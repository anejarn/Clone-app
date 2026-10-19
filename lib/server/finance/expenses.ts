import "server-only";
import { randomBytes } from "node:crypto";
import { isoDay } from "@/lib/admin/calendar";
import { todayInTimeZone } from "@/lib/dates";
import { FINANCE_TIMEZONE } from "@/lib/finance/months";
import { EXPENSE_LIMITS, type ExpenseInput } from "@/lib/finance/expense-form";
import { postExpense, postExpenseReversal } from "@/lib/finance/post";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ExpenseCategory, ExpensePayer, ExpenseStatus, Role } from "@/lib/generated/prisma/enums";
import { fileStorage } from "@/lib/storage";
import { MAX_PHOTO_BYTES, sniffImageType } from "@/lib/storage/images";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";

/**
 * Expenses of the homes (Finances → Dépenses, Lot 6), associés only, every write audited:
 * - a DRAFT is typed, changed, given a receipt, deleted freely;
 * - « Valider » posts it to the journal (lib/finance/post.ts postExpense) and freezes it (database trigger
 *   expenses_immutable): the home's owner is copied on it then;
 * - a validated expense is never changed or deleted: « Contre-passer » (reason required) writes the opposite entry
 *   and marks it REVERSED; the correct one is typed again (« Dupliquer » prefills it);
 * - the receipt (JPEG, PNG, WebP or PDF, 5 MB at most, type read from the bytes) is stored by lib/storage under
 *   receipts/<organizationId>/<expenseId>/…; a validated expense without one can still get it (once).
 * A breakdown (Pannes) whose cost is « à refacturer » is proposed as an expense (ticketProposals) until an expense of
 * the same home names it. Another organization's expense, home or ticket is « introuvable ».
 */

export const MAX_RECEIPT_BYTES = MAX_PHOTO_BYTES;
export type ReceiptType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
const RECEIPT_EXTENSION: Record<ReceiptType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export function sniffReceiptType(bytes: Uint8Array): ReceiptType | null {
  const image = sniffImageType(bytes);
  if (image) return image;
  // "%PDF-"
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  return null;
}

const notFound = () => new AppError(404, "NOT_FOUND", "Dépense introuvable.");

function checkReceipt(bytes: Uint8Array): ReceiptType {
  if (bytes.byteLength === 0) throw new AppError(422, "INVALID_RECEIPT", "Le fichier est vide.");
  if (bytes.byteLength > MAX_RECEIPT_BYTES) throw new AppError(422, "INVALID_RECEIPT", `Justificatif trop lourd : ${MAX_RECEIPT_BYTES / 1024 / 1024} Mo au maximum.`);
  const type = sniffReceiptType(bytes);
  if (!type) throw new AppError(422, "INVALID_RECEIPT", "Format non accepté : photo (JPEG, PNG, WebP) ou PDF.");
  return type;
}

export interface ExpenseView {
  id: string;
  listingId: string;
  listingTitle: string;
  ownerName: string | null;
  ticketId: string | null;
  date: string;
  category: ExpenseCategory;
  description: string;
  supplier: string;
  amountCents: number;
  paidBy: ExpensePayer;
  rebillToOwner: boolean;
  status: ExpenseStatus;
  receipt: { contentType: string; size: number } | null;
  createdAt: string;
  validatedAt: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
}

const expenseSelect = {
  id: true,
  listingId: true,
  ownerId: true,
  ticketId: true,
  date: true,
  category: true,
  description: true,
  supplier: true,
  amountCents: true,
  paidBy: true,
  rebillToOwner: true,
  status: true,
  receiptKey: true,
  receiptContentType: true,
  receiptSize: true,
  createdAt: true,
  validatedAt: true,
  reversedAt: true,
  reversalReason: true,
  listing: { select: { title: true, owner: { select: { name: true } } } },
} satisfies Prisma.ExpenseSelect;

function toView(e: Prisma.ExpenseGetPayload<{ select: typeof expenseSelect }>): ExpenseView {
  return {
    id: e.id,
    listingId: e.listingId,
    listingTitle: e.listing.title,
    ownerName: e.listing.owner.name,
    ticketId: e.ticketId,
    date: isoDay(e.date),
    category: e.category,
    description: e.description,
    supplier: e.supplier,
    amountCents: e.amountCents,
    paidBy: e.paidBy,
    rebillToOwner: e.rebillToOwner,
    status: e.status,
    receipt: e.receiptKey && e.receiptContentType && e.receiptSize ? { contentType: e.receiptContentType, size: e.receiptSize } : null,
    createdAt: e.createdAt.toISOString(),
    validatedAt: e.validatedAt?.toISOString() ?? null,
    reversedAt: e.reversedAt?.toISOString() ?? null,
    reversalReason: e.reversalReason,
  };
}

export interface ExpenseFilters {
  /** yyyy-MM: expenses dated in that month. */
  month?: string;
  listingId?: string;
  status?: ExpenseStatus;
}

export async function listExpenses(organizationId: string, f: ExpenseFilters = {}, take = 200): Promise<ExpenseView[]> {
  const where: Prisma.ExpenseWhereInput = { organizationId };
  if (f.listingId) where.listingId = f.listingId;
  if (f.status) where.status = f.status;
  if (f.month) {
    const from = new Date(`${f.month}-01T00:00:00Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    where.date = { gte: from, lt: to };
  }
  const rows = await db.expense.findMany({ where, select: expenseSelect, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take });
  return rows.map(toView);
}

export async function getExpense(organizationId: string, id: string): Promise<ExpenseView | null> {
  const e = await db.expense.findFirst({ where: { id, organizationId }, select: expenseSelect });
  return e ? toView(e) : null;
}

/** The home (and the ticket, of the same home) must be the organization's. */
async function checkRefs(tx: Prisma.TransactionClient, organizationId: string, input: Pick<ExpenseInput, "listingId" | "ticketId">) {
  const listing = await tx.listing.findFirst({ where: { id: input.listingId, organizationId }, select: { id: true, ownerId: true } });
  if (!listing) throw new AppError(404, "NOT_FOUND", "Bien introuvable.");
  if (input.ticketId) {
    const t = await tx.ticket.findFirst({ where: { id: input.ticketId, organizationId, listingId: listing.id }, select: { id: true } });
    if (!t) throw new AppError(404, "NOT_FOUND", "Panne introuvable pour ce bien.");
  }
  return listing;
}

const auditDetails = (input: ExpenseInput): Prisma.InputJsonObject => ({
  listingId: input.listingId,
  date: input.date,
  category: input.category,
  amountCents: input.amountCents,
  paidBy: input.paidBy,
  rebillToOwner: input.rebillToOwner,
  ticketId: input.ticketId,
});

async function storeReceipt(organizationId: string, expenseId: string, bytes: Uint8Array) {
  const type = checkReceipt(bytes);
  const key = `receipts/${organizationId}/${expenseId}/${randomBytes(16).toString("hex")}.${RECEIPT_EXTENSION[type]}`;
  await fileStorage().put(key, bytes, type);
  return { receiptKey: key, receiptContentType: type, receiptSize: bytes.byteLength };
}

/** A new draft, with its receipt when one is given (stored first; removed again if the row can't be written). */
export async function createExpense(actor: Authorized, input: ExpenseInput, receipt?: Uint8Array | null): Promise<{ id: string }> {
  const { organizationId } = actor;
  const id = `exp_${randomBytes(12).toString("hex")}`;
  if (receipt) checkReceipt(receipt);
  await checkRefs(db, organizationId, input);
  const stored = receipt ? await storeReceipt(organizationId, id, receipt) : null;
  try {
    await db.$transaction(async (tx) => {
      await checkRefs(tx, organizationId, input);
      await tx.expense.create({
        data: { id, organizationId, listingId: input.listingId, ticketId: input.ticketId, date: new Date(`${input.date}T00:00:00Z`), category: input.category, description: input.description, supplier: input.supplier, amountCents: input.amountCents, paidBy: input.paidBy, rebillToOwner: input.rebillToOwner, createdById: actor.user.id, ...(stored ?? {}) },
      });
      await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "expense.created", targetType: "expense", targetId: id, details: { ...auditDetails(input), receipt: !!stored } });
    });
  } catch (e) {
    if (stored) await fileStorage().delete(stored.receiptKey);
    throw e;
  }
  return { id };
}

async function lockExpense(tx: Prisma.TransactionClient, organizationId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "expenses" WHERE "id" = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
  if (!rows[0]) throw notFound();
  return tx.expense.findUniqueOrThrow({ where: { id }, select: { id: true, organizationId: true, listingId: true, status: true, date: true, description: true, supplier: true, amountCents: true, paidBy: true, rebillToOwner: true, receiptKey: true, ownerId: true, listing: { select: { ownerId: true } } } });
}

const frozen = () => new AppError(409, "EXPENSE_VALIDATED", "Une dépense validée ne se modifie plus : contre-passez-la puis saisissez la bonne.");

export async function updateExpense(actor: Authorized, id: string, input: ExpenseInput): Promise<void> {
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    const e = await lockExpense(tx, organizationId, id);
    if (e.status !== "DRAFT") throw frozen();
    await checkRefs(tx, organizationId, input);
    await tx.expense.update({
      where: { id },
      data: { listingId: input.listingId, ticketId: input.ticketId, date: new Date(`${input.date}T00:00:00Z`), category: input.category, description: input.description, supplier: input.supplier, amountCents: input.amountCents, paidBy: input.paidBy, rebillToOwner: input.rebillToOwner },
    });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "expense.updated", targetType: "expense", targetId: id, details: auditDetails(input) });
  });
}

export async function deleteExpense(actor: Authorized, id: string): Promise<void> {
  const { organizationId } = actor;
  const key = await db.$transaction(async (tx) => {
    const e = await lockExpense(tx, organizationId, id);
    if (e.status !== "DRAFT") throw frozen();
    await tx.expense.delete({ where: { id } });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "expense.deleted", targetType: "expense", targetId: id, details: { listingId: e.listingId, amountCents: e.amountCents } });
    return e.receiptKey;
  });
  if (key) await fileStorage().delete(key);
}

/** Adds (DRAFT: or replaces) the receipt. A validated expense only gets one it didn't have. */
export async function attachReceipt(actor: Authorized, id: string, bytes: Uint8Array): Promise<void> {
  const { organizationId } = actor;
  checkReceipt(bytes);
  const current = await db.expense.findFirst({ where: { id, organizationId }, select: { status: true, receiptKey: true } });
  if (!current) throw notFound();
  if (current.status === "REVERSED" || (current.status === "VALIDATED" && current.receiptKey)) throw new AppError(409, "EXPENSE_VALIDATED", "Le justificatif d'une dépense validée ne se remplace pas.");
  const stored = await storeReceipt(organizationId, id, bytes);
  let old: string | null = null;
  try {
    await db.$transaction(async (tx) => {
      const e = await lockExpense(tx, organizationId, id);
      if (e.status === "REVERSED" || (e.status === "VALIDATED" && e.receiptKey)) throw new AppError(409, "EXPENSE_VALIDATED", "Le justificatif d'une dépense validée ne se remplace pas.");
      old = e.receiptKey;
      await tx.expense.update({ where: { id }, data: stored });
      await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "expense.receipt_added", targetType: "expense", targetId: id, details: { contentType: stored.receiptContentType, size: stored.receiptSize, replaced: !!old } });
    });
  } catch (e) {
    await fileStorage().delete(stored.receiptKey);
    throw e;
  }
  if (old) await fileStorage().delete(old);
}

/** Posts the draft to the journal and freezes it. */
export async function validateExpense(actor: Authorized, id: string): Promise<{ period: string }> {
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    const e = await lockExpense(tx, organizationId, id);
    if (e.status !== "DRAFT") throw new AppError(409, "EXPENSE_VALIDATED", "Cette dépense est déjà validée.");
    const ownerId = e.listing.ownerId;
    await tx.expense.update({ where: { id }, data: { status: "VALIDATED", validatedAt: new Date(), validatedById: actor.user.id, ownerId } });
    const posted = await postExpense(tx, { ...e, ownerId }, actor.user.id);
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "expense.validated", targetType: "expense", targetId: id, details: { amountCents: e.amountCents, period: posted.period, entryId: posted.id } });
    return { period: posted.period };
  });
}

/** Writes the opposite entry and marks the expense REVERSED. */
export async function reverseExpense(actor: Authorized, id: string, reason: string): Promise<void> {
  const { organizationId } = actor;
  const why = reason.trim();
  if (why.length < 2 || why.length > EXPENSE_LIMITS.reason) throw new AppError(422, "INVALID_REASON", "Indiquez la raison de la contre-passation (2 à 500 caractères).");
  await db.$transaction(async (tx) => {
    const e = await lockExpense(tx, organizationId, id);
    if (e.status === "DRAFT") throw new AppError(409, "EXPENSE_DRAFT", "Un brouillon se supprime ou se modifie : il n'y a rien à contre-passer.");
    if (e.status === "REVERSED") throw new AppError(409, "EXPENSE_REVERSED", "Cette dépense est déjà contre-passée.");
    const n = await postExpenseReversal(tx, { ...e, ownerId: e.ownerId ?? e.listing.ownerId }, actor.user.id, why);
    await tx.expense.update({ where: { id }, data: { status: "REVERSED", reversedAt: new Date(), reversedById: actor.user.id, reversalReason: why } });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "expense.reversed", targetType: "expense", targetId: id, details: { amountCents: e.amountCents, entries: n, reason: why } });
  });
}

/**
 * The receipt, for an associé of the expense's organization, or — once validated — for the owner of its home. Anything
 * else is null (404), so the answer never tells whether an expense exists.
 */
export async function readReceipt(viewer: { userId: string; role: Role; organizationId: string }, id: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const e = await db.expense.findFirst({ where: { id, organizationId: viewer.organizationId }, select: { receiptKey: true, receiptContentType: true, status: true, listing: { select: { ownerId: true } } } });
  if (!e?.receiptKey || !e.receiptContentType) return null;
  const allowed = viewer.role === "ADMIN" || (viewer.role === "OWNER" && e.status !== "DRAFT" && e.listing.ownerId === viewer.userId);
  if (!allowed) return null;
  const file = await fileStorage().get(e.receiptKey);
  return file ? { bytes: file.bytes, contentType: e.receiptContentType } : null;
}

export interface TicketProposal {
  ticketId: string;
  listingId: string;
  listingTitle: string;
  title: string;
  costCents: number;
  status: string;
  updatedAt: string;
}

/** Breakdowns with a cost « à refacturer » that no expense of their home names yet (drafts and validated count). */
export async function ticketProposals(organizationId: string, take = 20): Promise<TicketProposal[]> {
  const tickets = await db.ticket.findMany({
    where: { organizationId, rechargeOwner: true, costCents: { gt: 0 }, status: { not: "CANCELLED" } },
    select: { id: true, listingId: true, title: true, costCents: true, status: true, updatedAt: true, listing: { select: { title: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  if (!tickets.length) return [];
  const used = new Set((await db.expense.findMany({ where: { organizationId, ticketId: { in: tickets.map((t) => t.id) }, status: { not: "REVERSED" } }, select: { ticketId: true } })).map((e) => e.ticketId));
  return tickets
    .filter((t) => !used.has(t.id))
    .slice(0, take)
    .map((t) => ({ ticketId: t.id, listingId: t.listingId, listingTitle: t.listing.title, title: t.title, costCents: t.costCents!, status: t.status, updatedAt: t.updatedAt.toISOString() }));
}

/** The values to prefill a new expense from a ticket (« Créer la dépense »). */
export async function ticketPrefill(organizationId: string, ticketId: string): Promise<Record<string, string> | null> {
  const t = await db.ticket.findFirst({ where: { id: ticketId, organizationId }, select: { id: true, listingId: true, title: true, costCents: true, rechargeOwner: true, resolvedAt: true, updatedAt: true } });
  if (!t) return null;
  const cents = t.costCents ?? 0;
  return {
    listingId: t.listingId,
    ticketId: t.id,
    category: "REPAIR",
    description: `Réparation : ${t.title}`.slice(0, EXPENSE_LIMITS.description),
    amount: cents ? `${Math.floor(cents / 100)}${cents % 100 ? `,${String(cents % 100).padStart(2, "0")}` : ""}` : "",
    date: isoDay(todayInTimeZone(FINANCE_TIMEZONE, (t.resolvedAt ?? t.updatedAt).getTime())),
    paidBy: "SIGMA",
    rebillToOwner: t.rechargeOwner ? "on" : "",
  };
}

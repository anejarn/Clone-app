import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { isoDay } from "@/lib/admin/calendar";
import { todayInTimeZone } from "@/lib/dates";
import { ownerEffect, postingPeriod, type LedgerAccount } from "@/lib/finance/ledger";
import { FINANCE_TIMEZONE, isMonth, localMonth, monthOfDay, monthShort } from "@/lib/finance/months";
import { closedMonths, lockForPosting } from "@/lib/finance/post";
import { assembleStatement, type StatementBranding, type StatementData, type StatementInput } from "@/lib/finance/statement";
import { mergePdfs, renderStatementPdf, statementFileName } from "@/lib/finance/statement-pdf";
import type { MonthSplit } from "@/lib/finance/split";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { Role } from "@/lib/generated/prisma/enums";
import { fileStorage } from "@/lib/storage";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";

/**
 * Owners' monthly statements (Lot 6b): assembled from the journal (lib/finance/statement.ts, the same rows as the
 * monthly overview), drawn as a PDF (lib/finance/statement-pdf.ts), and — once the month is closed — stored with their
 * figures as an immutable, versioned snapshot (OwnerStatement; trigger owner_statements_immutable). Closing a month
 * generates every statement of the month (app/admin/finances/actions.ts); « Générer » again only writes a new version
 * for an owner whose figures changed (after a reopening, or a new organization header), « Régénérer » always does.
 * An open month only has a preview, watermarked « Provisoire », never stored. Transfers to owners (« virement
 * effectué ») are recorded here too, posted to the journal (OWNER_PAYOUT) and audited.
 *
 * Who sees what: associés everything of their organization; an owner only their own statements (by ownerId AND
 * organizationId); anything else is « introuvable » (null → 404), whether it exists or not.
 */

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

export interface StatementViewer {
  userId: string;
  role: Role;
  organizationId: string;
}

// ---------- Branding ----------

export interface Branding extends StatementBranding {
  logoKey: string | null;
}

export async function organizationBranding(organizationId: string): Promise<Branding> {
  const o = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, legalName: true, legalAddress: true, ice: true, rcNumber: true, taxIdNumber: true, logoKey: true, statementEurRateMicros: true },
  });
  return { name: o.name, legalName: o.legalName, legalAddress: o.legalAddress, ice: o.ice, rcNumber: o.rcNumber, taxIdNumber: o.taxIdNumber, hasLogo: !!o.logoKey, logoKey: o.logoKey, eurRateMicros: o.statementEurRateMicros };
}

async function logoOf(b: Branding) {
  if (!b.logoKey) return null;
  const f = await fileStorage().get(b.logoKey);
  if (!f) return null;
  const type = f.contentType === "image/png" ? "image/png" : f.contentType === "image/jpeg" ? "image/jpeg" : null;
  return type ? { bytes: f.bytes, type: type as "image/png" | "image/jpeg" } : null;
}

// ---------- Assembly ----------

/** The statement's inputs, from the database; null when `ownerId` is not an owner of the organization. */
export async function statementInput(organizationId: string, ownerId: string, month: string): Promise<{ input: StatementInput; closed: boolean; logoKey: string | null } | null> {
  if (!isMonth(month)) throw new AppError(400, "INVALID_INPUT", "Mois invalide.");
  const owner = await db.user.findFirst({ where: { id: ownerId, organizationId, role: "OWNER" }, select: { id: true, name: true } });
  if (!owner) return null;
  const [branding, closing, entries, previous, ownedListings] = await Promise.all([
    organizationBranding(organizationId),
    db.financeMonthClosing.findUnique({ where: { organizationId_month: { organizationId, month } }, select: { closed: true } }),
    db.financialEntry.findMany({
      where: { organizationId, ownerId, period: month },
      select: { id: true, kind: true, account: true, period: true, originPeriod: true, amountCents: true, listingId: true, bookingId: true, expenseId: true, description: true },
      orderBy: { seq: "asc" },
    }),
    db.financialEntry.groupBy({ by: ["account"], where: { organizationId, ownerId, period: { lt: month } }, _sum: { amountCents: true } }),
    db.listing.findMany({ where: { organizationId, ownerId }, select: { id: true, title: true, managementType: true, subleaseRentCents: true, subleaseRentFrom: true } }),
  ]);
  const closed = !!closing?.closed;
  const listingIds = [...new Set(entries.map((e) => e.listingId).filter((x): x is string => !!x))];
  const bookingIds = [...new Set(entries.map((e) => e.bookingId).filter((x): x is string => !!x))];
  const expenseIds = [...new Set(entries.map((e) => e.expenseId).filter((x): x is string => !!x))];
  const payoutEntryIds = entries.filter((e) => e.account === "OWNER_PAYOUT").map((e) => e.id);
  const [listings, bookings, expenses, payouts] = await Promise.all([
    db.listing.findMany({ where: { organizationId, id: { in: [...new Set([...listingIds, ...ownedListings.map((l) => l.id)])] } }, select: { id: true, title: true, managementType: true } }),
    bookingIds.length
      ? db.booking.findMany({ where: { organizationId, id: { in: bookingIds } }, select: { id: true, checkIn: true, checkOut: true, source: true, finance: { select: { nights: true, months: true } } } })
      : [],
    expenseIds.length ? db.expense.findMany({ where: { organizationId, id: { in: expenseIds } }, select: { id: true, date: true, description: true, supplier: true, receiptKey: true } }) : [],
    payoutEntryIds.length
      ? db.ownerPayout.findMany({ where: { organizationId, ownerId, OR: [{ entryId: { in: payoutEntryIds } }, { reversalEntryId: { in: payoutEntryIds } }] } })
      : [],
  ]);
  const projectedRents = closed
    ? []
    : ownedListings
        .filter((l) => l.managementType === "SUBLEASE" && (l.subleaseRentCents ?? 0) > 0 && (!l.subleaseRentFrom || monthOfDay(isoDay(l.subleaseRentFrom)) <= month))
        .map((l) => ({ listingId: l.id, cents: l.subleaseRentCents! }));
  const byEntry = new Map<string, { p: (typeof payouts)[number]; reversal: boolean }>();
  for (const p of payouts) {
    byEntry.set(p.entryId, { p, reversal: false });
    if (p.reversalEntryId) byEntry.set(p.reversalEntryId, { p, reversal: true });
  }
  const prevSum = (a: LedgerAccount) => previous.filter((r) => r.account === a).reduce((s, r) => s + (r._sum.amountCents ?? 0), 0);
  const input: StatementInput = {
    branding,
    owner,
    month,
    provisional: !closed,
    listings: listings.map((l) => ({ id: l.id, title: l.title, managementType: l.managementType })),
    entries: entries.map((e) => ({ kind: e.kind, account: e.account, period: e.period, originPeriod: e.originPeriod, amountCents: e.amountCents, listingId: e.listingId, bookingId: e.bookingId, expenseId: e.expenseId, description: e.description })),
    bookings: bookings.map((b) => {
      const months = ((b.finance?.months ?? []) as unknown as MonthSplit[]).map((m) => [m.month, m.nights] as const);
      return { id: b.id, checkIn: isoDay(b.checkIn), checkOut: isoDay(b.checkOut), source: b.source, nights: b.finance?.nights ?? 0, monthNights: Object.fromEntries(months) };
    }),
    expenses: expenses.map((e) => ({ id: e.id, date: isoDay(e.date), description: e.description, supplier: e.supplier, hasReceipt: !!e.receiptKey })),
    previousNetDueCents: previous.reduce((s, r) => s + ownerEffect(r.account as LedgerAccount, r._sum.amountCents ?? 0), 0),
    previousPayoutsCents: prevSum("OWNER_PAYOUT"),
    payouts: entries
      .filter((e) => e.account === "OWNER_PAYOUT")
      .map((e) => {
        const x = byEntry.get(e.id);
        return { paidOn: x ? isoDay(x.p.paidOn) : "", reference: x?.p.reference ?? "", forMonth: x?.p.month ?? month, reversal: x?.reversal ?? e.amountCents < 0, amountCents: e.amountCents };
      }),
    projectedRents,
  };
  return { input, closed, logoKey: branding.logoKey };
}

/** The statement's figures now (any month); null for an unknown owner. */
export async function buildStatement(organizationId: string, ownerId: string, month: string): Promise<{ data: StatementData; closed: boolean; logoKey: string | null } | null> {
  const s = await statementInput(organizationId, ownerId, month);
  if (!s) return null;
  return { data: assembleStatement(s.input), closed: s.closed, logoKey: s.logoKey };
}

/** An associé's preview of a month's statement, as it would be now (« Provisoire » while the month is open). */
export async function previewStatementPdf(actor: Authorized, ownerId: string, month: string, now = new Date()): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const s = await buildStatement(actor.organizationId, ownerId, month);
  if (!s) return null;
  const branding = await organizationBranding(actor.organizationId);
  const bytes = await renderStatementPdf(s.data, { version: null, generatedAt: now, logo: await logoOf(branding) });
  return { bytes, filename: statementFileName(month, null, s.data.owner.name) };
}

// ---------- Generation (closed months) ----------

export type GenerateResult = { status: "created"; id: string; version: number } | { status: "unchanged"; id: string; version: number };

/**
 * Writes version n + 1 of an owner's statement for a closed month — unless `force` is false and the figures are the
 * latest version's (« unchanged »). The PDF is stored first (a new key, never overwritten), then the row and its
 * audit entry in one transaction; the file is removed again if the row can't be written.
 */
export async function generateStatement(actor: Authorized, ownerId: string, month: string, opts: { force?: boolean; now?: Date } = {}): Promise<GenerateResult> {
  const { organizationId } = actor;
  const now = opts.now ?? new Date();
  const s = await buildStatement(organizationId, ownerId, month);
  if (!s) throw new AppError(404, "NOT_FOUND", "Propriétaire introuvable.");
  if (!s.closed) throw new AppError(409, "MONTH_OPEN", `${monthShort(month)} n'est pas clôturé : le relevé définitif se génère à la clôture (l'aperçu est provisoire).`);
  const dataHash = sha256(JSON.stringify(s.data));
  const latest = await db.ownerStatement.findFirst({ where: { organizationId, ownerId, month }, orderBy: { version: "desc" }, select: { id: true, version: true, dataHash: true } });
  if (!opts.force && latest?.dataHash === dataHash) return { status: "unchanged", id: latest.id, version: latest.version };
  const version = (latest?.version ?? 0) + 1;
  const branding = await organizationBranding(organizationId);
  const pdf = await renderStatementPdf(s.data, { version, generatedAt: now, logo: await logoOf(branding) });
  const fileKey = `statements/${organizationId}/${ownerId}/${month}-v${version}-${randomBytes(8).toString("hex")}.pdf`;
  const hash = sha256(pdf);
  await fileStorage().put(fileKey, pdf, "application/pdf");
  try {
    const row = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('sigma.statement'), hashtext(${`${organizationId}|${ownerId}|${month}`}))`;
      const current = await tx.ownerStatement.findFirst({ where: { organizationId, ownerId, month }, orderBy: { version: "desc" }, select: { version: true } });
      if ((current?.version ?? 0) !== version - 1) throw new AppError(409, "STATEMENT_CONFLICT", "Un autre relevé de ce mois vient d'être généré : rechargez la page.");
      const created = await tx.ownerStatement.create({
        data: {
          organizationId,
          ownerId,
          month,
          version,
          fileKey,
          sha256: hash,
          sizeBytes: pdf.byteLength,
          dataHash,
          data: s.data as unknown as Prisma.InputJsonObject,
          netDueCents: s.data.summary.netDueCents,
          balanceCents: s.data.summary.balanceCents,
          generatedAt: now,
          generatedById: actor.user.id,
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        organizationId,
        actorId: actor.user.id,
        action: "statement.generated",
        targetType: "owner_statement",
        targetId: created.id,
        details: { ownerId, month, version, sha256: hash, netDueCents: s.data.summary.netDueCents, balanceCents: s.data.summary.balanceCents, forced: !!opts.force },
      });
      return created;
    });
    return { status: "created", id: row.id, version };
  } catch (e) {
    await fileStorage().delete(fileKey);
    throw e;
  }
}

/** The owners a month's statements are for: entries in the month, or a balance carried from earlier months. */
export async function statementOwners(organizationId: string, month: string): Promise<string[]> {
  const [inMonth, before, owners] = await Promise.all([
    db.financialEntry.findMany({ where: { organizationId, period: month, ownerId: { not: null } }, distinct: ["ownerId"], select: { ownerId: true } }),
    db.financialEntry.groupBy({ by: ["ownerId", "account"], where: { organizationId, period: { lt: month }, ownerId: { not: null } }, _sum: { amountCents: true } }),
    db.user.findMany({ where: { organizationId, role: "OWNER" }, select: { id: true } }),
  ]);
  const isOwner = new Set(owners.map((o) => o.id));
  const balance = new Map<string, number>();
  for (const r of before) {
    const effect = r.account === "OWNER_PAYOUT" ? -(r._sum.amountCents ?? 0) : ownerEffect(r.account as LedgerAccount, r._sum.amountCents ?? 0);
    balance.set(r.ownerId!, (balance.get(r.ownerId!) ?? 0) + effect);
  }
  const ids = new Set([...inMonth.map((r) => r.ownerId!), ...[...balance].filter(([, v]) => v !== 0).map(([k]) => k)]);
  return [...ids].filter((id) => isOwner.has(id)).sort();
}

/** « Générer les relevés du mois »: every owner's statement of a closed month (new versions only where it changed). */
export async function generateMonthStatements(actor: Authorized, month: string, now = new Date()): Promise<{ created: number; unchanged: number }> {
  if (!isMonth(month)) throw new AppError(400, "INVALID_INPUT", "Mois invalide.");
  const closing = await db.financeMonthClosing.findUnique({ where: { organizationId_month: { organizationId: actor.organizationId, month } }, select: { closed: true } });
  if (!closing?.closed) throw new AppError(409, "MONTH_OPEN", `${monthShort(month)} n'est pas clôturé : clôturez-le pour générer les relevés.`);
  let created = 0;
  let unchanged = 0;
  for (const ownerId of await statementOwners(actor.organizationId, month)) {
    const r = await generateStatement(actor, ownerId, month, { now });
    if (r.status === "created") created++;
    else unchanged++;
  }
  return { created, unchanged };
}

// ---------- Reading ----------

export interface StatementRow {
  id: string;
  month: string;
  version: number;
  versions: number;
  generatedAt: string;
  netDueCents: number;
  balanceCents: number;
  sha256: string;
}

export interface PayoutView {
  id: string;
  month: string;
  amountCents: number;
  paidOn: string;
  reference: string;
  createdAt: string;
  reversed: { at: string; reason: string } | null;
}

const payoutView = (p: { id: string; month: string; amountCents: number; paidOn: Date; reference: string; createdAt: Date; reversedAt: Date | null; reversalReason: string | null }): PayoutView => ({
  id: p.id,
  month: p.month,
  amountCents: p.amountCents,
  paidOn: isoDay(p.paidOn),
  reference: p.reference,
  createdAt: p.createdAt.toISOString(),
  reversed: p.reversedAt ? { at: p.reversedAt.toISOString(), reason: p.reversalReason ?? "" } : null,
});

/** The latest version of every statement of an owner (most recent month first), with the transfers of each month. */
export async function ownerStatementList(organizationId: string, ownerId: string): Promise<(StatementRow & { payouts: PayoutView[] })[]> {
  const [rows, payouts] = await Promise.all([
    db.ownerStatement.findMany({
      where: { organizationId, ownerId },
      select: { id: true, month: true, version: true, generatedAt: true, netDueCents: true, balanceCents: true, sha256: true },
      orderBy: [{ month: "desc" }, { version: "desc" }],
    }),
    db.ownerPayout.findMany({ where: { organizationId, ownerId }, orderBy: { createdAt: "asc" } }),
  ]);
  const out: (StatementRow & { payouts: PayoutView[] })[] = [];
  for (const r of rows) {
    if (out.some((x) => x.month === r.month)) continue;
    out.push({
      ...r,
      generatedAt: r.generatedAt.toISOString(),
      versions: rows.filter((x) => x.month === r.month).length,
      payouts: payouts.filter((p) => p.month === r.month).map(payoutView),
    });
  }
  return out;
}

export interface MonthStatementRow {
  ownerId: string;
  ownerName: string;
  latest: StatementRow | null;
  history: { id: string; version: number; generatedAt: string; netDueCents: number }[];
  payouts: PayoutView[];
  /** Latest statement's balance − the transfers recorded for this month (not reversed): what is left to pay. */
  leftToPayCents: number | null;
}

/** Finances → Relevés: the month's owners, their statements (every version) and transfers. */
export async function monthStatements(organizationId: string, month: string): Promise<MonthStatementRow[]> {
  if (!isMonth(month)) throw new AppError(400, "INVALID_INPUT", "Mois invalide.");
  const [owners, statements, payouts] = await Promise.all([
    statementOwners(organizationId, month),
    db.ownerStatement.findMany({
      where: { organizationId, month },
      select: { id: true, ownerId: true, month: true, version: true, generatedAt: true, netDueCents: true, balanceCents: true, sha256: true },
      orderBy: { version: "desc" },
    }),
    db.ownerPayout.findMany({ where: { organizationId, month }, orderBy: { createdAt: "asc" } }),
  ]);
  const ids = [...new Set([...owners, ...statements.map((s) => s.ownerId)])];
  const names = new Map((ids.length ? await db.user.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  return ids
    .map((ownerId) => {
      const mine = statements.filter((s) => s.ownerId === ownerId);
      const p = payouts.filter((x) => x.ownerId === ownerId);
      const latest = mine[0] ? { ...mine[0], generatedAt: mine[0].generatedAt.toISOString(), versions: mine.length } : null;
      const paid = p.filter((x) => !x.reversedAt).reduce((s, x) => s + x.amountCents, 0);
      return {
        ownerId,
        ownerName: names.get(ownerId) ?? "Propriétaire",
        latest,
        history: mine.map((s) => ({ id: s.id, version: s.version, generatedAt: s.generatedAt.toISOString(), netDueCents: s.netDueCents })),
        payouts: p.map(payoutView),
        leftToPayCents: latest ? latest.balanceCents - paid : null,
      };
    })
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName, "fr"));
}

/**
 * A stored statement's PDF for an associé of its organization or its own owner; null (404) for anyone else and for
 * unknown ids. The bytes are checked against the SHA-256 stored at generation: a file changed on disk is an error.
 */
export async function readStatementPdf(viewer: StatementViewer, id: string): Promise<{ bytes: Uint8Array; filename: string } | null> {
  if (viewer.role !== "ADMIN" && viewer.role !== "OWNER") return null;
  const s = await db.ownerStatement.findFirst({
    where: { id, organizationId: viewer.organizationId, ...(viewer.role === "OWNER" && { ownerId: viewer.userId }) },
    select: { fileKey: true, sha256: true, month: true, version: true, owner: { select: { name: true } } },
  });
  if (!s) return null;
  const file = await fileStorage().get(s.fileKey);
  if (!file) throw new Error(`statement file missing: ${id}`);
  if (sha256(file.bytes) !== s.sha256) throw new Error(`statement file altered: ${id}`);
  return { bytes: file.bytes, filename: statementFileName(s.month, s.version, s.owner.name) };
}

/** Every owner's latest statement of a month, as one PDF (associés). */
export async function monthStatementsPdf(actor: Authorized, month: string): Promise<Uint8Array | null> {
  const rows = await monthStatements(actor.organizationId, month);
  const files: Uint8Array[] = [];
  for (const r of rows) {
    if (!r.latest) continue;
    const f = await readStatementPdf({ userId: actor.user.id, role: "ADMIN", organizationId: actor.organizationId }, r.latest.id);
    if (f) files.push(f.bytes);
  }
  return files.length ? mergePdfs(files, `Relevés ${monthShort(month)}`) : null;
}

// ---------- Transfers to owners ----------

export interface PayoutInput {
  ownerId: string;
  month: string;
  /** yyyy-MM-dd. */
  paidOn: string;
  reference: string;
  amountCents: number;
}

/** « Virement effectué »: recorded against the month's statement, posted to the journal, audited. */
export async function recordOwnerPayout(actor: Authorized, input: PayoutInput, now = new Date()): Promise<{ id: string; period: string }> {
  const { organizationId } = actor;
  const reference = input.reference.trim();
  const today = isoDay(todayInTimeZone(FINANCE_TIMEZONE, now.getTime()));
  if (!isMonth(input.month) || !/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) throw new AppError(400, "INVALID_INPUT", "Mois ou date invalide.");
  if (input.paidOn > today) throw new AppError(422, "INVALID_DATE", "La date du virement ne peut pas être dans le futur.");
  if (input.paidOn < `${input.month}-01`) throw new AppError(422, "INVALID_DATE", "Le virement d'un relevé est daté au plus tôt du premier jour de son mois.");
  if (reference.length < 2 || reference.length > 100) throw new AppError(422, "INVALID_REFERENCE", "Indiquez la référence du virement (2 à 100 caractères).");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > 100_000_000) throw new AppError(422, "INVALID_AMOUNT", "Montant invalide.");
  return db.$transaction(async (tx) => {
    await lockForPosting(tx, organizationId, `payout:${input.ownerId}`);
    const owner = await tx.user.findFirst({ where: { id: input.ownerId, organizationId, role: "OWNER" }, select: { id: true, name: true } });
    if (!owner) throw new AppError(404, "NOT_FOUND", "Propriétaire introuvable.");
    const statement = await tx.ownerStatement.findFirst({ where: { organizationId, ownerId: owner.id, month: input.month }, orderBy: { version: "desc" }, select: { id: true } });
    if (!statement) throw new AppError(409, "NO_STATEMENT", `Générez d'abord le relevé de ${monthShort(input.month)}.`);
    const period = postingPeriod(monthOfDay(input.paidOn), await closedMonths(tx, organizationId));
    const day = `${input.paidOn.slice(8, 10)}/${input.paidOn.slice(5, 7)}/${input.paidOn.slice(0, 4)}`;
    const entry = await tx.financialEntry.create({
      data: { organizationId, actorId: actor.user.id, kind: "OWNER_PAYOUT", account: "OWNER_PAYOUT", period, amountCents: input.amountCents, ownerId: owner.id, description: `Virement à ${owner.name} le ${day} · réf. ${reference} · relevé ${monthShort(input.month)}`.slice(0, 500) },
      select: { id: true },
    });
    const p = await tx.ownerPayout.create({
      data: { organizationId, ownerId: owner.id, month: input.month, statementId: statement.id, amountCents: input.amountCents, paidOn: new Date(`${input.paidOn}T00:00:00Z`), reference, entryId: entry.id, createdById: actor.user.id },
      select: { id: true },
    });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "owner_payout.recorded", targetType: "owner_payout", targetId: p.id, details: { ownerId: owner.id, month: input.month, amountCents: input.amountCents, paidOn: input.paidOn, reference, period, entryId: entry.id } });
    return { id: p.id, period };
  });
}

/** Takes back a transfer recorded by mistake: the opposite entry in the current open month, reason required. */
export async function reverseOwnerPayout(actor: Authorized, id: string, reason: string, now = new Date()): Promise<void> {
  const { organizationId } = actor;
  const why = reason.trim();
  if (why.length < 2 || why.length > 500) throw new AppError(422, "INVALID_REASON", "Indiquez la raison de l'annulation (2 à 500 caractères).");
  await db.$transaction(async (tx) => {
    const p = await tx.ownerPayout.findFirst({ where: { id, organizationId } });
    if (!p) throw new AppError(404, "NOT_FOUND", "Virement introuvable.");
    await lockForPosting(tx, organizationId, `payout:${p.ownerId}`);
    const fresh = await tx.ownerPayout.findUniqueOrThrow({ where: { id }, select: { reversedAt: true } });
    if (fresh.reversedAt) throw new AppError(409, "ALREADY_REVERSED", "Ce virement est déjà annulé.");
    const period = postingPeriod(localMonth(now), await closedMonths(tx, organizationId));
    const entry = await tx.financialEntry.create({
      data: { organizationId, actorId: actor.user.id, kind: "OWNER_PAYOUT", account: "OWNER_PAYOUT", period, amountCents: -p.amountCents, ownerId: p.ownerId, reversesId: p.entryId, description: `Annulation du virement réf. ${p.reference} (relevé ${monthShort(p.month)}) : ${why}`.slice(0, 500) },
      select: { id: true },
    });
    await tx.ownerPayout.update({ where: { id }, data: { reversedAt: now, reversedById: actor.user.id, reversalReason: why, reversalEntryId: entry.id } });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "owner_payout.reversed", targetType: "owner_payout", targetId: id, details: { ownerId: p.ownerId, month: p.month, amountCents: p.amountCents, reason: why, period, entryId: entry.id } });
  });
}

// ---------- Statement header (organization parameters) ----------

export interface BrandingInput {
  legalName: string;
  legalAddress: string;
  ice: string;
  rcNumber: string;
  taxIdNumber: string;
  /** Millionths of MAD per euro, or null for MAD only. */
  eurRateMicros: number | null;
}

export const MAX_LOGO_BYTES = 1024 * 1024;

/**
 * Saves the header printed on the statements (Finances → Paramètres), with an optional new logo (PNG or JPEG, 1 MB at
 * most: what the PDF can embed) or its removal. Existing statements keep the header they were drawn with; the next
 * « Générer » writes new versions. Audited « organization.branding_updated » (from → to, never the image).
 */
export async function saveStatementBranding(actor: Authorized, input: BrandingInput, logo: Uint8Array | "remove" | null = null): Promise<void> {
  const { organizationId } = actor;
  const v = { legalName: input.legalName.trim(), legalAddress: input.legalAddress.trim(), ice: input.ice.replace(/\s/g, ""), rcNumber: input.rcNumber.trim(), taxIdNumber: input.taxIdNumber.trim(), statementEurRateMicros: input.eurRateMicros };
  if (v.legalName.length > 120 || v.legalAddress.length > 300 || v.rcNumber.length > 60 || v.taxIdNumber.length > 30) throw new AppError(422, "INVALID_INPUT", "Un des champs est trop long.");
  if (v.ice && !/^\d{15}$/.test(v.ice)) throw new AppError(422, "INVALID_ICE", "L'ICE compte 15 chiffres.");
  if (v.statementEurRateMicros !== null && (!Number.isSafeInteger(v.statementEurRateMicros) || v.statementEurRateMicros < 1 || v.statementEurRateMicros > 1_000_000_000)) throw new AppError(422, "INVALID_RATE", "Taux invalide.");
  let newKey: string | null = null;
  if (logo instanceof Uint8Array) {
    if (logo.byteLength === 0 || logo.byteLength > MAX_LOGO_BYTES) throw new AppError(422, "INVALID_LOGO", "Logo : 1 Mo au maximum.");
    const png = logo[0] === 0x89 && logo[1] === 0x50 && logo[2] === 0x4e && logo[3] === 0x47;
    const jpg = logo[0] === 0xff && logo[1] === 0xd8 && logo[2] === 0xff;
    if (!png && !jpg) throw new AppError(422, "INVALID_LOGO", "Logo : PNG ou JPEG uniquement.");
    newKey = `branding/${organizationId}/${randomBytes(12).toString("hex")}.${png ? "png" : "jpg"}`;
    await fileStorage().put(newKey, logo, png ? "image/png" : "image/jpeg");
  }
  let oldKey: string | null = null;
  try {
    await db.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { legalName: true, legalAddress: true, ice: true, rcNumber: true, taxIdNumber: true, statementEurRateMicros: true, logoKey: true } });
      const logoKey = newKey ?? (logo === "remove" ? null : before.logoKey);
      if (logoKey !== before.logoKey) oldKey = before.logoKey;
      await tx.organization.update({ where: { id: organizationId }, data: { ...v, logoKey } });
      const { logoKey: hadLogo, ...from } = before;
      await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "organization.branding_updated", targetType: "organization", targetId: organizationId, details: { from: { ...from, logo: !!hadLogo }, to: { ...v, logo: !!logoKey } } });
    });
  } catch (e) {
    if (newKey) await fileStorage().delete(newKey);
    throw e;
  }
  if (oldKey) await fileStorage().delete(oldKey);
}

/**
 * One stored statement with its figures, for its owner (portal) — or an associé of its organization; null for anyone
 * else and unknown ids. With the other versions of the same month and the month's transfers.
 */
export async function statementDetail(viewer: StatementViewer, id: string) {
  if (viewer.role !== "ADMIN" && viewer.role !== "OWNER") return null;
  const s = await db.ownerStatement.findFirst({
    where: { id, organizationId: viewer.organizationId, ...(viewer.role === "OWNER" && { ownerId: viewer.userId }) },
    select: { id: true, ownerId: true, month: true, version: true, generatedAt: true, data: true, netDueCents: true, balanceCents: true },
  });
  if (!s) return null;
  const [versions, payouts] = await Promise.all([
    db.ownerStatement.findMany({ where: { organizationId: viewer.organizationId, ownerId: s.ownerId, month: s.month }, select: { id: true, version: true, generatedAt: true }, orderBy: { version: "desc" } }),
    db.ownerPayout.findMany({ where: { organizationId: viewer.organizationId, ownerId: s.ownerId, month: s.month }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    id: s.id,
    month: s.month,
    version: s.version,
    generatedAt: s.generatedAt.toISOString(),
    data: s.data as unknown as StatementData,
    versions: versions.map((v) => ({ id: v.id, version: v.version, generatedAt: v.generatedAt.toISOString() })),
    payouts: payouts.map(payoutView),
  };
}

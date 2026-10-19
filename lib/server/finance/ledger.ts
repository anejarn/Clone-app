import "server-only";
import { isoDay } from "@/lib/admin/calendar";
import type { LedgerExportRow } from "@/lib/finance/csv";
import { totalsBy, totalsOf, type LedgerRow, type MonthTotals } from "@/lib/finance/ledger";
import { addMonths, isMonth, localMonth, monthOfDay, monthShort, monthWindow } from "@/lib/finance/months";
import { closedMonths, lockForClosing, postSubleaseRents } from "@/lib/finance/post";
import { MAX_PLATFORM_FEE_BPS, PLATFORM_SOURCES, platformFeeRates, type PlatformSource } from "@/lib/finance/platform-fees";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { CommissionBase, FeeBeneficiary, LedgerKind, ManagementType, RevenueAllocation } from "@/lib/generated/prisma/enums";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";

/**
 * The journal, the monthly overview and the closing (Finances, Lot 6), associés only.
 *
 * - The **monthly overview** reads the journal: a month shows what was posted in it (adjustments of closed months
 *   included, flagged), by home and by owner, with the net due to each owner and Sigma's result. An open month also
 *   shows the sublease rents it will post when closed (« prévu »).
 * - **Closing** a month (only a past month): its sublease rents are posted, a MONTH_CLOSED marker is written, and
 *   from then on its entries never change — later changes of its stays go to the first open month. **Reopening**
 *   (reason required) writes a MONTH_REOPENED marker; both are audited.
 * - The **journal** lists the entries with their author, filterable by months, home and owner, and is exported as CSV
 *   (lib/finance/csv.ts), each export audited with its filters and row count.
 */

export const MAX_EXPORT_ROWS = 50_000;

export interface JournalFilters {
  from: string;
  to: string;
  listingId?: string;
  ownerId?: string;
}

export function journalWhere(organizationId: string, f: JournalFilters): Prisma.FinancialEntryWhereInput {
  return {
    organizationId,
    period: { gte: f.from, lte: f.to },
    ...(f.listingId && { listingId: f.listingId }),
    ...(f.ownerId && { ownerId: f.ownerId }),
  };
}

/** Entries with the names of their home, owner and author, oldest first. */
export async function journalRows(organizationId: string, f: JournalFilters, take = MAX_EXPORT_ROWS): Promise<LedgerExportRow[]> {
  const rows = await db.financialEntry.findMany({ where: journalWhere(organizationId, f), orderBy: { seq: "asc" }, take });
  const listingIds = [...new Set(rows.map((r) => r.listingId).filter((x): x is string => !!x))];
  const userIds = [...new Set(rows.flatMap((r) => [r.ownerId, r.actorId]).filter((x): x is string => !!x))];
  const bookingIds = [...new Set(rows.map((r) => r.bookingId).filter((x): x is string => !!x))];
  const [listings, users, bookings] = await Promise.all([
    listingIds.length ? db.listing.findMany({ where: { id: { in: listingIds }, organizationId }, select: { id: true, title: true } }) : [],
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    bookingIds.length ? db.booking.findMany({ where: { id: { in: bookingIds }, organizationId }, select: { id: true, externalRef: true } }) : [],
  ]);
  const title = new Map(listings.map((l) => [l.id, l.title]));
  const name = new Map(users.map((u) => [u.id, u.name]));
  const ref = new Map(bookings.map((b) => [b.id, b.externalRef]));
  return rows.map((r) => ({
    seq: r.seq,
    createdAt: r.createdAt,
    period: r.period,
    originPeriod: r.originPeriod,
    kind: r.kind,
    account: r.account,
    amountCents: r.amountCents,
    description: r.description,
    listingId: r.listingId,
    listingTitle: r.listingId ? (title.get(r.listingId) ?? null) : null,
    ownerId: r.ownerId,
    ownerName: r.ownerId ? (name.get(r.ownerId) ?? null) : null,
    bookingId: r.bookingId,
    bookingRef: r.bookingId ? (ref.get(r.bookingId) ?? null) : null,
    expenseId: r.expenseId,
    serviceRequestId: r.serviceRequestId,
    reversesId: r.reversesId,
    actorId: r.actorId,
    actorName: r.actorId ? (name.get(r.actorId) ?? null) : null,
  }));
}

/** The rows of a CSV export, audited « finance.exported ». */
export async function exportJournal(actor: Authorized, f: JournalFilters, variant: string): Promise<LedgerExportRow[]> {
  const rows = await journalRows(actor.organizationId, f);
  await db.$transaction((tx) =>
    recordAudit(tx, { organizationId: actor.organizationId, actorId: actor.user.id, action: "finance.exported", targetType: "organization", targetId: actor.organizationId, details: { ...f, variant, rows: rows.length } }),
  );
  return rows;
}

// ---------- Monthly overview ----------

export interface ListingMonth {
  listingId: string;
  title: string;
  managementType: ManagementType;
  ownerId: string;
  ownerName: string;
  totals: MonthTotals;
  /** Open month: the rent that closing will post (sublease homes). */
  projectedRentCents: number;
}

export interface OwnerMonth {
  ownerId: string;
  ownerName: string;
  listings: number;
  totals: MonthTotals;
  projectedRentCents: number;
}

export interface MonthOverview {
  month: string;
  closed: boolean;
  closedAt: string | null;
  /** A month can be closed once it is over. */
  closable: boolean;
  totals: MonthTotals;
  listings: ListingMonth[];
  owners: OwnerMonth[];
  /** Splits of the month's stays waiting for an amount or a rate. */
  incomplete: number;
  draftExpenses: number;
}

export async function monthOverview(organizationId: string, month: string, now = new Date()): Promise<MonthOverview> {
  if (!isMonth(month)) throw new AppError(400, "INVALID_INPUT", "Mois invalide.");
  const { from, to } = monthWindow(month);
  const [entries, closing, listings, incomplete, draftExpenses] = await Promise.all([
    db.financialEntry.findMany({ where: { organizationId, period: month }, select: { kind: true, account: true, period: true, originPeriod: true, amountCents: true, listingId: true, ownerId: true } }),
    db.financeMonthClosing.findUnique({ where: { organizationId_month: { organizationId, month } } }),
    db.listing.findMany({ where: { organizationId }, select: { id: true, title: true, managementType: true, ownerId: true, subleaseRentCents: true, subleaseRentFrom: true, owner: { select: { name: true } } }, orderBy: { title: "asc" } }),
    db.bookingFinance.count({ where: { organizationId, status: { in: ["MISSING_AMOUNT", "MISSING_RATE"] }, booking: { status: "CONFIRMED", checkIn: { lt: new Date(`${to}T00:00:00Z`) }, checkOut: { gt: new Date(`${from}T00:00:00Z`) } } } }),
    db.expense.count({ where: { organizationId, status: "DRAFT", date: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${to}T00:00:00Z`) } } }),
  ]);
  const closed = !!closing?.closed;
  const rows = entries as LedgerRow[];
  const byListing = totalsBy(rows, (r) => r.listingId);
  const projected = (l: (typeof listings)[number]) =>
    !closed && l.managementType === "SUBLEASE" && (l.subleaseRentCents ?? 0) > 0 && (!l.subleaseRentFrom || monthOfDay(isoDay(l.subleaseRentFrom)) <= month) ? l.subleaseRentCents! : 0;
  const listingRows: ListingMonth[] = listings
    .map((l) => ({ listingId: l.id, title: l.title, managementType: l.managementType, ownerId: l.ownerId, ownerName: l.owner.name, totals: byListing.get(l.id) ?? totalsOf([]), projectedRentCents: projected(l) }))
    .filter((l) => byListing.has(l.listingId) || l.projectedRentCents > 0);
  // Owners by the owner recorded on each entry (the owner when it was posted), names from the accounts.
  const byOwner = totalsBy(rows, (r) => r.ownerId);
  const ownerIds = [...new Set([...byOwner.keys(), ...listingRows.filter((l) => l.projectedRentCents).map((l) => l.ownerId)])];
  const names = new Map((ownerIds.length ? await db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  const owners: OwnerMonth[] = ownerIds
    .map((id) => ({
      ownerId: id,
      ownerName: names.get(id) ?? "Propriétaire supprimé",
      listings: new Set([...rows.filter((r) => r.ownerId === id && r.listingId).map((r) => r.listingId), ...listingRows.filter((l) => l.ownerId === id && l.projectedRentCents).map((l) => l.listingId)]).size,
      totals: byOwner.get(id) ?? totalsOf([]),
      projectedRentCents: listingRows.filter((l) => l.ownerId === id).reduce((s, l) => s + l.projectedRentCents, 0),
    }))
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName, "fr"));
  return {
    month,
    closed,
    closedAt: closing?.closedAt?.toISOString() ?? null,
    closable: month < localMonth(now),
    totals: totalsOf(rows),
    listings: listingRows,
    owners,
    incomplete,
    draftExpenses,
  };
}

// ---------- Closing ----------

export async function closeMonth(actor: Authorized, month: string, now = new Date()): Promise<{ rents: number }> {
  const { organizationId } = actor;
  if (!isMonth(month)) throw new AppError(400, "INVALID_INPUT", "Mois invalide.");
  if (month >= localMonth(now)) throw new AppError(422, "MONTH_NOT_OVER", "Un mois se clôture une fois terminé.");
  return db.$transaction(
    async (tx) => {
      await lockForClosing(tx, organizationId);
      const c = await tx.financeMonthClosing.findUnique({ where: { organizationId_month: { organizationId, month } } });
      if (c?.closed) throw new AppError(409, "MONTH_CLOSED", `${monthShort(month)} est déjà clôturé.`);
      const rents = await postSubleaseRents(tx, organizationId, month, actor.user.id);
      const sums = await tx.financialEntry.aggregate({ where: { organizationId, period: month }, _sum: { amountCents: true }, _count: true });
      await tx.financialEntry.create({ data: { organizationId, actorId: actor.user.id, kind: "MONTH_CLOSED", account: "NONE", period: month, amountCents: 0, description: `Clôture de ${monthShort(month)} · ${sums._count} écritures` } });
      await tx.financeMonthClosing.upsert({
        where: { organizationId_month: { organizationId, month } },
        create: { organizationId, month, closed: true, closedAt: now, closedById: actor.user.id },
        update: { closed: true, closedAt: now, closedById: actor.user.id },
      });
      await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "finance.month_closed", targetType: "finance_month", targetId: month, details: { month, entries: sums._count, rents } });
      return { rents };
    },
    { timeout: 30_000 },
  );
}

export async function reopenMonth(actor: Authorized, month: string, reason: string): Promise<void> {
  const { organizationId } = actor;
  if (!isMonth(month)) throw new AppError(400, "INVALID_INPUT", "Mois invalide.");
  const why = reason.trim();
  if (why.length < 2 || why.length > 500) throw new AppError(422, "INVALID_REASON", "Indiquez la raison de la réouverture (2 à 500 caractères).");
  await db.$transaction(async (tx) => {
    await lockForClosing(tx, organizationId);
    const c = await tx.financeMonthClosing.findUnique({ where: { organizationId_month: { organizationId, month } } });
    if (!c?.closed) throw new AppError(409, "MONTH_OPEN", `${monthShort(month)} n'est pas clôturé.`);
    await tx.financialEntry.create({ data: { organizationId, actorId: actor.user.id, kind: "MONTH_REOPENED", account: "NONE", period: month, amountCents: 0, description: `Réouverture de ${monthShort(month)} : ${why}`.slice(0, 500) } });
    await tx.financeMonthClosing.update({ where: { organizationId_month: { organizationId, month } }, data: { closed: false, closedAt: null, closedById: null } });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "finance.month_reopened", targetType: "finance_month", targetId: month, details: { month, reason: why } });
  });
}

/** The organization's closed months, most recent first. */
export async function closedMonthList(organizationId: string): Promise<string[]> {
  return [...(await closedMonths(db, organizationId))].sort().reverse();
}

// ---------- Manual adjustment ----------

/** An amount in the owner's favour (> 0) or against them (< 0) on a home, in an open month, with its reason. */
export async function addManualAdjustment(actor: Authorized, input: { listingId: string; month: string; amountCents: number; reason: string }): Promise<void> {
  const { organizationId } = actor;
  const why = input.reason.trim();
  if (!isMonth(input.month)) throw new AppError(400, "INVALID_INPUT", "Mois invalide.");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents === 0 || Math.abs(input.amountCents) > 100_000_000) throw new AppError(422, "INVALID_AMOUNT", "Montant invalide.");
  if (why.length < 2 || why.length > 300) throw new AppError(422, "INVALID_REASON", "Indiquez la raison de l'ajustement (2 à 300 caractères).");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('sigma.finance'), hashtext(${organizationId}))`;
    const l = await tx.listing.findFirst({ where: { id: input.listingId, organizationId }, select: { id: true, ownerId: true, title: true } });
    if (!l) throw new AppError(404, "NOT_FOUND", "Bien introuvable.");
    if ((await closedMonths(tx, organizationId)).has(input.month)) throw new AppError(409, "MONTH_CLOSED", `${monthShort(input.month)} est clôturé : choisissez un mois ouvert.`);
    const e = await tx.financialEntry.create({
      data: { organizationId, actorId: actor.user.id, kind: "MANUAL_ADJUSTMENT", account: "OWNER_ADJUSTMENT", period: input.month, amountCents: input.amountCents, listingId: l.id, ownerId: l.ownerId, description: `Ajustement · ${l.title} : ${why}`.slice(0, 500) },
      select: { id: true },
    });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "finance.adjustment_added", targetType: "listing", targetId: l.id, details: { month: input.month, amountCents: input.amountCents, reason: why, entryId: e.id } });
  });
}

// ---------- Settings ----------

export interface FinanceSettings {
  cleaningBeneficiary: FeeBeneficiary;
  commissionBase: CommissionBase;
  allocation: RevenueAllocation;
  platformFeeBps: Record<PlatformSource, number>;
  defaultCommissionBps: number;
}

export async function getFinanceSettings(organizationId: string): Promise<FinanceSettings> {
  const o = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { financeCleaningBeneficiary: true, financeCommissionBase: true, financeAllocation: true, platformFeeBps: true, defaultCommissionBps: true } });
  return { cleaningBeneficiary: o.financeCleaningBeneficiary, commissionBase: o.financeCommissionBase, allocation: o.financeAllocation, platformFeeBps: platformFeeRates(o.platformFeeBps), defaultCommissionBps: o.defaultCommissionBps };
}

/** New splits take these; existing splits keep their terms until « Réappliquer les conditions du bien ». */
export async function saveFinanceSettings(actor: Authorized, s: Omit<FinanceSettings, "defaultCommissionBps">): Promise<void> {
  for (const p of PLATFORM_SOURCES) if (!Number.isSafeInteger(s.platformFeeBps[p]) || s.platformFeeBps[p] < 0 || s.platformFeeBps[p] > MAX_PLATFORM_FEE_BPS) throw new AppError(422, "INVALID_RATE", "Taux de frais de plateforme entre 0 et 50 %.");
  await db.$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { financeCleaningBeneficiary: true, financeCommissionBase: true, financeAllocation: true, platformFeeBps: true } });
    await tx.organization.update({ where: { id: actor.organizationId }, data: { financeCleaningBeneficiary: s.cleaningBeneficiary, financeCommissionBase: s.commissionBase, financeAllocation: s.allocation, platformFeeBps: s.platformFeeBps } });
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.user.id,
      action: "finance.settings_updated",
      targetType: "organization",
      targetId: actor.organizationId,
      details: { from: { ...before, platformFeeBps: platformFeeRates(before.platformFeeBps) }, to: s as unknown as Prisma.InputJsonObject },
    });
  });
}

export interface ListingTerms {
  listingId: string;
  title: string;
  managementType: ManagementType;
  commissionBps: number;
  cleaningFeeBeneficiary: FeeBeneficiary | null;
  subleaseRentCents: number | null;
  subleaseRentFrom: string | null;
  ownerName: string;
}

export async function listingTerms(organizationId: string): Promise<ListingTerms[]> {
  const rows = await db.listing.findMany({ where: { organizationId }, select: { id: true, title: true, managementType: true, commissionBps: true, cleaningFeeBeneficiary: true, subleaseRentCents: true, subleaseRentFrom: true, owner: { select: { name: true } } }, orderBy: { title: "asc" } });
  return rows.map((l) => ({ listingId: l.id, title: l.title, managementType: l.managementType, commissionBps: l.commissionBps, cleaningFeeBeneficiary: l.cleaningFeeBeneficiary, subleaseRentCents: l.subleaseRentCents, subleaseRentFrom: l.subleaseRentFrom ? isoDay(l.subleaseRentFrom) : null, ownerName: l.owner.name }));
}

export async function saveListingTerms(actor: Authorized, input: { listingId: string; cleaningFeeBeneficiary: FeeBeneficiary | null; subleaseRentCents: number | null; subleaseRentFrom: string | null }): Promise<void> {
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    const l = await tx.listing.findFirst({ where: { id: input.listingId, organizationId }, select: { id: true, managementType: true, cleaningFeeBeneficiary: true, subleaseRentCents: true, subleaseRentFrom: true } });
    if (!l) throw new AppError(404, "NOT_FOUND", "Bien introuvable.");
    if (l.managementType !== "SUBLEASE" && input.subleaseRentCents !== null) throw new AppError(422, "NOT_SUBLEASE", "Le loyer ne concerne que les biens en sous-location.");
    const data = { cleaningFeeBeneficiary: input.cleaningFeeBeneficiary, subleaseRentCents: input.subleaseRentCents, subleaseRentFrom: input.subleaseRentFrom && input.subleaseRentCents !== null ? new Date(`${input.subleaseRentFrom}T00:00:00Z`) : null };
    await tx.listing.update({ where: { id: l.id }, data });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "finance.listing_terms_updated",
      targetType: "listing",
      targetId: l.id,
      details: { from: { cleaningFeeBeneficiary: l.cleaningFeeBeneficiary, subleaseRentCents: l.subleaseRentCents, subleaseRentFrom: l.subleaseRentFrom ? isoDay(l.subleaseRentFrom) : null }, to: { cleaningFeeBeneficiary: input.cleaningFeeBeneficiary, subleaseRentCents: input.subleaseRentCents, subleaseRentFrom: input.subleaseRentFrom } },
    });
  });
}

/** The months of the overview's selector: the current one and the 23 before it. */
export function recentMonths(now = new Date(), count = 24): string[] {
  const current = localMonth(now);
  return Array.from({ length: count }, (_, i) => addMonths(current, -i));
}

export type { LedgerKind };

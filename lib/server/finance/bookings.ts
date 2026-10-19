import "server-only";
import { isoDay } from "@/lib/admin/calendar";
import { syncBookingFinance } from "@/lib/finance/post";
import type { MonthSplit } from "@/lib/finance/split";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { CommissionBase, FeeBeneficiary, FinanceFeeSource, FinanceGrossSource, FinanceSplitStatus, LedgerAccount, LedgerKind, ManagementType, RevenueAllocation } from "@/lib/generated/prisma/enums";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";

/**
 * A booking's split as the associés see it (Finances, and the booking's page) and the inputs they type on it: the gross
 * revenue (a platform booking without an amount, what is kept of a cancellation), the platform's fee (from its
 * statement), the exchange rate of a platform amount in another currency. Every write recomputes the split and posts
 * the differences (lib/finance/post.ts) in the same transaction, audited « finance.inputs_updated » (from → to).
 * Another organization's booking is « introuvable », as an unknown one.
 */

const notFound = () => new AppError(404, "NOT_FOUND", "Réservation introuvable.");

export interface FinanceEntryView {
  id: string;
  seq: number;
  createdAt: string;
  actorName: string | null;
  kind: LedgerKind;
  account: LedgerAccount;
  period: string;
  originPeriod: string | null;
  amountCents: number;
  description: string;
}

export interface BookingFinanceView {
  status: FinanceSplitStatus;
  grossSource: FinanceGrossSource | null;
  feeSource: FinanceFeeSource;
  foreignAmount: { cents: number; currency: string } | null;
  terms: { managementType: ManagementType; commissionBps: number; cleaningBeneficiary: FeeBeneficiary; commissionBase: CommissionBase; allocation: RevenueAllocation; platformFeeBps: number };
  /** The home's terms now differ from those kept on the split. */
  termsOutdated: boolean;
  inputs: { grossCents: number | null; platformFeeCents: number | null; fxRateMicros: number | null; note: string; updatedAt: string | null; updatedByName: string | null };
  nights: number;
  grossCents: number;
  platformFeeCents: number;
  cleaningSigmaCents: number;
  cleaningOwnerCents: number;
  commissionBaseCents: number;
  commissionCents: number;
  ownerShareCents: number;
  sigmaRentalCents: number;
  touristTaxCents: number;
  months: (MonthSplit & { closed: boolean })[];
  computedAt: string;
  version: number;
  entries: FinanceEntryView[];
  /** The booking's platform amount needs a rate. */
  needsRate: boolean;
}

export async function entryViews(rows: { id: string; seq: number; createdAt: Date; actorId: string | null; kind: LedgerKind; account: LedgerAccount; period: string; originPeriod: string | null; amountCents: number; description: string }[]): Promise<FinanceEntryView[]> {
  const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const names = new Map((ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    createdAt: r.createdAt.toISOString(),
    actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
    kind: r.kind,
    account: r.account,
    period: r.period,
    originPeriod: r.originPeriod,
    amountCents: r.amountCents,
    description: r.description,
  }));
}

/** The split of a booking (ADMIN), or null when it has none (owner block, imported « not available » block). */
export async function getBookingFinance(organizationId: string, bookingId: string): Promise<BookingFinanceView | null> {
  const f = await db.bookingFinance.findFirst({
    where: { bookingId, organizationId },
    include: { booking: { select: { platformCurrency: true, listing: { select: { managementType: true, commissionBps: true, cleaningFeeBeneficiary: true, ownerId: true } } } } },
  });
  if (!f) return null;
  const [entries, closings, org, updater] = await Promise.all([
    db.financialEntry.findMany({ where: { organizationId, bookingId }, orderBy: { seq: "asc" } }),
    db.financeMonthClosing.findMany({ where: { organizationId, closed: true }, select: { month: true } }),
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { financeCleaningBeneficiary: true, financeCommissionBase: true, financeAllocation: true } }),
    f.inputsUpdatedById ? db.user.findUnique({ where: { id: f.inputsUpdatedById }, select: { name: true } }) : null,
  ]);
  const closed = new Set(closings.map((c) => c.month));
  const l = f.booking.listing;
  const sublease = l.managementType === "SUBLEASE";
  const termsOutdated =
    f.managementType !== l.managementType ||
    f.commissionBps !== (sublease ? 0 : l.commissionBps) ||
    f.cleaningBeneficiary !== (sublease ? "SIGMA" : (l.cleaningFeeBeneficiary ?? org.financeCleaningBeneficiary)) ||
    f.commissionBase !== org.financeCommissionBase ||
    f.allocation !== org.financeAllocation ||
    f.ownerId !== l.ownerId;
  return {
    status: f.status,
    grossSource: f.grossSource,
    feeSource: f.feeSource,
    foreignAmount: f.foreignAmountCents !== null && f.foreignCurrency ? { cents: f.foreignAmountCents, currency: f.foreignCurrency } : null,
    terms: { managementType: f.managementType, commissionBps: f.commissionBps, cleaningBeneficiary: f.cleaningBeneficiary, commissionBase: f.commissionBase, allocation: f.allocation, platformFeeBps: f.platformFeeBps },
    termsOutdated,
    inputs: { grossCents: f.grossOverrideCents, platformFeeCents: f.platformFeeOverrideCents, fxRateMicros: f.fxRateMicros, note: f.inputsNote, updatedAt: f.inputsUpdatedAt?.toISOString() ?? null, updatedByName: updater?.name ?? null },
    nights: f.nights,
    grossCents: f.grossCents,
    platformFeeCents: f.platformFeeCents,
    cleaningSigmaCents: f.cleaningSigmaCents,
    cleaningOwnerCents: f.cleaningOwnerCents,
    commissionBaseCents: f.commissionBaseCents,
    commissionCents: f.commissionCents,
    ownerShareCents: f.ownerShareCents,
    sigmaRentalCents: f.sigmaRentalCents,
    touristTaxCents: f.touristTaxCents,
    months: (f.months as unknown as MonthSplit[]).map((m) => ({ ...m, closed: closed.has(m.month) })),
    computedAt: f.computedAt.toISOString(),
    version: f.version,
    entries: await entryViews(entries),
    needsRate: f.status === "MISSING_RATE" || (!!f.booking.platformCurrency && f.booking.platformCurrency !== "MAD"),
  };
}

export interface FinanceInputs {
  grossCents: number | null;
  platformFeeCents: number | null;
  fxRateMicros: number | null;
  note: string;
}

/** Saves what an associé typed on a booking's split, then recomputes it (and posts the differences). */
export async function setBookingFinanceInputs(actor: Authorized, bookingId: string, input: FinanceInputs): Promise<void> {
  const { organizationId } = actor;
  if (input.grossCents !== null && input.platformFeeCents !== null && input.platformFeeCents > input.grossCents) {
    throw new AppError(422, "INVALID_AMOUNT", "Les frais de plateforme ne peuvent pas dépasser le revenu brut.");
  }
  await db.$transaction(
    async (tx) => {
      const b = await tx.booking.findFirst({ where: { id: bookingId, organizationId }, select: { id: true, source: true, platformCurrency: true } });
      if (!b) throw notFound();
      if (b.source === "OWNER") throw new AppError(422, "OWNER_BLOCK", "Un blocage propriétaire n'a pas de répartition financière.");
      if (b.source === "DIRECT" && input.platformFeeCents) throw new AppError(422, "DIRECT_NO_FEE", "Une réservation directe n'a pas de frais de plateforme.");
      await syncBookingFinance(tx, b.id, { actorId: actor.user.id, createAlways: true });
      const before = await tx.bookingFinance.findUniqueOrThrow({ where: { bookingId: b.id }, select: { grossOverrideCents: true, platformFeeOverrideCents: true, fxRateMicros: true, inputsNote: true } });
      const after = { grossOverrideCents: input.grossCents, platformFeeOverrideCents: input.platformFeeCents, fxRateMicros: input.fxRateMicros, inputsNote: input.note };
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      await tx.bookingFinance.update({ where: { bookingId: b.id }, data: { ...after, inputsUpdatedAt: new Date(), inputsUpdatedById: actor.user.id } });
      const r = await syncBookingFinance(tx, b.id, { actorId: actor.user.id });
      await recordAudit(tx, {
        organizationId,
        actorId: actor.user.id,
        action: "finance.inputs_updated",
        targetType: "booking",
        targetId: b.id,
        details: { from: before as unknown as Prisma.InputJsonObject, to: after as unknown as Prisma.InputJsonObject, status: r?.status ?? null, entries: r?.written ?? 0 },
      });
    },
    { timeout: 20_000 },
  );
}

/** « Réappliquer les conditions du bien »: the home's and organization's current terms and owner replace the kept ones. */
export async function reapplyBookingTerms(actor: Authorized, bookingId: string): Promise<void> {
  const { organizationId } = actor;
  await db.$transaction(
    async (tx) => {
      const f = await tx.bookingFinance.findFirst({ where: { bookingId, organizationId }, select: { managementType: true, commissionBps: true, cleaningBeneficiary: true, commissionBase: true, allocation: true, platformFeeBps: true, ownerId: true } });
      if (!f) throw notFound();
      const r = await syncBookingFinance(tx, bookingId, { actorId: actor.user.id, reapplyTerms: true });
      const after = await tx.bookingFinance.findUniqueOrThrow({ where: { bookingId }, select: { managementType: true, commissionBps: true, cleaningBeneficiary: true, commissionBase: true, allocation: true, platformFeeBps: true, ownerId: true } });
      await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "finance.terms_reapplied", targetType: "booking", targetId: bookingId, details: { from: f, to: after, entries: r?.written ?? 0 } });
    },
    { timeout: 20_000 },
  );
}

/** Bookings whose split waits for an amount or a rate, stays from `since` on (Finances: « À compléter »). */
export async function incompleteSplits(organizationId: string, since = new Date(Date.now() - 400 * 86_400_000), take = 50) {
  const rows = await db.bookingFinance.findMany({
    where: { organizationId, status: { in: ["MISSING_AMOUNT", "MISSING_RATE"] }, booking: { status: "CONFIRMED", checkOut: { gte: since } } },
    select: { bookingId: true, status: true, foreignAmountCents: true, foreignCurrency: true, booking: { select: { source: true, externalRef: true, checkIn: true, checkOut: true, listing: { select: { title: true } } } } },
    orderBy: { booking: { checkIn: "asc" } },
    take,
  });
  return rows.map((r) => ({
    bookingId: r.bookingId,
    status: r.status,
    foreignAmount: r.foreignAmountCents !== null && r.foreignCurrency ? { cents: r.foreignAmountCents, currency: r.foreignCurrency } : null,
    source: r.booking.source,
    externalRef: r.booking.externalRef,
    checkIn: isoDay(r.booking.checkIn),
    checkOut: isoDay(r.booking.checkOut),
    listingTitle: r.booking.listing.title,
  }));
}

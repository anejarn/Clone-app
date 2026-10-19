import { SOURCE_LABEL } from "../admin/booking-sources";
import { formatDate } from "../format";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import type { BookingSource } from "../generated/prisma/enums";
import { monthTotals, type TaxNight } from "../tax/engine";
import { bookingPostings, diffPostings, expenseAccount, postedTotals, postingKey, postingPeriod, type LedgerAccount, type LedgerKind, type PostingKey } from "./ledger";
import { localMonth, monthOfDay, monthShort } from "./months";
import { platformFeeBpsFor } from "./platform-fees";
import { computeSplit, type BookingSplit, type SplitTerms } from "./split";

/**
 * Writes the finances (Lot 6) inside the caller's transaction: the booking's split snapshot (BookingFinance) and the
 * journal entries (FinancialEntry, append-only). One entry point per source, all idempotent (posting by difference,
 * lib/finance/ledger.ts):
 *
 * - syncBookingFinance(tx, bookingId): called by lib/operations/sync.ts syncBookingTasks — i.e. in the transaction of
 *   every booking write: the site's bookings, the team's entries, new dates and cancellations, iCal and e-mail imports
 *   — and by refreshBookingTax (taxe de séjour), by the e-mail enrichment of amounts, and by the split's own form;
 * - syncServiceFinance(tx, requestId): a conciergerie request's margin, posted when it is DONE (realised), in the
 *   month of its service date;
 * - postExpense / postExpenseReversal: an expense validated / reversed (lib/server/finance/expenses.ts);
 * - postSubleaseRents: the month's sublease rents, when the month is closed (lib/server/finance/closing.ts).
 *
 * Concurrency: every posting takes the organization's finance lock in shared mode plus an exclusive lock on its
 * source (Postgres transaction-level advisory locks), and closing a month takes the organization's lock exclusively:
 * a posting never reads a month as open while it is being closed, and two postings of one booking never both write
 * the same difference. Nothing here checks permissions (the callers did).
 */

type Tx = Prisma.TransactionClient;
type Client = Tx | PrismaClient;

function inTx<T>(client: Client, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return "$transaction" in client ? (client as PrismaClient).$transaction(fn, { timeout: 30_000 }) : fn(client);
}

/** Shared organization lock + exclusive lock of one source (a booking, a request, an expense). */
export async function lockForPosting(tx: Tx, organizationId: string, sourceKey: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('sigma.finance'), hashtext(${organizationId}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('sigma.finance.source'), hashtext(${sourceKey}))`;
}

/** Exclusive organization lock: closing and reopening a month. */
export async function lockForClosing(tx: Tx, organizationId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('sigma.finance'), hashtext(${organizationId}))`;
}

export async function closedMonths(tx: Tx, organizationId: string): Promise<Set<string>> {
  const rows = await tx.financeMonthClosing.findMany({ where: { organizationId, closed: true }, select: { month: true } });
  return new Set(rows.map((r) => r.month));
}

interface Party {
  listingId: string | null;
  ownerId: string | null;
}
const partyKey = (p: Party) => `${p.listingId ?? ""}|${p.ownerId ?? ""}`;

interface Reconcile {
  organizationId: string;
  actorId: string | null;
  kind: LedgerKind;
  /** The source's existing entries (this kind only). */
  where: Prisma.FinancialEntryWhereInput;
  /** What the source should hold now, for its current party. */
  desired: Map<PostingKey, number>;
  party: Party;
  refs: Pick<Prisma.FinancialEntryUncheckedCreateInput, "bookingId" | "serviceRequestId">;
  describe: (account: LedgerAccount, month: string) => string;
  closed?: Set<string>;
}

/**
 * Writes the differences between `desired` and what is posted. Entries posted under another party (the owner changed
 * and the terms were reapplied) are reversed under that party, and the new party gets the full amounts.
 */
async function reconcile(tx: Tx, r: Reconcile): Promise<number> {
  const rows = await tx.financialEntry.findMany({ where: { organizationId: r.organizationId, kind: r.kind, ...r.where }, select: { period: true, originPeriod: true, account: true, amountCents: true, listingId: true, ownerId: true } });
  const byParty = new Map<string, { party: Party; rows: typeof rows }>();
  for (const e of rows) {
    const k = partyKey(e);
    const g = byParty.get(k) ?? { party: { listingId: e.listingId, ownerId: e.ownerId }, rows: [] };
    g.rows.push(e);
    byParty.set(k, g);
  }
  if (!byParty.has(partyKey(r.party))) byParty.set(partyKey(r.party), { party: r.party, rows: [] });
  const closed = r.closed ?? (await closedMonths(tx, r.organizationId));
  const data: Prisma.FinancialEntryCreateManyInput[] = [];
  for (const [k, g] of byParty) {
    const posted = postedTotals(g.rows.map((e) => ({ month: e.originPeriod ?? e.period, account: e.account, amountCents: e.amountCents })));
    const desired = k === partyKey(r.party) ? r.desired : new Map<PostingKey, number>();
    for (const w of diffPostings(desired, posted)) {
      const period = postingPeriod(w.month, closed);
      const adjusted = period !== w.month;
      data.push({
        organizationId: r.organizationId,
        actorId: r.actorId,
        kind: r.kind,
        account: w.account,
        period,
        originPeriod: adjusted ? w.month : null,
        amountCents: w.amountCents,
        listingId: g.party.listingId,
        ownerId: g.party.ownerId,
        ...r.refs,
        description: `${r.describe(w.account, w.month)}${adjusted ? ` · ajustement après clôture de ${monthShort(w.month)}` : ""}`.slice(0, 500),
      });
    }
  }
  if (data.length) await tx.financialEntry.createMany({ data });
  return data.length;
}

// ---------- Bookings ----------

export interface BookingFinanceResult {
  status: BookingSplit["status"];
  written: number;
}

const bookingSelect = {
  id: true,
  organizationId: true,
  listingId: true,
  source: true,
  status: true,
  channelBlock: true,
  checkIn: true,
  checkOut: true,
  externalRef: true,
  totalCents: true,
  cleaningFeeCents: true,
  platformAmountCents: true,
  platformCurrency: true,
  platformAmountKind: true,
  touristTax: { select: { totalCents: true, lines: true } },
  finance: true,
  listing: { select: { ownerId: true, managementType: true, commissionBps: true, cleaningFeeBeneficiary: true } },
  organization: { select: { financeCleaningBeneficiary: true, financeCommissionBase: true, financeAllocation: true, platformFeeBps: true } },
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

/** The terms of a booking's home and organization now (what a new split takes). */
export function currentTerms(b: Pick<BookingRow, "source" | "listing" | "organization">): SplitTerms {
  const sublease = b.listing.managementType === "SUBLEASE";
  return {
    managementType: b.listing.managementType,
    commissionBps: sublease ? 0 : b.listing.commissionBps,
    cleaningBeneficiary: sublease ? "SIGMA" : (b.listing.cleaningFeeBeneficiary ?? b.organization.financeCleaningBeneficiary),
    commissionBase: b.organization.financeCommissionBase,
    allocation: b.organization.financeAllocation,
    platformFeeBps: platformFeeBpsFor(b.source, b.organization.platformFeeBps),
  };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** JSON with sorted keys (jsonb doesn't keep the order of keys), for change detection. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

function taxByMonth(b: BookingRow): Map<string, number> {
  const out = new Map<string, number>();
  if (b.status !== "CONFIRMED" || b.source === "OWNER" || !b.touristTax) return out;
  const lines = Array.isArray(b.touristTax.lines) ? (b.touristTax.lines as unknown as TaxNight[]) : [];
  for (const m of new Set(lines.map((l) => l.night.slice(0, 7)))) out.set(m, monthTotals(lines, m).totalCents);
  return out;
}

/**
 * Recomputes a booking's split and posts the differences. `reapplyTerms`: take the home's and the organization's
 * current terms (and owner) instead of those kept on the split. Owner blocks never get a split; an imported
 * « not available » block gets none either unless one already exists.
 */
export async function syncBookingFinance(client: Client, bookingId: string, opts: { actorId?: string | null; reapplyTerms?: boolean; now?: Date; createAlways?: boolean } = {}): Promise<BookingFinanceResult | null> {
  return inTx(client, async (tx) => {
    const head = await tx.booking.findUnique({ where: { id: bookingId }, select: { organizationId: true, source: true } });
    if (!head || head.source === "OWNER") return null;
    await lockForPosting(tx, head.organizationId, `booking:${bookingId}`);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: bookingSelect });
    const existing = b.finance;
    const keep = existing && !opts.reapplyTerms;
    const terms: SplitTerms = keep
      ? { managementType: existing.managementType, commissionBps: existing.commissionBps, cleaningBeneficiary: existing.cleaningBeneficiary, commissionBase: existing.commissionBase, allocation: existing.allocation, platformFeeBps: existing.platformFeeBps }
      : currentTerms(b);
    const ownerId = keep ? existing.ownerId : b.listing.ownerId;
    const overrides = { grossCents: existing?.grossOverrideCents ?? null, platformFeeCents: existing?.platformFeeOverrideCents ?? null, fxRateMicros: existing?.fxRateMicros ?? null };
    const split = computeSplit(
      {
        source: b.source,
        status: b.status,
        channelBlock: b.channelBlock,
        checkIn: isoDay(b.checkIn),
        checkOut: isoDay(b.checkOut),
        totalCents: b.totalCents,
        cleaningFeeCents: b.cleaningFeeCents,
        platformAmount: b.platformAmountCents !== null && b.platformCurrency && b.platformAmountKind ? { cents: b.platformAmountCents, currency: b.platformCurrency, kind: b.platformAmountKind } : null,
      },
      terms,
      overrides,
    );
    if (!existing && split.status === "NOT_APPLICABLE" && !opts.createAlways) return { status: split.status, written: 0 };
    const tax = taxByMonth(b);
    const touristTaxCents = [...tax.values()].reduce((s, x) => s + x, 0);
    const computed = {
      status: split.status === "NOT_APPLICABLE" ? ("CANCELLED" as const) : split.status,
      grossSource: split.status === "COMPLETE" ? split.grossSource : null,
      feeSource: split.feeSource,
      foreignAmountCents: split.foreignAmount?.cents ?? null,
      foreignCurrency: split.foreignAmount?.currency ?? null,
      nights: split.nights,
      grossCents: split.grossCents,
      platformFeeCents: split.platformFeeCents,
      cleaningSigmaCents: split.cleaningSigmaCents,
      cleaningOwnerCents: split.cleaningOwnerCents,
      commissionBaseCents: split.commissionBaseCents,
      commissionCents: split.commissionCents,
      ownerShareCents: split.ownerShareCents,
      sigmaRentalCents: split.sigmaRentalCents,
      touristTaxCents,
      months: split.months as unknown as Prisma.InputJsonArray,
    };
    const termsData = { listingId: b.listingId, ownerId, ...terms };
    const now = opts.now ?? new Date();
    if (!existing) {
      await tx.bookingFinance.create({ data: { bookingId: b.id, organizationId: b.organizationId, ...termsData, ...computed, computedAt: now } });
    } else {
      const changed =
        canonical({ ...termsData, ...computed }) !==
        canonical({
          listingId: existing.listingId,
          ownerId: existing.ownerId,
          managementType: existing.managementType,
          commissionBps: existing.commissionBps,
          cleaningBeneficiary: existing.cleaningBeneficiary,
          commissionBase: existing.commissionBase,
          allocation: existing.allocation,
          platformFeeBps: existing.platformFeeBps,
          ...Object.fromEntries(Object.keys(computed).map((k) => [k, existing[k as keyof typeof existing]])),
        });
      if (changed) await tx.bookingFinance.update({ where: { bookingId: b.id }, data: { ...termsData, ...computed, computedAt: now, version: { increment: 1 } } });
    }
    const label = `Séjour du ${formatDate(b.checkIn)} au ${formatDate(b.checkOut)} · ${SOURCE_LABEL[b.source as BookingSource]}${b.externalRef ? ` ${b.externalRef}` : ""}`;
    const written = await reconcile(tx, {
      organizationId: b.organizationId,
      actorId: opts.actorId ?? null,
      kind: "BOOKING",
      where: { bookingId: b.id },
      desired: bookingPostings(split, tax),
      party: { listingId: b.listingId, ownerId },
      refs: { bookingId: b.id },
      describe: (account) => (account === "TOURIST_TAX" ? `Taxe de séjour · ${label}` : label),
    });
    return { status: split.status, written };
  });
}

// ---------- Conciergerie ----------

/** A request's margin and partner cost, in the month of its service date, once DONE; reversed if it ever leaves DONE. */
export async function syncServiceFinance(tx: Tx, requestId: string, actorId: string | null): Promise<number> {
  const head = await tx.serviceRequest.findUnique({ where: { id: requestId }, select: { organizationId: true } });
  if (!head) return 0;
  await lockForPosting(tx, head.organizationId, `service:${requestId}`);
  const r = await tx.serviceRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: { id: true, organizationId: true, status: true, serviceDate: true, marginCents: true, partnerTotalCents: true, titleSnapshot: true, booking: { select: { listingId: true, listing: { select: { ownerId: true } } } } },
  });
  const desired = new Map<PostingKey, number>();
  if (r.status === "DONE" && r.marginCents !== null && r.partnerTotalCents !== null) {
    const month = monthOfDay(isoDay(r.serviceDate));
    if (r.marginCents) desired.set(postingKey(month, "SERVICE_MARGIN"), r.marginCents);
    if (r.partnerTotalCents) desired.set(postingKey(month, "SERVICE_PARTNER_COST"), r.partnerTotalCents);
  }
  return reconcile(tx, {
    organizationId: r.organizationId,
    actorId,
    kind: "SERVICE",
    where: { serviceRequestId: r.id },
    desired,
    party: { listingId: r.booking.listingId, ownerId: r.booking.listing.ownerId },
    refs: { serviceRequestId: r.id },
    describe: () => `Conciergerie : ${r.titleSnapshot} du ${formatDate(r.serviceDate)}`,
  });
}

// ---------- Expenses ----------

export interface PostedExpense {
  id: string;
  organizationId: string;
  listingId: string;
  ownerId: string;
  date: Date;
  description: string;
  supplier: string;
  amountCents: number;
  paidBy: "SIGMA" | "OWNER";
  rebillToOwner: boolean;
}

const expenseLabel = (e: PostedExpense) => `Dépense du ${formatDate(e.date)} : ${e.description}${e.supplier ? ` (${e.supplier})` : ""}`;

/** The validated expense's entry, in the month of its date or the first open month after it. */
export async function postExpense(tx: Tx, e: PostedExpense, actorId: string): Promise<{ id: string; period: string }> {
  await lockForPosting(tx, e.organizationId, `expense:${e.id}`);
  const month = monthOfDay(isoDay(e.date));
  const period = postingPeriod(month, await closedMonths(tx, e.organizationId));
  const adjusted = period !== month;
  const row = await tx.financialEntry.create({
    data: {
      organizationId: e.organizationId,
      actorId,
      kind: "EXPENSE",
      account: expenseAccount(e.paidBy, e.rebillToOwner),
      period,
      originPeriod: adjusted ? month : null,
      amountCents: e.amountCents,
      listingId: e.listingId,
      ownerId: e.ownerId,
      expenseId: e.id,
      description: `${expenseLabel(e)}${adjusted ? ` · mois de ${monthShort(month)} clôturé` : ""}`.slice(0, 500),
    },
    select: { id: true },
  });
  return { id: row.id, period };
}

/** The opposite of every entry of an expense not reversed yet. */
export async function postExpenseReversal(tx: Tx, e: PostedExpense, actorId: string, reason: string): Promise<number> {
  await lockForPosting(tx, e.organizationId, `expense:${e.id}`);
  const entries = await tx.financialEntry.findMany({ where: { organizationId: e.organizationId, expenseId: e.id }, orderBy: { seq: "asc" } });
  const reversed = new Set(entries.map((x) => x.reversesId).filter(Boolean));
  const closed = await closedMonths(tx, e.organizationId);
  const data: Prisma.FinancialEntryCreateManyInput[] = entries
    .filter((x) => x.kind === "EXPENSE" && !reversed.has(x.id))
    .map((x) => {
      const month = x.originPeriod ?? x.period;
      const period = postingPeriod(month, closed);
      return {
        organizationId: e.organizationId,
        actorId,
        kind: "EXPENSE_REVERSAL" as const,
        account: x.account,
        period,
        originPeriod: period !== month ? month : null,
        amountCents: -x.amountCents,
        listingId: x.listingId,
        ownerId: x.ownerId,
        expenseId: e.id,
        reversesId: x.id,
        description: `Contre-passation · ${expenseLabel(e)} · ${reason}`.slice(0, 500),
      };
    });
  if (data.length) await tx.financialEntry.createMany({ data });
  return data.length;
}

// ---------- Sublease rents ----------

/** The month's rent of every sublease home with a rent, as SUBLEASE_RENT entries (idempotent). Under the closing lock. */
export async function postSubleaseRents(tx: Tx, organizationId: string, month: string, actorId: string): Promise<number> {
  const listings = await tx.listing.findMany({
    where: { organizationId, managementType: "SUBLEASE", subleaseRentCents: { gt: 0 } },
    select: { id: true, title: true, ownerId: true, subleaseRentCents: true, subleaseRentFrom: true },
  });
  let written = 0;
  const closed = await closedMonths(tx, organizationId);
  for (const l of listings) {
    if (l.subleaseRentFrom && monthOfDay(isoDay(l.subleaseRentFrom)) > month) continue;
    written += await reconcile(tx, {
      organizationId,
      actorId,
      kind: "SUBLEASE_RENT",
      where: { listingId: l.id, OR: [{ period: month, originPeriod: null }, { originPeriod: month }] },
      desired: new Map([[postingKey(month, "SUBLEASE_RENT"), l.subleaseRentCents!]]),
      party: { listingId: l.id, ownerId: l.ownerId },
      refs: {},
      describe: () => `Loyer de sous-location de ${monthShort(month)} · ${l.title}`,
      closed,
    });
  }
  return written;
}

/** The accounting month « now » in Marrakech. */
export function currentMonth(now = new Date()): string {
  return localMonth(now);
}

import { ownerEffect, totalsOf, type LedgerAccount, type LedgerKind, type MonthTotals } from "./ledger";
import { monthLabel } from "./months";

/**
 * An owner's monthly statement (« relevé mensuel », Lot 6b), pure: no database, no clock. It is assembled from the
 * very rows the monthly overview (lib/server/finance/ledger.ts monthOverview) reads — the journal entries of the
 * month (period = the month) whose owner is this owner — so its figures are the overview's, to the centime:
 * `totals` is totalsOf(those rows), the net due of the month is totals.netDueOwnerCents, and every line below is a
 * group of those rows (assembleStatement checks that the lines add up to the totals and throws otherwise).
 *
 * Lines, per home:
 * - **stays**: the booking entries of a stay, grouped by stay and by the month they belong to (an « ajustement après
 *   clôture » of an earlier month is its own line, flagged); nights = the stay's nights counted in that month (a stay
 *   across two months shows e.g. 2 of 3 nights, NIGHTS allocation); columns: gross, platform fees, cleaning kept by
 *   Sigma, Sigma's commission, owner's share (owner share + cleaning kept by the owner). gross = fees + cleaning +
 *   commission + owner's share on every line. A sub-let's stays are Sigma's revenue: not listed (« sans objet »), the
 *   owner gets the rent instead;
 * - **expenses**: rebilled to the owner (deducted), advanced by the owner (reimbursed), paid by the owner (for
 *   information, no effect); their reversals; each with its receipt reference (the expense's own code);
 * - **rents** (sub-let) and **adjustments** (manual, with their reason).
 * The taxe de séjour (collected for the commune), the conciergerie margins and what Sigma bears alone are not the
 * owner's and are not listed (they have no effect on the net due either).
 *
 * Summary: net due of the month (+ the sub-let rents closing will post, for an open month's preview: « prévu »),
 * previous balance = Σ net due of the earlier months − Σ transfers recorded in them, transfers recorded in this month
 * (« virements effectués »), balance to pay = previous balance + net due − transfers.
 */

export interface StatementBranding {
  name: string;
  legalName: string;
  legalAddress: string;
  ice: string;
  rcNumber: string;
  taxIdNumber: string;
  hasLogo: boolean;
  /** Millionths of MAD per euro, for an indicative EUR amount; null = none. */
  eurRateMicros: number | null;
}

export interface StatementEntryInput {
  kind: LedgerKind;
  account: LedgerAccount;
  /** yyyy-MM: always the statement's month (the caller selects period = month). */
  period: string;
  originPeriod: string | null;
  amountCents: number;
  listingId: string | null;
  bookingId: string | null;
  expenseId: string | null;
  description: string;
}

export interface StatementListingInput {
  id: string;
  title: string;
  managementType: "MANAGED" | "SUBLEASE";
}

export interface StatementBookingInput {
  id: string;
  /** yyyy-MM-dd, checkOut exclusive. */
  checkIn: string;
  checkOut: string;
  source: string;
  nights: number;
  /** Nights counted in each month by the split (BookingFinance.months). */
  monthNights: Record<string, number>;
}

export interface StatementExpenseInput {
  id: string;
  /** yyyy-MM-dd. */
  date: string;
  description: string;
  supplier: string;
  hasReceipt: boolean;
}

export interface StatementPayoutInput {
  /** yyyy-MM-dd. */
  paidOn: string;
  reference: string;
  amountCents: number;
  /** The statement's month it paid. */
  forMonth: string;
  reversal: boolean;
}

export interface StatementInput {
  branding: StatementBranding;
  owner: { id: string; name: string };
  month: string;
  /** Open month: the PDF says « Provisoire ». */
  provisional: boolean;
  listings: StatementListingInput[];
  entries: StatementEntryInput[];
  bookings: StatementBookingInput[];
  expenses: StatementExpenseInput[];
  /** Σ of the net due of the months before (ownerEffect of their entries) and Σ of the transfers recorded in them. */
  previousNetDueCents: number;
  previousPayoutsCents: number;
  /** The transfers recorded in this month (OWNER_PAYOUT entries, with their details). */
  payouts: StatementPayoutInput[];
  /** Open month only: the sub-let rents its closing will post, by home. */
  projectedRents: { listingId: string; cents: number }[];
}

export interface StayLine {
  bookingId: string;
  checkIn: string;
  checkOut: string;
  source: string;
  nights: number;
  nightsInMonth: number;
  /** The closed month this line corrects, or null. */
  adjustmentOf: string | null;
  grossCents: number;
  platformFeeCents: number;
  cleaningCents: number;
  commissionCents: number;
  ownerShareCents: number;
}

export type ExpenseEffect = "REBILLED" | "ADVANCE" | "OWNER_PAID";

export interface ExpenseLine {
  expenseId: string;
  /** The receipt's reference printed on the statement (« DEP-… »), or null without receipt. */
  receiptRef: string | null;
  reference: string;
  date: string;
  description: string;
  supplier: string;
  effect: ExpenseEffect;
  reversal: boolean;
  amountCents: number;
  /** What it does to the net due (− rebilled, + advance, 0 paid by the owner). */
  netEffectCents: number;
  adjustmentOf: string | null;
}

export interface SimpleLine {
  description: string;
  amountCents: number;
  adjustmentOf: string | null;
  projected?: boolean;
}

export interface ListingSection {
  listingId: string;
  title: string;
  managementType: "MANAGED" | "SUBLEASE";
  stays: StayLine[];
  expenses: ExpenseLine[];
  rents: SimpleLine[];
  adjustments: SimpleLine[];
  totals: {
    nights: number;
    grossCents: number;
    platformFeeCents: number;
    cleaningCents: number;
    commissionCents: number;
    ownerShareCents: number;
    expensesNetCents: number;
    rentCents: number;
    adjustmentsCents: number;
    /** Σ of the net-due effects of this home's lines (projected rent excluded). */
    netDueCents: number;
    projectedRentCents: number;
  };
}

export interface StatementData {
  schema: 1;
  month: string;
  monthLabel: string;
  provisional: boolean;
  branding: StatementBranding;
  owner: { id: string; name: string };
  listings: ListingSection[];
  payouts: StatementPayoutInput[];
  /** totalsOf the month's rows of this owner: the Finances overview's figures for this owner. */
  totals: MonthTotals;
  summary: {
    ownerRevenueCents: number;
    expensesNetCents: number;
    rentCents: number;
    adjustmentsCents: number;
    netDueCents: number;
    projectedRentCents: number;
    previousBalanceCents: number;
    payoutsCents: number;
    balanceCents: number;
    /** Indicative, at the organization's rate; null without one. */
    balanceEurCents: number | null;
  };
}

const STAY_ACCOUNTS = new Set<LedgerAccount>(["PLATFORM_FEE", "CLEANING_SIGMA", "CLEANING_OWNER", "COMMISSION", "OWNER_SHARE", "SIGMA_RENTAL"]);
const EXPENSE_EFFECT: Partial<Record<LedgerAccount, ExpenseEffect>> = { EXPENSE_REBILLED: "REBILLED", EXPENSE_OWNER_ADVANCE: "ADVANCE", EXPENSE_OWNER_PAID: "OWNER_PAID" };

/** "DEP-7F3K2Q9A": the code a statement prints for an expense's receipt (the expense id's last 8 characters). */
export function expenseReference(expenseId: string): string {
  return `DEP-${expenseId.slice(-8).toUpperCase()}`;
}

/** EUR cents for an amount in MAD centimes at `rateMicros` MAD per euro, rounded half away from zero. */
export function madToEur(cents: number, rateMicros: number): number {
  if (!Number.isSafeInteger(rateMicros) || rateMicros <= 0) throw new RangeError(`not a rate: ${rateMicros}`);
  const p = BigInt(Math.abs(cents)) * BigInt(1_000_000);
  const R = BigInt(rateMicros);
  const q = Number((p * BigInt(2) + R) / (BigInt(2) * R));
  return cents < 0 && q !== 0 ? -q : q;
}

export class StatementMismatchError extends Error {}

export function assembleStatement(input: StatementInput): StatementData {
  const rows = input.entries.filter((e) => e.period === input.month);
  if (rows.length !== input.entries.length) throw new RangeError("entries of another month were given");
  const totals = totalsOf(rows);
  const bookings = new Map(input.bookings.map((b) => [b.id, b]));
  const expenses = new Map(input.expenses.map((e) => [e.id, e]));
  const listingIds = [...new Set([...rows.map((r) => r.listingId).filter((x): x is string => !!x), ...input.projectedRents.filter((p) => p.cents).map((p) => p.listingId)])];
  const known = new Map(input.listings.map((l) => [l.id, l]));

  const sections: ListingSection[] = listingIds.map((listingId) => {
    const l = known.get(listingId) ?? { id: listingId, title: "Bien", managementType: "MANAGED" as const };
    const mine = rows.filter((r) => r.listingId === listingId);

    // Stays: by (booking, month it belongs to).
    const stayGroups = new Map<string, StatementEntryInput[]>();
    for (const r of mine) {
      if (r.kind !== "BOOKING" || !r.bookingId || !STAY_ACCOUNTS.has(r.account)) continue;
      const k = `${r.bookingId}|${r.originPeriod ?? ""}`;
      stayGroups.set(k, [...(stayGroups.get(k) ?? []), r]);
    }
    const stays: StayLine[] = [];
    for (const [k, g] of stayGroups) {
      const sum = (a: LedgerAccount) => g.filter((r) => r.account === a).reduce((s, r) => s + r.amountCents, 0);
      const line = {
        platformFeeCents: sum("PLATFORM_FEE"),
        cleaningCents: sum("CLEANING_SIGMA"),
        commissionCents: sum("COMMISSION"),
        ownerShareCents: sum("OWNER_SHARE") + sum("CLEANING_OWNER"),
        sigmaRental: sum("SIGMA_RENTAL"),
      };
      // A sub-let stay (only Sigma's accounts) isn't the owner's: left out.
      const ownerSide = g.some((r) => r.account === "COMMISSION" || r.account === "OWNER_SHARE" || r.account === "CLEANING_OWNER");
      if (!ownerSide && (l.managementType === "SUBLEASE" || line.sigmaRental !== 0)) continue;
      const [bookingId, origin] = k.split("|");
      const b = bookings.get(bookingId);
      const forMonth = origin || input.month;
      stays.push({
        bookingId,
        checkIn: b?.checkIn ?? "",
        checkOut: b?.checkOut ?? "",
        source: b?.source ?? "OTHER",
        nights: b?.nights ?? 0,
        nightsInMonth: b?.monthNights[forMonth] ?? 0,
        adjustmentOf: origin || null,
        // Sigma's own sub-let revenue (a stay whose terms changed between mandate and sub-let) isn't shown.
        grossCents: line.platformFeeCents + line.cleaningCents + line.commissionCents + line.ownerShareCents,
        platformFeeCents: line.platformFeeCents,
        cleaningCents: line.cleaningCents,
        commissionCents: line.commissionCents,
        ownerShareCents: line.ownerShareCents,
      });
    }
    stays.sort((a, b) => (a.checkIn === b.checkIn ? (a.adjustmentOf ?? "").localeCompare(b.adjustmentOf ?? "") || a.bookingId.localeCompare(b.bookingId) : a.checkIn < b.checkIn ? -1 : 1));

    // Expenses: by (expense, kind, account, origin).
    const expenseGroups = new Map<string, StatementEntryInput[]>();
    for (const r of mine) {
      if ((r.kind !== "EXPENSE" && r.kind !== "EXPENSE_REVERSAL") || !r.expenseId || !EXPENSE_EFFECT[r.account]) continue;
      const k = `${r.expenseId}|${r.kind}|${r.account}|${r.originPeriod ?? ""}`;
      expenseGroups.set(k, [...(expenseGroups.get(k) ?? []), r]);
    }
    const expenseLines: ExpenseLine[] = [...expenseGroups.entries()].map(([k, g]) => {
      const [expenseId, kind, account, origin] = k.split("|") as [string, LedgerKind, LedgerAccount, string];
      const e = expenses.get(expenseId);
      const amountCents = g.reduce((s, r) => s + r.amountCents, 0);
      return {
        expenseId,
        reference: expenseReference(expenseId),
        receiptRef: e?.hasReceipt ? expenseReference(expenseId) : null,
        date: e?.date ?? "",
        description: e?.description ?? g[0].description,
        supplier: e?.supplier ?? "",
        effect: EXPENSE_EFFECT[account]!,
        reversal: kind === "EXPENSE_REVERSAL",
        amountCents,
        netEffectCents: ownerEffect(account, amountCents),
        adjustmentOf: origin || null,
      };
    });
    expenseLines.sort((a, b) => (a.date === b.date ? a.expenseId.localeCompare(b.expenseId) || Number(a.reversal) - Number(b.reversal) : a.date < b.date ? -1 : 1));

    const simple = (account: LedgerAccount): SimpleLine[] =>
      mine.filter((r) => r.account === account).map((r) => ({ description: r.description, amountCents: r.amountCents, adjustmentOf: r.originPeriod }));
    const rents = simple("SUBLEASE_RENT");
    const projected = input.projectedRents.filter((p) => p.listingId === listingId).reduce((s, p) => s + p.cents, 0);
    if (projected) rents.push({ description: "Loyer de sous-location du mois (passé à la clôture)", amountCents: projected, adjustmentOf: null, projected: true });
    const adjustments = simple("OWNER_ADJUSTMENT");

    const netDueCents = mine.reduce((s, r) => s + ownerEffect(r.account, r.amountCents), 0);
    const t = {
      nights: stays.filter((s) => !s.adjustmentOf).reduce((s, x) => s + x.nightsInMonth, 0),
      grossCents: stays.reduce((s, x) => s + x.grossCents, 0),
      platformFeeCents: stays.reduce((s, x) => s + x.platformFeeCents, 0),
      cleaningCents: stays.reduce((s, x) => s + x.cleaningCents, 0),
      commissionCents: stays.reduce((s, x) => s + x.commissionCents, 0),
      ownerShareCents: stays.reduce((s, x) => s + x.ownerShareCents, 0),
      expensesNetCents: expenseLines.reduce((s, x) => s + x.netEffectCents, 0),
      rentCents: rents.filter((r) => !r.projected).reduce((s, x) => s + x.amountCents, 0),
      adjustmentsCents: adjustments.reduce((s, x) => s + x.amountCents, 0),
      netDueCents,
      projectedRentCents: projected,
    };
    if (t.ownerShareCents + t.expensesNetCents + t.rentCents + t.adjustmentsCents !== netDueCents) {
      throw new StatementMismatchError(`statement lines of ${listingId} don't add up to its net due`);
    }
    return { listingId, title: l.title, managementType: l.managementType, stays, expenses: expenseLines, rents, adjustments, totals: t };
  });
  sections.sort((a, b) => a.title.localeCompare(b.title, "fr") || a.listingId.localeCompare(b.listingId));

  const sum = (f: (s: ListingSection) => number) => sections.reduce((s, x) => s + f(x), 0);
  const netDueCents = sum((s) => s.totals.netDueCents);
  if (netDueCents !== totals.netDueOwnerCents) throw new StatementMismatchError("statement lines don't add up to the month's net due");
  const ownerRevenueCents = sum((s) => s.totals.ownerShareCents);
  const expensesNetCents = sum((s) => s.totals.expensesNetCents);
  const rentCents = sum((s) => s.totals.rentCents);
  const adjustmentsCents = sum((s) => s.totals.adjustmentsCents);
  if (ownerRevenueCents + expensesNetCents + rentCents + adjustmentsCents !== netDueCents) throw new StatementMismatchError("statement summary doesn't add up");
  const projectedRentCents = sum((s) => s.totals.projectedRentCents);
  const payoutsCents = totals.ownerPayoutsCents;
  if (input.payouts.reduce((s, p) => s + p.amountCents, 0) !== payoutsCents) throw new StatementMismatchError("transfers don't match the journal");
  const previousBalanceCents = input.previousNetDueCents - input.previousPayoutsCents;
  const balanceCents = previousBalanceCents + netDueCents + projectedRentCents - payoutsCents;
  return {
    schema: 1,
    month: input.month,
    monthLabel: monthLabel(input.month),
    provisional: input.provisional,
    branding: input.branding,
    owner: input.owner,
    listings: sections,
    payouts: input.payouts,
    totals,
    summary: {
      ownerRevenueCents,
      expensesNetCents,
      rentCents,
      adjustmentsCents,
      netDueCents,
      projectedRentCents,
      previousBalanceCents,
      payoutsCents,
      balanceCents,
      balanceEurCents: input.branding.eurRateMicros ? madToEur(balanceCents, input.branding.eurRateMicros) : null,
    },
  };
}

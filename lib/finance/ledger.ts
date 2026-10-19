import { addMonths } from "./months";
import type { BookingSplit, SplitParts } from "./split";

/**
 * The financial journal (Lot 6), pure part: accounts, what each one means for the owner and for Sigma, and how a
 * source (a booking, a service request, a sublease's rent) is posted. The table financial_entries is append-only
 * (database trigger): an entry is never changed or deleted, a correction is a new entry. Every entry carries an
 * accounting month (`period`, yyyy-MM), the actor and time, and what it comes from.
 *
 * **Posting by difference.** For a booking, the split gives what each month should hold on each account; the journal
 * holds what was posted so far. Each (month, account) whose posted sum differs gets one entry of the difference:
 * - in that month when it is open;
 * - when that month is closed (« clôturé »), in the first open month after it, with originPeriod = the closed month
 *   (an « ajustement après clôture »): a closed month never changes.
 * Recomputing the same split again writes nothing (idempotent); a cancellation writes the reversal of what was
 * posted. The sums per (origin month, account) always equal the current split.
 *
 * This is a management journal for the statements and the accountant, not the general ledger: the accountant maps
 * the accounts below to the plan comptable (CGNC) in their own software.
 */

export const LEDGER_ACCOUNTS = [
  "PLATFORM_FEE",
  "CLEANING_SIGMA",
  "CLEANING_OWNER",
  "COMMISSION",
  "OWNER_SHARE",
  "SIGMA_RENTAL",
  "TOURIST_TAX",
  "SERVICE_MARGIN",
  "SERVICE_PARTNER_COST",
  "EXPENSE_REBILLED",
  "EXPENSE_SIGMA",
  "EXPENSE_OWNER_PAID",
  "EXPENSE_OWNER_ADVANCE",
  "SUBLEASE_RENT",
  "OWNER_ADJUSTMENT",
  "OWNER_PAYOUT",
  "NONE",
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

export const LEDGER_KINDS = ["BOOKING", "SERVICE", "EXPENSE", "EXPENSE_REVERSAL", "SUBLEASE_RENT", "MANUAL_ADJUSTMENT", "MONTH_CLOSED", "MONTH_REOPENED", "OWNER_PAYOUT"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const ACCOUNT_LABEL: Record<LedgerAccount, string> = {
  PLATFORM_FEE: "Frais de plateforme",
  CLEANING_SIGMA: "Ménage (Sigma)",
  CLEANING_OWNER: "Ménage (propriétaire)",
  COMMISSION: "Commission Sigma",
  OWNER_SHARE: "Part propriétaire",
  SIGMA_RENTAL: "Revenu de sous-location (Sigma)",
  TOURIST_TAX: "Taxe de séjour à reverser",
  SERVICE_MARGIN: "Marge conciergerie",
  SERVICE_PARTNER_COST: "Coût partenaire conciergerie",
  EXPENSE_REBILLED: "Dépense refacturée au propriétaire",
  EXPENSE_SIGMA: "Dépense à la charge de Sigma",
  EXPENSE_OWNER_PAID: "Dépense payée par le propriétaire",
  EXPENSE_OWNER_ADVANCE: "Dépense avancée par le propriétaire (remboursée)",
  SUBLEASE_RENT: "Loyer de sous-location dû au propriétaire",
  OWNER_ADJUSTMENT: "Ajustement propriétaire",
  OWNER_PAYOUT: "Virement au propriétaire",
  NONE: "—",
};

export const KIND_LABEL: Record<LedgerKind, string> = {
  BOOKING: "Réservation",
  SERVICE: "Conciergerie",
  EXPENSE: "Dépense",
  EXPENSE_REVERSAL: "Contre-passation de dépense",
  SUBLEASE_RENT: "Loyer de sous-location",
  MANUAL_ADJUSTMENT: "Ajustement manuel",
  MONTH_CLOSED: "Clôture du mois",
  MONTH_REOPENED: "Réouverture du mois",
  OWNER_PAYOUT: "Virement au propriétaire",
};

/** The booking accounts, one per part of a split; their sum is the gross revenue. */
export const BOOKING_PART_ACCOUNTS: readonly { key: keyof SplitParts; account: LedgerAccount }[] = [
  { key: "platformFeeCents", account: "PLATFORM_FEE" },
  { key: "cleaningSigmaCents", account: "CLEANING_SIGMA" },
  { key: "cleaningOwnerCents", account: "CLEANING_OWNER" },
  { key: "commissionCents", account: "COMMISSION" },
  { key: "ownerShareCents", account: "OWNER_SHARE" },
  { key: "sigmaRentalCents", account: "SIGMA_RENTAL" },
];
const GROSS_ACCOUNTS = new Set<LedgerAccount>(BOOKING_PART_ACCOUNTS.map((x) => x.account));

/**
 * What an entry adds to the net due to the owner (« net à reverser ») of its month. A transfer to the owner
 * (OWNER_PAYOUT, Lot 6b) adds nothing: it pays what is due, it doesn't change it; the balance still to pay is the
 * net due of the months minus the transfers (lib/finance/statement.ts).
 */
export function ownerEffect(account: LedgerAccount, amountCents: number): number {
  switch (account) {
    case "OWNER_SHARE":
    case "CLEANING_OWNER":
    case "EXPENSE_OWNER_ADVANCE":
    case "SUBLEASE_RENT":
    case "OWNER_ADJUSTMENT":
      return amountCents;
    case "EXPENSE_REBILLED":
      return -amountCents;
    default:
      return 0;
  }
}

/** What an entry adds to Sigma's own result (commission, cleaning, sublease, margins, minus what Sigma bears). */
export function sigmaEffect(account: LedgerAccount, amountCents: number): number {
  switch (account) {
    case "COMMISSION":
    case "CLEANING_SIGMA":
    case "SIGMA_RENTAL":
    case "SERVICE_MARGIN":
      return amountCents;
    case "EXPENSE_SIGMA":
    case "EXPENSE_OWNER_ADVANCE":
    case "SUBLEASE_RENT":
    case "OWNER_ADJUSTMENT":
      return -amountCents;
    default:
      return 0;
  }
}

/** The expense account for who paid and who bears it. */
export function expenseAccount(paidBy: "SIGMA" | "OWNER", rebillToOwner: boolean): LedgerAccount {
  if (paidBy === "SIGMA") return rebillToOwner ? "EXPENSE_REBILLED" : "EXPENSE_SIGMA";
  return rebillToOwner ? "EXPENSE_OWNER_PAID" : "EXPENSE_OWNER_ADVANCE";
}

export type PostingKey = `${string}|${LedgerAccount}`;
export const postingKey = (month: string, account: LedgerAccount): PostingKey => `${month}|${account}`;
export const parsePostingKey = (k: string): { month: string; account: LedgerAccount } => {
  const [month, account] = k.split("|");
  return { month, account: account as LedgerAccount };
};

/** What a booking's months should hold: its split's parts and its taxe de séjour by month (zeros left out). */
export function bookingPostings(split: Pick<BookingSplit, "status" | "months">, taxByMonth: ReadonlyMap<string, number> = new Map()): Map<PostingKey, number> {
  const out = new Map<PostingKey, number>();
  if (split.status === "COMPLETE") {
    for (const m of split.months) {
      for (const { key, account } of BOOKING_PART_ACCOUNTS) if (m[key] !== 0) out.set(postingKey(m.month, account), m[key]);
    }
  }
  for (const [month, cents] of taxByMonth) if (cents !== 0) out.set(postingKey(month, "TOURIST_TAX"), cents);
  return out;
}

export interface PostedRow {
  /** originPeriod ?? period: the month the amount belongs to. */
  month: string;
  account: LedgerAccount;
  amountCents: number;
}

/** Σ of the posted rows by (month, account). */
export function postedTotals(rows: readonly PostedRow[]): Map<PostingKey, number> {
  const out = new Map<PostingKey, number>();
  for (const r of rows) {
    const k = postingKey(r.month, r.account);
    out.set(k, (out.get(k) ?? 0) + r.amountCents);
  }
  return out;
}

/** The entries to write: desired − posted for every (month, account), sorted by month then account. */
export function diffPostings(desired: ReadonlyMap<PostingKey, number>, posted: ReadonlyMap<PostingKey, number>): { month: string; account: LedgerAccount; amountCents: number }[] {
  const keys = new Set<PostingKey>([...desired.keys(), ...posted.keys()]);
  const out: { month: string; account: LedgerAccount; amountCents: number }[] = [];
  for (const k of keys) {
    const delta = (desired.get(k) ?? 0) - (posted.get(k) ?? 0);
    if (delta !== 0) out.push({ ...parsePostingKey(k), amountCents: delta });
  }
  const order = (a: LedgerAccount) => LEDGER_ACCOUNTS.indexOf(a);
  return out.sort((a, b) => (a.month === b.month ? order(a.account) - order(b.account) : a.month < b.month ? -1 : 1));
}

/** The month an amount of `month` is posted in: itself when open, else the first open month after it. */
export function postingPeriod(month: string, closed: ReadonlySet<string>): string {
  let m = month;
  for (let i = 0; i < 1200 && closed.has(m); i++) m = addMonths(m, 1);
  return m;
}

export interface LedgerRow {
  kind: LedgerKind;
  account: LedgerAccount;
  period: string;
  originPeriod: string | null;
  amountCents: number;
  listingId: string | null;
  ownerId: string | null;
}

export interface MonthTotals {
  /** Gross revenue of the stays (Σ of the booking parts). */
  grossCents: number;
  platformFeeCents: number;
  commissionCents: number;
  cleaningSigmaCents: number;
  cleaningOwnerCents: number;
  ownerShareCents: number;
  sigmaRentalCents: number;
  touristTaxCents: number;
  serviceMarginCents: number;
  /** Rebilled to the owner (deducted from their net). */
  expensesRebilledCents: number;
  /** Borne by Sigma (paid by Sigma, or advanced by the owner and reimbursed). */
  expensesSigmaCents: number;
  /** Paid and borne by the owner (information only). */
  expensesOwnerPaidCents: number;
  /** Paid by the owner, borne by Sigma (added to their net). */
  ownerAdvancesCents: number;
  subleaseRentCents: number;
  ownerAdjustmentsCents: number;
  /** Transfers to the owner recorded in this month (« virements effectués »): not in the net due. */
  ownerPayoutsCents: number;
  /** Amounts posted here for closed months (ajustements après clôture), already included above. */
  adjustmentsAfterClosingCents: number;
  /** Net due to the owner: owner share + their cleaning − rebilled expenses + advances + rent + adjustments. */
  netDueOwnerCents: number;
  /** Sigma's result on these rows: commission + its cleaning + sublease revenue + margins − what Sigma bears. */
  sigmaResultCents: number;
}

export const EMPTY_TOTALS: MonthTotals = {
  grossCents: 0,
  platformFeeCents: 0,
  commissionCents: 0,
  cleaningSigmaCents: 0,
  cleaningOwnerCents: 0,
  ownerShareCents: 0,
  sigmaRentalCents: 0,
  touristTaxCents: 0,
  serviceMarginCents: 0,
  expensesRebilledCents: 0,
  expensesSigmaCents: 0,
  expensesOwnerPaidCents: 0,
  ownerAdvancesCents: 0,
  subleaseRentCents: 0,
  ownerAdjustmentsCents: 0,
  ownerPayoutsCents: 0,
  adjustmentsAfterClosingCents: 0,
  netDueOwnerCents: 0,
  sigmaResultCents: 0,
};

const FIELD: Partial<Record<LedgerAccount, keyof MonthTotals>> = {
  PLATFORM_FEE: "platformFeeCents",
  COMMISSION: "commissionCents",
  CLEANING_SIGMA: "cleaningSigmaCents",
  CLEANING_OWNER: "cleaningOwnerCents",
  OWNER_SHARE: "ownerShareCents",
  SIGMA_RENTAL: "sigmaRentalCents",
  TOURIST_TAX: "touristTaxCents",
  SERVICE_MARGIN: "serviceMarginCents",
  EXPENSE_REBILLED: "expensesRebilledCents",
  EXPENSE_SIGMA: "expensesSigmaCents",
  EXPENSE_OWNER_PAID: "expensesOwnerPaidCents",
  EXPENSE_OWNER_ADVANCE: "ownerAdvancesCents",
  SUBLEASE_RENT: "subleaseRentCents",
  OWNER_ADJUSTMENT: "ownerAdjustmentsCents",
  OWNER_PAYOUT: "ownerPayoutsCents",
};

/** Adds one row to running totals (returns a new object). */
export function addRow(t: MonthTotals, r: Pick<LedgerRow, "account" | "amountCents" | "originPeriod">): MonthTotals {
  const out = { ...t };
  const f = FIELD[r.account];
  if (f) out[f] += r.amountCents;
  if (r.account === "EXPENSE_OWNER_ADVANCE") out.expensesSigmaCents += r.amountCents;
  if (GROSS_ACCOUNTS.has(r.account)) out.grossCents += r.amountCents;
  if (r.originPeriod && r.account !== "NONE") out.adjustmentsAfterClosingCents += r.amountCents;
  out.netDueOwnerCents += ownerEffect(r.account, r.amountCents);
  out.sigmaResultCents += sigmaEffect(r.account, r.amountCents);
  return out;
}

export function totalsOf(rows: readonly Pick<LedgerRow, "account" | "amountCents" | "originPeriod">[]): MonthTotals {
  return rows.reduce(addRow, EMPTY_TOTALS);
}

/** Totals grouped by a key (listing, owner); rows whose key is null are left out. */
export function totalsBy<K extends string>(rows: readonly LedgerRow[], key: (r: LedgerRow) => K | null): Map<K, MonthTotals> {
  const out = new Map<K, MonthTotals>();
  for (const r of rows) {
    const k = key(r);
    if (k === null) continue;
    out.set(k, addRow(out.get(k) ?? EMPTY_TOTALS, r));
  }
  return out;
}

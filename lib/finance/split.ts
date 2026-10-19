import { stayNights } from "@/lib/pricing/engine";
import { convertToMad } from "./fx";
import { monthOfDay } from "./months";
import { allocate, applyBps, mulDivRound } from "./rounding";

/**
 * The split of a booking (« répartition », Lot 6), pure: no database, no clock. Amounts in centimes of dirham.
 *
 * **Gross revenue (G)** = what the guest pays for the stay, cleaning included, taxe de séjour excluded (Sigma's booking
 * totals never include it: it is collected on top and owed to the commune, see below). Where it comes from, first match:
 * 1. a gross typed by an associé on the booking's split (`overrides.grossCents`, e.g. a platform booking imported by
 *    iCal without an amount, or what is kept of a cancelled booking);
 * 2. the platform's e-mail amount (Booking.platformAmount*, Lot 7b), converted to MAD at the rate typed on the split
 *    when it is in another currency (no rate yet → status MISSING_RATE): a GUEST_TOTAL is G; a PAYOUT P is what the
 *    platform pays Sigma, so G = the booking's own total when it is larger than P (fee = G − P, exact), otherwise G is
 *    estimated as P ÷ (1 − default fee rate) and the fee is G − P (estimate, but the payout — hence the commission on
 *    net revenue — is exact);
 * 3. the booking's total (Booking.totalCents: the site's price, or typed by hand);
 * 4. none → status MISSING_AMOUNT (no split: nothing is posted until the amount is known).
 *
 * **Platform fee (F)**: typed by hand (`overrides.platformFeeCents`) > from the e-mail (payout vs total) > estimated at
 * the organization's default rate for that platform (lib/finance/platform-fees.ts) > 0 for a direct booking. Never
 * more than G.
 *
 * **Cleaning (C)** = the booking's cleaning fee (Booking.cleaningFeeCents), at most G − F; it goes in full to its
 * beneficiary (organization parameter, overridden per home: Sigma when it organizes the cleaning, the owner in a
 * « gestion à distance » mandate where the owner does — Lot 11). Platform fees are borne by the rent, not by the
 * cleaning. A cancelled booking has no cleaning.
 *
 * **Commission base** (organization parameter): NET_EXCL_CLEANING (default) = G − F − C, the rent actually received;
 * GROSS_EXCL_CLEANING = G − C, before platform fees. **Commission (K)** = base × commissionBps, rounded to the centime,
 * at most the rent G − F − C (an owner share is never negative because of fees).
 *
 * **MANAGED** (mandat de gestion): owner share O = G − F − C − K. **SUBLEASE** (sous-location): no commission and no
 * owner share: all the net revenue is Sigma's (sigmaRental = G − F − C, and the cleaning is Sigma's); the rent paid to
 * the owner is an expense of Sigma (Listing.subleaseRentCents, posted monthly at closing).
 *
 * Invariant: F + cleaningSigma + cleaningOwner + K + O + sigmaRental = G, all ≥ 0.
 *
 * **Months (mois à cheval)**: each part is shared between the months of the stay's nights in proportion to the number
 * of nights in each month (NIGHTS, default: a stay from 30/10 to 02/11 puts 2/3 in October and 1/3 in November), or
 * entirely in the month of the departure date (CHECKOUT, organization parameter), by largest remainder: every part's
 * months add up exactly to the part, and a month's gross is the sum of its parts.
 *
 * The taxe de séjour (BookingTouristTax, Lot 5) is not revenue: it is collected from the guest and owed to the commune
 * (a pass-through liability), carried next to the split and posted to its own account, month by month from its
 * night-by-night lines.
 */

export type ManagementType = "MANAGED" | "SUBLEASE";
export type FeeBeneficiary = "SIGMA" | "OWNER";
export type CommissionBase = "NET_EXCL_CLEANING" | "GROSS_EXCL_CLEANING";
export type RevenueAllocation = "NIGHTS" | "CHECKOUT";
export type SplitStatus = "COMPLETE" | "MISSING_AMOUNT" | "MISSING_RATE" | "CANCELLED" | "NOT_APPLICABLE";
export type GrossSource = "BOOKING" | "EMAIL" | "MANUAL" | "ESTIMATE";
export type FeeSource = "NONE" | "EMAIL" | "MANUAL" | "ESTIMATE";

export interface SplitInput {
  source: string;
  status: "CONFIRMED" | "CANCELLED";
  /** An imported platform « Not available » block: no guest, no revenue. */
  channelBlock: boolean;
  /** yyyy-MM-dd, checkOut exclusive. */
  checkIn: string;
  checkOut: string;
  totalCents: number | null;
  cleaningFeeCents: number | null;
  platformAmount: { cents: number; currency: string; kind: "PAYOUT" | "GUEST_TOTAL" } | null;
}

export interface SplitTerms {
  managementType: ManagementType;
  /** 0–10000; ignored (0) for SUBLEASE. */
  commissionBps: number;
  cleaningBeneficiary: FeeBeneficiary;
  commissionBase: CommissionBase;
  allocation: RevenueAllocation;
  /** The default platform fee rate of the booking's source, for estimates (0 for DIRECT). */
  platformFeeBps: number;
}

export interface SplitOverrides {
  grossCents: number | null;
  platformFeeCents: number | null;
  /** Millionths of MAD per unit of the platform amount's currency (lib/finance/fx.ts). */
  fxRateMicros: number | null;
}

export const NO_OVERRIDES: SplitOverrides = { grossCents: null, platformFeeCents: null, fxRateMicros: null };

export interface SplitParts {
  platformFeeCents: number;
  cleaningSigmaCents: number;
  cleaningOwnerCents: number;
  commissionCents: number;
  ownerShareCents: number;
  sigmaRentalCents: number;
}

export const PART_KEYS = ["platformFeeCents", "cleaningSigmaCents", "cleaningOwnerCents", "commissionCents", "ownerShareCents", "sigmaRentalCents"] as const satisfies readonly (keyof SplitParts)[];

export interface MonthSplit extends SplitParts {
  month: string;
  /** Nights of the stay in this month (CHECKOUT: every night counts in the departure month). */
  nights: number;
  grossCents: number;
}

export interface BookingSplit extends SplitParts {
  status: SplitStatus;
  grossSource: GrossSource | null;
  feeSource: FeeSource;
  /** The amount G was read from, in its currency, when it isn't MAD (or null). */
  foreignAmount: { cents: number; currency: string; kind: "PAYOUT" | "GUEST_TOTAL" } | null;
  nights: number;
  grossCents: number;
  commissionBaseCents: number;
  /** G − F: what reaches Sigma's account. */
  netCents: number;
  /** Commission + cleaning kept by Sigma + sublease rental. */
  sigmaTotalCents: number;
  /** Owner share + cleaning kept by the owner. */
  ownerTotalCents: number;
  months: MonthSplit[];
}

const ZERO_PARTS: SplitParts = { platformFeeCents: 0, cleaningSigmaCents: 0, cleaningOwnerCents: 0, commissionCents: 0, ownerShareCents: 0, sigmaRentalCents: 0 };

function empty(status: SplitStatus, nights: number, foreignAmount: BookingSplit["foreignAmount"] = null): BookingSplit {
  return { status, grossSource: null, feeSource: "NONE", foreignAmount, nights, grossCents: 0, commissionBaseCents: 0, netCents: 0, sigmaTotalCents: 0, ownerTotalCents: 0, months: [], ...ZERO_PARTS };
}

const nonNegative = (n: number | null | undefined) => (n !== null && n !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : null);

/** P ÷ (1 − bps), rounded: the guest total estimated from a payout. */
export function grossFromPayout(payoutCents: number, feeBps: number): number {
  if (feeBps <= 0) return payoutCents;
  return mulDivRound(payoutCents, 10_000, 10_000 - feeBps);
}

/** The months of a stay and their weights for the allocation. */
export function monthWeights(checkIn: string, checkOut: string, allocation: RevenueAllocation): { month: string; nights: number }[] {
  const nights = stayNights(checkIn, checkOut);
  if (allocation === "CHECKOUT") return [{ month: monthOfDay(checkOut), nights: nights.length }];
  const out: { month: string; nights: number }[] = [];
  for (const n of nights) {
    const m = monthOfDay(n);
    const last = out[out.length - 1];
    if (last && last.month === m) last.nights += 1;
    else out.push({ month: m, nights: 1 });
  }
  return out;
}

/** Shares every part between the months (largest remainder, part by part). */
export function allocateMonths(parts: SplitParts, weights: readonly { month: string; nights: number }[]): MonthSplit[] {
  if (!weights.length) return [];
  const w = weights.map((x) => Math.max(x.nights, 0));
  const usable = w.some((x) => x > 0) ? w : w.map(() => 1);
  const shares = Object.fromEntries(PART_KEYS.map((k) => [k, allocate(parts[k], usable)])) as Record<keyof SplitParts, number[]>;
  return weights.map((x, i) => {
    const p = Object.fromEntries(PART_KEYS.map((k) => [k, shares[k][i]])) as unknown as SplitParts;
    return { month: x.month, nights: x.nights, ...p, grossCents: PART_KEYS.reduce((s, k) => s + p[k], 0) };
  });
}

export function computeSplit(b: SplitInput, terms: SplitTerms, overrides: SplitOverrides = NO_OVERRIDES): BookingSplit {
  const nights = stayNights(b.checkIn, b.checkOut).length;
  if (b.source === "OWNER") return empty("NOT_APPLICABLE", nights);
  const grossOverride = nonNegative(overrides.grossCents);
  const cancelled = b.status === "CANCELLED";
  if (cancelled && grossOverride === null) return empty("CANCELLED", nights);
  if (b.channelBlock && grossOverride === null) return empty("NOT_APPLICABLE", nights);
  const feeBps = Math.min(Math.max(terms.platformFeeBps, 0), 9_999);

  let G: number;
  let grossSource: GrossSource;
  let fee: { cents: number; source: FeeSource } | null = null;
  let foreignAmount: BookingSplit["foreignAmount"] = null;
  const pa = b.platformAmount;
  if (grossOverride !== null) {
    G = grossOverride;
    grossSource = "MANUAL";
  } else if (pa && nonNegative(pa.cents) !== null) {
    let amount: number;
    if (pa.currency === "MAD") amount = pa.cents;
    else {
      foreignAmount = { ...pa };
      if (!overrides.fxRateMicros || overrides.fxRateMicros <= 0) return empty("MISSING_RATE", nights, foreignAmount);
      amount = convertToMad(pa.cents, overrides.fxRateMicros);
    }
    if (pa.kind === "GUEST_TOTAL") {
      G = amount;
      grossSource = "EMAIL";
    } else {
      // The e-mail's payout in MAD may itself have filled totalCents (lib/server/channels/email/process.ts): then the
      // booking's total is the payout, not the guest's total.
      const totalIsPayout = pa.currency === "MAD" && b.totalCents === pa.cents;
      const total = nonNegative(b.totalCents);
      if (total !== null && !totalIsPayout && total >= amount) {
        G = total;
        grossSource = "BOOKING";
        fee = { cents: total - amount, source: "EMAIL" };
      } else {
        G = grossFromPayout(amount, feeBps);
        grossSource = G === amount ? "EMAIL" : "ESTIMATE";
        fee = { cents: G - amount, source: G === amount ? "NONE" : "ESTIMATE" };
      }
    }
  } else if (nonNegative(b.totalCents) !== null) {
    G = b.totalCents!;
    grossSource = "BOOKING";
  } else {
    return empty("MISSING_AMOUNT", nights);
  }

  const feeOverride = nonNegative(overrides.platformFeeCents);
  if (feeOverride !== null) fee = { cents: feeOverride, source: "MANUAL" };
  else if (!fee) fee = feeBps > 0 && b.source !== "DIRECT" ? { cents: applyBps(G, feeBps), source: "ESTIMATE" } : { cents: 0, source: "NONE" };
  const F = Math.min(fee.cents, G);
  const C = cancelled ? 0 : Math.min(nonNegative(b.cleaningFeeCents) ?? 0, G - F);
  const rent = G - F - C;

  const parts: SplitParts = { ...ZERO_PARTS, platformFeeCents: F };
  let base = 0;
  if (terms.managementType === "SUBLEASE") {
    parts.cleaningSigmaCents = C;
    parts.sigmaRentalCents = rent;
  } else {
    if (terms.cleaningBeneficiary === "OWNER") parts.cleaningOwnerCents = C;
    else parts.cleaningSigmaCents = C;
    base = terms.commissionBase === "GROSS_EXCL_CLEANING" ? G - C : rent;
    const bps = Math.min(Math.max(terms.commissionBps, 0), 10_000);
    parts.commissionCents = Math.min(applyBps(base, bps), rent);
    parts.ownerShareCents = rent - parts.commissionCents;
  }
  const months = allocateMonths(parts, monthWeights(b.checkIn, b.checkOut, terms.allocation));
  return {
    status: "COMPLETE",
    grossSource,
    feeSource: F === 0 && fee.source !== "MANUAL" ? "NONE" : fee.source,
    foreignAmount,
    nights,
    grossCents: G,
    commissionBaseCents: base,
    netCents: G - F,
    sigmaTotalCents: parts.commissionCents + parts.cleaningSigmaCents + parts.sigmaRentalCents,
    ownerTotalCents: parts.ownerShareCents + parts.cleaningOwnerCents,
    months,
    ...parts,
  };
}

/** Σ of the parts: equals grossCents for every split (tests, database check). */
export function partsTotal(p: SplitParts): number {
  return PART_KEYS.reduce((s, k) => s + p[k], 0);
}

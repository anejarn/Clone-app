import { breakdownOfStay, type PriceBreakdown } from "./stay";

/**
 * The pricing engine: the price of each night of a stay and its minimum length, from the listing's base price and
 * minimum stay and the organization's price rules (seasons and events). Pure: the server (quote, booking, search,
 * back-office) and the browser (the back-office's price preview) run the same code.
 *
 * Nights are calendar dates, yyyy-MM-dd: the local date in Marrakech (Africa/Casablanca), as stored in @db.Date
 * columns. A stay from checkIn to checkOut has the nights checkIn … checkOut − 1. Amounts are integer centimes of
 * dirham (MAD).
 *
 * A rule covers the nights from startDate to endDate, both included; a recurring rule covers the same day-month
 * range every year, a range crossing 31/12 included (20/12 → 04/01). A recurring range starting or ending on 29/02
 * covers, in other years, the days around it (25/02 → 29/02 is 25/02 → 28/02); a recurring rule on 29/02 alone only
 * exists in leap years.
 *
 * Precedence: one rule sets the price of a night, the first of compareRules among those covering it:
 *   1. reach: a rule for one listing > a rule for a selection of listings > a rule for every listing;
 *   2. kind: an event > a season;
 *   3. priority (0–100): the higher;
 *   4. the most recently created; then the id, so the order is total.
 * Rules don't add up. No rule: the listing's base price, untouched. A PERCENT rule of 0 % only sets a minimum stay: it
 * takes no part in the price (a "minimum 3 nuits" event doesn't cancel the season's price under it).
 *
 * Price of a night under a rule:
 * - FIXED: that price (centimes as typed);
 * - PERCENT: base × (1 + bps / 10 000), rounded to the whole dirham, half up (1 234,50 → 1 235 MAD), and never under
 *   MIN_NIGHTLY_CENTS (1 MAD).
 *
 * Minimum stay of a stay: the largest of the listing's minNights and the minNights of every rule of the listing
 * that covers at least one of its nights, whatever their precedence (a rule never lowers the minimum).
 */

export type PriceRuleKind = "SEASON" | "EVENT";

export type PriceAdjustment = { type: "PERCENT"; bps: number } | { type: "FIXED"; cents: number };

export interface PricingRule {
  id: string;
  kind: PriceRuleKind;
  name: string;
  /** First night covered, yyyy-MM-dd. */
  startDate: string;
  /** Last night covered (included), yyyy-MM-dd. */
  endDate: string;
  /** Every year, same day-month range. */
  recurring: boolean;
  adjustment: PriceAdjustment;
  /** Minimum stay for stays with a night in the range; null: the listing's. */
  minNights: number | null;
  priority: number;
  /** null: every listing of the organization; otherwise the listings it applies to. */
  listingIds: readonly string[] | null;
  /** ISO timestamp; between otherwise equal rules the most recent wins. */
  createdAt: string;
}

/** What the engine needs of a listing. */
export interface PricedListing {
  id: string;
  /** Base nightly price, centimes. */
  priceCents: number;
  cleaningFeeCents: number;
  minNights: number;
}

/** No night is ever priced under 1 MAD, whatever the percentage. */
export const MIN_NIGHTLY_CENTS = 100;
/** Bounds of a percentage adjustment, in basis points: −90 % … +500 %. */
export const PERCENT_BPS_MIN = -9_000;
export const PERCENT_BPS_MAX = 50_000;

const DAY = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** yyyy-MM-dd of a UTC-midnight Date (or any Date: its UTC calendar date). */
export function isoNight(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toMs(iso: string): number {
  const m = ISO_RE.exec(iso);
  if (!m) throw new RangeError(`not a yyyy-MM-dd date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const asIso = (d: string | Date) => (typeof d === "string" ? isoNight(new Date(toMs(d))) : isoNight(d));

export function addNights(iso: string, n: number): string {
  return isoNight(new Date(toMs(iso) + n * DAY));
}

/** The nights of a stay: checkIn … checkOut − 1. Empty when checkOut ≤ checkIn. */
export function stayNights(checkIn: string | Date, checkOut: string | Date): string[] {
  const from = toMs(asIso(checkIn));
  const to = toMs(asIso(checkOut));
  const out: string[] = [];
  for (let t = from; t < to; t += DAY) out.push(isoNight(new Date(t)));
  return out;
}

/** 1231 for 31 December: day-month as a number, comparable across years. */
const monthDay = (iso: string) => Number(iso.slice(5, 7)) * 100 + Number(iso.slice(8, 10));

export function ruleCoversNight(rule: Pick<PricingRule, "startDate" | "endDate" | "recurring">, night: string): boolean {
  if (!rule.recurring) return rule.startDate <= night && night <= rule.endDate;
  const s = monthDay(rule.startDate);
  const e = monthDay(rule.endDate);
  const d = monthDay(night);
  // Within one year (15/03 → 31/05), or across 31/12 (20/12 → 04/01: the end's day-month comes before the start's,
  // as the range is shorter than a year: price_rules_recurring_span_check).
  if (rule.startDate.slice(0, 4) === rule.endDate.slice(0, 4)) return s <= d && d <= e;
  return d >= s || d <= e;
}

export function ruleAppliesToListing(rule: Pick<PricingRule, "listingIds">, listingId: string): boolean {
  return rule.listingIds === null || rule.listingIds.includes(listingId);
}

/** 2 for one listing, 1 for a selection, 0 for every listing. */
export function ruleReach(rule: Pick<PricingRule, "listingIds">): 0 | 1 | 2 {
  if (rule.listingIds === null) return 0;
  return rule.listingIds.length === 1 ? 2 : 1;
}

/** Negative when `a` wins over `b` (sort with it: the winner first). */
export function compareRules(a: PricingRule, b: PricingRule): number {
  return (
    ruleReach(b) - ruleReach(a) ||
    Number(b.kind === "EVENT") - Number(a.kind === "EVENT") ||
    b.priority - a.priority ||
    (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

/** Integer division rounded half up, for num ≥ 0 and den > 0. Exact for integers below 2^53. */
function divRoundHalfUp(num: number, den: number): number {
  return Math.floor((2 * num + den) / (2 * den));
}

/** A night's price under an adjustment, from the base price. */
export function adjustedPrice(baseCents: number, adjustment: PriceAdjustment): number {
  if (adjustment.type === "FIXED") return Math.max(MIN_NIGHTLY_CENTS, adjustment.cents);
  const factor = 10_000 + adjustment.bps;
  // Centimes × (10 000 + bps) / 10 000, then to the whole dirham (100 centimes), in one rounding.
  const dirhams = divRoundHalfUp(baseCents * Math.max(0, factor), 1_000_000);
  return Math.max(MIN_NIGHTLY_CENTS, dirhams * 100);
}

/** The rules of `listingId`, best first (compareRules). */
export function rulesForListing(rules: readonly PricingRule[], listingId: string): PricingRule[] {
  return rules.filter((r) => ruleAppliesToListing(r, listingId)).sort(compareRules);
}

/** Whether a rule sets prices (a 0 % rule only sets a minimum stay). */
export function rulePrices(rule: Pick<PricingRule, "adjustment">): boolean {
  return rule.adjustment.type === "FIXED" || rule.adjustment.bps !== 0;
}

export interface NightPrice {
  /** yyyy-MM-dd */
  date: string;
  priceCents: number;
  /** The rule that set the price; null for the base price. */
  rule: { id: string; name: string; kind: PriceRuleKind } | null;
}

function priceNight(listing: PricedListing, sorted: readonly PricingRule[], night: string): NightPrice {
  const rule = sorted.find((r) => rulePrices(r) && ruleCoversNight(r, night));
  if (!rule) return { date: night, priceCents: listing.priceCents, rule: null };
  return { date: night, priceCents: adjustedPrice(listing.priceCents, rule.adjustment), rule: { id: rule.id, name: rule.name, kind: rule.kind } };
}

/** The price of one night of a listing. */
export function nightPrice(listing: PricedListing, rules: readonly PricingRule[], night: string | Date): NightPrice {
  return priceNight(listing, rulesForListing(rules, listing.id), asIso(night));
}

function minNightsOver(listing: PricedListing, rules: readonly PricingRule[], nights: readonly string[]): number {
  let min = listing.minNights;
  for (const r of rules) {
    if (r.minNights !== null && r.minNights > min && ruleAppliesToListing(r, listing.id) && nights.some((n) => ruleCoversNight(r, n))) min = r.minNights;
  }
  return min;
}

/**
 * The minimum stay for a stay from checkIn to checkOut: the listing's, raised by any rule covering one of its nights.
 * For an empty stay (checkOut ≤ checkIn), the minimum of a stay arriving on checkIn.
 */
export function effectiveMinNights(listing: PricedListing, rules: readonly PricingRule[], checkIn: string | Date, checkOut: string | Date): number {
  const nights = stayNights(checkIn, checkOut);
  return minNightsOver(listing, rules, nights.length ? nights : [asIso(checkIn)]);
}

export interface StayPrice extends PriceBreakdown {
  /** Every night with its price, in order. */
  nightly: NightPrice[];
  /** Σ nights / nights, rounded to the centime: informative (what bookings store as nightlyCents). 0 without nights. */
  averageNightlyCents: number;
  /** Whether all the nights have the same price. */
  uniform: boolean;
  /** effectiveMinNights of the stay. */
  minNights: number;
}

/** The whole stay: each night's price, stay = Σ nights, total = stay + cleaning (+ service fee, none at Sigma). */
export function priceStay(listing: PricedListing, rules: readonly PricingRule[], checkIn: string | Date, checkOut: string | Date): StayPrice {
  const sorted = rulesForListing(rules, listing.id);
  const nights = stayNights(checkIn, checkOut);
  const nightly = nights.map((n) => priceNight(listing, sorted, n));
  const stayCents = nightly.reduce((sum, n) => sum + n.priceCents, 0);
  return {
    ...breakdownOfStay(stayCents, nights.length, listing.cleaningFeeCents),
    nightly,
    averageNightlyCents: nights.length ? Math.round(stayCents / nights.length) : 0,
    uniform: nightly.every((n) => n.priceCents === nightly[0].priceCents),
    minNights: minNightsOver(listing, sorted, nights.length ? nights : [asIso(checkIn)]),
  };
}

export interface CalendarDay extends NightPrice {
  /** The shortest stay that has this night: the listing's minimum raised by the rules covering it. */
  minNights: number;
}

/** `days` nights from `from`: the back-office's price calendar of a listing. */
export function priceCalendar(listing: PricedListing, rules: readonly PricingRule[], from: string | Date, days: number): CalendarDay[] {
  const sorted = rulesForListing(rules, listing.id);
  const start = asIso(from);
  return Array.from({ length: Math.max(0, days) }, (_, i) => {
    const night = addNights(start, i);
    return { ...priceNight(listing, sorted, night), minNights: minNightsOver(listing, sorted, [night]) };
  });
}

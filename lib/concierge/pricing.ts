import type { ServicePricingModel } from "@/lib/generated/prisma/enums";

/**
 * Conciergerie prices (Lot 4b). Pure, integer arithmetic on centimes of dirham (MAD): no floating point anywhere a
 * total is made, so a total is always exactly Σ (unit price × count) + Σ options.
 *
 * - The count (« multiplier ») of a line is the number of persons for PER_PERSON, the quantity otherwise (units,
 *   days, trips). ON_QUOTE has no price: its totals are null until the team sets them (adjustedTotals).
 * - An option is either flat (added once) or per unit (multiplied by the same count as the service).
 * - Margin = sale total − partner total, in centimes, never negative (the database refuses it too). Margin rate =
 *   margin ÷ sale total (taux de marque, on the sale price), in basis points, rounded half up to the basis point
 *   (0,01 %): the only rounding of the module, for display only — amounts are never derived from it. Null when the
 *   sale total is 0.
 * - Totals are capped at MAX_TOTAL_CENTS (10 000 000 MAD), far below 2^31 (Postgres integer) and 2^53.
 */

export const MAX_UNIT_CENTS = 100_000_000; // 1 000 000 MAD
export const MAX_TOTAL_CENTS = 1_000_000_000; // 10 000 000 MAD
export const MAX_COUNT = 50;

export interface PriceOption {
  saleCents: number;
  partnerCents: number;
  /** Multiplied by the line's count; otherwise added once. */
  perUnit: boolean;
}

export interface LineInput {
  pricingModel: ServicePricingModel;
  /** Null exactly for ON_QUOTE. */
  unitSaleCents: number | null;
  unitPartnerCents: number | null;
  quantity: number;
  persons: number;
  options: readonly PriceOption[];
}

export interface Totals {
  saleTotalCents: number;
  partnerTotalCents: number;
  marginCents: number;
}

export interface LineTotals {
  /** What the unit price is multiplied by. */
  multiplier: number;
  /** Null for ON_QUOTE (price to be set by the team). */
  totals: Totals | null;
}

function assertCents(n: number | null, what: string, max = MAX_UNIT_CENTS): asserts n is number {
  if (n === null || !Number.isSafeInteger(n) || n < 0 || n > max) throw new RangeError(`${what}: not an amount of centimes between 0 and ${max}: ${n}`);
}

function assertCount(n: number, what: string) {
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_COUNT) throw new RangeError(`${what}: not a count between 1 and ${MAX_COUNT}: ${n}`);
}

/** Sale and partner prices of one thing: integers, partner ≤ sale (no sale at a loss). */
export function assertPricePair(saleCents: number | null, partnerCents: number | null, what = "price", max = MAX_UNIT_CENTS): void {
  assertCents(saleCents, `${what} (sale)`, max);
  assertCents(partnerCents, `${what} (partner)`, max);
  if (partnerCents > saleCents) throw new RangeError(`${what}: partner price ${partnerCents} above sale price ${saleCents}`);
}

/** The count the unit price is multiplied by: persons for PER_PERSON, the quantity for every other model. */
export function multiplierOf(pricingModel: ServicePricingModel, quantity: number, persons: number): number {
  assertCount(quantity, "quantity");
  assertCount(persons, "persons");
  return pricingModel === "PER_PERSON" ? persons : quantity;
}

/** Margin of a sale and a partner total. */
export function marginOf(saleTotalCents: number, partnerTotalCents: number): Totals {
  assertPricePair(saleTotalCents, partnerTotalCents, "total", MAX_TOTAL_CENTS);
  return { saleTotalCents, partnerTotalCents, marginCents: saleTotalCents - partnerTotalCents };
}

/** The totals of a request line (service × count + options), or null totals for ON_QUOTE. Throws RangeError on bad input. */
export function lineTotals(input: LineInput): LineTotals {
  const multiplier = multiplierOf(input.pricingModel, input.quantity, input.persons);
  if (input.pricingModel === "ON_QUOTE") {
    if (input.unitSaleCents !== null || input.unitPartnerCents !== null) throw new RangeError("ON_QUOTE has no unit price");
    return { multiplier, totals: null };
  }
  const unitSale = input.unitSaleCents;
  const unitPartner = input.unitPartnerCents;
  if (unitSale === null || unitPartner === null) throw new RangeError("unit price: missing");
  assertPricePair(unitSale, unitPartner, "unit price");
  let sale = unitSale * multiplier;
  let partner = unitPartner * multiplier;
  for (const [i, o] of input.options.entries()) {
    assertPricePair(o.saleCents, o.partnerCents, `option ${i}`);
    const times = o.perUnit ? multiplier : 1;
    sale += o.saleCents * times;
    partner += o.partnerCents * times;
  }
  if (sale > MAX_TOTAL_CENTS) throw new RangeError(`total above ${MAX_TOTAL_CENTS} centimes: ${sale}`);
  return { multiplier, totals: marginOf(sale, partner) };
}

/** Margin rate in basis points (2 350 = 23,5 %) of the sale total, rounded half up; null when the sale is 0. */
export function marginBps(saleTotalCents: number, marginCents: number): number | null {
  assertCents(saleTotalCents, "sale total", MAX_TOTAL_CENTS);
  if (!Number.isSafeInteger(marginCents) || marginCents < 0 || marginCents > saleTotalCents) throw new RangeError(`margin out of range: ${marginCents}`);
  if (saleTotalCents === 0) return null;
  // round(margin × 10 000 / sale) with halves up, in integers: floor((2 × margin × 10 000 + sale) / (2 × sale)).
  return Math.floor((2 * marginCents * 10_000 + saleTotalCents) / (2 * saleTotalCents));
}

/** Σ of the margins of several requests (e.g. the month's), ignoring those without a price yet. */
export function sumMargins(rows: readonly { marginCents: number | null }[]): number {
  let total = 0;
  for (const r of rows) {
    if (r.marginCents === null) continue;
    if (!Number.isSafeInteger(r.marginCents) || r.marginCents < 0) throw new RangeError(`not a margin: ${r.marginCents}`);
    total += r.marginCents;
  }
  return total;
}

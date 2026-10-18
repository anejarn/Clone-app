import { addNights, stayNights } from "@/lib/pricing/engine";

/**
 * Taxe de séjour (Lot 5), pure: no database, no clock. Usable by the server, the seed and the tests alike.
 *
 * Tax of a stay = Σ over its nights of (rate of that night × taxable guests of that night), in centimes of dirham.
 *
 * - **Rates are versioned by effective date** (`effectiveFrom`, a local date): the version of a night is the latest
 *   one that took effect on or before that night. A new rate therefore never changes the nights before its date; a
 *   stay across the change is taxed night by night (old rate before, new rate from its date on).
 * - **Organization versions** (`OrgTaxVersion`) carry the rate per taxable guest per night and the exemption rules
 *   in force from their date; **listing versions** (`ListingTaxVersion`) override only the rate of one home from
 *   their date (`rateCents: null` = back to the organization's rate). Exemption rules always come from the
 *   organization version of the night.
 * - **Exemptions** (configurable, per organization version): minors under `minorsExemptUnder` years (age on the day of
 *   arrival; null = no exemption for minors), and, when `residentsExempt`, the guests whose country of residence is
 *   Morocco (MA). Nothing else is assumed: the real rules of Marrakech must be confirmed by Sigma with the commune or
 *   the accountant (docs: README « Taxe de séjour »).
 * - A night without any organization version in force has no tax (rate null, counted in `missingRateNights`, shown
 *   as « aucun taux » so that the team notices).
 * - **Rounding: none.** Rates are whole centimes (typed with at most two decimals, lib/money.ts) and every product and
 *   sum stays an integer number of centimes: the total is exact, never rounded to the dirham. Should the commune
 *   require a rounding, it is to be added here, once, on the stay's total.
 */

export interface OrgTaxVersion {
  id: string;
  /** yyyy-MM-dd. */
  effectiveFrom: string;
  /** Centimes of dirham per taxable guest per night. */
  rateCents: number;
  /** Guests younger than this on arrival pay nothing; null = minors are taxed like adults. */
  minorsExemptUnder: number | null;
  /** Guests residing in Morocco (residence country MA) pay nothing. */
  residentsExempt: boolean;
}

export interface ListingTaxVersion {
  id: string;
  listingId: string;
  effectiveFrom: string;
  /** null = the organization's rate again from this date. */
  rateCents: number | null;
}

/**
 * A guest of the stay. `age` is known from a recorded traveller (birth date); otherwise only the booking's category
 * is: ADULT (18 and over), CHILD (2 to 17, the site's « Enfants ») or INFANT (under 2, « Bébés »).
 */
export interface TaxGuest {
  kind: "ADULT" | "CHILD" | "INFANT";
  age: number | null;
  /** ISO 3166-1 alpha-2 country of residence, when recorded. */
  residenceCountry: string | null;
}

/** The youngest age a booking category can be (used when the exact age isn't recorded). */
const KIND_MAX_AGE_PLUS_ONE: Record<TaxGuest["kind"], number> = { ADULT: Number.POSITIVE_INFINITY, CHILD: 18, INFANT: 2 };

export interface TaxNight {
  night: string;
  /** null when no organization version is in force that night. */
  rateCents: number | null;
  orgVersionId: string | null;
  listingVersionId: string | null;
  taxable: number;
  exempt: number;
  amountCents: number;
}

export interface StayTax {
  totalCents: number;
  nights: number;
  taxableGuestNights: number;
  exemptGuestNights: number;
  missingRateNights: number;
  lines: TaxNight[];
}

/** The latest version in force on `night` (effectiveFrom ≤ night), or null. Ties: the last one given wins. */
export function versionOn<V extends { effectiveFrom: string }>(versions: readonly V[], night: string): V | null {
  let best: V | null = null;
  for (const v of versions) {
    if (v.effectiveFrom <= night && (!best || v.effectiveFrom >= best.effectiveFrom)) best = v;
  }
  return best;
}

/** Whole years between a birth date and a day (both yyyy-MM-dd). Born on 29/02: one year older on 01/03 in common years. */
export function ageOn(birthDate: string, day: string): number {
  const years = Number(day.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return day.slice(5) < birthDate.slice(5) ? years - 1 : years;
}

/** Whether a guest pays nothing under an organization version's rules. */
export function isExempt(guest: TaxGuest, rules: Pick<OrgTaxVersion, "minorsExemptUnder" | "residentsExempt">): boolean {
  if (rules.residentsExempt && guest.residenceCountry === "MA") return true;
  if (rules.minorsExemptUnder === null) return false;
  if (guest.age !== null) return guest.age < rules.minorsExemptUnder;
  // Age unknown: exempt only when every age of the category is under the limit (children 2–17 when the limit is ≥ 18).
  return KIND_MAX_AGE_PLUS_ONE[guest.kind] <= rules.minorsExemptUnder;
}

function assertCentimes(n: number, what: string) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${what} must be a whole, non-negative number of centimes: ${n}`);
}

/** The tax of a stay on `listingId`, night by night. Zero nights (checkOut ≤ checkIn) → zero. */
export function computeStayTax(input: {
  listingId: string;
  checkIn: string;
  checkOut: string;
  guests: readonly TaxGuest[];
  orgVersions: readonly OrgTaxVersion[];
  listingVersions?: readonly ListingTaxVersion[];
}): StayTax {
  const own = (input.listingVersions ?? []).filter((v) => v.listingId === input.listingId);
  for (const v of input.orgVersions) assertCentimes(v.rateCents, "rateCents");
  for (const v of own) if (v.rateCents !== null) assertCentimes(v.rateCents, "rateCents");
  const lines: TaxNight[] = stayNights(input.checkIn, input.checkOut).map((night) => {
    const org = versionOn(input.orgVersions, night);
    if (!org) return { night, rateCents: null, orgVersionId: null, listingVersionId: null, taxable: 0, exempt: 0, amountCents: 0 };
    const override = versionOn(own, night);
    const rateCents = override && override.rateCents !== null ? override.rateCents : org.rateCents;
    const exempt = input.guests.filter((g) => isExempt(g, org)).length;
    const taxable = input.guests.length - exempt;
    return { night, rateCents, orgVersionId: org.id, listingVersionId: override?.id ?? null, taxable, exempt, amountCents: rateCents * taxable };
  });
  const totalCents = lines.reduce((s, l) => s + l.amountCents, 0);
  if (!Number.isSafeInteger(totalCents)) throw new RangeError("tourist tax total overflows");
  return {
    totalCents,
    nights: lines.length,
    taxableGuestNights: lines.reduce((s, l) => s + (l.rateCents === null ? 0 : l.taxable), 0),
    exemptGuestNights: lines.reduce((s, l) => s + (l.rateCents === null ? 0 : l.exempt), 0),
    missingRateNights: lines.filter((l) => l.rateCents === null).length,
    lines,
  };
}

/** A recorded traveller, as the tax needs it. */
export interface TaxTraveler {
  /** yyyy-MM-dd, when recorded. */
  birthDate: string | null;
  isMinor: boolean;
  residenceCountry: string | null;
}

/**
 * The guests of a stay: the recorded travellers, completed from the booking's counts. The tax is never lower because
 * a fiche is missing: adults the booking announces beyond the recorded adult travellers count as taxable adults, and
 * children and babies beyond the recorded minors as their booking category. Ages come from the birth dates, on the
 * day of arrival.
 */
export function taxGuests(booking: { checkIn: string; adults: number; children: number; infants: number }, travelers: readonly TaxTraveler[]): TaxGuest[] {
  const guests: TaxGuest[] = travelers.map((t) => {
    const age = t.birthDate ? ageOn(t.birthDate, booking.checkIn) : null;
    return { kind: t.isMinor ? (age !== null && age < 2 ? "INFANT" : "CHILD") : "ADULT", age, residenceCountry: t.residenceCountry };
  });
  const adults = travelers.filter((t) => !t.isMinor).length;
  let minors = travelers.length - adults;
  for (let i = adults; i < booking.adults; i += 1) guests.push({ kind: "ADULT", age: null, residenceCountry: null });
  // Recorded minors first fill the children, then the babies.
  const unrecordedChildren = Math.max(0, booking.children - minors);
  minors = Math.max(0, minors - booking.children);
  const unrecordedInfants = Math.max(0, booking.infants - minors);
  for (let i = 0; i < unrecordedChildren; i += 1) guests.push({ kind: "CHILD", age: null, residenceCountry: null });
  for (let i = 0; i < unrecordedInfants; i += 1) guests.push({ kind: "INFANT", age: null, residenceCountry: null });
  return guests;
}

/** The lines of a stay that fall in a month (yyyy-MM), summed: for the monthly report by listing. */
export function monthTotals(lines: readonly TaxNight[], month: string): { nights: number; taxableGuestNights: number; totalCents: number; missingRateNights: number } {
  const inMonth = lines.filter((l) => l.night.startsWith(`${month}-`));
  return {
    nights: inMonth.length,
    taxableGuestNights: inMonth.reduce((s, l) => s + (l.rateCents === null ? 0 : l.taxable), 0),
    totalCents: inMonth.reduce((s, l) => s + l.amountCents, 0),
    missingRateNights: inMonth.filter((l) => l.rateCents === null).length,
  };
}

/** First day of the month after `month` (yyyy-MM), as yyyy-MM-dd; with the month's first day, the report's window. */
export function monthBounds(month: string): { from: string; to: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new RangeError(`not a yyyy-MM month: ${month}`);
  const from = `${month}-01`;
  let to = from;
  while (to.slice(0, 7) === month) to = addNights(to, 1);
  return { from, to };
}

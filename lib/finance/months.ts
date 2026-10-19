/**
 * Accounting months of the finances (Lot 6), as "yyyy-MM" strings. Stays' nights are local dates (Africa/Casablanca,
 * stored as UTC midnights in @db.Date columns), so the month of a night is plain text; an instant (a ledger entry's
 * time, « today ») is turned into Marrakech's local month with Intl (JavaScript's time-zone data: the database's is
 * not trusted for Morocco after 09/2026).
 */

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const FINANCE_TIMEZONE = "Africa/Casablanca";

export function isMonth(s: unknown): s is string {
  return typeof s === "string" && MONTH_RE.test(s);
}

/** "2026-10-31" → "2026-10". */
export function monthOfDay(isoDay: string): string {
  const m = isoDay.slice(0, 7);
  if (!MONTH_RE.test(m)) throw new RangeError(`not a yyyy-MM-dd date: ${isoDay}`);
  return m;
}

/** The month `n` months after `month` (n may be negative). */
export function addMonths(month: string, n: number): string {
  if (!MONTH_RE.test(month)) throw new RangeError(`not a yyyy-MM month: ${month}`);
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/** Every month from `from` to `to`, both included; empty when to < from. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 1200; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** The local month (Marrakech by default) of an instant. */
export function localMonth(instant: Date | number, timeZone = FINANCE_TIMEZONE): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  return ymd.slice(0, 7);
}

/** First day (yyyy-MM-dd) of `month` and first day of the next one: the half-open window of its nights. */
export function monthWindow(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${addMonths(month, 1)}-01` };
}

const LABEL = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

/** "2026-10" → "octobre 2026". */
export function monthLabel(month: string): string {
  return LABEL.format(new Date(`${month}-01T00:00:00Z`));
}

/** "2026-10" → "10/2026" (exports). */
export function monthShort(month: string): string {
  return `${month.slice(5, 7)}/${month.slice(0, 4)}`;
}

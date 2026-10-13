/**
 * Booking-calendar rules, on yyyy-MM-dd strings so they don't depend on the visitor's timezone. A night is
 * named by its date; a stay [checkIn, checkOut) uses the nights checkIn … checkOut − 1, so a guest can leave
 * on the day the next one arrives.
 */

/** A confirmed stay as /api/listings/:id/availability returns it (checkout exclusive). */
export interface BookedRange {
  checkIn: string;
  checkOut: string;
}

const DAY = 86_400_000;
const toMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

export function addDays(day: string, n: number): string {
  return new Date(toMs(day) + n * DAY).toISOString().slice(0, 10);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((toMs(checkOut) - toMs(checkIn)) / DAY);
}

export function isBookedNight(day: string, booked: BookedRange[]): boolean {
  return booked.some((r) => r.checkIn <= day && day < r.checkOut);
}

/** Whether a stay can start on `checkIn` and end on `checkOut`: long enough, and every night free. */
export function canStay(checkIn: string, checkOut: string, booked: BookedRange[], minNights: number): boolean {
  if (nightsBetween(checkIn, checkOut) < minNights) return false;
  return !booked.some((r) => r.checkIn < checkOut && r.checkOut > checkIn);
}

/**
 * Which days the calendar disables. While a check-in is picked and no checkout yet (`pendingCheckIn`), the
 * days after it are valid checkouts only; earlier days start over. A check-in day needs at least one valid
 * checkout: the minimum stay from it must be free and end by `last`, so no arrival leads to a dead end. Days
 * outside [first, last] are always disabled.
 */
export function isDayDisabled(
  day: string,
  opts: { booked: BookedRange[]; minNights: number; first: string; last: string; pendingCheckIn?: string },
): boolean {
  const { booked, minNights, first, last, pendingCheckIn } = opts;
  if (day < first || day > last) return true;
  if (pendingCheckIn && day > pendingCheckIn) return !canStay(pendingCheckIn, day, booked, minNights);
  const earliestCheckOut = addDays(day, minNights);
  return earliestCheckOut > last || !canStay(day, earliestCheckOut, booked, minNights);
}

/** Applies a click on `day` to the selection: start a new stay, or end the pending one. */
export function pickDay(day: string, selection: { checkIn?: string; checkOut?: string }): { checkIn?: string; checkOut?: string } {
  const { checkIn, checkOut } = selection;
  if (!checkIn || checkOut || day <= checkIn) return { checkIn: day };
  return { checkIn, checkOut: day };
}

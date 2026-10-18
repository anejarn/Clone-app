import { addDays, isoDay } from "../admin/calendar";
import { MARRAKECH_TIMEZONE } from "../neighbourhoods";
import { localDayAndMinutes, localInstant } from "../operations/schedule";
import type { IcalDate, IcalEvent } from "./ical/parse";

/**
 * An iCal event's nights at the home (Lot 7): checkIn = the first night, checkOut = the morning of departure
 * (excluded), as calendar days (UTC midnights, the shape of @db.Date). Computed in Africa/Casablanca with the
 * runtime's time zone rules (Intl / ICU: UTC+1, UTC+0 during Ramadan), never Postgres' (its zone data for Morocco is
 * wrong after September 2026 on Ubuntu 24.04).
 *
 * - DATE values are already nights: DTEND is exclusive (RFC 5545), so DTSTART 20270105 / DTEND 20270108 = 3 nights.
 * - DATE-TIME values (UTC, TZID or floating = local time) are read as instants and turned into the local date at the
 *   home: an arrival at 15:00 and a departure at 11:00 give the same nights as the dates.
 * - No DTEND: DURATION when there is one; otherwise one night for a date, and the start's night for a date-time.
 * - An event ending on the day it starts (a few hours) still takes that night; one ending before it starts is invalid.
 */

export interface Nights {
  checkIn: Date;
  checkOut: Date;
}

/** The instant of a wall-clock time in `timeZone`. */
function wallInstant(w: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string): Date {
  return localInstant(new Date(Date.UTC(w.year, w.month - 1, w.day)), w.hour * 60 + w.minute, timeZone);
}

/** The local calendar day (UTC midnight) of an iCal date or date-time at the home. */
export function localDay(d: IcalDate, timeZone = MARRAKECH_TIMEZONE): Date {
  switch (d.kind) {
    case "date":
      return new Date(`${d.date}T00:00:00Z`);
    case "utc":
      return localDayAndMinutes(new Date(d.instant), timeZone).day;
    case "zoned":
      return localDayAndMinutes(wallInstant(d.wall, d.timeZone), timeZone).day;
    case "floating":
      // « Local time »: the home's own wall clock, so its date is the date written.
      return new Date(Date.UTC(d.wall.year, d.wall.month - 1, d.wall.day));
  }
}

/** The instant of a date-time (a date counts as its local midnight at the home). */
export function instantOf(d: IcalDate, timeZone = MARRAKECH_TIMEZONE): number {
  switch (d.kind) {
    case "date":
      return localInstant(new Date(`${d.date}T00:00:00Z`), 0, timeZone).getTime();
    case "utc":
      return d.instant;
    case "zoned":
      return wallInstant(d.wall, d.timeZone).getTime();
    case "floating":
      return wallInstant(d.wall, timeZone).getTime();
  }
}

export type NightsResult = { ok: true; nights: Nights } | { ok: false; reason: "END_BEFORE_START" };

export function eventNights(ev: Pick<IcalEvent, "start" | "end" | "durationMs" | "durationDays">, timeZone = MARRAKECH_TIMEZONE): NightsResult {
  const checkIn = localDay(ev.start, timeZone);
  let checkOut: Date;
  if (ev.end) {
    checkOut = localDay(ev.end, timeZone);
    // A date-time end before its start is invalid even when the local dates are equal.
    if (ev.end.kind !== "date" && ev.start.kind !== "date" && instantOf(ev.end, timeZone) < instantOf(ev.start, timeZone)) return { ok: false, reason: "END_BEFORE_START" };
  } else if (ev.durationMs !== null) {
    checkOut =
      ev.start.kind === "date" && ev.durationDays !== null && ev.durationMs === ev.durationDays * 86_400_000
        ? addDays(checkIn, ev.durationDays)
        : localDay({ kind: "utc", instant: instantOf(ev.start, timeZone) + ev.durationMs }, timeZone);
  } else {
    checkOut = addDays(checkIn, 1);
  }
  if (checkOut < checkIn) return { ok: false, reason: "END_BEFORE_START" };
  if (checkOut.getTime() === checkIn.getTime()) checkOut = addDays(checkIn, 1);
  return { ok: true, nights: { checkIn, checkOut } };
}

/** "2027-01-05 → 2027-01-08", for logs and tests. */
export function formatNights(n: Nights): string {
  return `${isoDay(n.checkIn)} → ${isoDay(n.checkOut)}`;
}

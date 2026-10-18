import { createHash } from "node:crypto";
import { addDays } from "../admin/calendar";
import type { BookingSource } from "../generated/prisma/enums";

/**
 * The nights Sigma tells a platform are taken (Lot 7), for its export link: every confirmed booking and owner block of
 * the home whatever its source — except that platform's own reservations (it knows them; sending them back would
 * loop) —, the open double-booking conflicts of the other platforms, widened by the home's preparation days on both
 * sides, and the minimum notice (from today). Pure: the caller reads the rows.
 */

export interface BusyBooking {
  id: string;
  source: BookingSource;
  checkIn: Date;
  checkOut: Date;
}

export interface BusyRange {
  /** Stable per booking or conflict, without revealing its id. */
  uid: string;
  start: Date;
  /** Exclusive. */
  end: Date;
  /** For the DTSTAMP: when the booking was recorded (stable output). */
  stamp?: Date;
}

export interface BusyInput {
  /** The platform the export is for: its own bookings and conflicts are left out. */
  platform: BookingSource;
  bookings: readonly (BusyBooking & { createdAt?: Date })[];
  conflicts?: readonly (BusyBooking & { createdAt?: Date })[];
  preparationDays: number;
  minNoticeDays: number;
  /** Today in Marrakech (UTC midnight). Ranges over before today are left out. */
  today: Date;
  /** Salt of the UIDs (the organization), so two organizations never share one. */
  salt: string;
}

export const EXPORT_UID_DOMAIN = "sigma.ical";

export function exportUid(salt: string, kind: string, id: string): string {
  return `${createHash("sha256").update(`${salt}:${kind}:${id}`).digest("hex").slice(0, 32)}@${EXPORT_UID_DOMAIN}`;
}

export function busyRanges(input: BusyInput): BusyRange[] {
  const prep = input.preparationDays;
  const out: BusyRange[] = [];
  const add = (kind: string, b: BusyBooking & { createdAt?: Date }) => {
    if (b.source === input.platform) return;
    const start = addDays(b.checkIn, -prep);
    const end = addDays(b.checkOut, prep);
    if (end <= input.today) return;
    out.push({ uid: exportUid(input.salt, kind, b.id), start, end, stamp: b.createdAt });
  };
  for (const b of input.bookings) add("booking", b);
  for (const c of input.conflicts ?? []) add("conflict", c);
  if (input.minNoticeDays > 0) {
    out.push({ uid: exportUid(input.salt, "notice", "notice"), start: input.today, end: addDays(input.today, input.minNoticeDays) });
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime() || a.uid.localeCompare(b.uid));
}

/** Maximal runs of consecutive busy nights (ranges merged when they touch or overlap). */
export function mergedRuns(ranges: readonly Pick<BusyRange, "start" | "end">[]): { start: Date; end: Date }[] {
  const sorted = [...ranges].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: { start: Date; end: Date }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
    } else out.push({ start: r.start, end: r.end });
  }
  return out;
}

/**
 * Whether an imported event is only Sigma's own export coming back from the platform: its nights are exactly those
 * of one exported range, or of one run of consecutive exported nights (platforms merge adjacent closed dates). Only
 * ambiguous events (« not available », Booking.com's « CLOSED ») are checked: a real reservation with exactly those
 * dates would be a reservation on nights Sigma had closed, which the e-mail reading (lot 7b) catches.
 */
export function isEcho(ev: { checkIn: Date; checkOut: Date }, ranges: readonly Pick<BusyRange, "start" | "end">[]): boolean {
  const same = (r: { start: Date; end: Date }) => r.start.getTime() === ev.checkIn.getTime() && r.end.getTime() === ev.checkOut.getTime();
  return ranges.some(same) || mergedRuns(ranges).some(same);
}

/** Whether [checkIn, checkOut) overlaps a range widened by `days` on both sides (preparation days). */
export function overlapsWithBuffer(a: { checkIn: Date; checkOut: Date }, b: { checkIn: Date; checkOut: Date }, days: number): boolean {
  return a.checkIn < addDays(b.checkOut, days) && addDays(b.checkIn, -days) < a.checkOut;
}

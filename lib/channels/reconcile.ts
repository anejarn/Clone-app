import { addDays } from "../admin/calendar";
import type { BookingSource } from "../generated/prisma/enums";
import { isEcho, type BusyRange } from "./busy";
import type { ChannelEvent } from "./types";

/**
 * What one read of a feed changes (Lot 7), decided without the database: the sync (lib/server/channels/sync.ts)
 * reads the rows, calls planSync, applies the plan in one transaction. Rules:
 * - an event becomes a booking of the platform (externalRef = its ref, channelFeedId = the feed); its new dates
 *   re-date it; an event gone from the file (or STATUS:CANCELLED) cancels it — only bookings this feed created or
 *   adopted, never a DIRECT, OWNER or other platform's booking, and never a stay already started (platforms drop
 *   past events; a stay in progress is never cancelled by a missing line);
 * - a booking typed by hand with the same platform code (Airbnb's HM… code) is adopted by the feed instead of being
 *   duplicated; so is (lot 7b) a booking of the platform without a feed on exactly the event's nights — created from
 *   the platform's booking e-mail, whose code the feed doesn't carry (Booking.com, Agoda, Trip.com): it keeps its
 *   code (externalRef) and the feed's reference is recorded beside it (adopt with keepRef);
 * - an event on nights already taken (another booking or block, any source) is a conflict, never a silent failure:
 *   recorded (ChannelConflict) and nothing in bookings changes; the next read retries it (FREED when the nights are
 *   free again, EVENT_GONE when it left the file — only conflicts found by an import, not those of a booking e-mail);
 *   the same nights dismissed by an associé aren't reopened;
 * - ignored: events over before today, more than two years ahead, Sigma's own export coming back (echo), already
 *   cancelled without a booking;
 * - an empty file that would cancel 2 bookings or more is refused (EMPTY_FEED): a platform glitch must not free dates.
 * Events are applied by arrival date against a working copy of the taken nights, so two events of one file that
 * overlap make one booking and one conflict.
 */

export interface OwnBooking {
  id: string;
  ref: string;
  checkIn: Date;
  checkOut: Date;
  status: "CONFIRMED" | "CANCELLED";
  block: boolean;
}

export interface OtherBooking {
  id: string;
  source: BookingSource;
  ref: string | null;
  checkIn: Date;
  checkOut: Date;
}

export interface KnownConflict {
  id: string;
  ref: string;
  checkIn: Date;
  checkOut: Date;
  /** Found by an import (default) or by a booking e-mail (never closed as gone by the feed). */
  origin?: "ICAL" | "EMAIL";
}

export interface PlanInput {
  today: Date;
  /** The feed's platform (the source of its own bookings). */
  source: BookingSource;
  events: readonly ChannelEvent[];
  /** Bookings of this feed (any status). */
  own: readonly OwnBooking[];
  /** Same platform, same listing, no feed, same ref: typed by hand. */
  adoptable: readonly OwnBooking[];
  /**
   * Same platform, same listing, no feed, confirmed, whatever their ref (lot 7b: created from a booking e-mail): adopted
   * by an event on exactly their nights that matches nothing else.
   */
  adoptableByNights?: readonly OwnBooking[];
  /** Refs of the platform already used in the organization by bookings that are neither own nor adoptable. */
  takenRefs: ReadonlySet<string>;
  /** Confirmed bookings and blocks of the listing that aren't this feed's. */
  others: readonly OtherBooking[];
  /** What Sigma exports to this platform (echo detection). */
  exported: readonly Pick<BusyRange, "start" | "end">[];
  openConflicts: readonly KnownConflict[];
  dismissed: readonly { ref: string; checkIn: Date; checkOut: Date }[];
  /** Furthest arrival imported (default two years). */
  horizonDays?: number;
}

type Ev = Pick<ChannelEvent, "ref" | "checkIn" | "checkOut" | "kind">;

export type Action =
  | { type: "create"; ev: Ev }
  | { type: "update"; bookingId: string; ev: Ev; from: { checkIn: Date; checkOut: Date } }
  | { type: "reactivate"; bookingId: string; ev: Ev }
  | { type: "adopt"; bookingId: string; ev: Ev; from: { checkIn: Date; checkOut: Date }; keepRef?: boolean }
  | { type: "cancel"; bookingId: string }
  | { type: "conflict"; ev: Ev; blocker: OtherBooking; ownBookingId: string | null; existingConflictId: string | null }
  | { type: "resolve"; conflictId: string; resolution: "EVENT_GONE" | "FREED" };

export type IgnoreReason = "PAST" | "TOO_FAR" | "ECHO" | "CANCELLED" | "DISMISSED" | "REF_ELSEWHERE";

export interface Plan {
  actions: Action[];
  unchanged: number;
  ignored: { ref: string; reason: IgnoreReason }[];
  /** Kept although absent from the file: started stays. */
  kept: number;
  /** The file is empty and would cancel several bookings: nothing is applied. */
  suspectEmpty: boolean;
  counts: { created: number; updated: number; cancelled: number; conflicts: number };
}

const overlaps = (a: { checkIn: Date; checkOut: Date }, b: { checkIn: Date; checkOut: Date }) => a.checkIn < b.checkOut && b.checkIn < a.checkOut;
const sameNights = (a: { checkIn: Date; checkOut: Date }, b: { checkIn: Date; checkOut: Date }) =>
  a.checkIn.getTime() === b.checkIn.getTime() && a.checkOut.getTime() === b.checkOut.getTime();

export function planSync(input: PlanInput): Plan {
  const plan: Plan = { actions: [], unchanged: 0, ignored: [], kept: 0, suspectEmpty: false, counts: { created: 0, updated: 0, cancelled: 0, conflicts: 0 } };
  const horizon = addDays(input.today, input.horizonDays ?? 730);
  const ownByRef = new Map(input.own.map((b) => [b.ref, b]));
  const adoptByRef = new Map(input.adoptable.map((b) => [b.ref, b]));
  const conflictByRef = new Map(input.openConflicts.map((c) => [c.ref, c]));

  // 1. Which events count.
  const live: Ev[] = [];
  const present = new Set<string>();
  for (const ev of input.events) {
    if (ev.cancelled) {
      plan.ignored.push({ ref: ev.ref, reason: "CANCELLED" });
      continue;
    }
    // Present in the file: never cancelled for being "absent", whatever happens to it below.
    present.add(ev.ref);
    if (ev.checkOut <= input.today) plan.ignored.push({ ref: ev.ref, reason: "PAST" });
    else if (ev.checkIn > horizon) plan.ignored.push({ ref: ev.ref, reason: "TOO_FAR" });
    else if (ev.ownExport || ((ev.kind === "block" || ev.ambiguous) && !ownByRef.has(ev.ref) && !adoptByRef.has(ev.ref) && isEcho(ev, input.exported))) {
      plan.ignored.push({ ref: ev.ref, reason: "ECHO" });
    } else if (input.takenRefs.has(ev.ref) && !ownByRef.has(ev.ref) && !adoptByRef.has(ev.ref)) plan.ignored.push({ ref: ev.ref, reason: "REF_ELSEWHERE" });
    else live.push(ev);
  }

  // 2. Own bookings no longer in the file: cancelled unless started; their conflicts are over.
  const occupied: OtherBooking[] = [...input.others];
  const cancels: string[] = [];
  for (const b of input.own) {
    if (b.status !== "CONFIRMED") continue;
    if (present.has(b.ref)) {
      occupied.push({ id: b.id, source: input.source, ref: b.ref, checkIn: b.checkIn, checkOut: b.checkOut });
      continue;
    }
    if (b.checkIn < input.today) {
      plan.kept += 1;
      occupied.push({ id: b.id, source: input.source, ref: b.ref, checkIn: b.checkIn, checkOut: b.checkOut });
      continue;
    }
    cancels.push(b.id);
  }
  if (input.events.length === 0 && cancels.length >= 2) {
    plan.suspectEmpty = true;
    return plan;
  }
  for (const id of cancels) plan.actions.push({ type: "cancel", bookingId: id });
  plan.counts.cancelled = cancels.length;
  for (const c of input.openConflicts) {
    if ((c.origin ?? "ICAL") === "ICAL" && !live.some((e) => e.ref === c.ref)) plan.actions.push({ type: "resolve", conflictId: c.id, resolution: "EVENT_GONE" });
  }
  const byNights = (input.adoptableByNights ?? []).filter((b) => b.status === "CONFIRMED" && !ownByRef.has(b.ref) && !adoptByRef.has(b.ref));
  const claimed = new Set<string>();

  // 3. Events, by arrival.
  for (const ev of [...live].sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime() || a.ref.localeCompare(b.ref))) {
    const own = ownByRef.get(ev.ref);
    const adoptRef = own ? undefined : adoptByRef.get(ev.ref);
    const adoptNights = own || adoptRef || ev.kind === "block" ? undefined : byNights.find((b) => !claimed.has(b.id) && sameNights(b, ev));
    const adopt = adoptRef ?? adoptNights;
    const target = own ?? adopt;
    const blocker = occupied.find((o) => o.id !== target?.id && overlaps(o, ev));
    const conflict = conflictByRef.get(ev.ref);
    if (blocker) {
      if (input.dismissed.some((d) => d.ref === ev.ref && sameNights(d, ev))) {
        plan.ignored.push({ ref: ev.ref, reason: "DISMISSED" });
        continue;
      }
      const known = conflict && sameNights(conflict, ev);
      plan.actions.push({ type: "conflict", ev, blocker, ownBookingId: target?.status === "CONFIRMED" ? target.id : null, existingConflictId: conflict?.id ?? null });
      if (!known) plan.counts.conflicts += 1;
      continue;
    }
    if (conflict) plan.actions.push({ type: "resolve", conflictId: conflict.id, resolution: "FREED" });
    const entry: OtherBooking = { id: target?.id ?? `new:${ev.ref}`, source: input.source, ref: ev.ref, checkIn: ev.checkIn, checkOut: ev.checkOut };
    if (!target) {
      plan.actions.push({ type: "create", ev });
      plan.counts.created += 1;
    } else if (adopt) {
      plan.actions.push({ type: "adopt", bookingId: adopt.id, ev, from: { checkIn: adopt.checkIn, checkOut: adopt.checkOut }, ...(adoptNights && { keepRef: true }) });
      if (adoptNights) claimed.add(adoptNights.id);
      plan.counts.updated += 1;
    } else if (target.status === "CANCELLED") {
      plan.actions.push({ type: "reactivate", bookingId: target.id, ev });
      plan.counts.created += 1;
    } else if (!sameNights(target, ev) || target.block !== (ev.kind === "block")) {
      plan.actions.push({ type: "update", bookingId: target.id, ev, from: { checkIn: target.checkIn, checkOut: target.checkOut } });
      plan.counts.updated += 1;
      const i = occupied.findIndex((o) => o.id === target.id);
      if (i >= 0) occupied.splice(i, 1);
    } else plan.unchanged += 1;
    if (!occupied.some((o) => o.id === entry.id)) occupied.push(entry);
  }
  return plan;
}

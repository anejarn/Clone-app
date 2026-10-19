import { localInstant, parseTimeOfDay } from "@/lib/operations/schedule";
import { CONTROL_RE, ID_RE } from "@/lib/server/schemas";
import { isPhone } from "./form";
import { MAX_COUNT } from "./pricing";

/**
 * A guest's request for a service from the welcome guide (Lot 4b). Pure: the form's checks and the timing rule.
 * Errors are codes (lib/i18n/messages: services.errors), so the guide shows them in the guest's language.
 *
 * Timing (Africa/Casablanca, the listing's place): the service's day is between the arrival day and the departure day,
 * both included (an airport transfer on arrival, a hammam on the last morning), and its time at least the service's
 * lead time from now. Days are UTC midnights (the @db.Date shape); the instant is the local wall-clock time of that
 * day (lib/operations/schedule.ts localInstant, DST-safe).
 */

export const REQUEST_LIMITS = { note: 1000, phone: 40, maxOptions: 10 } as const;

export type RequestErrorCode = "service" | "date" | "time" | "quantity" | "persons" | "options" | "note" | "phone" | "outsideStay" | "tooSoon" | "past";

export interface RequestFormInput {
  serviceId: string;
  /** yyyy-MM-dd as a UTC midnight. */
  day: Date;
  minutes: number;
  quantity: number;
  persons: number;
  optionIds: string[];
  note: string;
  phone: string;
}

export type RequestParse = { ok: true; input: RequestFormInput } | { ok: false; errors: Partial<Record<RequestErrorCode, true>> };

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-24" → its UTC midnight; null when not a real calendar day. */
export function parseIsoDay(s: string): Date | null {
  if (!ISO_DAY_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

function count(raw: string | undefined, fallback: number): number | null {
  const t = (raw ?? "").trim();
  if (!t) return fallback;
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_COUNT ? n : null;
}

/** The guide's request form: values by name, `options` repeated (one per ticked option). */
export function parseRequestForm(values: Record<string, string>, optionIds: readonly string[]): RequestParse {
  const errors: Partial<Record<RequestErrorCode, true>> = {};
  const serviceId = (values.serviceId ?? "").trim();
  if (!ID_RE.test(serviceId)) errors.service = true;
  const day = parseIsoDay((values.date ?? "").trim());
  if (!day) errors.date = true;
  const minutes = parseTimeOfDay(values.time);
  if (minutes === null) errors.time = true;
  const quantity = count(values.quantity, 1);
  if (quantity === null) errors.quantity = true;
  const persons = count(values.persons, 1);
  if (persons === null) errors.persons = true;
  const ids = [...new Set(optionIds.map((s) => s.trim()).filter(Boolean))];
  if (ids.length > REQUEST_LIMITS.maxOptions || ids.some((s) => !/^[a-z0-9]{1,16}$/.test(s))) errors.options = true;
  const note = (values.note ?? "").trim();
  if (note.length > REQUEST_LIMITS.note || CONTROL_RE.test(note)) errors.note = true;
  const phone = (values.phone ?? "").trim();
  if (!phone || phone.length > REQUEST_LIMITS.phone || !isPhone(phone)) errors.phone = true;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, input: { serviceId, day: day!, minutes: minutes!, quantity: quantity!, persons: persons!, optionIds: ids, note, phone } };
}

export type TimingCheck = { ok: true; scheduledAt: Date } | { ok: false; reason: "outsideStay" | "tooSoon" | "past" };

/** Whether a service can be asked for on `day` at `minutes` (local), during the stay and with the lead time. */
export function checkRequestTiming(opts: { day: Date; minutes: number; checkIn: Date; checkOut: Date; leadTimeHours: number; now: Date; timeZone: string }): TimingCheck {
  if (opts.day.getTime() < opts.checkIn.getTime() || opts.day.getTime() > opts.checkOut.getTime()) return { ok: false, reason: "outsideStay" };
  const scheduledAt = localInstant(opts.day, opts.minutes, opts.timeZone);
  if (scheduledAt.getTime() <= opts.now.getTime()) return { ok: false, reason: "past" };
  if (scheduledAt.getTime() < opts.now.getTime() + opts.leadTimeHours * 3_600_000) return { ok: false, reason: "tooSoon" };
  return { ok: true, scheduledAt };
}

/** The earliest day a service can still be asked for (date picker's min): the later of arrival and today + lead time's day. */
export function earliestDay(opts: { checkIn: Date; leadTimeHours: number; localToday: Date }): Date {
  const leadDays = Math.floor(opts.leadTimeHours / 24);
  const min = new Date(opts.localToday.getTime() + leadDays * 86_400_000);
  return min.getTime() > opts.checkIn.getTime() ? min : opts.checkIn;
}

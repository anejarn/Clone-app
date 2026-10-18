/**
 * When field tasks happen (Opérations, Lot 3). Pure, no database: used by the generation (lib/operations/sync.ts),
 * the back-office forms and the unit tests (tests/unit/task-schedule.tz.test.ts).
 *
 * Days are calendar days as UTC midnights (the shape of @db.Date columns, like lib/admin/calendar.ts); times of day
 * are minutes after local midnight (900 = 15:00). A task's window is stored as two instants, computed in the home's
 * time zone (Africa/Casablanca: UTC+1, UTC+0 during Ramadan) with the runtime's time zone database (ICU), never the
 * server's local zone. A local time that doesn't exist (the hour skipped when clocks go forward) moves forward by the
 * jump; one that happens twice (clocks going back) is the first of the two.
 */

export type TaskKind = "CLEANING" | "LINEN" | "CHECKIN" | "OTHER";

export interface StayTimes {
  /** Check-in time, minutes after local midnight (default 15:00). */
  checkInMinutes: number;
  /** Check-out time (default 11:00). */
  checkOutMinutes: number;
}

export const DEFAULT_STAY_TIMES: StayTimes = { checkInMinutes: 15 * 60, checkOutMinutes: 11 * 60 };

/** How long a welcome lasts, and the shortest window of a cleaning or of the linen. */
export const CHECKIN_MINUTES = 120;
export const MIN_PREP_MINUTES = 60;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

const offsetFormats = new Map<string, Intl.DateTimeFormat>();
function partsFormat(timeZone: string) {
  let f = offsetFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    offsetFormats.set(timeZone, f);
  }
  return f;
}

/** The wall-clock date and time in `timeZone` at `instant`, as if it were UTC (to subtract from the instant). */
function wallClockAsUtc(instant: number, timeZone: string): number {
  const p = Object.fromEntries(partsFormat(timeZone).formatToParts(instant).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (+1 h in Marrakech most of the year). */
export function zoneOffsetMs(instant: number, timeZone: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  return wallClockAsUtc(whole, timeZone) - whole;
}

/** The instant at which it is `minutes` after midnight of `day` (a UTC midnight) in `timeZone`. */
export function localInstant(day: Date, minutes: number, timeZone: string): Date {
  const wall = day.getTime() + minutes * MINUTE_MS;
  // An offset changes at most once around a given day: the candidates are the wall time read with the offset of the
  // day before and with the offset of the day after. Keep those that read back as the wall time, the earliest first.
  const before = zoneOffsetMs(wall - DAY_MS, timeZone);
  const after = zoneOffsetMs(wall + DAY_MS, timeZone);
  const valid = [wall - before, wall - after].filter((c) => wallClockAsUtc(c, timeZone) === wall);
  if (valid.length) return new Date(Math.min(...valid));
  // Skipped by clocks going forward: read with the offset before the jump, i.e. moved forward by the jump.
  return new Date(wall - before);
}

/** The local calendar day (UTC midnight) and minutes after midnight of an instant in `timeZone`. */
export function localDayAndMinutes(instant: Date, timeZone: string): { day: Date; minutes: number } {
  const wall = wallClockAsUtc(instant.getTime(), timeZone);
  const day = Math.floor(wall / DAY_MS) * DAY_MS;
  return { day: new Date(day), minutes: Math.floor((wall - day) / MINUTE_MS) };
}

/** "15:00" → 900; null for anything that isn't HH:MM between 00:00 and 23:59. */
export function parseTimeOfDay(s: string | null | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s?.trim() ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 900 → "15:00". */
export function formatTimeOfDay(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** A listing's times: its own when set, else its organization's. */
export function stayTimes(org: Partial<StayTimes>, listing: { checkInMinutes?: number | null; checkOutMinutes?: number | null } = {}): StayTimes {
  return {
    checkInMinutes: listing.checkInMinutes ?? org.checkInMinutes ?? DEFAULT_STAY_TIMES.checkInMinutes,
    checkOutMinutes: listing.checkOutMinutes ?? org.checkOutMinutes ?? DEFAULT_STAY_TIMES.checkOutMinutes,
  };
}

/**
 * The window of a generated task on its day, in minutes after local midnight:
 * - CLEANING (departure day) and LINEN (arrival day): from check-out time to check-in time, between two stays (at
 *   least MIN_PREP_MINUTES if the times are set the wrong way round);
 * - CHECKIN (arrival day): from check-in time, CHECKIN_MINUTES long.
 */
export function taskWindow(type: Exclude<TaskKind, "OTHER">, times: StayTimes): { start: number; end: number } {
  if (type === "CHECKIN") return { start: times.checkInMinutes, end: times.checkInMinutes + CHECKIN_MINUTES };
  return { start: times.checkOutMinutes, end: Math.max(times.checkInMinutes, times.checkOutMinutes + MIN_PREP_MINUTES) };
}

export interface TaskSpec {
  type: Exclude<TaskKind, "OTHER">;
  /** The stay's day the task is placed from: arrival for LINEN and CHECKIN, departure for CLEANING. */
  anchorDate: Date;
  scheduledDate: Date;
  startsAt: Date;
  endsAt: Date;
}

/** The tasks of one guest stay: linen and welcome on the arrival day, cleaning on the departure day. */
export function stayTaskSpecs(stay: { checkIn: Date; checkOut: Date }, times: StayTimes, timeZone: string): TaskSpec[] {
  const at = (type: TaskSpec["type"], day: Date): TaskSpec => {
    const w = taskWindow(type, times);
    return { type, anchorDate: day, scheduledDate: day, startsAt: localInstant(day, w.start, timeZone), endsAt: localInstant(day, w.end, timeZone) };
  };
  return [at("LINEN", stay.checkIn), at("CHECKIN", stay.checkIn), at("CLEANING", stay.checkOut)];
}

/** A cleaning is a turnover when another stay (or an owner block) arrives the day the guest leaves. */
export function isTurnover(departure: Date, arrivals: readonly Date[]): boolean {
  return arrivals.some((a) => a.getTime() === departure.getTime());
}

/** A window typed in the back-office (day + "HH:MM" start and end) as instants; null when it doesn't end after it starts. */
export function typedWindow(day: Date, start: number, end: number, timeZone: string): { startsAt: Date; endsAt: Date } | null {
  if (end <= start) return null;
  return { startsAt: localInstant(day, start, timeZone), endsAt: localInstant(day, end, timeZone) };
}

/**
 * Date arithmetic of the back-office calendar (Calendrier). Every date is a calendar day as a UTC midnight, the
 * shape of @db.Date columns and of todayInTimeZone(): "today" is taken in Africa/Casablanca by the caller, and
 * nothing here reads the machine's time zone, so the grid is the same on a server in any zone.
 *
 * A stay occupies the nights from checkIn (included) to checkOut (excluded); the grid has one column per night.
 */

const DAY = 86_400_000;

export const CALENDAR_SPANS = [14, 30, 60] as const;
export type CalendarSpan = (typeof CALENDAR_SPANS)[number];
export const DEFAULT_SPAN: CalendarSpan = 30;

/** "2026-10-18" → UTC midnight, or null for anything that isn't a real calendar date. */
export function parseDay(s: string | undefined | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY);
}

/** Same day of the month `n` months later, clamped to the month's last day (31 jan. + 1 month = 28/29 feb.). */
export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

/** Whole days from a to b (both UTC midnights). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY);
}

export interface CalendarWindow {
  /** First night shown. */
  start: Date;
  /** Day after the last night shown (exclusive), as checkOut. */
  end: Date;
  span: CalendarSpan;
  days: Date[];
}

/** Bounds of the window that can be asked for: two years either side of today. */
const MAX_OFFSET_DAYS = 730;

/**
 * The window from the URL: `du` (yyyy-MM-dd, default today) and `jours` (14, 30 or 60, default 30). Junk falls back
 * to the defaults; a start more than two years from today is brought back to today.
 */
export function calendarWindow(today: Date, du?: string, jours?: string): CalendarWindow {
  const asked = parseDay(du);
  const start = asked && Math.abs(daysBetween(today, asked)) <= MAX_OFFSET_DAYS ? asked : today;
  const n = Number(jours);
  const span = (CALENDAR_SPANS as readonly number[]).includes(n) ? (n as CalendarSpan) : DEFAULT_SPAN;
  const days = Array.from({ length: span }, (_, i) => addDays(start, i));
  return { start, end: addDays(start, span), span, days };
}

/** Where the navigation buttons go: a week or a month before/after, and today. */
export function calendarNav(win: CalendarWindow, today: Date) {
  return {
    prevMonth: addMonths(win.start, -1),
    prevWeek: addDays(win.start, -7),
    today,
    nextWeek: addDays(win.start, 7),
    nextMonth: addMonths(win.start, 1),
  };
}

export interface BarLayout {
  /** Column of the first night shown (0-based). */
  col: number;
  /** Number of nights shown. */
  span: number;
  /** The stay began before the window (bar cut on the left). */
  clippedStart: boolean;
  /** The stay goes on after the window (bar cut on the right). */
  clippedEnd: boolean;
}

/** Where a stay [checkIn, checkOut) sits in the window, or null when it has no night in it. */
export function barLayout(win: Pick<CalendarWindow, "start" | "end">, checkIn: Date, checkOut: Date): BarLayout | null {
  if (checkOut <= win.start || checkIn >= win.end || checkOut <= checkIn) return null;
  const from = checkIn < win.start ? win.start : checkIn;
  const to = checkOut > win.end ? win.end : checkOut;
  return { col: daysBetween(win.start, from), span: daysBetween(from, to), clippedStart: checkIn < win.start, clippedEnd: checkOut > win.end };
}

const weekdayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

/** "lun." … "dim." (day header). */
export function weekdayShort(d: Date): string {
  return weekdayFmt.format(d);
}

/** "octobre 2026" (month header). */
export function monthLabel(d: Date): string {
  return monthFmt.format(d);
}

/** Saturday or Sunday (shaded columns). */
export function isWeekend(d: Date): boolean {
  const w = d.getUTCDay();
  return w === 0 || w === 6;
}

/** Month groups of the header: label and how many columns they cover. */
export function monthGroups(days: Date[]): { label: string; span: number }[] {
  const out: { label: string; span: number; key: string }[] = [];
  for (const d of days) {
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const last = out[out.length - 1];
    if (last?.key === key) last.span += 1;
    else out.push({ key, label: monthLabel(d), span: 1 });
  }
  return out.map(({ label, span }) => ({ label, span }));
}

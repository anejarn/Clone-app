import { describe, expect, it } from "vitest";
import { addDays, addMonths, barLayout, calendarNav, calendarWindow, isoDay, isWeekend, monthGroups, parseDay, weekdayShort } from "@/lib/admin/calendar";
import { todayInTimeZone } from "@/lib/dates";

/** Calendar grid date math. Runs in UTC, UTC+14 and UTC−8 (vitest projects): the results must not move. */

const d = (s: string) => parseDay(s)!;

describe("calendarWindow", () => {
  const today = d("2026-10-18");

  it("defaults to 30 nights from today", () => {
    const w = calendarWindow(today);
    expect(isoDay(w.start)).toBe("2026-10-18");
    expect(isoDay(w.end)).toBe("2026-11-17");
    expect(w.days).toHaveLength(30);
    expect(isoDay(w.days[29])).toBe("2026-11-16");
  });

  it("takes a start date and 14, 30 or 60 days; anything else falls back", () => {
    expect(calendarWindow(today, "2027-03-01", "14")).toMatchObject({ span: 14 });
    expect(isoDay(calendarWindow(today, "2027-03-01", "60").end)).toBe("2027-04-30");
    expect(calendarWindow(today, "2027-03-01", "45").span).toBe(30);
    expect(isoDay(calendarWindow(today, "2027-02-30").start)).toBe("2026-10-18");
    expect(isoDay(calendarWindow(today, "n'importe quoi").start)).toBe("2026-10-18");
    // More than two years away: back to today.
    expect(isoDay(calendarWindow(today, "2030-01-01").start)).toBe("2026-10-18");
  });

  it("crosses the change to and from summer time without losing or doubling a day", () => {
    // Europe's DST change (25 Oct 2026) and Morocco's Ramadan switch don't touch UTC-midnight arithmetic.
    const w = calendarWindow(today, "2026-10-20", "14");
    expect(w.days.map(isoDay)).toEqual([
      "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26",
      "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02",
    ]);
  });
});

describe("navigation", () => {
  it("moves by a week and by a calendar month, clamped to the month's last day", () => {
    const w = calendarWindow(d("2026-10-18"), "2027-01-31");
    const nav = calendarNav(w, d("2026-10-18"));
    expect(isoDay(nav.prevWeek)).toBe("2027-01-24");
    expect(isoDay(nav.nextWeek)).toBe("2027-02-07");
    expect(isoDay(nav.nextMonth)).toBe("2027-02-28");
    expect(isoDay(nav.prevMonth)).toBe("2026-12-31");
    expect(isoDay(nav.today)).toBe("2026-10-18");
    expect(isoDay(addMonths(d("2028-01-31"), 1))).toBe("2028-02-29");
    expect(isoDay(addMonths(d("2026-03-15"), -12))).toBe("2025-03-15");
  });
});

describe("barLayout: a stay's nights in the window", () => {
  const win = { start: d("2026-11-01"), end: d("2026-12-01") };

  it("places a stay inside the window on its nights (checkout night excluded)", () => {
    expect(barLayout(win, d("2026-11-05"), d("2026-11-08"))).toEqual({ col: 4, span: 3, clippedStart: false, clippedEnd: false });
    expect(barLayout(win, d("2026-11-01"), d("2026-11-02"))).toEqual({ col: 0, span: 1, clippedStart: false, clippedEnd: false });
    expect(barLayout(win, d("2026-11-30"), d("2026-12-01"))).toEqual({ col: 29, span: 1, clippedStart: false, clippedEnd: false });
  });

  it("cuts stays that start before or end after the window", () => {
    expect(barLayout(win, d("2026-10-28"), d("2026-11-03"))).toEqual({ col: 0, span: 2, clippedStart: true, clippedEnd: false });
    expect(barLayout(win, d("2026-11-28"), d("2026-12-05"))).toEqual({ col: 27, span: 3, clippedStart: false, clippedEnd: true });
    expect(barLayout(win, d("2026-10-01"), d("2027-01-01"))).toEqual({ col: 0, span: 30, clippedStart: true, clippedEnd: true });
  });

  it("leaves out stays with no night in the window", () => {
    // Leaving on the first day: the last night is the day before.
    expect(barLayout(win, d("2026-10-25"), d("2026-11-01"))).toBeNull();
    // Arriving on the day after the last night.
    expect(barLayout(win, d("2026-12-01"), d("2026-12-03"))).toBeNull();
    expect(barLayout(win, d("2026-11-10"), d("2026-11-10"))).toBeNull();
  });

  it("two back-to-back stays share no column", () => {
    const a = barLayout(win, d("2026-11-05"), d("2026-11-08"))!;
    const b = barLayout(win, d("2026-11-08"), d("2026-11-10"))!;
    expect(a.col + a.span).toBe(b.col);
  });
});

describe("labels", () => {
  it("names days and months in French, from the calendar date, not the machine's zone", () => {
    expect(weekdayShort(d("2026-10-18"))).toBe("dim.");
    expect(isWeekend(d("2026-10-17"))).toBe(true);
    expect(isWeekend(d("2026-10-19"))).toBe(false);
    expect(monthGroups(calendarWindow(d("2026-10-18")).days)).toEqual([
      { label: "octobre 2026", span: 14 },
      { label: "novembre 2026", span: 16 },
    ]);
  });

  it("today in Marrakech starts the default window: 23:30 UTC on 14 June 2027 is already the 15th", () => {
    const today = todayInTimeZone("Africa/Casablanca", Date.UTC(2027, 5, 14, 23, 30));
    expect(isoDay(calendarWindow(today).start)).toBe("2027-06-15");
    expect(isoDay(addDays(today, 1))).toBe("2027-06-16");
  });
});

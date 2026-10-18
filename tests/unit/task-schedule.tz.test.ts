import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAY_TIMES,
  formatTimeOfDay,
  isTurnover,
  localDayAndMinutes,
  localInstant,
  parseTimeOfDay,
  stayTaskSpecs,
  stayTimes,
  taskWindow,
  typedWindow,
  zoneOffsetMs,
} from "@/lib/operations/schedule";

/**
 * Task times in Africa/Casablanca, whatever the machine's zone (this file also runs under UTC+14 and UTC−8):
 * Morocco is UTC+1, and UTC+0 during Ramadan. In 2027 the clocks go back on Sunday 07/02 at 03:00 (→ 02:00) and
 * forward again on Sunday 14/03 at 02:00 (→ 03:00), per the runtime's time zone database (ICU).
 */
const TZ = "Africa/Casablanca";
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString();
const H = 3_600_000;

describe("localInstant (Africa/Casablanca)", () => {
  it("is UTC+1 outside Ramadan", () => {
    expect(zoneOffsetMs(Date.parse("2026-10-18T10:00:00Z"), TZ)).toBe(H);
    expect(iso(localInstant(day("2026-10-18"), 11 * 60, TZ))).toBe("2026-10-18T10:00:00.000Z");
    expect(iso(localInstant(day("2027-01-20"), 15 * 60, TZ))).toBe("2027-01-20T14:00:00.000Z");
  });

  it("is UTC+0 during Ramadan (2027)", () => {
    expect(zoneOffsetMs(Date.parse("2027-02-20T10:00:00Z"), TZ)).toBe(0);
    expect(iso(localInstant(day("2027-02-20"), 11 * 60, TZ))).toBe("2027-02-20T11:00:00.000Z");
    expect(iso(localInstant(day("2027-03-13"), 15 * 60, TZ))).toBe("2027-03-13T15:00:00.000Z");
  });

  it("follows the change of offset on the day itself", () => {
    // 07/02/2027: back to UTC+0 at 03:00 local; check-out 11:00 and check-in 15:00 are after the change.
    expect(iso(localInstant(day("2027-02-07"), 11 * 60, TZ))).toBe("2027-02-07T11:00:00.000Z");
    expect(iso(localInstant(day("2027-02-06"), 11 * 60, TZ))).toBe("2027-02-06T10:00:00.000Z");
    // 14/03/2027: UTC+1 again from 02:00 local (→ 03:00).
    expect(iso(localInstant(day("2027-03-14"), 11 * 60, TZ))).toBe("2027-03-14T10:00:00.000Z");
    expect(iso(localInstant(day("2027-03-14"), 60, TZ))).toBe("2027-03-14T01:00:00.000Z");
  });

  it("takes the first of a repeated time and moves a skipped one forward", () => {
    // 02:30 happens twice on 07/02/2027 (01:30 UTC at +1, then 02:30 UTC at +0): the first one.
    expect(iso(localInstant(day("2027-02-07"), 2 * 60 + 30, TZ))).toBe("2027-02-07T01:30:00.000Z");
    // 02:30 doesn't exist on 14/03/2027 (02:00 → 03:00): 03:30 local, 02:30 UTC.
    const skipped = localInstant(day("2027-03-14"), 2 * 60 + 30, TZ);
    expect(iso(skipped)).toBe("2027-03-14T02:30:00.000Z");
    expect(localDayAndMinutes(skipped, TZ).minutes).toBe(3 * 60 + 30);
  });

  it("reads back as the same local day and time", () => {
    for (const d of ["2026-10-18", "2027-02-07", "2027-02-20", "2027-03-14", "2027-12-31"]) {
      for (const m of [0, 11 * 60, 15 * 60, 23 * 60 + 59]) {
        const back = localDayAndMinutes(localInstant(day(d), m, TZ), TZ);
        expect([iso(back.day).slice(0, 10), back.minutes], `${d} ${m}`).toEqual([d, m]);
      }
    }
  });

  it("works for other zones too (Paris summer time)", () => {
    expect(iso(localInstant(day("2027-07-01"), 15 * 60, "Europe/Paris"))).toBe("2027-07-01T13:00:00.000Z");
  });
});

describe("generated tasks of a stay", () => {
  it("defaults to check-in 15:00 and check-out 11:00; a home's own times win", () => {
    expect(DEFAULT_STAY_TIMES).toEqual({ checkInMinutes: 900, checkOutMinutes: 660 });
    expect(stayTimes({}, {})).toEqual(DEFAULT_STAY_TIMES);
    expect(stayTimes({ checkInMinutes: 960, checkOutMinutes: 600 }, { checkInMinutes: null })).toEqual({ checkInMinutes: 960, checkOutMinutes: 600 });
    expect(stayTimes({ checkInMinutes: 960, checkOutMinutes: 600 }, { checkInMinutes: 840, checkOutMinutes: 720 })).toEqual({ checkInMinutes: 840, checkOutMinutes: 720 });
  });

  it("windows: cleaning and linen between check-out and check-in, welcome from check-in for two hours", () => {
    expect(taskWindow("CLEANING", DEFAULT_STAY_TIMES)).toEqual({ start: 660, end: 900 });
    expect(taskWindow("LINEN", DEFAULT_STAY_TIMES)).toEqual({ start: 660, end: 900 });
    expect(taskWindow("CHECKIN", DEFAULT_STAY_TIMES)).toEqual({ start: 900, end: 1020 });
    // Times the wrong way round still give a window of an hour.
    expect(taskWindow("CLEANING", { checkInMinutes: 600, checkOutMinutes: 720 })).toEqual({ start: 720, end: 780 });
  });

  it("linen and welcome on the arrival day, cleaning on the departure day, across Ramadan", () => {
    const specs = stayTaskSpecs({ checkIn: day("2027-02-05"), checkOut: day("2027-02-09") }, DEFAULT_STAY_TIMES, TZ);
    expect(specs.map((s) => [s.type, iso(s.anchorDate).slice(0, 10), iso(s.startsAt), iso(s.endsAt)])).toEqual([
      ["LINEN", "2027-02-05", "2027-02-05T10:00:00.000Z", "2027-02-05T14:00:00.000Z"],
      ["CHECKIN", "2027-02-05", "2027-02-05T14:00:00.000Z", "2027-02-05T16:00:00.000Z"],
      // UTC+0 from 07/02: the same 11:00–15:00 local is an hour later in UTC.
      ["CLEANING", "2027-02-09", "2027-02-09T11:00:00.000Z", "2027-02-09T15:00:00.000Z"],
    ]);
    expect(specs.every((s) => s.scheduledDate.getTime() === s.anchorDate.getTime())).toBe(true);
  });

  it("turnover: another arrival the day the guest leaves", () => {
    expect(isTurnover(day("2027-05-10"), [day("2027-05-10")])).toBe(true);
    expect(isTurnover(day("2027-05-10"), [day("2027-05-11"), day("2027-05-09")])).toBe(false);
    expect(isTurnover(day("2027-05-10"), [])).toBe(false);
  });
});

describe("typed times", () => {
  it("parses and formats HH:MM", () => {
    expect([parseTimeOfDay("15:00"), parseTimeOfDay("09:05"), parseTimeOfDay("00:00"), parseTimeOfDay("23:59")]).toEqual([900, 545, 0, 1439]);
    for (const bad of ["24:00", "9:00", "12:60", "", "15h", null, undefined]) expect(parseTimeOfDay(bad as string), String(bad)).toBeNull();
    expect([formatTimeOfDay(900), formatTimeOfDay(545), formatTimeOfDay(1440 + 60)]).toEqual(["15:00", "09:05", "01:00"]);
  });

  it("a typed window ends after it starts", () => {
    expect(typedWindow(day("2027-02-20"), 600, 660, TZ)).toEqual({ startsAt: new Date("2027-02-20T10:00:00Z"), endsAt: new Date("2027-02-20T11:00:00Z") });
    expect(typedWindow(day("2027-02-20"), 660, 660, TZ)).toBeNull();
    expect(typedWindow(day("2027-02-20"), 700, 660, TZ)).toBeNull();
  });
});

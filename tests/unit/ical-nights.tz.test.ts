import { describe, expect, it } from "vitest";
import { isoDay } from "@/lib/admin/calendar";
import { parseIcalDate, type IcalDate } from "@/lib/channels/ical/parse";
import { eventNights } from "@/lib/channels/nights";

/**
 * iCal times → nights at the home, in Africa/Casablanca (lib/channels/nights.ts), the same whatever the machine's zone
 * (this file also runs under UTC+14 and UTC−8). Morocco is UTC+1 except during Ramadan (UTC+0: 2027 ≈ 7 Feb → 14 Mar).
 */

const d = (v: string, params: Record<string, string> = {}) => parseIcalDate(v, params)!;
const n = (start: IcalDate, end: IcalDate | null, durationMs: number | null = null, durationDays: number | null = null) => {
  const r = eventNights({ start, end, durationMs, durationDays });
  return r.ok ? `${isoDay(r.nights.checkIn)}→${isoDay(r.nights.checkOut)}` : r.reason;
};

describe("event nights in Marrakech", () => {
  it("all-day dates: DTEND exclusive", () => {
    expect(n(d("20270105"), d("20270108"))).toBe("2027-01-05→2027-01-08");
  });

  it("missing DTEND: one night for a date, the start's night for a date-time", () => {
    expect(n(d("20270105"), null)).toBe("2027-01-05→2027-01-06");
    expect(n(d("20270105T150000Z"), null)).toBe("2027-01-05→2027-01-06");
  });

  it("DURATION: calendar days for a date, an instant for a date-time", () => {
    expect(n(d("20270105"), null, 3 * 86_400_000, 3)).toBe("2027-01-05→2027-01-08");
    expect(n(d("20270105T150000Z"), null, 68 * 3_600_000, 2)).toBe("2027-01-05→2027-01-08");
  });

  it("UTC date-times around midnight, outside Ramadan (UTC+1) and during it (UTC+0)", () => {
    // 23:30 UTC = 00:30 the next day in Marrakech in January…
    expect(n(d("20270110T233000Z"), d("20270112T100000Z"))).toBe("2027-01-11→2027-01-12");
    // …but 23:30 the same day during Ramadan 2027.
    expect(n(d("20270220T233000Z"), d("20270222T100000Z"))).toBe("2027-02-20→2027-02-22");
    // A departure at 23:30 UTC on the last Ramadan days stays that day; after the switch back it's the next day.
    expect(n(d("20270301T150000Z"), d("20270303T233000Z"))).toBe("2027-03-01→2027-03-03");
    expect(n(d("20270401T150000Z"), d("20270403T233000Z"))).toBe("2027-04-01→2027-04-04");
  });

  it("TZID feeds: the instant in their zone, then the date in Marrakech", () => {
    // 02:00 in Paris (UTC+1 in January) = 01:00 UTC = 02:00 in Marrakech: same date.
    expect(n(d("20270110T020000", { TZID: "Europe/Paris" }), d("20270112T110000", { TZID: "Europe/Paris" }))).toBe("2027-01-10→2027-01-12");
    // 00:30 in Paris in summer (UTC+2) = 22:30 UTC = 23:30 in Marrakech (UTC+1): the day before.
    expect(n(d("20270710T003000", { TZID: "Europe/Paris" }), d("20270712T110000", { TZID: "Europe/Paris" }))).toBe("2027-07-09→2027-07-12");
    // 06:00 in Shanghai (UTC+8) = 22:00 UTC the day before; during Ramadan that's 22:00 in Marrakech.
    expect(n(d("20270215T060000", { TZID: "Asia/Shanghai" }), d("20270217T060000", { TZID: "Asia/Shanghai" }))).toBe("2027-02-14→2027-02-16");
    // A TZID that already is Marrakech.
    expect(n(d("20270220T003000", { TZID: "Africa/Casablanca" }), d("20270222T110000", { TZID: "Africa/Casablanca" }))).toBe("2027-02-20→2027-02-22");
  });

  it("floating times are the home's wall clock", () => {
    expect(n(d("20270220T233000"), d("20270222T110000"))).toBe("2027-02-20→2027-02-22");
    expect(n(d("20270720T003000"), d("20270722T110000"))).toBe("2027-07-20→2027-07-22");
  });

  it("an event of a few hours takes its night; one ending before it starts is refused", () => {
    expect(n(d("20270110T100000Z"), d("20270110T180000Z"))).toBe("2027-01-10→2027-01-11");
    expect(n(d("20270105"), d("20270105"))).toBe("2027-01-05→2027-01-06");
    expect(n(d("20270110T180000Z"), d("20270110T100000Z"))).toBe("END_BEFORE_START");
    expect(n(d("20270110"), d("20270108"))).toBe("END_BEFORE_START");
  });
});

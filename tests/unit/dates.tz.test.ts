import { describe, expect, it } from "vitest";
import { todayInTimeZone } from "@/lib/dates";

describe(`todayInTimeZone (process TZ=${process.env.TZ ?? "system"})`, () => {
  it("gives the local calendar date of the zone, independent of the process timezone", () => {
    // Marrakech is UTC+1 outside Ramadan: 23:30 UTC on 14 June is already the 15th there.
    expect(todayInTimeZone("Africa/Casablanca", Date.parse("2027-06-14T23:30:00Z")).toISOString()).toBe("2027-06-15T00:00:00.000Z");
    // Around Ramadan (7 February to 14 March 2027 in the tz database) Morocco is on UTC+0: still the 20th at 23:30 UTC.
    expect(todayInTimeZone("Africa/Casablanca", Date.parse("2027-02-20T23:30:00Z")).toISOString()).toBe("2027-02-20T00:00:00.000Z");
    expect(todayInTimeZone("America/New_York", Date.parse("2027-03-06T03:00:00Z")).toISOString()).toBe("2027-03-05T00:00:00.000Z");
    expect(todayInTimeZone("Pacific/Kiritimati", Date.parse("2027-12-31T11:00:00Z")).toISOString()).toBe("2028-01-01T00:00:00.000Z");
  });
});

import { describe, expect, it } from "vitest";
import { todayInTimeZone } from "@/lib/dates";

describe(`todayInTimeZone (process TZ=${process.env.TZ ?? "system"})`, () => {
  const at = Date.parse("2027-03-06T03:00:00Z");
  it("gives the local calendar date of the zone, independent of the process timezone", () => {
    expect(todayInTimeZone("America/New_York", at).toISOString()).toBe("2027-03-05T00:00:00.000Z");
    expect(todayInTimeZone("Europe/Paris", at).toISOString()).toBe("2027-03-06T00:00:00.000Z");
    expect(todayInTimeZone("Pacific/Kiritimati", Date.parse("2027-12-31T11:00:00Z")).toISOString()).toBe("2028-01-01T00:00:00.000Z");
  });
});

import { format, parseISO } from "date-fns";
import { describe, expect, it } from "vitest";
import { addDays, canStay, isBookedNight, isDayDisabled, nightsBetween, pickDay } from "@/lib/stay-calendar";

// One stay from the 10th to the 14th (nights 10–13 taken).
const booked = [{ checkIn: "2027-02-10", checkOut: "2027-02-14" }];
const rules = { booked, minNights: 2, first: "2027-02-01", last: "2027-03-31" };

describe(`stay calendar (TZ=${process.env.TZ ?? "system"})`, () => {
  it("does day arithmetic on calendar dates", () => {
    expect(addDays("2027-02-27", 2)).toBe("2027-03-01");
    expect(addDays("2027-03-27", 2)).toBe("2027-03-29"); // across the DST change
    expect(nightsBetween("2027-03-27", "2027-03-29")).toBe(2);
  });

  it("treats checkout as exclusive: the departure day is free for the next guest", () => {
    expect(isBookedNight("2027-02-09", booked)).toBe(false);
    expect(isBookedNight("2027-02-10", booked)).toBe(true);
    expect(isBookedNight("2027-02-13", booked)).toBe(true);
    expect(isBookedNight("2027-02-14", booked)).toBe(false);
    expect(canStay("2027-02-08", "2027-02-10", booked, 2)).toBe(true);
    expect(canStay("2027-02-14", "2027-02-16", booked, 2)).toBe(true);
    expect(canStay("2027-02-08", "2027-02-11", booked, 2)).toBe(false);
    expect(canStay("2027-02-05", "2027-02-20", booked, 2)).toBe(false); // spans the stay
  });

  it("enforces the minimum stay", () => {
    expect(canStay("2027-02-01", "2027-02-02", [], 2)).toBe(false);
    expect(canStay("2027-02-01", "2027-02-03", [], 2)).toBe(true);
    expect(canStay("2027-02-01", "2027-02-03", [], 3)).toBe(false);
  });

  it("disables booked nights as check-ins, and invalid checkouts while one is pending", () => {
    expect(isDayDisabled("2027-02-11", rules)).toBe(true);
    expect(isDayDisabled("2027-02-14", rules)).toBe(false);
    expect(isDayDisabled("2027-01-31", rules)).toBe(true); // before the first bookable day
    expect(isDayDisabled("2027-04-01", rules)).toBe(true); // beyond the booking window
    const pending = { ...rules, pendingCheckIn: "2027-02-06" };
    expect(isDayDisabled("2027-02-07", pending)).toBe(true); // 1 night < minimum
    expect(isDayDisabled("2027-02-08", pending)).toBe(false);
    expect(isDayDisabled("2027-02-10", pending)).toBe(false); // leave as the next guest arrives
    expect(isDayDisabled("2027-02-11", pending)).toBe(true); // would cross a booked night
    expect(isDayDisabled("2027-02-03", pending)).toBe(false); // an earlier, free day starts over
  });

  it("disables check-ins with no valid checkout (fewer free nights than the minimum stay)", () => {
    const three = { ...rules, minNights: 3 };
    expect(isDayDisabled("2027-02-07", three)).toBe(false); // 7, 8, 9: three free nights before the stay
    expect(isDayDisabled("2027-02-08", three)).toBe(true); // only the 8th and 9th are free
    expect(isDayDisabled("2027-02-09", three)).toBe(true);
    expect(isDayDisabled("2027-02-09", rules)).toBe(true); // one free night, two required
    expect(isDayDisabled("2027-03-29", rules)).toBe(false); // checkout on the last day
    expect(isDayDisabled("2027-03-30", rules)).toBe(true); // checkout would fall outside the window
    // Starting over before a pending check-in follows the same rule.
    expect(isDayDisabled("2027-02-08", { ...three, pendingCheckIn: "2027-02-20" })).toBe(true);
  });

  it("starts a stay, ends it, and starts over", () => {
    expect(pickDay("2027-02-05", {})).toEqual({ checkIn: "2027-02-05" });
    expect(pickDay("2027-02-08", { checkIn: "2027-02-05" })).toEqual({ checkIn: "2027-02-05", checkOut: "2027-02-08" });
    expect(pickDay("2027-02-03", { checkIn: "2027-02-05" })).toEqual({ checkIn: "2027-02-03" });
    expect(pickDay("2027-02-20", { checkIn: "2027-02-05", checkOut: "2027-02-08" })).toEqual({ checkIn: "2027-02-20" });
  });

  it("round-trips calendar days (local midnights) to the same yyyy-MM-dd", () => {
    for (const day of ["2027-02-10", "2027-03-28", "2027-10-31"]) expect(format(parseISO(day), "yyyy-MM-dd")).toBe(day);
  });
});

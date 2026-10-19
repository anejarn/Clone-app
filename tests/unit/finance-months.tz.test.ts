import { describe, expect, it } from "vitest";
import { addMonths, localMonth, monthLabel, monthRange, monthWindow, monthOfDay } from "@/lib/finance/months";
import { monthWeights } from "@/lib/finance/split";

/** Runs in the unit project and again under far-off TZ settings (vitest.config.mts): nothing may depend on the machine's zone. */
describe("accounting months", () => {
  it("adds months across years", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-10", 15)).toBe("2028-01");
    expect(monthRange("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthRange("2027-02", "2026-11")).toEqual([]);
    expect(monthWindow("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
    expect(monthOfDay("2026-10-31")).toBe("2026-10");
    expect(monthLabel("2026-10")).toBe("octobre 2026");
  });

  it("an instant's month is Marrakech's (Africa/Casablanca), not UTC's nor the machine's", () => {
    // Morocco is UTC+1 outside Ramadan: 23:30 UTC on 31/10 is already November there.
    expect(localMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
    expect(localMonth(new Date("2026-10-31T22:59:00Z"))).toBe("2026-10");
    expect(localMonth(new Date("2026-12-31T23:00:00Z"))).toBe("2027-01");
    expect(localMonth(new Date("2026-12-31T22:59:59Z"))).toBe("2026-12");
    // During Ramadan 2027 (UTC+0, about 07/02–14/03/2027): midnight UTC is midnight in Marrakech.
    expect(localMonth(new Date("2027-02-28T23:30:00Z"))).toBe("2027-02");
    expect(localMonth(new Date("2027-03-01T00:00:00Z"))).toBe("2027-03");
  });

  it("nights are local dates: the allocation never shifts with the machine's zone", () => {
    expect(monthWeights("2026-10-31", "2026-11-02", "NIGHTS")).toEqual([
      { month: "2026-10", nights: 1 },
      { month: "2026-11", nights: 1 },
    ]);
    expect(monthWeights("2027-02-27", "2027-03-02", "NIGHTS")).toEqual([
      { month: "2027-02", nights: 2 },
      { month: "2027-03", nights: 1 },
    ]);
  });
});

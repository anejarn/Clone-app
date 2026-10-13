import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteStay } from "@/lib/server/bookings";
import { findHome } from "./helpers";

/** "Today" for a stay is the listing's local date (Place.timezone, Europe/Paris for both resorts), not UTC's. */
describe("check-in day follows the listing's timezone", () => {
  afterEach(() => vi.useRealTimers());

  it("late on 5 March in UTC is already 6 March in the Alps: a stay can no longer start on the 5th", async () => {
    // Only Date is faked: the database driver keeps its real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    const stay = { checkIn: "2027-03-05", checkOut: "2027-03-07", adults: 1, children: 0, infants: 0, pets: 0 };
    const home = await findHome({ place: "orcieres-merlette", guests: 1 });

    vi.setSystemTime(new Date("2027-03-05T22:30:00Z")); // 23:30 on the 5th in Paris (UTC+1)
    await expect(quoteStay(home.id, stay)).resolves.toMatchObject({ nights: 2 });
    vi.setSystemTime(new Date("2027-03-05T23:30:00Z")); // still the 5th in UTC, 00:30 on the 6th in Paris
    await expect(quoteStay(home.id, stay)).rejects.toMatchObject({ code: "INVALID_DATES" });
  });
});

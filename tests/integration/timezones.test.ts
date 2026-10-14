import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteStay } from "@/lib/server/bookings";
import { findHome } from "./helpers";

/** "Today" for a stay is the listing's local date, not UTC's. */
describe("check-in day follows the listing's timezone", () => {
  afterEach(() => vi.useRealTimers());

  it("at 03:00 UTC on 6 March, a New York stay may still start on 5 March; a Paris one may not", async () => {
    // Only Date is faked: the database driver keeps its real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-06T03:00:00Z")); // 22:00 on the 5th in New York, 04:00 on the 6th in Paris
    const stay = { checkIn: "2027-03-05", checkOut: "2027-03-07", adults: 1, children: 0, infants: 0, pets: 0 };
    const ny = await findHome({ place: "new-york", guests: 1 });
    const paris = await findHome({ place: "paris", guests: 1 });

    await expect(quoteStay(ny.id, stay)).resolves.toMatchObject({ nights: 2 });
    await expect(quoteStay(paris.id, stay)).rejects.toMatchObject({ code: "INVALID_DATES" });
  });
});

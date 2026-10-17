import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelBooking, createBooking, quoteStay } from "@/lib/server/bookings";
import { findHome, makeUser, sigmaOrgId } from "./helpers";

const org = await sigmaOrgId();

/**
 * "Today" for a stay is Marrakech's date (Africa/Casablanca), not UTC's. Morocco is on UTC+1 except around
 * Ramadan, when it goes back to UTC+0; the tz database decides which, these tests only pick dates on each side.
 */
describe("check-in and cancellation days follow Marrakech's local date", () => {
  afterEach(() => vi.useRealTimers());
  // Only Date is faked: the database driver keeps its real timers.
  const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  };
  const stay = (checkIn: string, checkOut: string) => ({ checkIn, checkOut, adults: 1, children: 0, infants: 0, pets: 0 });

  it("outside Ramadan (UTC+1): at 23:30 UTC on 14 June 2027 it is already the 15th in Marrakech", async () => {
    const home = await findHome({ place: "gueliz", guests: 1 });
    at("2027-06-14T23:30:00Z"); // 00:30 on the 15th in Marrakech
    // UTC's date would still accept the 14th.
    await expect(quoteStay(org, home.id, stay("2027-06-14", "2027-06-16"))).rejects.toMatchObject({ code: "INVALID_DATES" });
    await expect(quoteStay(org, home.id, stay("2027-06-15", "2027-06-17"))).resolves.toMatchObject({ nights: 2 });
  });

  it("outside Ramadan, a stay starting on the 15th can no longer be cancelled at 23:30 UTC on the 14th", async () => {
    const home = await findHome({ place: "hivernage", guests: 1 });
    const guest = await makeUser("Casablanca");
    at("2027-06-01T12:00:00Z");
    const booking = await createBooking(org, guest.id, { listingId: home.id, ...stay("2027-06-15", "2027-06-18") });
    at("2027-06-14T23:30:00Z"); // 00:30 on the 15th in Marrakech: the stay has started, though UTC is still on the 14th
    await expect(cancelBooking(org, guest.id, booking.id)).rejects.toMatchObject({ code: "NOT_CANCELLABLE" });
    at("2027-06-14T22:30:00Z"); // 23:30 on the 14th in Marrakech: still the day before
    await expect(cancelBooking(org, guest.id, booking.id)).resolves.toMatchObject({ status: "CANCELLED" });
  });

  it("during Ramadan 2027 (UTC+0): at 23:30 UTC on 20 February it is still the 20th in Marrakech", async () => {
    const home = await findHome({ place: "medina", guests: 1 });
    at("2027-02-20T23:30:00Z"); // 23:30 on the 20th in Marrakech; with UTC+1 it would be the 21st
    await expect(quoteStay(org, home.id, stay("2027-02-20", "2027-02-22"))).resolves.toMatchObject({ nights: 2 });
    await expect(quoteStay(org, home.id, stay("2027-02-19", "2027-02-22"))).rejects.toMatchObject({ code: "INVALID_DATES" });
  });
});

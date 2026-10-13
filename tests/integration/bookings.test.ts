import { describe, expect, it } from "vitest";
import { cancelBooking, createBooking, listBookings, quoteStay } from "@/lib/server/bookings";
import { db } from "@/lib/server/db";
import { AppError } from "@/lib/server/errors";
import { stayTotal } from "@/lib/pricing";
import { day, findHome, makeUser } from "./helpers";

const stay = (listingId: string, from: number, to: number, extra = {}) => ({
  listingId,
  checkIn: day(from),
  checkOut: day(to),
  adults: 2,
  children: 0,
  infants: 0,
  pets: 0,
  ...extra,
});

async function rejects(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

describe("quote", () => {
  it("prices the stay server-side", async () => {
    const home = await findHome();
    const q = await quoteStay(home.id, stay(home.id, 210, 213));
    expect(q).toMatchObject({ nights: 3, available: true, nightlyCents: home.priceCents });
    expect(q.totalCents).toBe(stayTotal(home.priceCents, 3, home.cleaningFeeCents));
  });

  it("rejects impossible stays", async () => {
    const home = await findHome({ pets: false });
    await rejects(quoteStay(home.id, stay(home.id, 5, 5)), "INVALID_DATES");
    await rejects(quoteStay(home.id, stay(home.id, -3, 2)), "INVALID_DATES");
    await rejects(quoteStay(home.id, stay(home.id, 400, 402)), "INVALID_DATES");
    await rejects(quoteStay(home.id, stay(home.id, 100, 200)), "INVALID_DATES");
    await rejects(quoteStay(home.id, stay(home.id, 220, 222, { adults: home.maxGuests + 1 })), "TOO_MANY_GUESTS");
    await rejects(quoteStay(home.id, stay(home.id, 220, 222, { pets: 1 })), "PETS_NOT_ALLOWED");
    await rejects(quoteStay("missing", stay("missing", 220, 222)), "NOT_FOUND");
    const exp = await db.listing.findFirstOrThrow({ where: { category: "EXPERIENCE" } });
    await rejects(quoteStay(exp.id, stay(exp.id, 220, 222)), "NOT_BOOKABLE");
  });
});

describe("createBooking", () => {
  it("books, then refuses overlapping stays but allows back-to-back ones", async () => {
    const [alice, bob] = await Promise.all([makeUser("Alice"), makeUser("Bob")]);
    const home = await findHome({ place: "bordeaux" });
    const b = await createBooking(alice.id, stay(home.id, 230, 234));
    expect(b).toMatchObject({ status: "CONFIRMED", nightlyCents: home.priceCents });
    expect(b.totalCents).toBe(stayTotal(home.priceCents, 4, home.cleaningFeeCents));

    await rejects(createBooking(bob.id, stay(home.id, 233, 236)), "UNAVAILABLE");
    await rejects(createBooking(bob.id, stay(home.id, 228, 231)), "UNAVAILABLE");
    // Checkout day is the next guest's check-in day.
    await expect(createBooking(bob.id, stay(home.id, 234, 236))).resolves.toMatchObject({ status: "CONFIRMED" });
    await expect(createBooking(bob.id, stay(home.id, 226, 230))).resolves.toMatchObject({ status: "CONFIRMED" });
  });

  it("lets exactly one of many simultaneous requests win the same dates", async () => {
    const home = await findHome({ place: "nantes" });
    const guests = await Promise.all(Array.from({ length: 6 }, (_, i) => makeUser(`Racer${i}`)));
    const results = await Promise.allSettled(guests.map((g) => createBooking(g.id, stay(home.id, 250, 253))));
    const won = results.filter((r) => r.status === "fulfilled");
    expect(won).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect((r.reason as AppError).code).toBe("UNAVAILABLE");
    // And the database agrees: one confirmed stay in that window.
    expect(await db.booking.count({ where: { listingId: home.id, status: "CONFIRMED", checkIn: new Date(`${day(250)}T00:00:00Z`) } })).toBe(1);
  });

  it("enforces the no-overlap rule in the database itself", async () => {
    const home = await findHome({ place: "rome" });
    const guest = await makeUser("Direct");
    const row = {
      listingId: home.id,
      guestId: guest.id,
      checkIn: new Date(`${day(260)}T00:00:00Z`),
      checkOut: new Date(`${day(263)}T00:00:00Z`),
      adults: 1,
      nightlyCents: 100,
      cleaningFeeCents: 0,
      serviceFeeCents: 14,
      totalCents: 314,
    };
    await db.booking.create({ data: row });
    await expect(db.booking.create({ data: { ...row, checkIn: new Date(`${day(261)}T00:00:00Z`) } })).rejects.toThrow();
  });

  it("refuses hosts booking their own listing", async () => {
    const home = await findHome({ place: "lisbonne" });
    await rejects(createBooking(home.hostId, stay(home.id, 240, 242)), "OWN_LISTING");
  });
});

describe("cancelBooking", () => {
  it("only the guest can cancel, once, and the dates free up", async () => {
    const [alice, mallory] = await Promise.all([makeUser("Alice"), makeUser("Mallory")]);
    const home = await findHome({ place: "londres" });
    const b = await createBooking(alice.id, stay(home.id, 270, 273));
    await rejects(cancelBooking(mallory.id, b.id), "NOT_FOUND");
    await expect(cancelBooking(alice.id, b.id)).resolves.toMatchObject({ status: "CANCELLED" });
    await rejects(cancelBooking(alice.id, b.id), "NOT_CANCELLABLE");
    await expect(createBooking(mallory.id, stay(home.id, 270, 273))).resolves.toMatchObject({ status: "CONFIRMED" });
    expect((await listBookings(alice.id)).map((x) => x.status)).toEqual(["CANCELLED"]);
  });
});

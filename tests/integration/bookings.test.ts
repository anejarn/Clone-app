import { describe, expect, it } from "vitest";
import { GET as quoteRoute } from "@/app/api/listings/[id]/quote/route";
import { cancelBooking, createBooking, listBookings, quoteStay } from "@/lib/server/bookings";
import { db } from "@/lib/server/db";
import { AppError } from "@/lib/server/errors";
import { priceStay } from "@/lib/pricing";
import { day, findHome, makeUser, pricingOf } from "./helpers";

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
  return e as AppError;
}

/** What lib/pricing.ts says the stay costs, from the listing's own data. */
async function expectedPrice(listingId: string, checkIn: string, nights: number, guests: { adults: number; children?: number; infants?: number }) {
  const l = await pricingOf(listingId);
  return priceStay({
    nightlyCents: l.priceCents,
    cleaningFeeCents: l.cleaningFeeCents,
    nights,
    checkIn,
    inseeCode: l.place.inseeCode,
    stars: l.stars,
    isFoundingHost: l.host.isFoundingHost,
    ...guests,
  });
}

describe("quote", () => {
  it("prices the stay server-side: stay + cleaning + taxe de séjour, no service fee", async () => {
    const home = await findHome();
    const q = await quoteStay(home.id, stay(home.id, 210, 213, { children: 1 }));
    const { guest, host } = await expectedPrice(home.id, day(210), 3, { adults: 2, children: 1 });
    expect(q).toMatchObject({ ...guest, nights: 3, available: true, nightlyCents: home.priceCents, minNights: 2 });
    expect(q.host).toEqual(host);
    expect(q.stayCents + q.cleaningFeeCents + q.touristTaxCents).toBe(q.totalCents);
    expect(q).not.toHaveProperty("serviceFeeCents");
  });

  it("charges the classified rate per adult, or 5.5 % of the cost per occupant when unclassified", async () => {
    const classified = await db.listing.findFirstOrThrow({ where: { stars: 3, minNights: 2, maxGuests: { gte: 4 }, place: { inseeCode: "05098" } } });
    const q1 = await quoteStay(classified.id, stay(classified.id, 215, 218, { children: 2 }));
    expect(q1.touristTaxCents).toBe(154 * 2 * 3); // Les Orres 3★, children exempt

    const unclassified = await db.listing.findFirstOrThrow({
      where: { stars: null, minNights: 2, maxGuests: { gte: 4 }, place: { inseeCode: "05096" } },
      orderBy: { id: "asc" },
    });
    const q2 = await quoteStay(unclassified.id, stay(unclassified.id, 215, 218, { children: 2 }));
    const rate = Math.min(Math.round((unclassified.priceCents * 550) / (4 * 10_000)), 440);
    expect(q2.touristTaxCents).toBe(rate * 2 * 3);
  });

  it("gives founding hosts 5 % for check-ins up to 30 April 2027, then 10 %", async () => {
    const home = await db.listing.findFirstOrThrow({ where: { minNights: 2, host: { isFoundingHost: true } }, orderBy: { id: "asc" } });
    const other = await db.listing.findFirstOrThrow({ where: { minNights: 2, host: { isFoundingHost: false } }, orderBy: { id: "asc" } });
    const today = new Date("2027-01-01T00:00:00Z");
    const at = (id: string, checkIn: string, checkOut: string) => quoteStay(id, { checkIn, checkOut, adults: 2, children: 0, infants: 0, pets: 0 }, today);
    expect((await at(home.id, "2027-04-28", "2027-04-30")).host.commissionBps).toBe(500);
    expect((await at(home.id, "2027-04-30", "2027-05-02")).host.commissionBps).toBe(500);
    expect((await at(home.id, "2027-05-01", "2027-05-03")).host.commissionBps).toBe(1000);
    expect((await at(other.id, "2027-04-28", "2027-04-30")).host.commissionBps).toBe(1000);
  });

  it("enforces the listing's minimum stay", async () => {
    const home = await findHome({ minNights: 3 });
    const e = await rejects(quoteStay(home.id, stay(home.id, 220, 222)), "MIN_NIGHTS");
    expect(e.status).toBe(422);
    expect(e.message).toBe("Ce logement se réserve pour 3 nuits minimum.");
    await expect(quoteStay(home.id, stay(home.id, 220, 223))).resolves.toMatchObject({ nights: 3, minNights: 3 });
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
  });

  it("refuses anything that isn't a home (no experiences are seeded, the rule stays)", async () => {
    const home = await findHome();
    const exp = await db.listing.create({
      data: {
        category: "EXPERIENCE",
        title: "Test only",
        description: "Test only",
        placeId: home.placeId,
        hostId: home.hostId,
        lat: home.lat,
        lng: home.lng,
        maxGuests: 8,
        priceCents: 5_000,
        registrationNumber: "05096000000ZZ",
        liftDistanceM: 0,
      },
    });
    try {
      await rejects(quoteStay(exp.id, stay(exp.id, 220, 222)), "NOT_BOOKABLE");
    } finally {
      await db.listing.delete({ where: { id: exp.id } });
    }
  });

  it("the public quote shows guest lines only", async () => {
    const home = await findHome({ nth: 1 });
    const url = `http://localhost/api/listings/${home.id}/quote?checkin=${day(225)}&checkout=${day(228)}&adults=2&children=1`;
    const res = await quoteRoute(new Request(url), { params: Promise.resolve({ id: home.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["available", "cleaningFeeCents", "minNights", "nightlyCents", "nights", "stayCents", "totalCents", "touristTaxCents"]);
    const { guest } = await expectedPrice(home.id, day(225), 3, { adults: 2, children: 1 });
    expect(body).toMatchObject({ available: true, ...guest, minNights: 2 });
  });
});

describe("createBooking", () => {
  it("snapshots both sides of the price, and shows the guest only theirs", async () => {
    const guest = await makeUser("Snap");
    const home = await findHome({ nth: 2 });
    const b = await createBooking(guest.id, stay(home.id, 230, 234, { children: 1, infants: 1 }));
    for (const hidden of ["commissionBps", "commissionCents", "commissionVatCents", "hostPayoutCents", "serviceFeeCents"]) {
      expect(b, hidden).not.toHaveProperty(hidden);
    }
    for (const x of await listBookings(guest.id)) expect(x).not.toHaveProperty("hostPayoutCents");

    const expected = await expectedPrice(home.id, day(230), 4, { adults: 2, children: 1, infants: 1 });
    expect(b).toMatchObject({
      status: "CONFIRMED",
      nightlyCents: home.priceCents,
      cleaningFeeCents: expected.guest.cleaningFeeCents,
      touristTaxCents: expected.guest.touristTaxCents,
      totalCents: expected.guest.totalCents,
    });
    const row = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row).toMatchObject({
      nightlyCents: home.priceCents,
      cleaningFeeCents: home.cleaningFeeCents,
      touristTaxCents: expected.guest.touristTaxCents,
      totalCents: expected.guest.totalCents,
      ...expected.host,
    });
    const base = row.nightlyCents * 4 + row.cleaningFeeCents;
    expect(row.hostPayoutCents + row.commissionCents + row.commissionVatCents).toBe(base);
    expect(row.totalCents).toBe(base + row.touristTaxCents);
  });

  it("books, then refuses overlapping stays but allows back-to-back ones", async () => {
    const [alice, bob] = await Promise.all([makeUser("Alice"), makeUser("Bob")]);
    const home = await findHome({ place: "les-orres" });
    const b = await createBooking(alice.id, stay(home.id, 230, 234));
    expect(b).toMatchObject({ status: "CONFIRMED", nightlyCents: home.priceCents });

    await rejects(createBooking(bob.id, stay(home.id, 233, 236)), "UNAVAILABLE");
    await rejects(createBooking(bob.id, stay(home.id, 228, 231)), "UNAVAILABLE");
    // Checkout day is the next guest's check-in day.
    await expect(createBooking(bob.id, stay(home.id, 234, 236))).resolves.toMatchObject({ status: "CONFIRMED" });
    await expect(createBooking(bob.id, stay(home.id, 226, 230))).resolves.toMatchObject({ status: "CONFIRMED" });
  });

  it("refuses stays shorter than the listing's minimum", async () => {
    const guest = await makeUser("Short");
    const home = await findHome({ minNights: 3, nth: 1 });
    await rejects(createBooking(guest.id, stay(home.id, 240, 242)), "MIN_NIGHTS");
    await expect(createBooking(guest.id, stay(home.id, 240, 243))).resolves.toMatchObject({ status: "CONFIRMED" });
  });

  it("lets exactly one of many simultaneous requests win the same dates", async () => {
    const home = await findHome({ place: "orcieres-merlette", nth: 3 });
    const guests = await Promise.all(Array.from({ length: 6 }, (_, i) => makeUser(`Racer${i}`)));
    const results = await Promise.allSettled(guests.map((g) => createBooking(g.id, stay(home.id, 250, 253))));
    const won = results.filter((r) => r.status === "fulfilled");
    expect(won).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect((r.reason as AppError).code).toBe("UNAVAILABLE");
    // And the database agrees: one confirmed stay in that window.
    expect(await db.booking.count({ where: { listingId: home.id, status: "CONFIRMED", checkIn: new Date(`${day(250)}T00:00:00Z`) } })).toBe(1);
  });

  it("enforces the no-overlap and amount rules in the database itself", async () => {
    const home = await findHome({ place: "les-orres", nth: 2 });
    const guest = await makeUser("Direct");
    // 3 nights at €1 = 300; 10 % commission 30, VAT 6, payout 264; no tax.
    const row = {
      listingId: home.id,
      guestId: guest.id,
      checkIn: new Date(`${day(260)}T00:00:00Z`),
      checkOut: new Date(`${day(263)}T00:00:00Z`),
      adults: 1,
      nightlyCents: 100,
      cleaningFeeCents: 0,
      touristTaxCents: 0,
      totalCents: 300,
      commissionBps: 1000,
      commissionCents: 30,
      commissionVatCents: 6,
      hostPayoutCents: 264,
    };
    await db.booking.create({ data: row });
    await expect(db.booking.create({ data: { ...row, checkIn: new Date(`${day(261)}T00:00:00Z`) } })).rejects.toThrow();
    const later = { checkIn: new Date(`${day(270)}T00:00:00Z`), checkOut: new Date(`${day(273)}T00:00:00Z`) };
    // Split that doesn't add up to the base, and a total that isn't base + tax.
    await expect(db.booking.create({ data: { ...row, ...later, hostPayoutCents: 270 } })).rejects.toThrow(/bookings_split_check|check/i);
    await expect(db.booking.create({ data: { ...row, ...later, totalCents: 314 } })).rejects.toThrow(/bookings_total_check|check/i);
    await expect(db.booking.create({ data: { ...row, ...later } })).resolves.toMatchObject({ totalCents: 300 });
  });

  it("refuses hosts booking their own listing", async () => {
    const home = await findHome({ place: "les-orres", nth: 3 });
    await rejects(createBooking(home.hostId, stay(home.id, 240, 242)), "OWN_LISTING");
  });
});

describe("cancelBooking", () => {
  it("only the guest can cancel, once, and the dates free up", async () => {
    const [alice, mallory] = await Promise.all([makeUser("Alice"), makeUser("Mallory")]);
    const home = await findHome({ place: "les-orres", nth: 4 });
    const b = await createBooking(alice.id, stay(home.id, 270, 273));
    await rejects(cancelBooking(mallory.id, b.id), "NOT_FOUND");
    const cancelled = await cancelBooking(alice.id, b.id);
    expect(cancelled).toMatchObject({ status: "CANCELLED" });
    expect(cancelled).not.toHaveProperty("hostPayoutCents");
    await rejects(cancelBooking(alice.id, b.id), "NOT_CANCELLABLE");
    await expect(createBooking(mallory.id, stay(home.id, 270, 273))).resolves.toMatchObject({ status: "CONFIRMED" });
    expect((await listBookings(alice.id)).map((x) => x.status)).toEqual(["CANCELLED"]);
  });
});

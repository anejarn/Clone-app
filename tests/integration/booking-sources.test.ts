import { beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { cancelBooking, createBooking, listBookings, quoteStay } from "@/lib/server/bookings";
import { bookedRanges, getListing, searchHomes } from "@/lib/server/catalog";
import { db } from "@/lib/server/db";
import { parseSearchQuery } from "@/lib/search/params";
import { day, findHome, makeUser, sigmaOrgId } from "./helpers";

const sigma = await sigmaOrgId();
const PLATFORMS = ["AIRBNB", "BOOKING", "AGODA", "TRIPCOM", "EXPEDIA"] as const;
const at = (n: number) => new Date(`${day(n)}T00:00:00Z`);
const stay = (listingId: string, from: number, to: number) => ({
  listingId,
  checkIn: day(from),
  checkOut: day(to),
  adults: 1,
  children: 0,
  infants: 0,
  pets: 0,
});
const amounts = { nightlyCents: 50_000, cleaningFeeCents: 10_000, serviceFeeCents: 0, totalCents: 110_000 };
let refs = 0;
/** A unique, plausible Airbnb code for this run. */
const airbnbRef = () => `HMT${Date.now().toString(36).toUpperCase().slice(-5)}${(refs++).toString().padStart(2, "0")}`;

/** Rows written straight to the database, to test its own rules (the app never writes most of these). */
function row(listingId: string, from: number, to: number, extra: Partial<Prisma.BookingUncheckedCreateInput> = {}) {
  return { organizationId: sigma, listingId, checkIn: at(from), checkOut: at(to), adults: 1, ...extra } satisfies Prisma.BookingUncheckedCreateInput;
}
const ownerBlock = (listingId: string, from: number, to: number, extra: Partial<Prisma.BookingUncheckedCreateInput> = {}) =>
  row(listingId, from, to, { source: "OWNER", adults: 0, ...extra });

describe("seeded bookings", () => {
  it("has platform bookings from Airbnb, Booking.com, Agoda and Trip.com without guest accounts", async () => {
    for (const source of ["AIRBNB", "BOOKING", "AGODA", "TRIPCOM"] as const) {
      const rows = await db.booking.findMany({ where: { organizationId: sigma, source } });
      expect(rows.length, source).toBeGreaterThan(3);
      for (const b of rows) {
        expect(b).toMatchObject({ guestId: null, guestName: expect.any(String) });
        expect(b.externalRef).toMatch({ AIRBNB: /^HM[A-Z0-9]{8}$/, BOOKING: /^\d{10}$/, AGODA: /^\d{9}$/, TRIPCOM: /^\d{16}$/ }[source]);
      }
    }
    // Guests from many countries: at least a dozen different names.
    const names = await db.booking.findMany({ where: { organizationId: sigma, source: { in: [...PLATFORMS] } }, distinct: ["guestName"], select: { guestName: true } });
    expect(names.length).toBeGreaterThanOrEqual(12);
  });

  it("has owner blocks with dates only, and direct stays of guest accounts with their amounts", async () => {
    const blocks = await db.booking.findMany({ where: { organizationId: sigma, source: "OWNER" } });
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const b of blocks) {
      expect(b).toMatchObject({ guestId: null, guestName: null, guestEmail: null, guestPhone: null, externalRef: null, totalCents: null, adults: 0 });
    }
    const direct = await db.booking.findMany({ where: { organizationId: sigma, source: "DIRECT", guest: { email: { endsWith: "@demo.sigma.test" } } } });
    expect(direct.length).toBeGreaterThan(5);
    for (const b of direct) expect(b.guestId && b.totalCents! > 0).toBeTruthy();
  });
});

describe("database rules by source", () => {
  let home: string;
  let guest: string;
  beforeAll(async () => {
    home = (await findHome({ place: "agdal" })).id;
    guest = (await makeUser("Rules")).id;
  });

  it("an owner block has no amount and no guest", async () => {
    await expect(db.booking.create({ data: ownerBlock(home, 400, 402) })).resolves.toMatchObject({ source: "OWNER", totalCents: null });
    const refused: Partial<Prisma.BookingUncheckedCreateInput>[] = [
      amounts,
      { totalCents: 100 },
      { guestId: guest },
      { guestName: "Ami du propriétaire" },
      { guestEmail: "ami@test.sigma.test" },
      { guestPhone: "+212 600 000 000" },
      { externalRef: "HMOWNER001" },
      { adults: 2 },
    ];
    for (const extra of refused) {
      await expect(db.booking.create({ data: ownerBlock(home, 410, 412, extra) }), JSON.stringify(extra)).rejects.toThrow(
        /bookings_owner_block_check|bookings_amounts_check|23514/,
      );
    }
  });

  it("a platform booking always has its externalRef; other sources never do", async () => {
    for (const source of PLATFORMS) {
      await expect(db.booking.create({ data: row(home, 420, 422, { source, guestName: "Emma de Jong" }) }), source).rejects.toThrow(
        /bookings_external_ref_check|23514/,
      );
      await expect(db.booking.create({ data: row(home, 420, 422, { source, externalRef: "   " }) }), source).rejects.toThrow(
        /bookings_external_ref_check|23514/,
      );
    }
    await expect(db.booking.create({ data: row(home, 420, 422, { guestId: guest, ...amounts, externalRef: "HMDIRECT01" }) })).rejects.toThrow(
      /bookings_external_ref_check|23514/,
    );
    // No guest account, no amount yet (iCal carries neither): still valid for a platform.
    const ok = await db.booking.create({ data: row(home, 420, 423, { source: "AIRBNB", externalRef: airbnbRef() }) });
    expect(ok).toMatchObject({ guestId: null, guestName: null, totalCents: null });
  });

  it("amounts are all known or all unknown; a direct booking always has them and a guest", async () => {
    await expect(db.booking.create({ data: row(home, 430, 432, { source: "BOOKING", externalRef: "9000000001", totalCents: 100 }) })).rejects.toThrow(
      /bookings_amounts_check|23514/,
    );
    await expect(db.booking.create({ data: row(home, 430, 432, { guestId: guest }) })).rejects.toThrow(/bookings_amounts_check|23514/);
    await expect(db.booking.create({ data: row(home, 430, 432, { ...amounts }) })).rejects.toThrow(/bookings_direct_guest_check|23514/);
    await expect(db.booking.create({ data: row(home, 430, 432, { ...amounts, guestName: "  " }) })).rejects.toThrow(/bookings_direct_guest_check|23514/);
    // Booked by phone: no account, a name.
    await expect(db.booking.create({ data: row(home, 430, 432, { ...amounts, guestName: "Youssef Amrani", guestPhone: "+212 600 000 001" }) })).resolves.toMatchObject({
      source: "DIRECT",
      guestId: null,
    });
    // Guests: at least one adult outside owner blocks.
    await expect(db.booking.create({ data: row(home, 440, 442, { source: "AGODA", externalRef: "900000002", adults: 0 }) })).rejects.toThrow(
      /bookings_guests_check|23514/,
    );
  });

  it("externalRef is unique per source within an organization, even once cancelled or on another listing", async () => {
    const other = (await findHome({ place: "targa" })).id;
    const ref = airbnbRef();
    const first = await db.booking.create({ data: row(home, 450, 452, { source: "AIRBNB", externalRef: ref }) });
    await expect(db.booking.create({ data: row(other, 450, 452, { source: "AIRBNB", externalRef: ref }) })).rejects.toMatchObject({ code: "P2002" });
    await db.booking.update({ where: { id: first.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await expect(db.booking.create({ data: row(other, 460, 462, { source: "AIRBNB", externalRef: ref }) })).rejects.toMatchObject({ code: "P2002" });
    // The same code from another platform is another booking.
    await expect(db.booking.create({ data: row(other, 460, 462, { source: "BOOKING", externalRef: ref }) })).resolves.toMatchObject({ source: "BOOKING" });
  });

  it("a seeded platform code can't be imported twice", async () => {
    const seeded = await db.booking.findFirstOrThrow({ where: { organizationId: sigma, source: "TRIPCOM" } });
    const elsewhere = (await findHome({ place: "menara" })).id;
    await expect(
      db.booking.create({ data: row(elsewhere, 470, 472, { source: "TRIPCOM", externalRef: seeded.externalRef }) }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("owner blocks and platform bookings block the dates (bookings_no_overlap)", () => {
  let home: string;
  let guest: string;
  beforeAll(async () => {
    home = (await findHome({ place: "semlalia", minNights: 1 })).id;
    guest = (await makeUser("Overlap")).id;
    await db.booking.create({ data: ownerBlock(home, 350, 355) });
  });

  it("refuses a booking over an owner block, from the app and in the database", async () => {
    await expect(createBooking(sigma, guest, stay(home, 353, 357))).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect((await quoteStay(sigma, home, stay(home, 351, 352))).available).toBe(false);
    await expect(db.booking.create({ data: row(home, 354, 356, { guestId: guest, ...amounts }) })).rejects.toThrow(/bookings_no_overlap|23P01/);
    await expect(db.booking.create({ data: row(home, 349, 351, { source: "BOOKING", externalRef: "9100000001" }) })).rejects.toThrow(
      /bookings_no_overlap|23P01/,
    );
    // Back to back is fine.
    await expect(createBooking(sigma, guest, stay(home, 355, 357))).resolves.toMatchObject({ source: "DIRECT" });
  });

  it("refuses an owner block over a booking, and over another block", async () => {
    await expect(db.booking.create({ data: ownerBlock(home, 356, 360) })).rejects.toThrow(/bookings_no_overlap|23P01/);
    await expect(db.booking.create({ data: ownerBlock(home, 352, 354) })).rejects.toThrow(/bookings_no_overlap|23P01/);
  });

  it("shows owner blocks as booked in the calendar and the search, without saying why", async () => {
    const ranges = await bookedRanges(sigma, home, at(340), at(365));
    expect(ranges).toContainEqual({ checkIn: day(350), checkOut: day(355) });
    const listing = await db.listing.findUniqueOrThrow({ where: { id: home }, include: { place: true } });
    const during = await searchHomes(sigma, listing.place.slug, parseSearchQuery({ checkin: day(351), checkout: day(353) }));
    expect(during.cards.map((c) => c.id)).not.toContain(home);
  });

  it("a cancelled block frees the dates", async () => {
    const block = await db.booking.create({ data: ownerBlock(home, 360, 363) });
    await db.booking.update({ where: { id: block.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await expect(createBooking(sigma, guest, stay(home, 360, 363))).resolves.toMatchObject({ status: "CONFIRMED" });
  });
});

describe("guest flows", () => {
  it("booking from the site is DIRECT with the guest's account, no contact copied", async () => {
    const guest = await makeUser("Direct");
    const home = await findHome({ place: "medina" });
    const b = await createBooking(sigma, guest.id, stay(home.id, 214, 216));
    const stored = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(stored).toMatchObject({ source: "DIRECT", guestId: guest.id, externalRef: null, guestName: null, guestEmail: null });
    expect(b).not.toHaveProperty("guestName");
    expect(b).not.toHaveProperty("guestEmail");
  });

  it("trips list only the guest's own bookings, never platform bookings or owner blocks", async () => {
    const guest = await makeUser("Trips");
    expect(await listBookings(sigma, guest.id)).toEqual([]);
    const home = await findHome({ place: "palmeraie" });
    const mine = await createBooking(sigma, guest.id, stay(home.id, 216, 218));
    const trips = await listBookings(sigma, guest.id);
    expect(trips.map((t) => t.id)).toEqual([mine.id]);
    // None of the seeded platform bookings or blocks belong to anyone.
    expect(await db.booking.count({ where: { source: { not: "DIRECT" }, guest: { email: { endsWith: "@demo.sigma.test" } } } })).toBe(0);
  });

  it("a platform booking tied to an account can't be cancelled from Sigma", async () => {
    const guest = await makeUser("Platform");
    const home = await findHome({ place: "ourika" });
    const b = await db.booking.create({ data: row(home.id, 222, 225, { source: "AIRBNB", externalRef: airbnbRef(), guestId: guest.id }) });
    await expect(cancelBooking(sigma, guest.id, b.id)).rejects.toMatchObject({ code: "NOT_CANCELLABLE" });
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CONFIRMED");
  });
});

describe("nothing public reveals platform guests", () => {
  let secrets: string[];
  let listingIds: string[];
  beforeAll(async () => {
    const rows = await db.booking.findMany({
      where: { organizationId: sigma, source: { in: [...PLATFORMS] } },
      select: { listingId: true, guestName: true, guestEmail: true, guestPhone: true, externalRef: true },
    });
    secrets = [...new Set(rows.flatMap((r) => [r.guestName, r.guestEmail, r.guestPhone, r.externalRef]).filter((s): s is string => !!s))];
    listingIds = [...new Set(rows.map((r) => r.listingId))].slice(0, 15);
  });

  const leaks = (text: string) => secrets.filter((s) => text.includes(s));

  it("not the listing page data, the availability API or the search", async () => {
    const { GET: availability } = await import("@/app/api/listings/[id]/availability/route");
    const { GET: detail } = await import("@/app/api/listings/[id]/route");
    for (const id of listingIds) {
      expect(leaks(JSON.stringify(await getListing(sigma, id)))).toEqual([]);
      const ctx = { params: Promise.resolve({ id }) };
      const a = await availability(new Request(`http://localhost:3000/api/listings/${id}/availability`), ctx as Parameters<typeof availability>[1]);
      expect(a.status).toBe(200);
      expect(leaks(await a.text())).toEqual([]);
      const d = await detail(new Request(`http://localhost:3000/api/listings/${id}`), ctx as Parameters<typeof detail>[1]);
      expect(d.status).toBe(200);
      expect(leaks(await d.text())).toEqual([]);
    }
    expect(leaks(JSON.stringify(await searchHomes(sigma, "partout", parseSearchQuery({}))))).toEqual([]);
  });
});

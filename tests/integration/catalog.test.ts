import { describe, expect, it } from "vitest";
import { GET as availabilityRoute } from "@/app/api/listings/[id]/availability/route";
import { formatPrice } from "@/lib/format";
import { SKI_IN_MAX_M } from "@/lib/labels";
import { priceStay } from "@/lib/pricing";
import {
  bookedRanges,
  cardsByIds,
  FAMILY_MIN_GUESTS,
  findPlace,
  getListing,
  homeIds,
  homeSections,
  PAGE_SIZE,
  searchHomes,
  suggestPlaces,
} from "@/lib/server/catalog";
import { db } from "@/lib/server/db";
import { parseSearchQuery } from "@/lib/search/params";
import { TOURIST_TAX_GRIDS, touristTax } from "@/lib/tourist-tax";
import { day, findHome, pricingOf } from "./helpers";

describe("places", () => {
  it("are the two launch resorts, each with a taxe de séjour grid", async () => {
    const places = await db.place.findMany({ select: { slug: true, inseeCode: true, timezone: true }, orderBy: { slug: "asc" } });
    expect(places.map((p) => p.slug)).toEqual(["les-orres", "orcieres-merlette"]);
    for (const p of places) {
      expect(TOURIST_TAX_GRIDS[p.inseeCode], p.slug).toBeDefined();
      expect(() => touristTax({ inseeCode: p.inseeCode, stars: null, nightlyCents: 10_000, nights: 1, adults: 1 })).not.toThrow();
      expect(p.timezone).toBe("Europe/Paris");
    }
  });

  it("suggests accent- and case-insensitively, prefix matches first", async () => {
    expect((await suggestPlaces("ORC")).map((p) => p.slug)).toEqual(["orcieres-merlette"]);
    expect((await suggestPlaces("orcières")).map((p) => p.slug)).toEqual(["orcieres-merlette"]);
    // "orres" is inside "les-orres": still found.
    expect((await suggestPlaces("orres")).map((p) => p.slug)).toEqual(["les-orres"]);
    expect((await suggestPlaces("france")).map((p) => p.slug).sort()).toEqual(["les-orres", "orcieres-merlette"]);
    expect(await suggestPlaces("paris")).toEqual([]);
    expect(await suggestPlaces("")).toHaveLength(2);
  });

  it("resolves URL segments by slug or name", async () => {
    expect((await findPlace("les-orres"))?.name).toBe("Les Orres");
    expect((await findPlace("Les Orres"))?.slug).toBe("les-orres");
    expect((await findPlace("Orcières-Merlette 1850"))?.slug).toBe("orcieres-merlette");
    expect((await findPlace("orcieres-merlette"))?.altitudeM).toBe(1850);
    expect(await findPlace("paris")).toBeNull();
    expect(await findPlace("atlantide")).toBeNull();
  });
});

describe("searchHomes", () => {
  it("returns nothing for unknown places and everything for 'partout'", async () => {
    expect((await searchHomes("atlantide", parseSearchQuery({}))).total).toBe(0);
    const all = await searchHomes("partout", parseSearchQuery({}));
    expect(all.total).toBe(await db.listing.count({ where: { category: "HOME" } }));
    expect(all.cards).toHaveLength(PAGE_SIZE);
    expect(await db.listing.count({ where: { category: { not: "HOME" } } })).toBe(0);
  });

  it("filters by guests and pets", async () => {
    const big = await searchHomes("orcieres-merlette", parseSearchQuery({ adults: "6" }));
    expect(big.total).toBeGreaterThan(0);
    const maxGuests = await db.listing.findMany({ where: { id: { in: big.cards.map((c) => c.id) } }, select: { maxGuests: true } });
    expect(maxGuests.every((l) => l.maxGuests >= 6)).toBe(true);
    const pets = await searchHomes("partout", parseSearchQuery({ adults: "1", pets: "1" }));
    const withPets = await db.listing.count({ where: { category: "HOME", amenities: { some: { amenityId: "animaux" } } } });
    expect(pets.total).toBe(withPets);
  });

  it("filters by property type and ski-in", async () => {
    const studios = await searchHomes("les-orres", parseSearchQuery({ type: "studio" }));
    expect(studios.total).toBe(await db.listing.count({ where: { place: { slug: "les-orres" }, propertyType: "STUDIO" } }));
    expect(studios.total).toBeGreaterThan(0);
    const ski = await searchHomes("partout", parseSearchQuery({ ski: "1" }));
    expect(ski.total).toBe(await db.listing.count({ where: { category: "HOME", liftDistanceM: { lte: SKI_IN_MAX_M } } }));
    // Junk filter values are ignored.
    expect((await searchHomes("partout", parseSearchQuery({ type: "villa", ski: "oui" }))).total).toBe(await db.listing.count({ where: { category: "HOME" } }));
  });

  it("links cards to the listing page with the searched dates and guests", async () => {
    const r = await searchHomes("orcieres-merlette", parseSearchQuery({ checkin: day(200), checkout: day(203), adults: "2" }));
    const card = r.cards[0];
    expect(card.href).toBe(`/rooms/${card.id}?checkin=${day(200)}&checkout=${day(203)}&adults=2`);
    expect(card.facts).toMatch(/^(Meublé [1-5]★|Non classé) · (Ski aux pieds|À \d+\u00a0m des pistes)/);
  });

  it("hides homes booked on the requested dates", async () => {
    const booking = await db.booking.findFirstOrThrow({ where: { status: "CONFIRMED" }, include: { listing: { include: { place: true } } } });
    const checkin = booking.checkIn.toISOString().slice(0, 10);
    const checkout = booking.checkOut.toISOString().slice(0, 10);
    const during = await searchHomes(booking.listing.place.slug, parseSearchQuery({ checkin, checkout }));
    expect(during.cards.map((c) => c.id)).not.toContain(booking.listingId);
    const later = await searchHomes(booking.listing.place.slug, parseSearchQuery({ checkin: day(300), checkout: day(303) }));
    expect(later.total).toBe(await db.listing.count({ where: { place: { slug: booking.listing.place.slug } } }));
  });

  it("hides homes whose minimum stay is longer than the dates", async () => {
    const twoNights = await searchHomes("partout", parseSearchQuery({ checkin: day(310), checkout: day(312) }));
    const threeNights = await searchHomes("partout", parseSearchQuery({ checkin: day(310), checkout: day(313) }));
    const longMin = await db.listing.count({ where: { minNights: 3 } });
    expect(longMin).toBeGreaterThan(0);
    expect(twoNights.total).toBe(threeNights.total - longMin);
  });

  it("puts the pinned home first and never repeats it on later pages", async () => {
    const last = await db.listing.findFirstOrThrow({ where: { category: "HOME" }, orderBy: { id: "desc" } });
    const q = parseSearchQuery({ pinned: last.id });
    const p1 = await searchHomes("partout", q, 1);
    expect(p1.cards[0]).toMatchObject({ id: last.id, pinned: true });
    const seen = new Set<string>();
    for (let page = 1; page <= p1.pageCount; page++) {
      for (const c of (await searchHomes("partout", q, page)).cards) {
        expect(seen.has(c.id)).toBe(false);
        seen.add(c.id);
      }
    }
    expect(seen.size).toBe(p1.total);
  });

  it("prices whole stays all-in when dates are given (taxe de séjour for the searched guests)", async () => {
    const r = await searchHomes("les-orres", parseSearchQuery({ checkin: day(200), checkout: day(203), adults: "2", children: "1" }));
    expect(r.nights).toBe(3);
    const card = r.cards[0];
    expect(card.priceSuffix).toBe("pour 3 nuits");
    const l = await pricingOf(card.id);
    const { guest } = priceStay({
      nightlyCents: l.priceCents,
      cleaningFeeCents: l.cleaningFeeCents,
      nights: 3,
      checkIn: day(200),
      inseeCode: l.place.inseeCode,
      stars: l.stars,
      isFoundingHost: l.host.isFoundingHost,
      adults: 2,
      children: 1,
    });
    // To the cent: the card never shows less than the booking charges.
    expect(card.price).toBe(formatPrice(guest.totalCents));
    expect(card).toMatchObject({ stars: l.stars, minNights: l.minNights });
  });
});

describe("homeSections", () => {
  it("leads with the two resorts, then one row per resort, ski-in and family rows", async () => {
    const sections = await homeSections();
    expect(sections[0]).toMatchObject({ kind: "resorts" });
    if (sections[0].kind === "resorts") expect(sections[0].places.map((p) => p.slug).sort()).toEqual(["les-orres", "orcieres-merlette"]);
    expect(sections.slice(1).map((s) => s.title)).toEqual([
      "Logements populaires · Orcières-Merlette 1850",
      "Logements populaires · Les Orres",
      "Ski aux pieds",
      "Grands logements pour les familles",
    ]);
    expect(sections.every((s) => s.kind === "resorts" || s.kind === "listings")).toBe(true);
  });

  it("only puts matching homes in each row, priced per night and linking to their page", async () => {
    const rows = (await homeSections()).flatMap((s) => (s.kind === "listings" ? [s] : []));
    for (const s of rows) {
      expect(s.cards.length, s.title).toBeGreaterThan(0);
      const ids = s.cards.map((c) => c.id);
      const homes = await db.listing.findMany({ where: { id: { in: ids } }, select: { liftDistanceM: true, maxGuests: true, category: true, place: { select: { name: true } } } });
      expect(homes.every((h) => h.category === "HOME"), s.title).toBe(true);
      if (s.title === "Ski aux pieds") expect(homes.every((h) => h.liftDistanceM <= SKI_IN_MAX_M)).toBe(true);
      if (s.title.startsWith("Grands")) expect(homes.every((h) => h.maxGuests >= FAMILY_MIN_GUESTS)).toBe(true);
      if (s.title.startsWith("Logements populaires · ")) expect(homes.every((h) => s.title.endsWith(h.place.name))).toBe(true);
      for (const c of s.cards) {
        expect(c.priceSuffix).toBe("par nuit");
        expect(c.href).toBe(`/rooms/${c.id}`);
      }
    }
    // The row titles link to the matching searches.
    expect(rows.find((s) => s.title === "Ski aux pieds")?.href).toBe("/s/partout/homes?ski=1");
    expect(rows.find((s) => s.title.startsWith("Grands"))?.href).toBe(`/s/partout/homes?adults=${FAMILY_MIN_GUESTS}`);
  });
});

describe("homeIds", () => {
  it("lists every home, for prerendering listing pages", async () => {
    expect(await homeIds()).toHaveLength(await db.listing.count({ where: { category: "HOME" } }));
  });
});

describe("cardsByIds", () => {
  it("keeps the requested order and skips unknown ids", async () => {
    const a = await findHome({ place: "orcieres-merlette" });
    const b = await findHome({ place: "les-orres" });
    expect((await cardsByIds([b.id, "nope", a.id])).map((c) => c.id)).toEqual([b.id, a.id]);
  });
});

describe("listing detail and calendar", () => {
  it("returns the full listing with its ski and legal data, or null", async () => {
    const home = await findHome({ place: "orcieres-merlette" });
    const l = await getListing(home.id);
    expect(l).toMatchObject({
      id: home.id,
      place: { slug: "orcieres-merlette", inseeCode: "05096", altitudeM: 1850 },
      registrationNumber: home.registrationNumber,
      liftDistanceM: home.liftDistanceM,
      minNights: home.minNights,
      stars: home.stars,
    });
    // The owner's commission tier is host-side data.
    expect(l!.host).not.toHaveProperty("isFoundingHost");
    expect(l!.registrationNumber).toMatch(/^05096\d{6}[A-Z]{2}$/);
    expect(l!.photos.length).toBeGreaterThan(0);
    expect(l!.reviews.length).toBeLessThanOrEqual(6);
    expect(await getListing("missing")).toBeNull();
  });

  it("lists booked ranges inside the window only", async () => {
    const b = await db.booking.findFirstOrThrow({ where: { status: "CONFIRMED" } });
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const inside = await bookedRanges(b.listingId, new Date(b.checkIn.getTime() - 86_400_000), new Date(b.checkOut.getTime() + 86_400_000));
    expect(inside).toContainEqual({ checkIn: iso(b.checkIn), checkOut: iso(b.checkOut) });
    // A window that ends on the check-in day doesn't overlap (checkout exclusive).
    expect(await bookedRanges(b.listingId, new Date(b.checkIn.getTime() - 5 * 86_400_000), b.checkIn)).toEqual([]);
  });

  it("the availability route gives the minimum stay, and 404 for unknown listings", async () => {
    const home = await findHome({ minNights: 3 });
    const call = (id: string) => availabilityRoute(new Request(`http://localhost/api/listings/${id}/availability`), { params: Promise.resolve({ id }) });
    const res = await call(home.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ listingId: home.id, minNights: 3, booked: expect.any(Array) });
    expect((await call("missing")).status).toBe(404);
  });
});

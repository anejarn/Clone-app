import { describe, expect, it } from "vitest";
import { bookedRanges, cardsByIds, findPlace, getListing, homeSections, PAGE_SIZE, searchHomes, suggestPlaces } from "@/lib/server/catalog";
import { db } from "@/lib/server/db";
import { parseSearchQuery } from "@/lib/search/params";
import { day, findHome, sigmaOrgId } from "./helpers";

const org = await sigmaOrgId();

describe("places", () => {
  it("suggests accent- and case-insensitively, prefix matches first", async () => {
    expect((await suggestPlaces("GUÉL")).map((p) => p.slug)).toEqual(["gueliz"]);
    expect((await suggestPlaces("menara")).map((p) => p.slug)).toEqual(["menara"]);
    // "ag" starts Agafay and Agdal, and is inside Hivernage.
    expect((await suggestPlaces("ag")).map((p) => p.slug)).toEqual(["agafay", "agdal", "hivernage"]);
    expect(await suggestPlaces("maroc")).toHaveLength(8);
    expect(await suggestPlaces("")).toHaveLength(8);
  });
  it("resolves URL segments by slug or name", async () => {
    expect((await findPlace("ourika"))?.name).toBe("Route de l'Ourika");
    expect((await findPlace("Route de l'Ourika"))?.slug).toBe("ourika");
    expect((await findPlace("route-de-l-ourika"))?.slug).toBe("ourika");
    expect((await findPlace("Guéliz"))?.slug).toBe("gueliz");
    expect(await findPlace("atlantide")).toBeNull();
  });
});

describe("searchHomes", () => {
  it("returns nothing for unknown places and everything for 'partout'", async () => {
    expect((await searchHomes(org, "atlantide", parseSearchQuery({}))).total).toBe(0);
    const all = await searchHomes(org, "partout", parseSearchQuery({}));
    expect(all.total).toBe(await db.listing.count({ where: { organizationId: org, category: "HOME" } }));
    expect(all.cards).toHaveLength(PAGE_SIZE);
  });

  it("filters by guests and pets", async () => {
    const big = await searchHomes(org, "palmeraie", parseSearchQuery({ adults: "6" }));
    const maxGuests = await db.listing.findMany({ where: { id: { in: big.cards.map((c) => c.id) } }, select: { maxGuests: true } });
    expect(maxGuests.every((l) => l.maxGuests >= 6)).toBe(true);
    const pets = await searchHomes(org, "partout", parseSearchQuery({ adults: "1", pets: "1" }));
    const withPets = await db.listing.count({ where: { organizationId: org, category: "HOME", amenities: { some: { amenityId: "animaux" } } } });
    expect(pets.total).toBe(withPets);
  });

  it("hides homes booked on the requested dates", async () => {
    const booking = await db.booking.findFirstOrThrow({ where: { organizationId: org, status: "CONFIRMED" }, include: { listing: { include: { place: true } } } });
    const checkin = booking.checkIn.toISOString().slice(0, 10);
    const checkout = booking.checkOut.toISOString().slice(0, 10);
    const during = await searchHomes(org, booking.listing.place.slug, parseSearchQuery({ checkin, checkout }));
    expect(during.cards.map((c) => c.id)).not.toContain(booking.listingId);
    const later = await searchHomes(org, booking.listing.place.slug, parseSearchQuery({ checkin: day(300), checkout: day(302) }));
    expect(later.cards.map((c) => c.id)).toContain(booking.listingId);
  });

  it("puts the pinned home first and never repeats it on later pages", async () => {
    const last = await db.listing.findFirstOrThrow({ where: { organizationId: org, category: "HOME" }, orderBy: { id: "desc" } });
    const q = parseSearchQuery({ pinned: last.id });
    const p1 = await searchHomes(org, "partout", q, 1);
    expect(p1.cards[0]).toMatchObject({ id: last.id, pinned: true });
    const seen = new Set<string>();
    for (let page = 1; page <= p1.pageCount; page++) {
      for (const c of (await searchHomes(org, "partout", q, page)).cards) {
        expect(seen.has(c.id)).toBe(false);
        seen.add(c.id);
      }
    }
    expect(seen.size).toBe(p1.total);
  });

  it("prices whole stays when dates are given", async () => {
    const r = await searchHomes(org, "gueliz", parseSearchQuery({ checkin: day(200), checkout: day(203) }));
    expect(r.nights).toBe(3);
    expect(r.cards[0].priceSuffix).toBe("pour 3 nuits");
  });
});

describe("homeSections", () => {
  it("only advertises homes that are free on the advertised weekend", async () => {
    const sections = await homeSections(org, "all", Date.now());
    const rows = sections.filter((s) => s.kind === "listings");
    expect(rows.length).toBeGreaterThan(2);
    expect(sections.slice(0, 2)).toMatchObject([
      { kind: "destinations", title: "Quartiers de Marrakech" },
      { kind: "services", title: "Services de conciergerie Sigma" },
    ]);
    expect(rows.map((s) => s.title)).toEqual(expect.arrayContaining(["Logements populaires · Hivernage", "Villas avec piscine · Palmeraie", "Activités populaires · Marrakech"]));
    // Prices in dirhams: "1 392 MAD", never euros.
    for (const s of rows) if (s.kind === "listings") for (const c of s.cards) expect(c.price).toMatch(/\u00a0MAD$/);
  });
});

describe("cardsByIds", () => {
  it("keeps the requested order and skips unknown ids", async () => {
    const a = await findHome({ place: "gueliz" });
    const b = await findHome({ place: "medina" });
    expect((await cardsByIds(org, [b.id, "nope", a.id])).map((c) => c.id)).toEqual([b.id, a.id]);
  });
});

describe("homeSections per tab", () => {
  it("homes, experiences and services tabs have their own rows", async () => {
    const [homes, experiences, services] = await Promise.all(
      (["homes", "experiences", "services"] as const).map((c) => homeSections(org, c, Date.now())),
    );
    expect(homes.every((s) => s.kind === "listings" && s.cards.length > 0)).toBe(true);
    const hotels = homes.find((s) => s.title === "Hôtels et chambres · Marrakech");
    expect(hotels?.kind === "listings" && hotels.cards.length).toBeGreaterThan(0);
    if (hotels?.kind === "listings") expect(hotels.cards.every((c) => /^(Hôtel|Chambre) ·/.test(c.title))).toBe(true);
    const villas = homes.find((s) => s.title === "Villas avec piscine · Palmeraie");
    expect(villas?.kind === "listings" && villas.cards.length).toBeGreaterThan(0);
    if (villas?.kind === "listings") expect(villas.cards.every((c) => c.title === "Villa · Palmeraie")).toBe(true);
    expect(experiences.map((s) => s.kind)).toEqual(["listings", "listings"]);
    expect(experiences.flatMap((s) => (s.kind === "listings" ? s.cards : [])).every((c) => c.priceSuffix === "par personne" && /^Dès \d[\d\u202f]*\u00a0MAD$/.test(c.price))).toBe(true);
    expect(services.map((s) => s.kind)).toEqual(["services", "destinations"]);
  });
});

describe("listing detail and calendar", () => {
  it("returns the full listing, or null", async () => {
    const home = await findHome({ place: "hivernage" });
    const l = await getListing(org, home.id);
    expect(l).toMatchObject({ id: home.id, place: { slug: "hivernage" } });
    expect(l!.photos.length).toBeGreaterThan(0);
    expect(l!.reviews.length).toBeLessThanOrEqual(6);
    expect(await getListing(org, "missing")).toBeNull();
  });

  it("lists booked ranges inside the window only", async () => {
    // A seeded stay (demo guest), never one written by another test file: those can sit back to back with others.
    const b = await db.booking.findFirstOrThrow({
      where: { organizationId: org, status: "CONFIRMED", source: "DIRECT", guest: { email: { endsWith: "@demo.sigma.test" } } },
      orderBy: { id: "asc" },
    });
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const inside = await bookedRanges(org, b.listingId, new Date(b.checkIn.getTime() - 86_400_000), new Date(b.checkOut.getTime() + 86_400_000));
    expect(inside).toContainEqual({ checkIn: iso(b.checkIn), checkOut: iso(b.checkOut) });
    // A window that ends on the check-in day doesn't overlap (checkout exclusive).
    expect(await bookedRanges(org, b.listingId, new Date(b.checkIn.getTime() - 5 * 86_400_000), b.checkIn)).toEqual([]);
  });
});

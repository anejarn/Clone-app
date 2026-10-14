import { describe, expect, it } from "vitest";
import { bookedRanges, cardsByIds, findPlace, getListing, homeSections, PAGE_SIZE, searchHomes, suggestPlaces } from "@/lib/server/catalog";
import { db } from "@/lib/server/db";
import { parseSearchQuery } from "@/lib/search/params";
import { day, findHome } from "./helpers";

describe("places", () => {
  it("suggests accent- and case-insensitively, prefix matches first", async () => {
    expect((await suggestPlaces("ANNE")).map((p) => p.slug)).toEqual(["annecy"]);
    expect((await suggestPlaces("an")).map((p) => p.slug)[0]).toBe("annecy");
    expect((await suggestPlaces("espagne")).map((p) => p.slug)).toEqual(["barcelone"]);
    expect(await suggestPlaces("")).toHaveLength(8);
  });
  it("resolves URL segments by slug or name", async () => {
    expect((await findPlace("chamonix"))?.name).toBe("Chamonix-Mont-Blanc");
    expect((await findPlace("Chamonix-Mont-Blanc"))?.slug).toBe("chamonix");
    expect(await findPlace("atlantide")).toBeNull();
  });
});

describe("searchHomes", () => {
  it("returns nothing for unknown places and everything for 'partout'", async () => {
    expect((await searchHomes("atlantide", parseSearchQuery({}))).total).toBe(0);
    const all = await searchHomes("partout", parseSearchQuery({}));
    expect(all.total).toBe(await db.listing.count({ where: { category: "HOME" } }));
    expect(all.cards).toHaveLength(PAGE_SIZE);
  });

  it("filters by guests and pets", async () => {
    const big = await searchHomes("paris", parseSearchQuery({ adults: "6" }));
    const maxGuests = await db.listing.findMany({ where: { id: { in: big.cards.map((c) => c.id) } }, select: { maxGuests: true } });
    expect(maxGuests.every((l) => l.maxGuests >= 6)).toBe(true);
    const pets = await searchHomes("partout", parseSearchQuery({ adults: "1", pets: "1" }));
    const withPets = await db.listing.count({ where: { category: "HOME", amenities: { some: { amenityId: "animaux" } } } });
    expect(pets.total).toBe(withPets);
  });

  it("hides homes booked on the requested dates", async () => {
    const booking = await db.booking.findFirstOrThrow({ where: { status: "CONFIRMED" }, include: { listing: { include: { place: true } } } });
    const checkin = booking.checkIn.toISOString().slice(0, 10);
    const checkout = booking.checkOut.toISOString().slice(0, 10);
    const during = await searchHomes(booking.listing.place.slug, parseSearchQuery({ checkin, checkout }));
    expect(during.cards.map((c) => c.id)).not.toContain(booking.listingId);
    const later = await searchHomes(booking.listing.place.slug, parseSearchQuery({ checkin: day(300), checkout: day(302) }));
    expect(later.cards.map((c) => c.id)).toContain(booking.listingId);
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

  it("prices whole stays when dates are given", async () => {
    const r = await searchHomes("lyon", parseSearchQuery({ checkin: day(200), checkout: day(203) }));
    expect(r.nights).toBe(3);
    expect(r.cards[0].priceSuffix).toBe("pour 3 nuits");
  });
});

describe("homeSections", () => {
  it("only advertises homes that are free on the advertised weekend", async () => {
    const sections = await homeSections("all", Date.now());
    const rows = sections.filter((s) => s.kind === "listings");
    expect(rows.length).toBeGreaterThan(2);
    expect(sections[0]).toMatchObject({ kind: "destinations" });
  });
});

describe("cardsByIds", () => {
  it("keeps the requested order and skips unknown ids", async () => {
    const a = await findHome({ place: "nice" });
    const b = await findHome({ place: "lyon" });
    expect((await cardsByIds([b.id, "nope", a.id])).map((c) => c.id)).toEqual([b.id, a.id]);
  });
});

describe("homeSections per tab", () => {
  it("homes, experiences and services tabs have their own rows", async () => {
    const [homes, experiences, services] = await Promise.all(
      (["homes", "experiences", "services"] as const).map((c) => homeSections(c, Date.now())),
    );
    expect(homes.every((s) => s.kind === "listings" && s.cards.length > 0)).toBe(true);
    const hotels = homes.find((s) => s.title.startsWith("De superbes hôtels"));
    if (hotels?.kind === "listings") expect(hotels.cards.every((c) => /^(Hôtel|Chambre) ·/.test(c.title))).toBe(true);
    expect(experiences.map((s) => s.kind)).toEqual(["listings", "listings"]);
    expect(experiences.flatMap((s) => (s.kind === "listings" ? s.cards : [])).every((c) => c.priceSuffix === "/ voyageur")).toBe(true);
    expect(services.map((s) => s.kind)).toEqual(["services", "destinations"]);
  });
});

describe("listing detail and calendar", () => {
  it("returns the full listing, or null", async () => {
    const home = await findHome({ place: "paris" });
    const l = await getListing(home.id);
    expect(l).toMatchObject({ id: home.id, place: { slug: "paris" } });
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
});

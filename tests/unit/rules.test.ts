import { describe, expect, it } from "vitest";
import { minFor, stepGuests } from "@/components/search/GuestsPicker";
import { Check } from "lucide-react";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import { amenityIcon } from "@/components/room/Amenities";
import { SKI_IN_MAX_M } from "@/lib/labels";
import { nightsBetween, priceStay } from "@/lib/pricing";
import { isRegistrationNumber } from "@/lib/registration";
import { TOURIST_TAX_GRIDS } from "@/lib/tourist-tax";
import { emptyGuests } from "@/lib/search/params";
import { AMENITIES, buildBookings, buildFixtures, LISTINGS_PER_PLACE, PLACES } from "../../prisma/fixtures";

describe("pricing", () => {
  it("counts nights between UTC dates", () => {
    expect(nightsBetween(new Date("2026-10-22T00:00:00Z"), new Date("2026-10-24T00:00:00Z"))).toBe(2);
  });
  it("charges guests no service fee: stay + cleaning + taxe de séjour", () => {
    // Orcières 2★: €0.99 per adult per night.
    const { guest } = priceStay({ nightlyCents: 10_000, cleaningFeeCents: 5_000, nights: 2, checkIn: "2027-02-06", inseeCode: "05096", stars: 2, isFoundingHost: false, adults: 2 });
    expect(guest.totalCents).toBe(20_000 + 5_000 + 99 * 2 * 2);
    expect(priceStay({ nightlyCents: 10_000, cleaningFeeCents: 5_000, nights: 0, checkIn: "2027-02-06", inseeCode: "05096", stars: 2, isFoundingHost: false, adults: 2 }).guest.totalCents).toBe(0);
  });
  it("breaks down into lines that always sum to the total", () => {
    for (const [price, nights, cleaning] of [[12_345, 3, 4_567], [9_999, 1, 0], [33_300, 7, 7_100]]) {
      const b = priceStay({ nightlyCents: price, cleaningFeeCents: cleaning, nights, checkIn: "2027-02-06", inseeCode: "05098", stars: null, isFoundingHost: false, adults: 2, children: 1 }).guest;
      expect(b.stayCents + b.cleaningFeeCents + b.touristTaxCents).toBe(b.totalCents);
    }
  });
});

describe("guest stepper rules", () => {
  it("adds an adult when the first child is added", () => {
    expect(stepGuests(emptyGuests, "children", 1)).toMatchObject({ adults: 1, children: 1 });
  });
  it("keeps one adult while others travel", () => {
    expect(minFor({ adults: 1, children: 0, infants: 1, pets: 0 }, "adults")).toBe(1);
    expect(minFor({ adults: 1, children: 0, infants: 0, pets: 0 }, "adults")).toBe(0);
  });
  it("caps adults + children at a listing's capacity and keeps an adult on bookings", () => {
    const four = { adults: 2, children: 2, infants: 0, pets: 0 };
    expect(stepGuests(four, "children", 1, 4)).toBe(four);
    expect(stepGuests(four, "infants", 1, 4).infants).toBe(1);
    expect(stepGuests(four, "children", -1, 4).children).toBe(1);
    expect(minFor({ adults: 1, children: 0, infants: 0, pets: 0 }, "adults", 1)).toBe(1);
  });
  it("caps adults + children at 16", () => {
    const full = { adults: 10, children: 6, infants: 0, pets: 0 };
    expect(stepGuests(full, "adults", 1)).toBe(full);
    expect(stepGuests(full, "infants", 1).infants).toBe(1);
  });
});

describe("fixtures", () => {
  const f = buildFixtures();
  const inseeOf = new Map(f.places.map((p) => [p.slug, p.inseeCode]));

  it("are deterministic", () => {
    expect(buildFixtures()).toEqual(f);
    expect(f.listings[0]).toMatchObject({ id: "1000", placeSlug: "orcieres-merlette", category: "HOME" });
  });

  it("are the two launch resorts, each with a taxe de séjour grid", () => {
    expect(f.places.map((p) => [p.slug, p.name, p.inseeCode, p.altitudeM, p.timezone, p.country])).toEqual([
      ["orcieres-merlette", "Orcières-Merlette 1850", "05096", 1850, "Europe/Paris", "France"],
      ["les-orres", "Les Orres", "05098", 1650, "Europe/Paris", "France"],
    ]);
    for (const p of f.places) expect(TOURIST_TAX_GRIDS[p.inseeCode], p.slug).toBeDefined();
  });

  it("are well-formed homes", () => {
    expect(f.places).toHaveLength(PLACES.length);
    expect(f.listings).toHaveLength(PLACES.length * LISTINGS_PER_PLACE);
    expect(new Set(f.listings.map((l) => l.id)).size).toBe(f.listings.length);
    const hostIds = new Set(f.hosts.map((h) => h.id));
    for (const l of f.listings) {
      expect(l.category).toBe("HOME");
      expect(["APARTMENT", "STUDIO", "CHALET"]).toContain(l.propertyType);
      const [min, max] = { STUDIO: [2, 4], APARTMENT: [4, 8], CHALET: [6, 10] }[l.propertyType as "STUDIO" | "APARTMENT" | "CHALET"];
      expect(l.maxGuests, l.id).toBeGreaterThanOrEqual(min);
      expect(l.maxGuests, l.id).toBeLessThanOrEqual(max);
      expect(l.priceCents).toBeGreaterThanOrEqual(7_000);
      expect(l.priceCents).toBeLessThanOrEqual(26_000);
      expect(l.cleaningFeeCents).toBeGreaterThanOrEqual(3_000);
      expect(l.cleaningFeeCents).toBeLessThanOrEqual(9_000);
      expect(hostIds.has(l.hostId)).toBe(true);
      expect([2, 3]).toContain(l.minNights);
      expect(l.liftDistanceM).toBeGreaterThanOrEqual(0);
      expect(l.liftDistanceM).toBeLessThanOrEqual(1200);
      expect(l.stars === null || [1, 2, 3, 4, 5].includes(l.stars)).toBe(true);
      expect(l.dpeClass === null || "ABCDEFG".includes(l.dpeClass)).toBe(true);
    }
    for (const r of f.reviews) expect(r.rating).toBeGreaterThanOrEqual(1);
  });

  it("have valid, unique registration numbers from their own commune", () => {
    expect(new Set(f.listings.map((l) => l.registrationNumber)).size).toBe(f.listings.length);
    for (const l of f.listings) {
      expect(isRegistrationNumber(l.registrationNumber), l.registrationNumber).toBe(true);
      expect(l.registrationNumber.slice(0, 5)).toBe(inseeOf.get(l.placeSlug));
    }
  });

  it("are mostly classified 2★–3★, with about a third founding hosts", () => {
    const classified = f.listings.filter((l) => l.stars !== null);
    expect(classified.length / f.listings.length).toBeGreaterThan(0.45);
    expect(classified.length / f.listings.length).toBeLessThan(0.75);
    expect(classified.filter((l) => l.stars === 2 || l.stars === 3).length / classified.length).toBeGreaterThan(0.5);
    const founding = f.hosts.filter((h) => h.isFoundingHost).length / f.hosts.length;
    expect(founding).toBeGreaterThan(0.25);
    expect(founding).toBeLessThan(0.42);
  });

  it("use mountain amenities whose icons exist", () => {
    const ids = AMENITIES.map(([id]) => id);
    expect(ids).toEqual(expect.arrayContaining(["casier-a-skis", "ski-aux-pieds", "chauffage", "vue-montagne", "animaux"]));
    for (const dropped of ["vue-mer", "piscine", "climatisation"]) expect(ids).not.toContain(dropped);
    for (const [, , icon] of AMENITIES) {
      expect(Object.keys(dynamicIconImports), icon).toContain(icon);
      // The listing page imports each icon by name: none may fall back to the default check mark.
      expect(amenityIcon(icon), icon).not.toBe(Check);
    }
    for (const l of f.listings) {
      for (const a of l.amenities) expect(ids).toContain(a);
      // "Ski aux pieds" exactly when the nearest lift is within SKI_IN_MAX_M.
      expect(l.amenities.includes("ski-aux-pieds"), l.id).toBe(l.liftDistanceM <= SKI_IN_MAX_M);
      if (l.title.includes("au pied des pistes")) expect(l.liftDistanceM).toBeLessThanOrEqual(SKI_IN_MAX_M);
    }
    expect(f.listings.some((l) => l.liftDistanceM <= SKI_IN_MAX_M)).toBe(true);
  });

  it("seed at most one future stay per home, never shorter than its minimum", () => {
    const today = new Date("2026-10-12T00:00:00Z");
    const bookings = buildBookings(f.listings, f.guests, today);
    const byId = new Map(f.listings.map((l) => [l.id, l]));
    expect(new Set(bookings.map((b) => b.listingId)).size).toBe(bookings.length);
    for (const b of bookings) {
      expect(b.checkIn > today).toBe(true);
      expect(nightsBetween(b.checkIn, b.checkOut)).toBeGreaterThanOrEqual(byId.get(b.listingId)!.minNights);
    }
  });
});

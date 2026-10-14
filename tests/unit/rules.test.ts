import { describe, expect, it } from "vitest";
import { minFor, stepGuests } from "@/components/search/GuestsPicker";
import { nightsBetween, priceBreakdown, stayTotal } from "@/lib/pricing";
import { emptyGuests } from "@/lib/search/params";
import { buildBookings, buildFixtures, PLACES } from "../../prisma/fixtures";

describe("pricing", () => {
  it("counts nights between UTC dates", () => {
    expect(nightsBetween(new Date("2026-10-22T00:00:00Z"), new Date("2026-10-24T00:00:00Z"))).toBe(2);
  });
  it("adds cleaning and a 14% service fee", () => {
    expect(stayTotal(10_000, 2, 5_000)).toBe(28_500);
    expect(stayTotal(10_000, 0, 5_000)).toBe(0);
  });
  it("breaks down into lines that always sum to the total", () => {
    for (const [price, nights, cleaning] of [[12_345, 3, 4_567], [9_999, 1, 0], [33_300, 7, 7_100]]) {
      const b = priceBreakdown(price, nights, cleaning);
      expect(b.stayCents + b.cleaningFeeCents + b.serviceFeeCents).toBe(b.totalCents);
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
  it("caps adults + children at 16", () => {
    const full = { adults: 10, children: 6, infants: 0, pets: 0 };
    expect(stepGuests(full, "adults", 1)).toBe(full);
    expect(stepGuests(full, "infants", 1).infants).toBe(1);
  });
});

describe("fixtures", () => {
  const f = buildFixtures();
  it("are deterministic", () => {
    expect(buildFixtures()).toEqual(f);
    expect(f.listings[0]).toMatchObject({ id: "1000", placeSlug: "paris", category: "HOME" });
  });
  it("are well-formed", () => {
    expect(f.places).toHaveLength(PLACES.length);
    expect(f.listings).toHaveLength(PLACES.length * 15);
    expect(new Set(f.listings.map((l) => l.id)).size).toBe(f.listings.length);
    const hostIds = new Set(f.hosts.map((h) => h.id));
    for (const l of f.listings) {
      expect(l.priceCents).toBeGreaterThan(0);
      expect(l.maxGuests).toBeGreaterThanOrEqual(1);
      expect(hostIds.has(l.hostId)).toBe(true);
      expect(l.category === "HOME" ? l.propertyType : null).toBe(l.propertyType);
    }
    for (const r of f.reviews) expect(r.rating).toBeGreaterThanOrEqual(1);
  });
  it("seed at most one future stay per home", () => {
    const today = new Date("2026-10-12T00:00:00Z");
    const bookings = buildBookings(f.listings, f.guests, today);
    expect(new Set(bookings.map((b) => b.listingId)).size).toBe(bookings.length);
    for (const b of bookings) {
      expect(b.checkIn > today).toBe(true);
      expect(b.checkOut > b.checkIn).toBe(true);
    }
  });
});

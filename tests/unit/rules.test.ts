import { describe, expect, it } from "vitest";
import { minFor, stepGuests } from "@/components/search/GuestsPicker";
import { listings, places } from "@/lib/data/seed";
import { nightsBetween, stayTotal } from "@/lib/pricing";
import { emptyGuests } from "@/lib/search/params";
import { matchPlaces } from "@/lib/search/useSearchDraft";

describe("pricing", () => {
  it("counts nights between UTC dates", () => {
    expect(nightsBetween(new Date("2026-10-22T00:00:00Z"), new Date("2026-10-24T00:00:00Z"))).toBe(2);
  });
  it("adds cleaning and a 14% service fee", () => {
    expect(stayTotal(10_000, 2, 5_000)).toBe(28_500);
    expect(stayTotal(10_000, 0, 5_000)).toBe(0);
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

describe("seed data", () => {
  it("is deterministic and well-formed", () => {
    expect(listings.length).toBe(places.length * 15);
    expect(new Set(listings.map((l) => l.id)).size).toBe(listings.length);
    for (const l of listings) {
      expect(l.price).toBeGreaterThan(0);
      expect(l.photos.length).toBeGreaterThan(0);
      if (l.rating !== null) expect(l.rating).toBeLessThanOrEqual(5);
    }
    expect(listings[0]).toMatchObject({ id: "1000", placeSlug: "paris" });
  });
  it("matches destinations accent- and case-insensitively", () => {
    expect(matchPlaces(places, "ANNE").map((p) => p.slug)).toEqual(["annecy"]);
    expect(matchPlaces(places, "espagne").map((p) => p.slug)).toEqual(["barcelone"]);
    expect(matchPlaces(places, "")).toHaveLength(places.length);
  });
});

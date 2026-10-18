import { describe, expect, it } from "vitest";
import { minFor, stepGuests } from "@/components/search/GuestsPicker";
import { nightsBetween, priceBreakdown, SERVICE_FEE_RATE, stayTotal } from "@/lib/pricing";
import { emptyGuests } from "@/lib/search/params";
import { buildBookings, buildFixtures, buildLicenses, buildPriceRules, OWNERS, PLACES } from "../../prisma/fixtures";

describe("pricing", () => {
  it("counts nights between UTC dates", () => {
    expect(nightsBetween(new Date("2026-10-22T00:00:00Z"), new Date("2026-10-24T00:00:00Z"))).toBe(2);
  });
  it("charges guests no service fee: Sigma is not a marketplace", () => {
    expect(SERVICE_FEE_RATE).toBe(0);
    // 2 nights at 1 000 MAD + 500 MAD cleaning, in centimes.
    expect(stayTotal(100_000, 2, 50_000)).toBe(250_000);
    expect(priceBreakdown(100_000, 2, 50_000)).toEqual({ nights: 2, stayCents: 200_000, cleaningFeeCents: 50_000, serviceFeeCents: 0, totalCents: 250_000 });
    expect(stayTotal(100_000, 0, 50_000)).toBe(0);
  });
  it("breaks down into lines that always sum to the total, at Sigma's rate and at any other", () => {
    for (const rate of [SERVICE_FEE_RATE, 0.14, 0.035, 1 / 3]) {
      for (const [price, nights, cleaning] of [[123_457, 3, 45_671], [99_999, 1, 0], [333_001, 7, 7_133], [1, 1, 1]]) {
        const b = priceBreakdown(price, nights, cleaning, rate);
        expect(Number.isInteger(b.serviceFeeCents) && Number.isInteger(b.totalCents)).toBe(true);
        expect(b.stayCents).toBe(price * nights);
        expect(b.stayCents + b.cleaningFeeCents + b.serviceFeeCents).toBe(b.totalCents);
      }
    }
  });
  it("rounds a fee to the nearest centime", () => {
    // 14 % of 10 001 centimes is 1 400.14: 1 400; of 10 004 it is 1 400.56: 1 401.
    expect(priceBreakdown(10_001, 1, 0, 0.14).serviceFeeCents).toBe(1_400);
    expect(priceBreakdown(10_004, 1, 0, 0.14).serviceFeeCents).toBe(1_401);
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
    expect(f.listings[0]).toMatchObject({ id: "1000", placeSlug: "hivernage", category: "HOME" });
  });
  it("are well-formed", () => {
    expect(f.places).toHaveLength(PLACES.length);
    expect(f.listings).toHaveLength(PLACES.length * 15);
    expect(new Set(f.listings.map((l) => l.id)).size).toBe(f.listings.length);
    const ownerIds = new Set(f.owners.map((h) => h.id));
    for (const l of f.listings) {
      expect(l.priceCents).toBeGreaterThan(0);
      expect(l.maxGuests).toBeGreaterThanOrEqual(1);
      expect(ownerIds.has(l.ownerId)).toBe(true);
      expect(l.minNights).toBeGreaterThanOrEqual(1);
      expect(l.minNights).toBeLessThanOrEqual(3);
      expect(l.address).toMatch(/Marrakech$/);
      expect(l.category === "HOME" ? l.propertyType : null).toBe(l.propertyType);
    }
    for (const r of f.reviews) expect(r.rating).toBeGreaterThanOrEqual(1);
  });
  it("give Sigma three associés (ADMIN), two agents and 6 to 8 owners; everyone else is a guest", () => {
    expect(f.staff.filter((u) => u.role === "ADMIN").map((u) => u.name)).toEqual(["Amine", "Felicia", "Othman"]);
    expect(f.staff.filter((u) => u.role === "AGENT")).toHaveLength(2);
    expect(f.owners.length).toBeGreaterThanOrEqual(6);
    expect(f.owners.length).toBeLessThanOrEqual(8);
    expect(f.owners.every((u) => u.role === "OWNER")).toBe(true);
    expect(f.guests.every((u) => u.role === "GUEST")).toBe(true);
    const emails = [...f.staff, ...f.owners, ...f.guests].map((u) => u.email);
    expect(new Set(emails).size).toBe(emails.length);
  });
  it("are Marrakech neighbourhoods, in Morocco's time zone, with demo e-mails that can never be delivered", () => {
    expect(f.places.map((p) => p.name)).toEqual(
      ["Hivernage", "Guéliz", "Médina", "Palmeraie", "Agdal", "Targa", "Route de l'Ourika", "Agafay", "Semlalia", "Ménara"],
    );
    expect(f.places.every((p) => p.timezone === "Africa/Casablanca" && p.country === "Maroc")).toBe(true);
    // Around Marrakech (31.63 N, 8.0 W): Agafay, the farthest, is about 25 km out.
    for (const p of f.places) {
      expect(Math.abs(p.lat - 31.63)).toBeLessThan(0.25);
      expect(Math.abs(p.lng + 8.0)).toBeLessThan(0.25);
    }
    for (const u of [...f.staff, ...f.owners, ...f.guests]) expect(u.email).toMatch(/@demo\.sigma\.test$/);
  });
  it("price in whole dirhams, at Marrakech levels", () => {
    const homes = f.listings.filter((l) => l.category === "HOME");
    for (const l of f.listings) expect(l.priceCents % 1_000).toBe(0); // 10 DH steps, in centimes
    const dh = (l: { priceCents: number }) => l.priceCents / 100;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // In town, about 850 DH a night on average; villas outside town cost more.
    const town = homes.filter((l) => !["palmeraie", "ourika", "agafay"].includes(l.placeSlug));
    expect(mean(town.map(dh))).toBeGreaterThan(650);
    expect(mean(town.map(dh))).toBeLessThan(1_050);
    const villas = homes.filter((l) => l.propertyType === "VILLA" && ["palmeraie", "agafay"].includes(l.placeSlug));
    expect(mean(villas.map(dh))).toBeGreaterThan(2 * mean(town.map(dh)));
    // Hivernage's top tier (loft, house, villa) sits between 3 000 and 4 900 DH a night; Palmeraie and Agafay villas cost more.
    const hivernageTop = homes.filter((l) => l.placeSlug === "hivernage" && ["LOFT", "HOUSE", "VILLA"].includes(l.propertyType!));
    expect(hivernageTop).toHaveLength(3);
    for (const l of hivernageTop) expect(dh(l)).toBeGreaterThanOrEqual(3_000);
    for (const l of hivernageTop) expect(dh(l)).toBeLessThanOrEqual(4_900);
    expect(mean(villas.map(dh))).toBeGreaterThan(mean(hivernageTop.map(dh)));
    // Every villa has a pool (the "Villas avec piscine" row).
    for (const v of homes.filter((l) => l.propertyType === "VILLA")) expect(v.amenities).toContain("piscine");
  });
  it("spread the listings over every owner, with a few sub-lets in town", () => {
    const homes = f.listings.filter((l) => l.category === "HOME");
    for (const o of OWNERS) expect(homes.filter((l) => l.ownerId === o.id).length).toBeGreaterThan(3);
    const sublets = homes.filter((l) => l.managementType === "SUBLEASE");
    expect(sublets.length).toBeGreaterThanOrEqual(3);
    expect(sublets.length).toBeLessThan(homes.length / 5);
    for (const l of sublets) expect(["palmeraie", "ourika", "agafay"]).not.toContain(l.placeSlug);
    expect(f.listings.filter((l) => l.category === "EXPERIENCE").every((l) => l.managementType === "MANAGED")).toBe(true);
  });
  it("have riads in the Médina, which take two nights minimum", () => {
    const riads = f.listings.filter((l) => l.propertyType === "RIAD");
    expect(riads.length).toBeGreaterThanOrEqual(2);
    for (const r of riads) expect(r).toMatchObject({ placeSlug: "medina", minNights: 2, title: expect.stringMatching(/^Riad /) });
    // Villas outside town take three nights; Hivernage and Guéliz (booked by the e2e tests) take one.
    for (const v of f.listings.filter((l) => l.propertyType === "VILLA" && ["palmeraie", "ourika", "agafay"].includes(l.placeSlug))) {
      expect(v.minNights).toBe(3);
    }
    expect(f.listings.filter((l) => ["hivernage", "gueliz"].includes(l.placeSlug)).every((l) => l.minNights === 1)).toBe(true);
    expect(new Set(f.listings.map((l) => l.minNights))).toEqual(new Set([1, 2, 3]));
  });
  it("give homes 80-14 authorisations relative to today: one expired, some expiring within 60 days, a few pending", () => {
    const today = new Date("2026-10-17T00:00:00Z");
    const licenses = buildLicenses(f.listings, today);
    expect(buildLicenses(f.listings, today)).toEqual(licenses);
    expect(licenses).toHaveLength(f.listings.filter((l) => l.category === "HOME").length);
    const daysLeft = (d: Date) => (d.getTime() - today.getTime()) / 86_400_000;
    const issued = licenses.filter((l) => l.licenseExpiresAt);
    expect(issued.filter((l) => daysLeft(l.licenseExpiresAt!) < 0)).toHaveLength(1);
    const soon = issued.filter((l) => daysLeft(l.licenseExpiresAt!) >= 0 && daysLeft(l.licenseExpiresAt!) <= 60);
    expect(soon.length).toBeGreaterThanOrEqual(3);
    const pending = licenses.filter((l) => !l.licenseNumber);
    expect(pending.length).toBeGreaterThan(0);
    for (const l of pending) expect(l.licenseExpiresAt).toBeNull();
    for (const l of issued) expect(l.licenseNumber).toMatch(/^MKH-80\.14-20\d\d-\d{4}$/);
    expect(new Set(issued.map((l) => l.licenseNumber)).size).toBe(issued.length);
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

describe("demo seasons and events (Prix)", () => {
  const { listings } = buildFixtures();
  const rules = buildPriceRules(listings);
  const homes = new Map(listings.filter((l) => l.category === "HOME").map((l) => [l.id, l]));

  it("are for selections of homes only, with values the database accepts", () => {
    for (const r of rules) {
      expect(r.listingIds, r.name).not.toBeNull();
      expect(r.listingIds!.length, r.name).toBeGreaterThan(0);
      expect(r.listingIds!.every((id) => homes.has(id)), r.name).toBe(true);
      expect(r.endDate >= r.startDate).toBe(true);
      if (r.recurring) expect(r.endDate.getTime() - r.startDate.getTime()).toBeLessThan(365 * 86_400_000);
      expect(r.percentBps).toBeGreaterThanOrEqual(-9_000);
      expect(r.percentBps).toBeLessThanOrEqual(50_000);
    }
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
    expect(rules.map((r) => r.name)).toEqual(expect.arrayContaining(["Haute saison de printemps", "Haute saison d'automne", "Fêtes de fin d'année", "Marathon de Marrakech 2027"]));
  });

  it("leave Hivernage and Guéliz without yearly rules or raised minimum stays (the tests book short stays there)", () => {
    for (const r of rules.filter((x) => x.recurring || x.minNights !== null)) {
      expect(r.listingIds!.some((id) => ["hivernage", "gueliz"].includes(homes.get(id)!.placeSlug)), r.name).toBe(false);
    }
  });
});

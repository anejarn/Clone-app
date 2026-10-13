import { describe, expect, it } from "vitest";
import { TOURIST_TAX_GRIDS, touristTax, touristTaxGrid, touristTaxRate } from "@/lib/tourist-tax";

const ORCIERES = "05096";
const LES_ORRES = "05098";

describe("taxe de séjour grids (10 % departmental surcharge included)", () => {
  it.each([
    // commune, stars, cents per adult per night
    [ORCIERES, 1, 88],
    [ORCIERES, 2, 99],
    [ORCIERES, 3, 121],
    [ORCIERES, 4, 132],
    [ORCIERES, 5, 330],
    [LES_ORRES, 1, 88],
    [LES_ORRES, 2, 99],
    [LES_ORRES, 3, 154],
    [LES_ORRES, 4, 209],
    [LES_ORRES, 5, 275],
  ])("%s %i★ → %i cents", (inseeCode, stars, cents) => {
    expect(touristTaxRate({ inseeCode, stars, nightlyCents: 15_000, adults: 2 })).toBe(cents);
    // Per adult per night, whatever the price.
    expect(touristTax({ inseeCode, stars, nightlyCents: 99_000, nights: 3, adults: 2 }).totalCents).toBe(cents * 2 * 3);
  });

  it("caps unclassified homes at the commune's highest rate", () => {
    expect(touristTaxGrid(ORCIERES)).toMatchObject({ unclassifiedBps: 550, unclassifiedCapCents: 440 });
    expect(touristTaxGrid(LES_ORRES)).toMatchObject({ unclassifiedBps: 550, unclassifiedCapCents: 308 });
    // €260 for one adult: 5.5 % = €14.30, capped.
    expect(touristTaxRate({ inseeCode: ORCIERES, stars: null, nightlyCents: 26_000, adults: 1 })).toBe(440);
    expect(touristTaxRate({ inseeCode: LES_ORRES, stars: null, nightlyCents: 26_000, adults: 1 })).toBe(308);
    // Just under the cap: €80 / 1 × 5.5 % = €4.40 (Orcières); €56 / 1 × 5.5 % = €3.08 (Les Orres).
    expect(touristTaxRate({ inseeCode: ORCIERES, stars: null, nightlyCents: 8_000, adults: 1 })).toBe(440);
    expect(touristTaxRate({ inseeCode: ORCIERES, stars: null, nightlyCents: 7_900, adults: 1 })).toBe(435);
    expect(touristTaxRate({ inseeCode: LES_ORRES, stars: null, nightlyCents: 5_600, adults: 1 })).toBe(308);
  });

  it("splits the nightly cost between all occupants, but only adults pay", () => {
    // €120 a night, 2 adults + 1 child + 1 infant: €30 per occupant × 5.5 % = €1.65, paid by 2 adults.
    const t = touristTax({ inseeCode: ORCIERES, stars: null, nightlyCents: 12_000, nights: 4, adults: 2, children: 1, infants: 1 });
    expect(t).toEqual({ perPersonNightCents: 165, liablePersons: 2, totalCents: 165 * 2 * 4 });
    // Same home, adults only: the per-person cost (and so the rate) goes up.
    expect(touristTax({ inseeCode: ORCIERES, stars: null, nightlyCents: 12_000, nights: 4, adults: 2 }).perPersonNightCents).toBe(330);
  });

  it("exempts minors in classified homes too", () => {
    const t = touristTax({ inseeCode: LES_ORRES, stars: 3, nightlyCents: 20_000, nights: 7, adults: 2, children: 3, infants: 1 });
    expect(t).toEqual({ perPersonNightCents: 154, liablePersons: 2, totalCents: 154 * 2 * 7 });
  });

  it("rounds the proportional rate to the nearest cent, half up, exactly", () => {
    // €91 / 3 × 5.5 % = 166.83… cents → 167
    expect(touristTaxRate({ inseeCode: ORCIERES, stars: null, nightlyCents: 9_100, adults: 3 })).toBe(167);
    // Exact halves: 100 × 5.5 % = 5.5 → 6; 300 / 3 × 5.5 % = 5.5 → 6; 300 × 5.5 % = 16.5 → 17
    expect(touristTaxRate({ inseeCode: ORCIERES, stars: null, nightlyCents: 100, adults: 1 })).toBe(6);
    expect(touristTaxRate({ inseeCode: ORCIERES, stars: null, nightlyCents: 300, adults: 1, children: 2 })).toBe(6);
    expect(touristTaxRate({ inseeCode: ORCIERES, stars: null, nightlyCents: 300, adults: 1 })).toBe(17);
  });

  it("is always whole cents", () => {
    for (let nightly = 7_000; nightly <= 26_000; nightly += 137) {
      for (const [adults, children, infants] of [[1, 0, 0], [2, 1, 0], [3, 2, 1], [4, 4, 2]]) {
        for (const inseeCode of [ORCIERES, LES_ORRES]) {
          const t = touristTax({ inseeCode, stars: null, nightlyCents: nightly, nights: 5, adults, children, infants });
          expect(Number.isInteger(t.totalCents)).toBe(true);
          expect(t.totalCents).toBe(t.perPersonNightCents * adults * 5);
        }
      }
    }
  });

  it("refuses unknown communes and impossible star ratings", () => {
    expect(() => touristTax({ inseeCode: "75056", stars: 2, nightlyCents: 10_000, nights: 2, adults: 2 })).toThrow(/75056/);
    expect(() => touristTaxRate({ inseeCode: ORCIERES, stars: 6, nightlyCents: 10_000, adults: 2 })).toThrow(RangeError);
    expect(() => touristTaxRate({ inseeCode: ORCIERES, stars: 0, nightlyCents: 10_000, adults: 2 })).toThrow(RangeError);
  });

  it("keeps each grid's source", () => {
    for (const grid of Object.values(TOURIST_TAX_GRIDS)) {
      expect(grid.sources.length).toBeGreaterThan(0);
      expect(grid.validity).not.toBe("");
    }
    expect(TOURIST_TAX_GRIDS[ORCIERES].sources[0]).toBe("https://orcieres.taxesejour.fr/portail/document/27925991/download");
  });
});

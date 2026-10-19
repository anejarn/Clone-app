import { describe, expect, it } from "vitest";
import { assertPricePair, lineTotals, marginBps, marginOf, MAX_TOTAL_CENTS, multiplierOf, sumMargins, type LineInput } from "@/lib/concierge/pricing";
import { PRICING_MODELS } from "@/lib/concierge/catalog";

/** Conciergerie money (Lot 4b): line totals per pricing model, options, margin and its rate. Mandatory per CLAUDE.md. */

const line = (over: Partial<LineInput> = {}): LineInput => ({ pricingModel: "PER_UNIT", unitSaleCents: 25_000, unitPartnerCents: 18_000, quantity: 1, persons: 1, options: [], ...over });

describe("multiplierOf", () => {
  it("counts persons per person, the quantity for every other model", () => {
    expect(multiplierOf("PER_PERSON", 1, 4)).toBe(4);
    for (const m of ["PER_UNIT", "PER_DAY", "PER_TRIP", "ON_QUOTE"] as const) expect(multiplierOf(m, 3, 4)).toBe(3);
  });

  it("refuses counts outside 1–50 and non-integers", () => {
    for (const bad of [0, -1, 51, 1.5, Number.NaN]) {
      expect(() => multiplierOf("PER_UNIT", bad, 1)).toThrow(RangeError);
      expect(() => multiplierOf("PER_PERSON", 1, bad)).toThrow(RangeError);
    }
    expect(multiplierOf("PER_UNIT", 50, 50)).toBe(50);
  });
});

describe("lineTotals", () => {
  it("per unit, per day, per trip: unit price × quantity", () => {
    expect(lineTotals(line({ quantity: 2 }))).toEqual({ multiplier: 2, totals: { saleTotalCents: 50_000, partnerTotalCents: 36_000, marginCents: 14_000 } });
    expect(lineTotals(line({ pricingModel: "PER_DAY", unitSaleCents: 35_000, unitPartnerCents: 28_000, quantity: 5, persons: 3 })).totals).toEqual({ saleTotalCents: 175_000, partnerTotalCents: 140_000, marginCents: 35_000 });
    expect(lineTotals(line({ pricingModel: "PER_TRIP", quantity: 2, persons: 4 })).totals?.saleTotalCents).toBe(50_000);
  });

  it("per person: unit price × persons, whatever the quantity", () => {
    expect(lineTotals(line({ pricingModel: "PER_PERSON", unitSaleCents: 30_000, unitPartnerCents: 22_000, quantity: 1, persons: 3 }))).toEqual({
      multiplier: 3,
      totals: { saleTotalCents: 90_000, partnerTotalCents: 66_000, marginCents: 24_000 },
    });
  });

  it("adds flat options once and per-unit options per count", () => {
    const t = lineTotals(
      line({
        pricingModel: "PER_DAY",
        unitSaleCents: 35_000,
        unitPartnerCents: 28_000,
        quantity: 3,
        options: [
          { saleCents: 3_000, partnerCents: 2_000, perUnit: true }, // baby seat per day
          { saleCents: 10_000, partnerCents: 6_000, perUnit: false }, // delivery once
        ],
      }),
    ).totals!;
    expect(t).toEqual({ saleTotalCents: 105_000 + 9_000 + 10_000, partnerTotalCents: 84_000 + 6_000 + 6_000, marginCents: 28_000 });
    // The margin is always exactly sale − partner.
    expect(t.saleTotalCents - t.partnerTotalCents).toBe(t.marginCents);
  });

  it("keeps centimes exact (no floating point): 19,99 MAD × 3 + 0,01", () => {
    const t = lineTotals(line({ unitSaleCents: 1_999, unitPartnerCents: 1_001, quantity: 3, options: [{ saleCents: 1, partnerCents: 0, perUnit: false }] })).totals!;
    expect(t).toEqual({ saleTotalCents: 5_998, partnerTotalCents: 3_003, marginCents: 2_995 });
  });

  it("free options and a zero margin are allowed", () => {
    expect(lineTotals(line({ unitSaleCents: 18_000, unitPartnerCents: 18_000, options: [{ saleCents: 0, partnerCents: 0, perUnit: true }] })).totals).toEqual({ saleTotalCents: 18_000, partnerTotalCents: 18_000, marginCents: 0 });
    expect(lineTotals(line({ unitSaleCents: 0, unitPartnerCents: 0 })).totals).toEqual({ saleTotalCents: 0, partnerTotalCents: 0, marginCents: 0 });
  });

  it("on quote: no totals, and no unit price allowed", () => {
    expect(lineTotals(line({ pricingModel: "ON_QUOTE", unitSaleCents: null, unitPartnerCents: null, quantity: 2 }))).toEqual({ multiplier: 2, totals: null });
    expect(() => lineTotals(line({ pricingModel: "ON_QUOTE" }))).toThrow(RangeError);
  });

  it("refuses a missing unit price for priced models", () => {
    for (const m of PRICING_MODELS.filter((x) => x !== "ON_QUOTE")) {
      expect(() => lineTotals(line({ pricingModel: m, unitSaleCents: null }))).toThrow(RangeError);
      expect(() => lineTotals(line({ pricingModel: m, unitPartnerCents: null }))).toThrow(RangeError);
    }
  });

  it("refuses a negative margin, negative or fractional amounts, on the unit and on each option", () => {
    expect(() => lineTotals(line({ unitSaleCents: 100, unitPartnerCents: 101 }))).toThrow(/above sale/);
    expect(() => lineTotals(line({ unitSaleCents: -1, unitPartnerCents: 0 }))).toThrow(RangeError);
    expect(() => lineTotals(line({ unitSaleCents: 10.5, unitPartnerCents: 0 }))).toThrow(RangeError);
    expect(() => lineTotals(line({ options: [{ saleCents: 100, partnerCents: 200, perUnit: false }] }))).toThrow(/option 0/);
    expect(() => lineTotals(line({ options: [{ saleCents: -5, partnerCents: 0, perUnit: false }] }))).toThrow(RangeError);
  });

  it("caps the total at 10 000 000 MAD", () => {
    expect(lineTotals(line({ unitSaleCents: 20_000_000, unitPartnerCents: 0, quantity: 50 })).totals?.saleTotalCents).toBe(MAX_TOTAL_CENTS);
    expect(() => lineTotals(line({ unitSaleCents: 20_000_000, unitPartnerCents: 0, quantity: 50, options: [{ saleCents: 1, partnerCents: 0, perUnit: false }] }))).toThrow(/total above/);
    expect(() => lineTotals(line({ unitSaleCents: 100_000_001, unitPartnerCents: 0 }))).toThrow(RangeError);
  });

  it("totals add up whatever the combination (property check on a grid)", () => {
    for (const model of PRICING_MODELS.filter((m) => m !== "ON_QUOTE")) {
      for (const quantity of [1, 2, 7, 50]) {
        for (const persons of [1, 3, 50]) {
          const opts = [
            { saleCents: 1_250, partnerCents: 999, perUnit: true },
            { saleCents: 5_000, partnerCents: 5_000, perUnit: false },
          ];
          const { multiplier, totals } = lineTotals({ pricingModel: model, unitSaleCents: 12_345, unitPartnerCents: 9_876, quantity, persons, options: opts });
          expect(multiplier).toBe(model === "PER_PERSON" ? persons : quantity);
          expect(totals!.saleTotalCents).toBe(12_345 * multiplier + 1_250 * multiplier + 5_000);
          expect(totals!.partnerTotalCents).toBe(9_876 * multiplier + 999 * multiplier + 5_000);
          expect(totals!.marginCents).toBe(totals!.saleTotalCents - totals!.partnerTotalCents);
          expect(totals!.marginCents).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe("marginOf (final price set by the team)", () => {
  it("computes the margin and refuses partner > sale", () => {
    expect(marginOf(120_000, 90_000)).toEqual({ saleTotalCents: 120_000, partnerTotalCents: 90_000, marginCents: 30_000 });
    expect(marginOf(0, 0).marginCents).toBe(0);
    expect(() => marginOf(100, 101)).toThrow(RangeError);
    expect(() => marginOf(MAX_TOTAL_CENTS + 1, 0)).toThrow(RangeError);
  });

  it("assertPricePair checks both amounts", () => {
    expect(() => assertPricePair(null, 0)).toThrow(RangeError);
    expect(() => assertPricePair(10, null)).toThrow(RangeError);
    expect(() => assertPricePair(10, 5)).not.toThrow();
  });
});

describe("marginBps: margin ÷ sale price, rounded half up to 0,01 %", () => {
  it("exact rates", () => {
    expect(marginBps(25_000, 7_000)).toBe(2_800); // 28 %
    expect(marginBps(30_000, 8_000)).toBe(2_667); // 26,666… → 26,67 %
    expect(marginBps(100, 100)).toBe(10_000);
    expect(marginBps(100, 0)).toBe(0);
  });

  it("rounds halves up and the rest to the nearest", () => {
    // 1 / 8 000 = 1,25 bp → 1; 1 / 6 000 = 1,666… → 2; 1 / 20 000 = 0,5 bp → 1 (half up).
    expect(marginBps(8_000, 1)).toBe(1);
    expect(marginBps(6_000, 1)).toBe(2);
    expect(marginBps(20_000, 1)).toBe(1);
    expect(marginBps(40_000, 1)).toBe(0); // 0,25 bp
    expect(marginBps(3, 1)).toBe(3_333);
    expect(marginBps(3, 2)).toBe(6_667);
  });

  it("is null for a free service, and refuses impossible margins", () => {
    expect(marginBps(0, 0)).toBeNull();
    expect(() => marginBps(100, 101)).toThrow(RangeError);
    expect(() => marginBps(100, -1)).toThrow(RangeError);
    expect(() => marginBps(-100, 0)).toThrow(RangeError);
  });

  it("stays exact at the largest totals", () => {
    expect(marginBps(MAX_TOTAL_CENTS, MAX_TOTAL_CENTS / 2)).toBe(5_000);
    expect(marginBps(MAX_TOTAL_CENTS, 333_333_333)).toBe(3_333);
  });
});

describe("sumMargins", () => {
  it("adds the priced requests' margins and skips quotes still pending", () => {
    expect(sumMargins([{ marginCents: 16_000 }, { marginCents: null }, { marginCents: 7_000 }, { marginCents: 0 }])).toBe(23_000);
    expect(sumMargins([])).toBe(0);
    expect(() => sumMargins([{ marginCents: -1 }])).toThrow(RangeError);
  });
});

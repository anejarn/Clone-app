import { describe, expect, it } from "vitest";
import { countLabel, formatDateRange, formatEuros, formatRating } from "@/lib/format";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("formatDateRange", () => {
  it("collapses ranges within one month", () => {
    expect(formatDateRange(d("2027-01-08"), d("2027-01-10"))).toBe("8–10 janv.");
  });
  it("spells out both months across a boundary", () => {
    expect(formatDateRange(d("2026-10-30"), d("2026-11-01"))).toBe("30 oct. – 1 nov.");
  });
});

describe("number formatting", () => {
  it("formats euros without decimals, fr-FR style", () => {
    expect(formatEuros(34_700).replace(/\s/g, " ")).toBe("347 €");
    expect(formatEuros(139_200).replace(/\s/g, " ")).toBe("1 392 €");
  });
  it("keeps one decimal minimum on ratings", () => {
    expect(formatRating(5)).toBe("5,0");
    expect(formatRating(4.92)).toBe("4,92");
  });
  it("words result counts", () => {
    expect(countLabel(1)).toBe("1 logement");
    expect(countLabel(9)).toBe("9 logements");
    expect(countLabel(216)).toBe("Plus de 210 logements");
  });
});

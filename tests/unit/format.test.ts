import { describe, expect, it } from "vitest";
import { countLabel, formatDate, formatDateRange, formatPrice, formatRating, formatStayDates } from "@/lib/format";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const NNBSP = " ";
const NBSP = " ";

describe("formatDateRange (compact labels: search bar and cards)", () => {
  it("collapses ranges within one month", () => {
    expect(formatDateRange(d("2027-01-08"), d("2027-01-10"))).toBe("8–10 janv.");
  });
  it("spells out both months across a boundary", () => {
    expect(formatDateRange(d("2026-10-30"), d("2026-11-01"))).toBe("30 oct. – 1 nov.");
  });
});

describe("full dates, JJ/MM/AAAA", () => {
  it("pads day and month", () => {
    expect(formatDate(d("2027-01-08"))).toBe("08/01/2027");
    expect(formatDate(d("2026-11-24"))).toBe("24/11/2026");
  });
  it("reads the stored UTC calendar day, whatever the process timezone", () => {
    expect(formatDate(new Date("2026-12-31T00:00:00Z"))).toBe("31/12/2026");
  });
  it("words a stay", () => {
    expect(formatStayDates(d("2026-11-24"), d("2026-11-26"))).toBe("Du 24/11/2026 au 26/11/2026");
  });
});

describe("formatPrice: centimes of dirham as whole dirhams", () => {
  it("groups thousands with a narrow no-break space and puts a no-break space before MAD", () => {
    expect(formatPrice(139_200)).toBe(`1${NNBSP}392${NBSP}MAD`);
    expect(formatPrice(34_700)).toBe(`347${NBSP}MAD`);
    expect(formatPrice(0)).toBe(`0${NBSP}MAD`);
    expect(formatPrice(100_000_000)).toBe(`1${NNBSP}000${NNBSP}000${NBSP}MAD`);
  });
  it("rounds to the nearest dirham, halves away from zero", () => {
    expect(formatPrice(34_749)).toBe(`347${NBSP}MAD`);
    expect(formatPrice(34_750)).toBe(`348${NBSP}MAD`);
    expect(formatPrice(99_950)).toBe(`1${NNBSP}000${NBSP}MAD`);
    expect(formatPrice(-34_750)).toBe(`-348${NBSP}MAD`);
    // Less than half a dirham is no amount at all, not "-0".
    expect(formatPrice(-49)).toBe(`0${NBSP}MAD`);
  });
  it("never shows a euro sign or decimals", () => {
    for (const c of [1, 99, 12_345, 987_654_321]) expect(formatPrice(c)).toMatch(/^\d{1,3}( \d{3})* MAD$/);
  });
});

describe("other formatting", () => {
  it("keeps one decimal minimum on ratings", () => {
    expect(formatRating(5)).toBe("5,0");
    expect(formatRating(4.92)).toBe("4,92");
  });
  it("words result counts", () => {
    expect(countLabel(1)).toBe("1 logement");
    expect(countLabel(9)).toBe("9 logements");
    expect(countLabel(20)).toBe("20 logements");
    expect(countLabel(21)).toBe("Plus de 20 logements");
    expect(countLabel(216)).toBe("Plus de 210 logements");
    // Exactly 120 is not "more than 120".
    expect(countLabel(120)).toBe("Plus de 110 logements");
  });
});

import { describe, expect, it } from "vitest";
import { OWNER_BLOCK_STYLE, SOURCE_COLOR, SOURCE_LABEL, SOURCES, sourceStyle } from "@/lib/admin/booking-sources";

/** Calendar colours by source: readable text (WCAG AA), told apart from each other, every source covered. */

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Rough perceptual distance in RGB ("redmean"), enough to catch two near-identical colours. */
function distance(a: string, b: string) {
  const [r1, g1, b1] = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const [r2, g2, b2] = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

describe("source colours", () => {
  it("every source has a label and a style", () => {
    for (const s of SOURCES) {
      expect(SOURCE_LABEL[s]).toBeTruthy();
      expect(sourceStyle(s).background).toBeTruthy();
    }
  });

  it("white text on every bar meets WCAG AA (4.5:1)", () => {
    for (const [s, c] of Object.entries(SOURCE_COLOR)) {
      expect(sourceStyle(s as keyof typeof SOURCE_COLOR)).toEqual({ background: c, color: "#ffffff", border: c });
      expect(contrast(c, "#ffffff"), s).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("direct bookings use Sigma's Majorelle blue; the colours are distinct", () => {
    expect(SOURCE_COLOR.DIRECT).toBe("#3550a8");
    const colors = Object.values(SOURCE_COLOR);
    expect(new Set(colors).size).toBe(colors.length);
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) expect(distance(colors[i], colors[j]), `${colors[i]} vs ${colors[j]}`).toBeGreaterThan(100);
    }
  });

  it("owner blocks are hatched grey with dark text readable on both stripes", () => {
    expect(sourceStyle("OWNER")).toBe(OWNER_BLOCK_STYLE);
    expect(OWNER_BLOCK_STYLE.background).toMatch(/^repeating-linear-gradient/);
    for (const stripe of OWNER_BLOCK_STYLE.background.match(/#[0-9a-f]{6}/g)!) expect(contrast(stripe, OWNER_BLOCK_STYLE.color)).toBeGreaterThanOrEqual(4.5);
  });

  it("labels name the platforms in text only", () => {
    expect(SOURCE_LABEL).toMatchObject({ DIRECT: "Directe", AIRBNB: "Airbnb", BOOKING: "Booking.com", AGODA: "Agoda", TRIPCOM: "Trip.com", EXPEDIA: "Expedia", OWNER: "Blocage propriétaire" });
  });
});

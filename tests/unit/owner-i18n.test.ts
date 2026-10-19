import { describe, expect, it } from "vitest";
import { dirOf, LRI, ltr, ownerAmount, ownerDate, ownerInstantDate, ownerMonth, ownerPercent, PDI } from "@/lib/i18n/bidi";
import { negotiateOwnerLocale, OWNER_LOCALES, ownerMessages } from "@/lib/i18n/owner";

/** The owner portal's languages (Lot 6b): French, Arabic (right to left) and English, with the same keys. */

function keys(o: unknown, prefix = ""): string[] {
  if (typeof o === "string") return [prefix];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("owner catalogs", () => {
  it("every language has exactly the French keys, and no empty text except optional notes", () => {
    const ref = keys(ownerMessages("fr")).sort();
    for (const l of OWNER_LOCALES) {
      expect(keys(ownerMessages(l)).sort(), l).toEqual(ref);
    }
    const ar = ownerMessages("ar");
    expect(ar.nav.statements).toBe("الكشوفات");
    expect(/[؀-ۿ]/.test(ar.dashboard.hello)).toBe(true);
  });

  it("negotiates the cookie's language, then the browser's, then French", () => {
    expect(negotiateOwnerLocale({ cookie: "ar" })).toBe("ar");
    expect(negotiateOwnerLocale({ cookie: "xx", acceptLanguage: "es-ES,en;q=0.8,ar;q=0.5" })).toBe("en");
    expect(negotiateOwnerLocale({ acceptLanguage: "ar-MA" })).toBe("ar");
    expect(negotiateOwnerLocale({ acceptLanguage: "de-DE" })).toBe("fr");
    expect(negotiateOwnerLocale({})).toBe("fr");
  });
});

describe("right-to-left formatting", () => {
  it("Arabic is right to left; amounts, dates and references are isolated left-to-right runs there only", () => {
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("fr")).toBe("ltr");
    expect(ltr("VIR-123", "ar")).toBe(`${LRI}VIR-123${PDI}`);
    expect(ltr("VIR-123", "fr")).toBe("VIR-123");
    expect(ownerAmount(123_450, "ar")).toBe(`${LRI}1 234,50 MAD${PDI}`);
    expect(ownerAmount(123_450, "fr")).toBe("1 234,50 MAD");
    expect(ownerAmount(-123_450, "en")).toBe("-MAD 1,234.50");
    expect(ownerAmount(5, "fr")).toBe("0,05 MAD");
    expect(ownerDate("2026-10-31", "ar")).toBe(`${LRI}31/10/2026${PDI}`);
    expect(ownerDate("2026-10-31", "en")).toBe("31/10/2026");
    // An instant just before midnight UTC is already the next day in Marrakech (UTC+1).
    expect(ownerInstantDate("2026-10-30T23:30:00Z", "fr")).toBe("31/10/2026");
  });

  it("month names in each language, Latin digits in Arabic", () => {
    expect(ownerMonth("2026-10", "fr")).toBe("octobre 2026");
    expect(ownerMonth("2026-10", "en")).toBe("October 2026");
    const ar = ownerMonth("2026-10", "ar");
    expect(ar).toContain("2026");
    expect(/[؀-ۿ]/.test(ar)).toBe(true);
    expect(/[٠-٩]/.test(ar)).toBe(false);
  });

  it("percentages", () => {
    expect(ownerPercent(2000, "fr")).toBe("20");
    expect(ownerPercent(1750, "ar")).toBe("17,5");
    expect(ownerPercent(1750, "en")).toBe("17.5");
  });
});

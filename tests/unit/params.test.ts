import { describe, expect, it } from "vitest";
import { guestsSummary, parseSearchQuery, slugify, toSearchParams } from "@/lib/search/params";

describe("parseSearchQuery", () => {
  it("round-trips through the URL", () => {
    const q = parseSearchQuery({ checkin: "2026-10-22", checkout: "2026-10-24", adults: "2", children: "1", pinned: "1003" });
    expect(parseSearchQuery(toSearchParams(q))).toEqual(q);
    expect(toSearchParams(q).toString()).toBe("checkin=2026-10-22&checkout=2026-10-24&adults=2&children=1&pinned=1003");
  });
  it("drops inverted or partial date ranges", () => {
    expect(parseSearchQuery({ checkin: "2026-10-24", checkout: "2026-10-22" }).checkin).toBeUndefined();
    expect(parseSearchQuery({ checkin: "2026-10-24" }).checkin).toBeUndefined();
    expect(parseSearchQuery({ checkin: "nope", checkout: "2026-10-22" }).checkout).toBeUndefined();
  });
  it("clamps junk counts and implies an adult", () => {
    const q = parseSearchQuery({ adults: "-3", children: "2", pets: "99" });
    expect(q).toMatchObject({ adults: 1, children: 2, pets: 0 });
  });
  it("accepts URLSearchParams and array values", () => {
    expect(parseSearchQuery(new URLSearchParams("adults=3")).adults).toBe(3);
    expect(parseSearchQuery({ adults: ["4", "5"] }).adults).toBe(4);
  });
});

describe("helpers", () => {
  it("slugifies accented place names", () => {
    expect(slugify("L'Île d'Oléron")).toBe("l-ile-d-oleron");
    expect(slugify("  Chamonix-Mont-Blanc ")).toBe("chamonix-mont-blanc");
  });
  it("summarises guests like the original", () => {
    expect(guestsSummary({ adults: 2, children: 1, infants: 1, pets: 0 })).toBe("3 voyageurs, 1 bébé");
    expect(guestsSummary({ adults: 1, children: 0, infants: 0, pets: 2 })).toBe("1 voyageur, 2 animaux");
    expect(guestsSummary({ adults: 0, children: 0, infants: 0, pets: 0 })).toBe("");
  });
});

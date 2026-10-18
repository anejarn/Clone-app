import { describe, expect, it } from "vitest";
import {
  addNights,
  adjustedPrice,
  compareRules,
  effectiveMinNights,
  MIN_NIGHTLY_CENTS,
  nightPrice,
  priceCalendar,
  priceStay,
  ruleCoversNight,
  ruleReach,
  stayNights,
  type PricedListing,
  type PricingRule,
} from "@/lib/pricing";

/** The pricing engine (lib/pricing/engine.ts): money, so every rule is pinned down here. */

const L: PricedListing = { id: "l1", priceCents: 100_000, cleaningFeeCents: 20_000, minNights: 2 };
let seq = 0;
function rule(over: Partial<PricingRule> = {}): PricingRule {
  seq += 1;
  return {
    id: `r${String(seq).padStart(3, "0")}`,
    kind: "SEASON",
    name: `Règle ${seq}`,
    startDate: "2027-03-15",
    endDate: "2027-05-31",
    recurring: false,
    adjustment: { type: "PERCENT", bps: 2_000 },
    minNights: null,
    priority: 0,
    listingIds: null,
    createdAt: `2026-10-01T00:00:${String(seq % 60).padStart(2, "0")}.000Z`,
    ...over,
  };
}
const pct = (bps: number) => ({ type: "PERCENT" as const, bps });
const fixed = (cents: number) => ({ type: "FIXED" as const, cents });

describe("nights", () => {
  it("a stay's nights run from the arrival to the night before departure", () => {
    expect(stayNights("2027-12-30", "2028-01-02")).toEqual(["2027-12-30", "2027-12-31", "2028-01-01"]);
    expect(stayNights("2027-01-01", "2027-01-01")).toEqual([]);
    expect(stayNights("2027-01-02", "2027-01-01")).toEqual([]);
    expect(stayNights(new Date("2027-02-27T00:00:00Z"), new Date("2027-03-01T00:00:00Z"))).toEqual(["2027-02-27", "2027-02-28"]);
    expect(stayNights("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29"]);
  });

  it("adds nights across months, years and leap days", () => {
    expect(addNights("2027-12-31", 1)).toBe("2028-01-01");
    expect(addNights("2028-02-28", 1)).toBe("2028-02-29");
    expect(addNights("2027-02-28", 1)).toBe("2027-03-01");
    expect(addNights("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("refuses what isn't a date", () => {
    expect(() => stayNights("27/12/2027", "2027-12-30")).toThrow(RangeError);
  });
});

describe("which nights a rule covers", () => {
  it("one-off: from the first to the last night, both included", () => {
    const r = rule({ startDate: "2027-01-23", endDate: "2027-01-25" });
    expect(["2027-01-22", "2027-01-23", "2027-01-24", "2027-01-25", "2027-01-26"].map((d) => ruleCoversNight(r, d))).toEqual([false, true, true, true, false]);
    // Not another year.
    expect(ruleCoversNight(r, "2028-01-24")).toBe(false);
  });

  it("yearly within a year: the same day-month range every year, before and after the year typed", () => {
    const r = rule({ startDate: "2027-03-15", endDate: "2027-05-31", recurring: true });
    for (const y of [2026, 2027, 2031]) {
      expect(ruleCoversNight(r, `${y}-03-14`)).toBe(false);
      expect(ruleCoversNight(r, `${y}-03-15`)).toBe(true);
      expect(ruleCoversNight(r, `${y}-05-31`)).toBe(true);
      expect(ruleCoversNight(r, `${y}-06-01`)).toBe(false);
    }
  });

  it("yearly across the year end: 20/12 → 04/01 every winter", () => {
    const r = rule({ startDate: "2026-12-20", endDate: "2027-01-04", recurring: true });
    const covered = ["2027-12-19", "2027-12-20", "2027-12-31", "2028-01-01", "2028-01-04", "2028-01-05"].map((d) => ruleCoversNight(r, d));
    expect(covered).toEqual([false, true, true, true, true, false]);
    expect(ruleCoversNight(r, "2027-07-01")).toBe(false);
  });

  it("one-off across the year end only covers those dates", () => {
    const r = rule({ startDate: "2026-12-20", endDate: "2027-01-04" });
    expect(ruleCoversNight(r, "2026-12-31")).toBe(true);
    expect(ruleCoversNight(r, "2027-12-31")).toBe(false);
  });

  it("leap day: a yearly range ending on 29/02 ends on 28/02 in other years; 29/02 alone only exists in leap years", () => {
    const toLeap = rule({ startDate: "2028-02-25", endDate: "2028-02-29", recurring: true });
    expect(ruleCoversNight(toLeap, "2027-02-28")).toBe(true);
    expect(ruleCoversNight(toLeap, "2027-03-01")).toBe(false);
    expect(ruleCoversNight(toLeap, "2032-02-29")).toBe(true);
    const fromLeap = rule({ startDate: "2028-02-29", endDate: "2028-03-03", recurring: true });
    expect(ruleCoversNight(fromLeap, "2027-02-28")).toBe(false);
    expect(ruleCoversNight(fromLeap, "2027-03-01")).toBe(true);
    const leapOnly = rule({ startDate: "2028-02-29", endDate: "2028-02-29", recurring: true });
    expect(ruleCoversNight(leapOnly, "2032-02-29")).toBe(true);
    expect(["2029-02-28", "2029-03-01"].some((d) => ruleCoversNight(leapOnly, d))).toBe(false);
    // A one-off range over February counts 29 nights in a leap year.
    const feb = rule({ startDate: "2028-02-01", endDate: "2028-02-29" });
    expect(stayNights("2028-02-01", "2028-03-01").filter((d) => ruleCoversNight(feb, d))).toHaveLength(29);
  });

  it("a yearly range of a whole year less a day covers everything but the day before it starts", () => {
    const r = rule({ startDate: "2027-03-01", endDate: "2028-02-28", recurring: true });
    expect(ruleCoversNight(r, "2029-02-28")).toBe(true);
    expect(ruleCoversNight(r, "2029-03-01")).toBe(true);
    expect(ruleCoversNight(r, "2029-10-10")).toBe(true);
  });
});

describe("price of a night under a rule", () => {
  it("a percentage of the base price, rounded to the whole dirham, half up", () => {
    expect(adjustedPrice(100_000, pct(2_000))).toBe(120_000);
    expect(adjustedPrice(100_000, pct(-1_000))).toBe(90_000);
    // 1 234,56 × 1,10 = 1 358,016 → 1 358 MAD.
    expect(adjustedPrice(123_456, pct(1_000))).toBe(135_800);
    // 1 235 × 1,50 = 1 852,50 → 1 853 MAD (half up).
    expect(adjustedPrice(123_500, pct(5_000))).toBe(185_300);
    // 999 × 0,85 = 849,15 → 849.
    expect(adjustedPrice(99_900, pct(-1_500))).toBe(84_900);
    // 12,5 % in basis points: 800 × 1,125 = 900.
    expect(adjustedPrice(80_000, pct(1_250))).toBe(90_000);
    // 0,5 MAD exactly → rounds up; 0,49 → down.
    expect(adjustedPrice(101, pct(-5_050))).toBe(MIN_NIGHTLY_CENTS);
    expect(adjustedPrice(30_100, pct(-5_000))).toBe(15_100);
    expect(adjustedPrice(29_900, pct(-5_000))).toBe(15_000);
  });

  it("never under 1 MAD, whatever the percentage", () => {
    expect(adjustedPrice(100, pct(-9_000))).toBe(MIN_NIGHTLY_CENTS);
    expect(adjustedPrice(50, pct(-9_000))).toBe(MIN_NIGHTLY_CENTS);
    expect(adjustedPrice(100, pct(-100_000))).toBe(MIN_NIGHTLY_CENTS);
    expect(adjustedPrice(0, pct(2_000))).toBe(MIN_NIGHTLY_CENTS);
  });

  it("a fixed price as typed, centimes included", () => {
    expect(adjustedPrice(100_000, fixed(150_050))).toBe(150_050);
    expect(adjustedPrice(100_000, fixed(1))).toBe(MIN_NIGHTLY_CENTS);
  });

  it("stays exact on the largest amounts", () => {
    expect(adjustedPrice(1_000_000_000, pct(50_000))).toBe(6_000_000_000);
    expect(Number.isInteger(adjustedPrice(999_999_999, pct(3_333)))).toBe(true);
  });
});

describe("precedence", () => {
  const night = "2027-04-10";
  const winner = (rules: PricingRule[]) => nightPrice(L, rules, night).rule?.name;

  it("no rule: the base price, untouched (no rounding)", () => {
    const l = { ...L, priceCents: 123_456 };
    expect(nightPrice(l, [], night)).toEqual({ date: night, priceCents: 123_456, rule: null });
    expect(nightPrice(l, [rule({ startDate: "2027-06-01", endDate: "2027-06-30" })], night).priceCents).toBe(123_456);
  });

  it("reach first: one listing > a selection > every listing, even against an event", () => {
    const all = rule({ name: "Tous", kind: "EVENT", priority: 100 });
    const some = rule({ name: "Sélection", kind: "EVENT", listingIds: ["l1", "l2"] });
    const one = rule({ name: "Ce bien", kind: "SEASON", listingIds: ["l1"] });
    expect(winner([all, some, one])).toBe("Ce bien");
    expect(winner([all, some])).toBe("Sélection");
    expect(winner([all])).toBe("Tous");
    expect([ruleReach(all), ruleReach(some), ruleReach(one)]).toEqual([0, 1, 2]);
  });

  it("then an event beats a season of the same reach", () => {
    const season = rule({ name: "Haute saison", priority: 100 });
    const event = rule({ name: "Marathon", kind: "EVENT", adjustment: pct(3_000) });
    expect(winner([season, event])).toBe("Marathon");
    expect(nightPrice(L, [season, event], night).priceCents).toBe(130_000);
  });

  it("then the higher priority, then the most recent, then the id", () => {
    const low = rule({ name: "Basse", priority: 1, createdAt: "2026-12-01T00:00:00.000Z" });
    const high = rule({ name: "Haute", priority: 5, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(winner([low, high])).toBe("Haute");
    const older = rule({ name: "Ancienne", createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = rule({ name: "Récente", createdAt: "2026-06-01T00:00:00.000Z" });
    expect(winner([newer, older])).toBe("Récente");
    expect(winner([older, newer])).toBe("Récente");
    const a = rule({ id: "a", name: "A", createdAt: "2026-01-01T00:00:00.000Z" });
    const b = rule({ id: "b", name: "B", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(winner([a, b])).toBe(winner([b, a]));
    expect(compareRules(a, a)).toBe(0);
  });

  it("rules of other listings are ignored; rules don't add up", () => {
    const other = rule({ name: "Autre bien", listingIds: ["l2"], adjustment: pct(9_000) });
    const plus = rule({ name: "+20", adjustment: pct(2_000) });
    const plus2 = rule({ name: "+10", adjustment: pct(1_000) });
    expect(nightPrice(L, [other], night).rule).toBeNull();
    // One rule only: +10 (most recent), not +32 %.
    expect(nightPrice(L, [other, plus, plus2], night).priceCents).toBe(110_000);
  });

  it("a 0 % rule only sets a minimum stay: the price under it stays the season's", () => {
    const season = rule({ name: "Haute saison", adjustment: pct(2_000) });
    const min3 = rule({ name: "Minimum 3 nuits", kind: "EVENT", listingIds: ["l1"], adjustment: pct(0), minNights: 3 });
    expect(nightPrice(L, [season, min3], night)).toMatchObject({ priceCents: 120_000, rule: { name: "Haute saison" } });
    expect(effectiveMinNights(L, [season, min3], night, addNights(night, 1))).toBe(3);
  });
});

describe("a whole stay", () => {
  it("without rules: base × nights + cleaning, as before", () => {
    const p = priceStay(L, [], "2027-04-01", "2027-04-04");
    expect(p).toMatchObject({ nights: 3, stayCents: 300_000, cleaningFeeCents: 20_000, serviceFeeCents: 0, totalCents: 320_000, averageNightlyCents: 100_000, uniform: true, minNights: 2 });
    expect(p.nightly.map((n) => n.priceCents)).toEqual([100_000, 100_000, 100_000]);
  });

  it("each night at its own price; total = Σ nights + cleaning, exactly", () => {
    const marathon = rule({ name: "Marathon", kind: "EVENT", startDate: "2027-01-23", endDate: "2027-01-24", adjustment: pct(5_000) });
    const p = priceStay(L, [marathon], "2027-01-22", "2027-01-26");
    expect(p.nightly.map((n) => [n.date, n.priceCents, n.rule?.name ?? null])).toEqual([
      ["2027-01-22", 100_000, null],
      ["2027-01-23", 150_000, "Marathon"],
      ["2027-01-24", 150_000, "Marathon"],
      ["2027-01-25", 100_000, null],
    ]);
    expect(p).toMatchObject({ stayCents: 500_000, totalCents: 520_000, averageNightlyCents: 125_000, uniform: false });
    expect(p.totalCents).toBe(p.nightly.reduce((s, n) => s + n.priceCents, 0) + p.cleaningFeeCents + p.serviceFeeCents);
  });

  it("the average is rounded to the centime but the total never is", () => {
    const l = { ...L, priceCents: 100_001, cleaningFeeCents: 0 };
    const r = rule({ startDate: "2027-04-02", endDate: "2027-04-02", adjustment: fixed(100_000) });
    const p = priceStay(l, [r], "2027-04-01", "2027-04-04");
    expect(p.stayCents).toBe(300_002);
    expect(p.averageNightlyCents).toBe(100_001);
    expect(p.totalCents).toBe(300_002);
  });

  it("across the year end, with a yearly event and a season under it", () => {
    const winter = rule({ name: "Hiver", startDate: "2026-11-01", endDate: "2027-02-28", recurring: true, adjustment: pct(-1_000) });
    const fetes = rule({ name: "Fêtes", kind: "EVENT", startDate: "2026-12-20", endDate: "2027-01-04", recurring: true, adjustment: pct(3_500), minNights: 3 });
    const p = priceStay(L, [winter, fetes], "2028-01-03", "2028-01-07");
    expect(p.nightly.map((n) => n.priceCents)).toEqual([135_000, 135_000, 90_000, 90_000]);
    expect(p.minNights).toBe(3);
    expect(p.totalCents).toBe(450_000 + 20_000);
  });

  it("over a leap day", () => {
    const feb = rule({ startDate: "2028-02-29", endDate: "2028-02-29", adjustment: fixed(299_900), listingIds: ["l1"] });
    const p = priceStay(L, [feb], "2028-02-28", "2028-03-02");
    expect(p.nightly.map((n) => n.priceCents)).toEqual([100_000, 299_900, 100_000]);
    expect(p.totalCents).toBe(499_900 + 20_000);
  });

  it("an empty stay costs nothing", () => {
    expect(priceStay(L, [rule()], "2027-04-01", "2027-04-01")).toMatchObject({ nights: 0, stayCents: 0, cleaningFeeCents: 0, totalCents: 0, averageNightlyCents: 0, nightly: [] });
  });
});

describe("minimum stay", () => {
  const fetes = rule({ name: "Fêtes", kind: "EVENT", startDate: "2026-12-20", endDate: "2027-01-04", recurring: true, minNights: 5 });

  it("the listing's when no rule raises it", () => {
    expect(effectiveMinNights(L, [], "2027-04-01", "2027-04-02")).toBe(2);
    expect(effectiveMinNights(L, [fetes], "2027-04-01", "2027-04-02")).toBe(2);
  });

  it("raised by any rule covering one of the stay's nights, at either end", () => {
    expect(effectiveMinNights(L, [fetes], "2027-12-18", "2027-12-21")).toBe(5);
    expect(effectiveMinNights(L, [fetes], "2028-01-04", "2028-01-06")).toBe(5);
    // Departure on the first night of the rule: no night inside.
    expect(effectiveMinNights(L, [fetes], "2027-12-17", "2027-12-20")).toBe(2);
    expect(effectiveMinNights(L, [fetes], "2028-01-05", "2028-01-07")).toBe(2);
  });

  it("the largest of the overrides, whatever their price precedence; never lowered", () => {
    const one = rule({ listingIds: ["l1"], startDate: "2027-12-01", endDate: "2027-12-31", minNights: 3 });
    expect(effectiveMinNights(L, [fetes, one], "2027-12-28", "2027-12-30")).toBe(5);
    const lower = rule({ listingIds: ["l1"], minNights: 1 });
    expect(effectiveMinNights(L, [lower], "2027-04-01", "2027-04-02")).toBe(2);
    const otherListing = rule({ listingIds: ["l2"], minNights: 7 });
    expect(effectiveMinNights(L, [otherListing], "2027-04-01", "2027-04-02")).toBe(2);
  });

  it("an empty stay: the minimum of a stay arriving that day", () => {
    expect(effectiveMinNights(L, [fetes], "2027-12-25", "2027-12-25")).toBe(5);
  });
});

describe("price calendar", () => {
  it("one day a night, with its price, rule and minimum stay", () => {
    const marathon = rule({ name: "Marathon", kind: "EVENT", startDate: "2027-01-23", endDate: "2027-01-24", adjustment: pct(2_500), minNights: 2 });
    const l = { ...L, minNights: 1 };
    const days = priceCalendar(l, [marathon], "2027-01-22", 4);
    expect(days.map((d) => [d.date, d.priceCents, d.minNights, d.rule?.name ?? null])).toEqual([
      ["2027-01-22", 100_000, 1, null],
      ["2027-01-23", 125_000, 2, "Marathon"],
      ["2027-01-24", 125_000, 2, "Marathon"],
      ["2027-01-25", 100_000, 1, null],
    ]);
    expect(priceCalendar(l, [], "2027-01-22", 90)).toHaveLength(90);
    expect(priceCalendar(l, [], "2027-01-22", 0)).toEqual([]);
  });
});

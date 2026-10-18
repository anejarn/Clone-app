import { describe, expect, it } from "vitest";
import { changedLines, formatMad, isNoop, linesOf, listingPriceChanged, listingSnapshot, mergeSnapshots, parseLines, ruleAdjustment, rulePeriod, ruleSnapshot, type RuleShape } from "@/lib/channels/price-reminders";

/** What a price reminder says (lib/channels/price-reminders.ts): prices don't go through iCal. */

const rule: RuleShape = { kind: "SEASON", name: "Haute saison", startDate: "2027-03-15", endDate: "2027-05-31", recurring: false, adjustment: { type: "PERCENT", bps: 2000 }, minNights: 3, priority: 0 };

describe("descriptions", () => {
  it("amounts to the centime, periods JJ/MM/AAAA, adjustments", () => {
    expect(formatMad(120_000)).toBe("1 200 MAD");
    expect(formatMad(123_450)).toBe("1 234,50 MAD");
    expect(rulePeriod(rule)).toBe("du 15/03/2027 au 31/05/2027 (nuits incluses)");
    expect(rulePeriod({ ...rule, recurring: true, startDate: "2026-12-20", endDate: "2027-01-04" })).toBe("chaque année du 20/12 au 04/01 (nuits incluses)");
    expect(ruleAdjustment({ type: "PERCENT", bps: 2000 })).toBe("+20 % sur le prix de base");
    expect(ruleAdjustment({ type: "PERCENT", bps: -1250 })).toBe("−12,5 % sur le prix de base");
    expect(ruleAdjustment({ type: "PERCENT", bps: 0 })).toBe("prix de base inchangé");
    expect(ruleAdjustment({ type: "FIXED", cents: 99_900 })).toBe("999 MAD la nuit");
  });

  it("a rule created, changed, deleted", () => {
    const created = changedLines(linesOf(ruleSnapshot(null), ruleSnapshot(rule)));
    expect(created.map((l) => [l.label, l.before, l.after])).toEqual([
      ["Nom", null, "Haute saison"],
      ["Type", null, "Saison"],
      ["Période", null, "du 15/03/2027 au 31/05/2027 (nuits incluses)"],
      ["Prix", null, "+20 % sur le prix de base"],
      ["Séjour minimum", null, "3 nuits"],
    ]);
    const changed = changedLines(linesOf(ruleSnapshot(rule), ruleSnapshot({ ...rule, adjustment: { type: "PERCENT", bps: 2500 }, minNights: null })));
    expect(changed.map((l) => [l.label, l.before, l.after])).toEqual([
      ["Prix", "+20 % sur le prix de base", "+25 % sur le prix de base"],
      ["Séjour minimum", "3 nuits", "celui du bien"],
    ]);
    expect(changedLines(linesOf(ruleSnapshot(rule), ruleSnapshot(null))).every((l) => l.after === null)).toBe(true);
  });

  it("a home's prices", () => {
    const a = { priceCents: 150_000, minNights: 1, cleaningFeeCents: 0 };
    const b = { ...a, priceCents: 165_000, cleaningFeeCents: 25_000 };
    expect(listingPriceChanged(a, a)).toBe(false);
    expect(listingPriceChanged(a, b)).toBe(true);
    expect(changedLines(linesOf(listingSnapshot(a), listingSnapshot(b)))).toEqual([
      { label: "Prix de base par nuit", before: "1 500 MAD", after: "1 650 MAD" },
      { label: "Frais de ménage", before: "aucun", after: "250 MAD" },
    ]);
  });
});

describe("an open reminder changed again", () => {
  it("keeps what the platform has (before), takes the new after; back to the start is nothing to report", () => {
    const first = linesOf(ruleSnapshot(rule), ruleSnapshot({ ...rule, adjustment: { type: "PERCENT", bps: 2500 } }));
    const second = linesOf(ruleSnapshot({ ...rule, adjustment: { type: "PERCENT", bps: 2500 } }), ruleSnapshot({ ...rule, adjustment: { type: "PERCENT", bps: 3000 }, minNights: 4 }));
    const merged = mergeSnapshots(first, second);
    expect(changedLines(merged).map((l) => [l.label, l.before, l.after])).toEqual([
      ["Prix", "+20 % sur le prix de base", "+30 % sur le prix de base"],
      ["Séjour minimum", "3 nuits", "4 nuits"],
    ]);
    const back = mergeSnapshots(merged, linesOf(ruleSnapshot({ ...rule, adjustment: { type: "PERCENT", bps: 3000 }, minNights: 4 }), ruleSnapshot(rule)));
    expect(isNoop(back)).toBe(true);
  });

  it("created then deleted before reporting: nothing to report", () => {
    expect(isNoop(mergeSnapshots(linesOf(ruleSnapshot(null), ruleSnapshot(rule)), linesOf(ruleSnapshot(rule), ruleSnapshot(null))))).toBe(true);
  });

  it("parseLines reads only well-formed lines", () => {
    expect(parseLines([{ label: "Prix", before: "a", after: "b" }, { nope: 1 }, null, "x"])).toEqual([{ label: "Prix", before: "a", after: "b" }]);
    expect(parseLines({})).toEqual([]);
  });
});

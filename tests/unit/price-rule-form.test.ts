import { describe, expect, it } from "vitest";
import {
  adjustmentLabel,
  bpsToSignedPercent,
  parseRuleForm,
  ruleDatesLabel,
  ruleFormValues,
  ruleScopeLabel,
  ruleToValues,
  signedPercentToBps,
  type RuleValues,
} from "@/lib/admin/price-rule-form";

/** Seasons and events typed by an associé (Prix): parsing of amounts and percentages, bounds, scope rules. */

const base: RuleValues = {
  kind: "EVENT",
  name: "Marathon de Marrakech",
  startDate: "2027-01-23",
  endDate: "2027-01-25",
  recurring: "",
  adjustmentType: "PERCENT",
  percent: "+25",
  fixed: "",
  minNights: "",
  priority: "",
  scope: "ALL",
  listingIds: [],
};
const parse = (over: RuleValues) => parseRuleForm({ ...base, ...over });
const errorsOf = (over: RuleValues) => {
  const r = parse(over);
  if (r.ok) throw new Error("expected errors");
  return r.fieldErrors;
};

describe("percentages with their sign", () => {
  it("parses +, -, the Unicode minus, decimals and a trailing %", () => {
    expect(signedPercentToBps("+20")).toBe(2_000);
    expect(signedPercentToBps("20")).toBe(2_000);
    expect(signedPercentToBps("-10")).toBe(-1_000);
    expect(signedPercentToBps("−10")).toBe(-1_000);
    expect(signedPercentToBps(" +12,5 % ")).toBe(1_250);
    expect(signedPercentToBps("7.25")).toBe(725);
    expect(signedPercentToBps("0")).toBe(0);
    for (const bad of ["", "abc", "+-5", "1e2", "12,345", "1000", "--1"]) expect(signedPercentToBps(bad), bad).toBeNull();
  });

  it("goes back to the field and to a label", () => {
    expect([2_000, -1_250, 0, 5].map(bpsToSignedPercent)).toEqual(["+20", "-12,5", "0", "+0,05"]);
    expect(adjustmentLabel({ type: "PERCENT", bps: 2_000 })).toBe("+20 %");
    expect(adjustmentLabel({ type: "PERCENT", bps: -1_000 })).toBe("−10 %");
    expect(adjustmentLabel({ type: "PERCENT", bps: 0 })).toBe("Prix inchangé");
    expect(adjustmentLabel({ type: "FIXED", cents: 150_000 })).toBe("1 500 MAD la nuit");
  });
});

describe("parseRuleForm", () => {
  it("an event for every listing, +25 %", () => {
    expect(parse({})).toEqual({
      ok: true,
      input: {
        kind: "EVENT",
        name: "Marathon de Marrakech",
        startDate: new Date("2027-01-23T00:00:00Z"),
        endDate: new Date("2027-01-25T00:00:00Z"),
        recurring: false,
        adjustment: { type: "PERCENT", bps: 2_500 },
        minNights: null,
        priority: 0,
        allListings: true,
        listingIds: [],
      },
    });
  });

  it("a yearly season across the year end for a selection, with a minimum stay and a priority", () => {
    const r = parse({ kind: "SEASON", name: "Fêtes", startDate: "2026-12-20", endDate: "2027-01-04", recurring: "on", percent: "35", minNights: "3", priority: "10", scope: "SELECTED", listingIds: ["1001", "1002", "1001"] });
    expect(r).toMatchObject({ ok: true, input: { recurring: true, minNights: 3, priority: 10, allListings: false, listingIds: ["1001", "1002"] } });
  });

  it("a fixed price for exactly one listing", () => {
    expect(parse({ adjustmentType: "FIXED", fixed: "1 500,50", percent: "", scope: "SELECTED", listingIds: ["1001"] })).toMatchObject({
      ok: true,
      input: { adjustment: { type: "FIXED", cents: 150_050 }, listingIds: ["1001"] },
    });
    const many = "Biens concernés : un prix fixe s'applique à un seul bien (utilisez un pourcentage pour plusieurs biens)";
    expect(errorsOf({ adjustmentType: "FIXED", fixed: "1500", scope: "ALL" }).listingIds).toBe(many);
    expect(errorsOf({ adjustmentType: "FIXED", fixed: "1500", scope: "SELECTED", listingIds: ["1001", "1002"] }).listingIds).toBe(many);
    expect(errorsOf({ adjustmentType: "FIXED", fixed: "0,99", scope: "SELECTED", listingIds: ["1001"] }).fixed).toBe("Prix par nuit : 1 MAD au minimum");
    expect(errorsOf({ adjustmentType: "FIXED", fixed: "abc", scope: "SELECTED", listingIds: ["1001"] }).fixed).toMatch(/montant en dirhams attendu/);
    expect(errorsOf({ adjustmentType: "FIXED", fixed: "10000001", scope: "SELECTED", listingIds: ["1001"] }).fixed).toBe("Prix par nuit : montant trop élevé");
  });

  it("percent bounds: −90 % to +500 %; 0 % only with a minimum stay", () => {
    expect(parse({ percent: "-90" }).ok).toBe(true);
    expect(parse({ percent: "+500" }).ok).toBe(true);
    expect(errorsOf({ percent: "-90,01" }).percent).toBe("Pourcentage : entre -90 et +500");
    expect(errorsOf({ percent: "+501" }).percent).toBe("Pourcentage : entre -90 et +500");
    expect(errorsOf({ percent: "0" }).percent).toMatch(/séjour minimum/);
    expect(parse({ percent: "0", minNights: "3" })).toMatchObject({ ok: true, input: { adjustment: { bps: 0 }, minNights: 3 } });
    expect(errorsOf({ percent: "" }).percent).toMatch(/nombre attendu/);
  });

  it("dates: in order, real days, two years at most, a yearly rule shorter than a year", () => {
    expect(parse({ startDate: "2027-01-23", endDate: "2027-01-23" }).ok).toBe(true);
    expect(errorsOf({ endDate: "2027-01-22" }).endDate).toBe("Dernière nuit : le même jour que la première nuit ou après");
    expect(errorsOf({ startDate: "2027-02-30" }).startDate).toBe("Première nuit : date invalide");
    expect(errorsOf({ startDate: "" }).startDate).toBe("Première nuit : champ obligatoire");
    expect(errorsOf({ startDate: "2027-01-01", endDate: "2029-01-02" }).endDate).toMatch(/deux ans/);
    expect(parse({ startDate: "2027-03-01", endDate: "2028-02-28", recurring: "on" }).ok).toBe(true);
    expect(errorsOf({ startDate: "2027-03-01", endDate: "2028-02-29", recurring: "on" }).endDate).toMatch(/moins d'un an/);
    expect(parse({ startDate: "2028-02-29", endDate: "2028-02-29", recurring: "on" }).ok).toBe(true);
  });

  it("names, minimum stays, priorities, kinds and listing ids", () => {
    expect(errorsOf({ name: " a " }).name).toBe("Nom : champ obligatoire");
    expect(errorsOf({ name: "x".repeat(81) }).name).toMatch(/80 caractères/);
    expect(errorsOf({ name: "Fête\u0007" }).name).toBe("Nom : caractères non autorisés");
    expect(errorsOf({ minNights: "0" }).minNights).toBe("Séjour minimum : entre 1 et 365");
    expect(errorsOf({ minNights: "2,5" }).minNights).toBe("Séjour minimum : nombre entier attendu");
    expect(errorsOf({ priority: "101" }).priority).toBe("Priorité : entre 0 et 100");
    expect(errorsOf({ kind: "HOLIDAY" }).kind).toMatch(/^Type/);
    expect(errorsOf({ scope: "SELECTED", listingIds: [] }).listingIds).toBe("Biens concernés : cochez au moins un bien");
    expect(errorsOf({ scope: "SELECTED", listingIds: ["../x"] }).listingIds).toBe("Biens concernés : choisissez dans la liste");
    // Every listing: the selection is ignored.
    expect(parse({ scope: "ALL", listingIds: ["1001"] })).toMatchObject({ ok: true, input: { allListings: true, listingIds: [] } });
  });

  it("reads a FormData and goes back to the form from a stored rule", () => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ ...base, listingIds: undefined, recurring: "on", extra: "x" })) if (typeof v === "string") f.append(k, v);
    f.append("listingIds", "1001");
    f.append("listingIds", "1002");
    const values = ruleFormValues(f);
    expect(values).toMatchObject({ name: "Marathon de Marrakech", recurring: "on", listingIds: ["1001", "1002"] });
    expect(values).not.toHaveProperty("extra");
    const stored = {
      kind: "SEASON" as const,
      name: "Basse saison",
      startDate: new Date("2027-06-15T00:00:00Z"),
      endDate: new Date("2027-08-31T00:00:00Z"),
      recurring: true,
      adjustmentType: "PERCENT" as const,
      percentBps: -1_500,
      fixedCents: null,
      minNights: null,
      priority: 0,
      allListings: false,
      listingIds: ["1001"],
    };
    const back = ruleToValues(stored);
    expect(back).toMatchObject({ percent: "-15", recurring: "on", scope: "SELECTED", startDate: "2027-06-15" });
    expect(parseRuleForm(back)).toMatchObject({ ok: true, input: { adjustment: { type: "PERCENT", bps: -1_500 }, listingIds: ["1001"] } });
  });
});

describe("labels", () => {
  it("dates JJ/MM/AAAA, or day-month every year; scope", () => {
    expect(ruleDatesLabel({ startDate: new Date("2027-01-23T00:00:00Z"), endDate: new Date("2027-01-25T00:00:00Z"), recurring: false })).toBe("du 23/01/2027 au 25/01/2027");
    expect(ruleDatesLabel({ startDate: new Date("2026-12-20T00:00:00Z"), endDate: new Date("2027-01-04T00:00:00Z"), recurring: true })).toBe("chaque année du 20/12 au 04/01");
    expect(ruleScopeLabel({ allListings: true, listings: [] })).toBe("Tous les biens");
    expect(ruleScopeLabel({ allListings: false, listings: [{ title: "Riad Dar Zitoun" }] })).toBe("Riad Dar Zitoun");
    expect(ruleScopeLabel({ allListings: false, listings: [{ title: "a" }, { title: "b" }, { title: "c" }] })).toBe("3 biens");
  });
});

import { describe, expect, it } from "vitest";
import { ageOn, computeStayTax, isExempt, monthBounds, monthTotals, taxGuests, versionOn, type ListingTaxVersion, type OrgTaxVersion, type TaxGuest } from "@/lib/tax/engine";
import { formatTaxAmount, parseListingRateForm, parseOrgRateForm, parseRetentionForm } from "@/lib/tax/form";

/** Taxe de séjour engine (lib/tax/engine.ts): money is always tested. Rates here are made up for the tests. */

const org = (id: string, effectiveFrom: string, rateCents: number, rules: Partial<OrgTaxVersion> = {}): OrgTaxVersion => ({
  id,
  effectiveFrom,
  rateCents,
  minorsExemptUnder: 18,
  residentsExempt: false,
  ...rules,
});
const adult = (residenceCountry: string | null = null, age: number | null = null): TaxGuest => ({ kind: "ADULT", age, residenceCountry });
const child = (age: number | null = null): TaxGuest => ({ kind: "CHILD", age, residenceCountry: null });
const infant = (): TaxGuest => ({ kind: "INFANT", age: null, residenceCountry: null });
const stay = (checkIn: string, checkOut: string, guests: TaxGuest[], orgVersions: OrgTaxVersion[], listingVersions: ListingTaxVersion[] = [], listingId = "L1") =>
  computeStayTax({ listingId, checkIn, checkOut, guests, orgVersions, listingVersions });

describe("computeStayTax", () => {
  it("is rate × taxable guests × nights, in centimes, exactly", () => {
    const t = stay("2027-03-10", "2027-03-13", [adult(), adult()], [org("v1", "2027-01-01", 2_550)]);
    expect(t.nights).toBe(3);
    expect(t.taxableGuestNights).toBe(6);
    expect(t.totalCents).toBe(15_300);
    expect(t.lines.map((l) => l.night)).toEqual(["2027-03-10", "2027-03-11", "2027-03-12"]);
    expect(t.lines.every((l) => l.amountCents === 5_100 && l.orgVersionId === "v1")).toBe(true);
    expect(t.missingRateNights).toBe(0);
  });

  it("zero nights (same day, or departure before arrival) costs nothing", () => {
    for (const [a, b] of [
      ["2027-03-10", "2027-03-10"],
      ["2027-03-10", "2027-03-09"],
    ]) {
      const t = stay(a, b, [adult()], [org("v1", "2027-01-01", 2_000)]);
      expect(t).toMatchObject({ totalCents: 0, nights: 0, taxableGuestNights: 0, lines: [] });
    }
  });

  it("no guest, no tax; a zero rate is a valid rate", () => {
    expect(stay("2027-03-10", "2027-03-12", [], [org("v1", "2027-01-01", 2_000)]).totalCents).toBe(0);
    const zero = stay("2027-03-10", "2027-03-12", [adult()], [org("v1", "2027-01-01", 0)]);
    expect(zero).toMatchObject({ totalCents: 0, missingRateNights: 0, taxableGuestNights: 2 });
  });

  it("a rate change in the middle of a stay applies night by night from its date", () => {
    const versions = [org("old", "2027-01-01", 2_000), org("new", "2027-03-12", 3_000)];
    const t = stay("2027-03-10", "2027-03-14", [adult(), adult()], versions);
    expect(t.lines.map((l) => [l.night, l.rateCents, l.orgVersionId])).toEqual([
      ["2027-03-10", 2_000, "old"],
      ["2027-03-11", 2_000, "old"],
      ["2027-03-12", 3_000, "new"],
      ["2027-03-13", 3_000, "new"],
    ]);
    expect(t.totalCents).toBe(2 * 2 * 2_000 + 2 * 2 * 3_000);
  });

  it("a new version never changes the nights before its date (versions given in any order)", () => {
    const before = stay("2027-02-01", "2027-02-03", [adult()], [org("a", "2027-01-01", 2_000)]);
    const after = stay("2027-02-01", "2027-02-03", [adult()], [org("b", "2027-06-01", 9_900), org("a", "2027-01-01", 2_000)]);
    expect(after.totalCents).toBe(before.totalCents);
    expect(after.lines).toEqual(before.lines);
  });

  it("a version taking effect on the departure day doesn't touch the stay (the departure day is not a night)", () => {
    const t = stay("2027-03-10", "2027-03-12", [adult()], [org("a", "2027-01-01", 2_000), org("b", "2027-03-12", 5_000)]);
    expect(t.totalCents).toBe(4_000);
  });

  it("nights before the first version have no rate, flagged, not invented", () => {
    const t = stay("2026-12-30", "2027-01-02", [adult()], [org("v1", "2027-01-01", 2_000)]);
    expect(t.lines.map((l) => l.rateCents)).toEqual([null, null, 2_000]);
    expect(t).toMatchObject({ missingRateNights: 2, totalCents: 2_000, taxableGuestNights: 1 });
    const none = stay("2027-03-10", "2027-03-12", [adult()], []);
    expect(none).toMatchObject({ missingRateNights: 2, totalCents: 0, taxableGuestNights: 0 });
  });

  it("exempts minors under the configured age, from the exact age when known", () => {
    const v = [org("v1", "2027-01-01", 1_000, { minorsExemptUnder: 12 })];
    const t = stay("2027-03-10", "2027-03-11", [adult(), adult(null, 11), adult(null, 12), child(17)], v);
    // 11 → exempt; 12 and 17 → taxed (limit 12).
    expect(t.lines[0]).toMatchObject({ taxable: 3, exempt: 1, amountCents: 3_000 });
  });

  it("booking categories without an age: children exempt only when the limit covers 2–17, babies when it covers under 2", () => {
    const guests = [adult(), child(), infant()];
    expect(stay("2027-03-10", "2027-03-11", guests, [org("v", "2027-01-01", 1_000, { minorsExemptUnder: 18 })]).lines[0]).toMatchObject({ taxable: 1, exempt: 2 });
    expect(stay("2027-03-10", "2027-03-11", guests, [org("v", "2027-01-01", 1_000, { minorsExemptUnder: 12 })]).lines[0]).toMatchObject({ taxable: 2, exempt: 1 });
    expect(stay("2027-03-10", "2027-03-11", guests, [org("v", "2027-01-01", 1_000, { minorsExemptUnder: 2 })]).lines[0]).toMatchObject({ taxable: 2, exempt: 1 });
    expect(stay("2027-03-10", "2027-03-11", guests, [org("v", "2027-01-01", 1_000, { minorsExemptUnder: 1 })]).lines[0]).toMatchObject({ taxable: 3, exempt: 0 });
  });

  it("without a minors' exemption everybody pays", () => {
    const t = stay("2027-03-10", "2027-03-12", [adult(), child(5), infant()], [org("v", "2027-01-01", 1_000, { minorsExemptUnder: null })]);
    expect(t).toMatchObject({ taxableGuestNights: 6, exemptGuestNights: 0, totalCents: 6_000 });
  });

  it("exempts Moroccan residents only when configured", () => {
    const guests = [adult("MA"), adult("FR"), adult(null)];
    expect(stay("2027-03-10", "2027-03-11", guests, [org("v", "2027-01-01", 1_000)]).totalCents).toBe(3_000);
    expect(stay("2027-03-10", "2027-03-11", guests, [org("v", "2027-01-01", 1_000, { residentsExempt: true })]).lines[0]).toMatchObject({ taxable: 2, exempt: 1 });
  });

  it("exemption rules follow the version of each night", () => {
    const versions = [org("a", "2027-01-01", 1_000, { residentsExempt: false }), org("b", "2027-03-11", 1_000, { residentsExempt: true })];
    const t = stay("2027-03-10", "2027-03-12", [adult("MA")], versions);
    expect(t.lines.map((l) => l.taxable)).toEqual([1, 0]);
    expect(t).toMatchObject({ totalCents: 1_000, taxableGuestNights: 1, exemptGuestNights: 1 });
  });

  it("a home's override replaces the rate from its date, and null brings the organization's back", () => {
    const orgV = [org("o1", "2027-01-01", 2_000), org("o2", "2027-03-13", 2_500)];
    const own: ListingTaxVersion[] = [
      { id: "l1", listingId: "L1", effectiveFrom: "2027-03-11", rateCents: 4_000 },
      { id: "l2", listingId: "L1", effectiveFrom: "2027-03-12", rateCents: null },
      { id: "x", listingId: "OTHER", effectiveFrom: "2027-01-01", rateCents: 9_999 },
    ];
    const t = stay("2027-03-10", "2027-03-14", [adult()], orgV, own);
    expect(t.lines.map((l) => [l.rateCents, l.listingVersionId])).toEqual([
      [2_000, null],
      [4_000, "l1"],
      [2_000, "l2"],
      [2_500, "l2"],
    ]);
    // Another home is unaffected by L1's override; OTHER's override applies to OTHER only.
    expect(stay("2027-03-10", "2027-03-11", [adult()], orgV, own, "L2").totalCents).toBe(2_000);
    expect(stay("2027-03-10", "2027-03-11", [adult()], orgV, own, "OTHER").totalCents).toBe(9_999);
  });

  it("an override without any organization version doesn't create a tax (exemptions come from the organization)", () => {
    const t = stay("2027-03-10", "2027-03-11", [adult()], [], [{ id: "l1", listingId: "L1", effectiveFrom: "2027-01-01", rateCents: 4_000 }]);
    expect(t).toMatchObject({ totalCents: 0, missingRateNights: 1 });
  });

  it("no rounding: odd centimes stay exact over long stays", () => {
    const t = stay("2027-01-01", "2028-01-01", [adult(), adult(), adult()], [org("v", "2026-01-01", 1_333)]);
    expect(t.nights).toBe(365);
    expect(t.totalCents).toBe(1_333 * 3 * 365);
  });

  it("crosses months and leap days", () => {
    const t = stay("2028-02-28", "2028-03-02", [adult()], [org("v", "2028-01-01", 100)]);
    expect(t.lines.map((l) => l.night)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(monthTotals(t.lines, "2028-02")).toMatchObject({ nights: 2, totalCents: 200 });
    expect(monthTotals(t.lines, "2028-03")).toMatchObject({ nights: 1, totalCents: 100 });
    expect(monthTotals(t.lines, "2028-04")).toMatchObject({ nights: 0, totalCents: 0 });
  });

  it("refuses negative or fractional rates", () => {
    expect(() => stay("2027-03-10", "2027-03-11", [adult()], [org("v", "2027-01-01", -1)])).toThrow(RangeError);
    expect(() => stay("2027-03-10", "2027-03-11", [adult()], [org("v", "2027-01-01", 10.5)])).toThrow(RangeError);
    expect(() => stay("2027-03-10", "2027-03-11", [adult()], [org("v", "2027-01-01", 1)], [{ id: "l", listingId: "L1", effectiveFrom: "2027-01-01", rateCents: -5 }])).toThrow(RangeError);
  });
});

describe("helpers", () => {
  it("versionOn takes the latest version in force", () => {
    const vs = [{ effectiveFrom: "2027-01-01", id: "a" }, { effectiveFrom: "2027-06-01", id: "b" }];
    expect(versionOn(vs, "2026-12-31")).toBeNull();
    expect(versionOn(vs, "2027-01-01")?.id).toBe("a");
    expect(versionOn(vs, "2027-05-31")?.id).toBe("a");
    expect(versionOn(vs, "2027-06-01")?.id).toBe("b");
  });

  it("ageOn counts whole years, birthdays included, 29 February too", () => {
    expect(ageOn("2009-03-10", "2027-03-09")).toBe(17);
    expect(ageOn("2009-03-10", "2027-03-10")).toBe(18);
    expect(ageOn("2008-02-29", "2026-02-28")).toBe(17);
    expect(ageOn("2008-02-29", "2026-03-01")).toBe(18);
  });

  it("isExempt combines both rules", () => {
    expect(isExempt(adult("MA", 30), { minorsExemptUnder: null, residentsExempt: true })).toBe(true);
    expect(isExempt(adult("FR", 30), { minorsExemptUnder: 18, residentsExempt: true })).toBe(false);
    expect(isExempt(child(10), { minorsExemptUnder: 18, residentsExempt: false })).toBe(true);
  });

  it("taxGuests completes the recorded travellers from the booking's counts, never lowering the tax", () => {
    const booking = { checkIn: "2027-03-10", adults: 3, children: 1, infants: 1 };
    // One adult and one 10-year-old recorded: two adults and one baby still counted from the booking.
    const g = taxGuests(booking, [
      { birthDate: "1980-01-01", isMinor: false, residenceCountry: "MA" },
      { birthDate: "2016-05-01", isMinor: true, residenceCountry: null },
    ]);
    expect(g).toEqual([
      { kind: "ADULT", age: 47, residenceCountry: "MA" },
      { kind: "CHILD", age: 10, residenceCountry: null },
      { kind: "ADULT", age: null, residenceCountry: null },
      { kind: "ADULT", age: null, residenceCountry: null },
      { kind: "INFANT", age: null, residenceCountry: null },
    ]);
    // More travellers recorded than announced: the travellers count.
    expect(taxGuests({ checkIn: "2027-03-10", adults: 1, children: 0, infants: 0 }, [0, 1, 2].map(() => ({ birthDate: "1990-01-01", isMinor: false, residenceCountry: null })))).toHaveLength(3);
    // No traveller: the booking's counts.
    expect(taxGuests(booking, []).map((x) => x.kind)).toEqual(["ADULT", "ADULT", "ADULT", "CHILD", "INFANT"]);
    // A recorded baby (under 2) fills a baby's place once the children are covered.
    expect(taxGuests({ checkIn: "2027-03-10", adults: 1, children: 0, infants: 1 }, [{ birthDate: "2026-06-01", isMinor: true, residenceCountry: null }]).map((x) => x.kind)).toEqual(["INFANT", "ADULT"]);
  });

  it("monthBounds", () => {
    expect(monthBounds("2027-02")).toEqual({ from: "2027-02-01", to: "2027-03-01" });
    expect(monthBounds("2027-12")).toEqual({ from: "2027-12-01", to: "2028-01-01" });
    expect(() => monthBounds("2027-13")).toThrow(RangeError);
  });
});

describe("settings forms", () => {
  it("parses a rate in dirhams to exact centimes", () => {
    expect(parseOrgRateForm({ effectiveFrom: "2027-01-01", rate: "12,50", minorsExempt: "on", minorsAge: "18", note: " x " })).toEqual({
      ok: true,
      input: { effectiveFrom: "2027-01-01", rateCents: 1_250, minorsExemptUnder: 18, residentsExempt: false, note: "x" },
    });
    expect(parseOrgRateForm({ effectiveFrom: "2027-01-01", rate: "0", residentsExempt: "on" })).toMatchObject({ ok: true, input: { rateCents: 0, minorsExemptUnder: null, residentsExempt: true } });
  });

  it("refuses bad input", () => {
    const r = parseOrgRateForm({ effectiveFrom: "2027-02-30", rate: "12,505", minorsExempt: "on", minorsAge: "40" });
    expect(r).toMatchObject({ ok: false, fieldErrors: { effectiveFrom: expect.any(String), rate: expect.any(String), minorsAge: expect.any(String) } });
    expect(parseOrgRateForm({ effectiveFrom: "2027-01-01", rate: "1000,01" })).toMatchObject({ ok: false, fieldErrors: { rate: expect.stringContaining("maximum") } });
    expect(parseOrgRateForm({ effectiveFrom: "2027-01-01", rate: "" })).toMatchObject({ ok: false });
  });

  it("a home's rate, or back to the organization's", () => {
    expect(parseListingRateForm({ listingId: "1001", effectiveFrom: "2027-01-01", rate: "30" })).toMatchObject({ ok: true, input: { rateCents: 3_000 } });
    expect(parseListingRateForm({ listingId: "1001", effectiveFrom: "2027-01-01", useOrgRate: "on", rate: "zz" })).toMatchObject({ ok: true, input: { rateCents: null } });
    expect(parseListingRateForm({ listingId: "", effectiveFrom: "2027-01-01", rate: "3" })).toMatchObject({ ok: false, fieldErrors: { listingId: expect.any(String) } });
  });

  it("retention days", () => {
    expect(parseRetentionForm({ retentionDays: "365" })).toEqual({ ok: true, days: 365 });
    for (const v of ["0", "3651", "1.5", "", "abc"]) expect(parseRetentionForm({ retentionDays: v }).ok).toBe(false);
  });

  it("formats exact amounts, never rounded to the dirham", () => {
    expect(formatTaxAmount(1_250)).toBe("12,50 MAD");
    expect(formatTaxAmount(0)).toBe("0,00 MAD");
    expect(formatTaxAmount(123_456_7)).toBe("12 345,67 MAD");
  });
});

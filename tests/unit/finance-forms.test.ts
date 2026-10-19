import { describe, expect, it } from "vitest";
import { parseAdjustment, parseListingTerms, parseSettings, parseSplitInputs } from "@/lib/finance/forms";

describe("finance forms", () => {
  it("split inputs: empty = none, amounts in centimes, rates in millionths", () => {
    expect(parseSplitInputs({ gross: "", platformFee: "", fxRate: "", note: "" })).toEqual({ ok: true, value: { grossCents: null, platformFeeCents: null, fxRateMicros: null, note: "" } });
    expect(parseSplitInputs({ gross: "1 250,50", platformFee: "0", fxRate: "10,85", note: " relevé " })).toEqual({ ok: true, value: { grossCents: 125_050, platformFeeCents: 0, fxRateMicros: 10_850_000, note: "relevé" } });
    const bad = parseSplitInputs({ gross: "abc", platformFee: "-1", fxRate: "0", note: "x".repeat(501) });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.fieldErrors).sort()).toEqual(["fxRate", "gross", "note", "platformFee"]);
    expect(parseSplitInputs({ gross: "100", platformFee: "100,01" })).toMatchObject({ ok: false, fieldErrors: { platformFee: expect.any(String) } });
  });
  it("settings: enums and platform rates 0–50 %", () => {
    const v = { cleaningBeneficiary: "OWNER", commissionBase: "GROSS_EXCL_CLEANING", allocation: "CHECKOUT", fee_AIRBNB: "15,5", fee_BOOKING: "17", fee_AGODA: "18", fee_TRIPCOM: "15", fee_EXPEDIA: "15", fee_OTHER: "0" };
    expect(parseSettings(v)).toEqual({ ok: true, value: { cleaningBeneficiary: "OWNER", commissionBase: "GROSS_EXCL_CLEANING", allocation: "CHECKOUT", platformFeeBps: { AIRBNB: 1550, BOOKING: 1700, AGODA: 1800, TRIPCOM: 1500, EXPEDIA: 1500, OTHER: 0 } } });
    expect(parseSettings({ ...v, fee_AIRBNB: "50,01", allocation: "X" })).toMatchObject({ ok: false, fieldErrors: { fee_AIRBNB: expect.any(String), allocation: expect.any(String) } });
  });
  it("a home's terms and a manual adjustment", () => {
    expect(parseListingTerms({ cleaningFeeBeneficiary: "", subleaseRent: "9000", subleaseRentFrom: "2026-01-01" })).toEqual({ ok: true, value: { cleaningFeeBeneficiary: null, subleaseRentCents: 900_000, subleaseRentFrom: "2026-01-01" } });
    expect(parseListingTerms({ subleaseRentFrom: "2026-01-01" })).toMatchObject({ ok: false, fieldErrors: { subleaseRentFrom: expect.any(String) } });
    expect(parseAdjustment({ listingId: "l1", month: "2026-10", direction: "debit", amount: "50", reason: "Casse" })).toEqual({ ok: true, value: { listingId: "l1", month: "2026-10", amountCents: -5_000, reason: "Casse" } });
    expect(parseAdjustment({ listingId: "l1", month: "2026-13", direction: "x", amount: "0", reason: "" }).ok).toBe(false);
  });
});

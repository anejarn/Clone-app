import { describe, expect, it } from "vitest";
import { computeSplit, grossFromPayout, monthWeights, partsTotal, PART_KEYS, type SplitInput, type SplitOverrides, type SplitTerms } from "@/lib/finance/split";
import { DEFAULT_PLATFORM_FEE_BPS, platformFeeBpsFor, platformFeeRates } from "@/lib/finance/platform-fees";
import { prng } from "../support/prng";

const managed: SplitTerms = { managementType: "MANAGED", commissionBps: 2000, cleaningBeneficiary: "SIGMA", commissionBase: "NET_EXCL_CLEANING", allocation: "NIGHTS", platformFeeBps: 0 };
const direct = (over: Partial<SplitInput> = {}): SplitInput => ({
  source: "DIRECT",
  status: "CONFIRMED",
  channelBlock: false,
  checkIn: "2026-11-10",
  checkOut: "2026-11-13",
  totalCents: 300_000 + 30_000,
  cleaningFeeCents: 30_000,
  platformAmount: null,
  ...over,
});
const none: SplitOverrides = { grossCents: null, platformFeeCents: null, fxRateMicros: null };

function expectInvariants(s: ReturnType<typeof computeSplit>) {
  expect(partsTotal(s)).toBe(s.grossCents);
  for (const k of PART_KEYS) {
    expect(Number.isSafeInteger(s[k])).toBe(true);
    expect(s[k]).toBeGreaterThanOrEqual(0);
    expect(s.months.reduce((t, m) => t + m[k], 0)).toBe(s[k]);
  }
  expect(s.months.reduce((t, m) => t + m.grossCents, 0)).toBe(s.grossCents);
  for (const m of s.months) expect(partsTotal(m)).toBe(m.grossCents);
  expect(s.sigmaTotalCents + s.ownerTotalCents + s.platformFeeCents).toBe(s.grossCents);
}

describe("MANAGED (mandat de gestion)", () => {
  it("direct booking: no platform fee, cleaning to Sigma, 20 % of the rent", () => {
    const s = computeSplit(direct(), managed);
    expect(s).toMatchObject({ status: "COMPLETE", grossSource: "BOOKING", feeSource: "NONE", grossCents: 330_000, platformFeeCents: 0, cleaningSigmaCents: 30_000, cleaningOwnerCents: 0, commissionBaseCents: 300_000, commissionCents: 60_000, ownerShareCents: 240_000, sigmaRentalCents: 0, nights: 3 });
    expect(s.months).toEqual([{ month: "2026-11", nights: 3, grossCents: 330_000, platformFeeCents: 0, cleaningSigmaCents: 30_000, cleaningOwnerCents: 0, commissionCents: 60_000, ownerShareCents: 240_000, sigmaRentalCents: 0 }]);
    expectInvariants(s);
  });

  it("cleaning kept by the owner (gestion à distance)", () => {
    const s = computeSplit(direct(), { ...managed, cleaningBeneficiary: "OWNER", commissionBps: 1500 });
    expect(s).toMatchObject({ cleaningSigmaCents: 0, cleaningOwnerCents: 30_000, commissionCents: 45_000, ownerShareCents: 255_000, ownerTotalCents: 285_000, sigmaTotalCents: 45_000 });
    expectInvariants(s);
  });

  it("commission on the gross excluding cleaning (parameter)", () => {
    const s = computeSplit(direct({ source: "BOOKING", totalCents: 230_000, cleaningFeeCents: 30_000 }), { ...managed, platformFeeBps: 1500, commissionBase: "GROSS_EXCL_CLEANING" });
    // G 2 300, F 15 % = 345, C 300, base G − C = 2 000 → K 400; owner 2 300 − 345 − 300 − 400 = 1 255.
    expect(s).toMatchObject({ grossCents: 230_000, platformFeeCents: 34_500, feeSource: "ESTIMATE", commissionBaseCents: 200_000, commissionCents: 40_000, ownerShareCents: 125_500 });
    expectInvariants(s);
  });

  it("commission rounds to the centime (halves up)", () => {
    // Rent 1 234,57 → 20 % = 246,914 → 246,91; 1 234,58 → 246,916 → 246,92.
    expect(computeSplit(direct({ totalCents: 123_457, cleaningFeeCents: 0 }), managed).commissionCents).toBe(24_691);
    expect(computeSplit(direct({ totalCents: 123_458, cleaningFeeCents: 0 }), managed).commissionCents).toBe(24_692);
    // 17,5 % of 0,02 MAD = 0,0035 → 0; of 0,03 → 0,00525 → 0,01.
    expect(computeSplit(direct({ totalCents: 2, cleaningFeeCents: 0 }), { ...managed, commissionBps: 1750 }).commissionCents).toBe(0);
    expect(computeSplit(direct({ totalCents: 3, cleaningFeeCents: 0 }), { ...managed, commissionBps: 1750 }).commissionCents).toBe(1);
  });

  it("0 % and 100 % commissions", () => {
    expect(computeSplit(direct(), { ...managed, commissionBps: 0 })).toMatchObject({ commissionCents: 0, ownerShareCents: 300_000 });
    expect(computeSplit(direct(), { ...managed, commissionBps: 10_000 })).toMatchObject({ commissionCents: 300_000, ownerShareCents: 0 });
  });
});

describe("SUBLEASE (sous-location)", () => {
  it("all the net revenue is Sigma's, cleaning included, no commission, no owner share", () => {
    const s = computeSplit(direct({ source: "AIRBNB" }), { ...managed, managementType: "SUBLEASE", commissionBps: 0, cleaningBeneficiary: "OWNER", platformFeeBps: 1550 });
    // F = 15,5 % × 3 300 = 511,50; Sigma keeps 3 300 − 511,50.
    expect(s).toMatchObject({ platformFeeCents: 51_150, cleaningSigmaCents: 30_000, cleaningOwnerCents: 0, commissionCents: 0, ownerShareCents: 0, sigmaRentalCents: 248_850, ownerTotalCents: 0, sigmaTotalCents: 278_850 });
    expectInvariants(s);
  });
  it("ignores a commission rate given for a sublease", () => {
    const s = computeSplit(direct(), { ...managed, managementType: "SUBLEASE", commissionBps: 2000 });
    expect(s.commissionCents).toBe(0);
    expect(s.sigmaRentalCents).toBe(300_000);
  });
});

describe("platform fees", () => {
  it("estimated at the platform's default rate when only the guest total is known", () => {
    const s = computeSplit(direct({ source: "BOOKING", totalCents: 100_000, cleaningFeeCents: 0 }), { ...managed, platformFeeBps: 1700 });
    expect(s).toMatchObject({ feeSource: "ESTIMATE", platformFeeCents: 17_000, commissionBaseCents: 83_000, commissionCents: 16_600, ownerShareCents: 66_400 });
  });
  it("exact from the e-mail: payout and the booking's total", () => {
    const s = computeSplit(direct({ source: "AIRBNB", totalCents: 120_000, cleaningFeeCents: 10_000, platformAmount: { cents: 101_400, currency: "MAD", kind: "PAYOUT" } }), { ...managed, platformFeeBps: 1550 });
    expect(s).toMatchObject({ grossSource: "BOOKING", feeSource: "EMAIL", grossCents: 120_000, platformFeeCents: 18_600, netCents: 101_400, cleaningSigmaCents: 10_000, commissionBaseCents: 91_400, commissionCents: 18_280 });
    expectInvariants(s);
  });
  it("a payout alone: the gross is estimated, the net (commission base) is exact", () => {
    const s = computeSplit(direct({ source: "AIRBNB", totalCents: null, cleaningFeeCents: null, platformAmount: { cents: 84_500, currency: "MAD", kind: "PAYOUT" } }), { ...managed, platformFeeBps: 1550 });
    expect(grossFromPayout(84_500, 1550)).toBe(100_000);
    expect(s).toMatchObject({ grossSource: "ESTIMATE", feeSource: "ESTIMATE", grossCents: 100_000, platformFeeCents: 15_500, netCents: 84_500, commissionBaseCents: 84_500, commissionCents: 16_900 });
    expectInvariants(s);
  });
  it("a MAD payout that filled the booking's total is not taken as the guest total", () => {
    const s = computeSplit(direct({ source: "AIRBNB", totalCents: 84_500, cleaningFeeCents: 0, platformAmount: { cents: 84_500, currency: "MAD", kind: "PAYOUT" } }), { ...managed, platformFeeBps: 1550 });
    expect(s).toMatchObject({ grossCents: 100_000, netCents: 84_500, grossSource: "ESTIMATE" });
  });
  it("a guest total from the e-mail is the gross; the fee is estimated", () => {
    const s = computeSplit(direct({ source: "BOOKING", totalCents: null, cleaningFeeCents: null, platformAmount: { cents: 150_000, currency: "MAD", kind: "GUEST_TOTAL" } }), { ...managed, platformFeeBps: 1700 });
    expect(s).toMatchObject({ grossSource: "EMAIL", grossCents: 150_000, feeSource: "ESTIMATE", platformFeeCents: 25_500 });
  });
  it("typed by hand: beats the e-mail and the estimate, never more than the gross", () => {
    const input = direct({ source: "AGODA", totalCents: 100_000, cleaningFeeCents: 20_000 });
    expect(computeSplit(input, { ...managed, platformFeeBps: 1800 }, { ...none, platformFeeCents: 12_345 })).toMatchObject({ feeSource: "MANUAL", platformFeeCents: 12_345 });
    expect(computeSplit(input, { ...managed, platformFeeBps: 1800 }, { ...none, platformFeeCents: 0 })).toMatchObject({ feeSource: "MANUAL", platformFeeCents: 0 });
    const capped = computeSplit(input, managed, { ...none, platformFeeCents: 500_000 });
    expect(capped).toMatchObject({ platformFeeCents: 100_000, cleaningSigmaCents: 0, commissionCents: 0, ownerShareCents: 0 });
    expectInvariants(capped);
  });
  it("fees are borne by the rent: cleaning is cut only when fees leave less than it", () => {
    const s = computeSplit(direct({ source: "OTHER", totalCents: 10_000, cleaningFeeCents: 9_000 }), managed, { ...none, platformFeeCents: 2_000 });
    expect(s).toMatchObject({ platformFeeCents: 2_000, cleaningSigmaCents: 8_000, commissionCents: 0, ownerShareCents: 0 });
    expectInvariants(s);
  });
  it("default rates are an organization parameter, completed with the defaults", () => {
    expect(platformFeeRates({ AIRBNB: 300, BOOKING: -1, AGODA: "x", NOPE: 4 })).toEqual({ ...DEFAULT_PLATFORM_FEE_BPS, AIRBNB: 300 });
    expect(platformFeeRates(null)).toEqual(DEFAULT_PLATFORM_FEE_BPS);
    expect(platformFeeBpsFor("DIRECT", {})).toBe(0);
    expect(platformFeeBpsFor("TRIPCOM", { TRIPCOM: 1200 })).toBe(1200);
  });
});

describe("currencies", () => {
  const eur = direct({ source: "BOOKING", totalCents: null, cleaningFeeCents: null, platformAmount: { cents: 30_000, currency: "EUR", kind: "GUEST_TOTAL" } });
  it("an amount in euros waits for the rate typed by an associé", () => {
    const s = computeSplit(eur, { ...managed, platformFeeBps: 1700 });
    expect(s).toMatchObject({ status: "MISSING_RATE", grossCents: 0, months: [], foreignAmount: { cents: 30_000, currency: "EUR" } });
  });
  it("converts at the rate stored on the split, to the centime", () => {
    const s = computeSplit(eur, { ...managed, platformFeeBps: 1700 }, { ...none, fxRateMicros: 10_851_200 });
    // 300,00 € × 10,8512 = 3 255,36 MAD.
    expect(s).toMatchObject({ status: "COMPLETE", grossCents: 325_536, platformFeeCents: 55_341, foreignAmount: { currency: "EUR" } });
    expectInvariants(s);
  });
  it("a gross typed in MAD needs no rate", () => {
    expect(computeSplit(eur, managed, { ...none, grossCents: 300_000 })).toMatchObject({ status: "COMPLETE", grossSource: "MANUAL", grossCents: 300_000 });
  });
});

describe("statuses", () => {
  it("owner blocks and imported « not available » blocks have no split", () => {
    expect(computeSplit(direct({ source: "OWNER", totalCents: null, cleaningFeeCents: null }), managed).status).toBe("NOT_APPLICABLE");
    expect(computeSplit(direct({ source: "AIRBNB", channelBlock: true, totalCents: null, cleaningFeeCents: null }), managed).status).toBe("NOT_APPLICABLE");
  });
  it("an iCal booking without an amount waits for one", () => {
    expect(computeSplit(direct({ source: "AIRBNB", totalCents: null, cleaningFeeCents: null }), managed)).toMatchObject({ status: "MISSING_AMOUNT", grossCents: 0, months: [] });
  });
  it("a cancelled booking is all zero, unless an associé typed what was kept (no cleaning then)", () => {
    expect(computeSplit(direct({ status: "CANCELLED" }), managed)).toMatchObject({ status: "CANCELLED", grossCents: 0, months: [] });
    const kept = computeSplit(direct({ status: "CANCELLED" }), managed, { ...none, grossCents: 50_000 });
    expect(kept).toMatchObject({ status: "COMPLETE", grossCents: 50_000, cleaningSigmaCents: 0, commissionCents: 10_000, ownerShareCents: 40_000 });
    expectInvariants(kept);
  });
});

describe("mois à cheval", () => {
  it("shares each part by nights between the months", () => {
    // 30/10 → 02/11: 2 nights in October, 1 in November.
    const s = computeSplit(direct({ checkIn: "2026-10-30", checkOut: "2026-11-02", totalCents: 100_000, cleaningFeeCents: 10_000 }), managed);
    expect(monthWeights("2026-10-30", "2026-11-02", "NIGHTS")).toEqual([
      { month: "2026-10", nights: 2 },
      { month: "2026-11", nights: 1 },
    ]);
    // Rent 900 → K 180, O 720; cleaning 100. October: 2/3, November: 1/3, largest remainder per part.
    expect(s.months).toEqual([
      { month: "2026-10", nights: 2, grossCents: 66_667, platformFeeCents: 0, cleaningSigmaCents: 6_667, cleaningOwnerCents: 0, commissionCents: 12_000, ownerShareCents: 48_000, sigmaRentalCents: 0 },
      { month: "2026-11", nights: 1, grossCents: 33_333, platformFeeCents: 0, cleaningSigmaCents: 3_333, cleaningOwnerCents: 0, commissionCents: 6_000, ownerShareCents: 24_000, sigmaRentalCents: 0 },
    ]);
    expectInvariants(s);
  });
  it("a stay over three months, and over the new year", () => {
    const s = computeSplit(direct({ checkIn: "2026-12-30", checkOut: "2027-02-02", totalCents: 1_000_001, cleaningFeeCents: 0 }), managed);
    expect(s.months.map((m) => [m.month, m.nights])).toEqual([
      ["2026-12", 2],
      ["2027-01", 31],
      ["2027-02", 1],
    ]);
    expectInvariants(s);
  });
  it("the night of 31/10 is October's and the departure day isn't a night", () => {
    expect(monthWeights("2026-10-31", "2026-11-01", "NIGHTS")).toEqual([{ month: "2026-10", nights: 1 }]);
    expect(monthWeights("2026-02-28", "2026-03-01", "NIGHTS")).toEqual([{ month: "2026-02", nights: 1 }]);
    expect(monthWeights("2028-02-28", "2028-03-01", "NIGHTS")).toEqual([{ month: "2028-02", nights: 2 }]);
  });
  it("by departure date (parameter): everything in the checkout month", () => {
    const s = computeSplit(direct({ checkIn: "2026-10-30", checkOut: "2026-11-02" }), { ...managed, allocation: "CHECKOUT" });
    expect(s.months).toHaveLength(1);
    expect(s.months[0]).toMatchObject({ month: "2026-11", nights: 3, grossCents: s.grossCents });
    // A stay leaving on 1/11 counts in November by checkout, October by nights.
    expect(monthWeights("2026-10-28", "2026-11-01", "CHECKOUT")).toEqual([{ month: "2026-11", nights: 4 }]);
  });
});

describe("property: random bookings (seed 2026)", () => {
  it("parts sum to the gross, months to the parts, nothing negative, recomputing gives the same split", () => {
    const r = prng(2026);
    const sources = ["DIRECT", "AIRBNB", "BOOKING", "AGODA", "TRIPCOM", "EXPEDIA", "OTHER"];
    for (let i = 0; i < 1500; i++) {
      const start = Date.UTC(2026, r.int(0, 11), r.int(1, 28));
      const nights = r.int(1, 70);
      const checkIn = new Date(start).toISOString().slice(0, 10);
      const checkOut = new Date(start + nights * 86_400_000).toISOString().slice(0, 10);
      const total = r.int(0, 3) === 0 ? null : r.int(1, 20_000_000);
      const kind = r.pick(["PAYOUT", "GUEST_TOTAL"] as const);
      const platformAmount = r.int(0, 2) === 0 ? { cents: r.int(1, 15_000_000), currency: r.pick(["MAD", "EUR", "USD"]), kind } : null;
      const input: SplitInput = { source: r.pick(sources), status: r.int(0, 9) === 0 ? "CANCELLED" : "CONFIRMED", channelBlock: false, checkIn, checkOut, totalCents: total, cleaningFeeCents: r.int(0, 2) === 0 ? null : r.int(0, 500_000), platformAmount };
      const terms: SplitTerms = {
        managementType: r.pick(["MANAGED", "SUBLEASE"] as const),
        commissionBps: r.int(0, 10_000),
        cleaningBeneficiary: r.pick(["SIGMA", "OWNER"] as const),
        commissionBase: r.pick(["NET_EXCL_CLEANING", "GROSS_EXCL_CLEANING"] as const),
        allocation: r.pick(["NIGHTS", "CHECKOUT"] as const),
        platformFeeBps: r.int(0, 3000),
      };
      const overrides: SplitOverrides = {
        grossCents: r.int(0, 5) === 0 ? r.int(0, 10_000_000) : null,
        platformFeeCents: r.int(0, 5) === 0 ? r.int(0, 3_000_000) : null,
        fxRateMicros: r.int(0, 1) ? r.int(1, 20_000_000) : null,
      };
      const s = computeSplit(input, terms, overrides);
      expectInvariants(s);
      if (terms.managementType === "SUBLEASE") expect(s.ownerTotalCents).toBe(0);
      if (s.status === "COMPLETE") {
        expect(s.months.reduce((t, m) => t + m.nights, 0)).toBe(nights);
        expect(s.commissionCents).toBeLessThanOrEqual(s.grossCents - s.platformFeeCents - s.cleaningSigmaCents - s.cleaningOwnerCents);
      } else expect(s.grossCents).toBe(0);
      expect(computeSplit(input, terms, overrides)).toEqual(s);
    }
  });
});

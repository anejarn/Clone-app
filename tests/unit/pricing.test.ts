import { describe, expect, it } from "vitest";
import {
  COMMISSION_BPS,
  commissionBpsFor,
  FOUNDING_COMMISSION_BPS,
  guestPrice,
  hostSplit,
  priceStay,
  type StayPricingInput,
} from "@/lib/pricing";
import { prng } from "../../prisma/fixtures";

describe("commission rate", () => {
  it("is 10 %, or 5 % for founding hosts on stays checking in by 30 April 2027", () => {
    expect(COMMISSION_BPS).toBe(1000);
    expect(FOUNDING_COMMISSION_BPS).toBe(500);
    expect(commissionBpsFor(false, "2027-02-13")).toBe(1000);
    expect(commissionBpsFor(true, "2027-02-13")).toBe(500);
    expect(commissionBpsFor(true, "2027-04-30")).toBe(500);
    expect(commissionBpsFor(true, "2027-05-01")).toBe(1000);
    expect(commissionBpsFor(true, new Date("2027-04-30T00:00:00Z"))).toBe(500);
    expect(commissionBpsFor(true, new Date("2027-05-01T00:00:00Z"))).toBe(1000);
  });

  it("follows the check-in day, not the stay's end", () => {
    const base: StayPricingInput = { nightlyCents: 10_000, cleaningFeeCents: 0, nights: 5, checkIn: "2027-04-28", inseeCode: "05096", stars: 3, isFoundingHost: true, adults: 2 };
    expect(priceStay(base).host.commissionBps).toBe(500);
    expect(priceStay({ ...base, checkIn: "2027-04-30" }).host.commissionBps).toBe(500);
    expect(priceStay({ ...base, checkIn: "2027-05-01" }).host.commissionBps).toBe(1000);
    expect(priceStay({ ...base, isFoundingHost: false }).host.commissionBps).toBe(1000);
  });
});

describe("host split", () => {
  it("takes 10 % + 20 % VAT (12 % in all) from the base", () => {
    expect(hostSplit(100_000, 1000)).toEqual({ commissionBps: 1000, commissionCents: 10_000, commissionVatCents: 2_000, hostPayoutCents: 88_000 });
    expect(hostSplit(100_000, 500)).toEqual({ commissionBps: 500, commissionCents: 5_000, commissionVatCents: 1_000, hostPayoutCents: 94_000 });
  });

  it("rounds commission and VAT to the cent", () => {
    // 12 345 × 10 % = 1 234.5 → 1 235; × 20 % = 247
    expect(hostSplit(12_345, 1000)).toEqual({ commissionBps: 1000, commissionCents: 1_235, commissionVatCents: 247, hostPayoutCents: 10_863 });
    // 12 345 × 5 % = 617.25 → 617; × 20 % = 123.4 → 123
    expect(hostSplit(12_345, 500)).toEqual({ commissionBps: 500, commissionCents: 617, commissionVatCents: 123, hostPayoutCents: 11_605 });
    // 1 234 × 5 % = 61.7 → 62; × 20 % = 12.4 → 12
    expect(hostSplit(1_234, 500)).toMatchObject({ commissionCents: 62, commissionVatCents: 12 });
  });
});

describe("a stay, both sides", () => {
  it("prices a week in a 3★ Orcières flat", () => {
    const p = priceStay({ nightlyCents: 15_000, cleaningFeeCents: 6_000, nights: 7, checkIn: "2027-02-13", inseeCode: "05096", stars: 3, isFoundingHost: false, adults: 2, children: 1 });
    expect(p.guest).toEqual({ nights: 7, nightlyCents: 15_000, stayCents: 105_000, cleaningFeeCents: 6_000, touristTaxCents: 121 * 2 * 7, totalCents: 111_000 + 1_694 });
    expect(p.host).toEqual({ commissionBps: 1000, commissionCents: 11_100, commissionVatCents: 2_220, hostPayoutCents: 97_680 });
  });

  it("keeps the tourist tax out of the commission base", () => {
    const a = priceStay({ nightlyCents: 20_000, cleaningFeeCents: 5_000, nights: 3, checkIn: "2027-02-13", inseeCode: "05098", stars: 5, isFoundingHost: false, adults: 1 });
    const b = priceStay({ nightlyCents: 20_000, cleaningFeeCents: 5_000, nights: 3, checkIn: "2027-02-13", inseeCode: "05098", stars: 5, isFoundingHost: false, adults: 6 });
    expect(b.guest.touristTaxCents).toBeGreaterThan(a.guest.touristTaxCents);
    expect(b.host).toEqual(a.host);
  });

  it("is all zeros without nights", () => {
    expect(guestPrice(10_000, 0, 5_000, 0)).toMatchObject({ stayCents: 0, cleaningFeeCents: 0, touristTaxCents: 0, totalCents: 0 });
  });

  it("holds its invariants for any stay (property check)", () => {
    const rand = prng(2027);
    const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
    for (let i = 0; i < 5_000; i++) {
      const input: StayPricingInput = {
        nightlyCents: int(1, 400_00),
        cleaningFeeCents: int(0, 150_00),
        nights: int(1, 60),
        checkIn: rand() < 0.5 ? "2027-04-30" : "2027-05-01",
        inseeCode: rand() < 0.5 ? "05096" : "05098",
        stars: rand() < 0.4 ? null : int(1, 5),
        isFoundingHost: rand() < 0.33,
        adults: int(1, 10),
        children: int(0, 6),
        infants: int(0, 3),
      };
      const { guest, host } = priceStay(input);
      const base = guest.stayCents + guest.cleaningFeeCents;
      const all = [...Object.values(guest), ...Object.values(host)];
      expect(all.every(Number.isInteger), JSON.stringify(input)).toBe(true);
      expect(all.every((v) => v >= 0), JSON.stringify(input)).toBe(true);
      // Guest lines sum to the guest total.
      expect(guest.stayCents + guest.cleaningFeeCents + guest.touristTaxCents).toBe(guest.totalCents);
      expect(guest.stayCents).toBe(input.nightlyCents * input.nights);
      // Host side: payout + commission + VAT is exactly the base.
      expect(host.hostPayoutCents + host.commissionCents + host.commissionVatCents).toBe(base);
      // Commission within half a cent of the rate, VAT within half a cent of 20 % of it.
      expect(Math.abs(host.commissionCents - (base * host.commissionBps) / 10_000)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(host.commissionVatCents - host.commissionCents * 0.2)).toBeLessThanOrEqual(0.5);
    }
  });
});

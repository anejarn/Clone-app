import { describe, expect, it } from "vitest";
import { convertToMad, formatRate, parseRate } from "@/lib/finance/fx";
import { allocate, applyBps, mulDivRound } from "@/lib/finance/rounding";
import { prng } from "../support/prng";

describe("mulDivRound / applyBps", () => {
  it("rounds halves away from zero", () => {
    expect(mulDivRound(1, 1, 2)).toBe(1);
    expect(mulDivRound(-1, 1, 2)).toBe(-1);
    expect(mulDivRound(3, 1, 2)).toBe(2);
    expect(mulDivRound(1, 1, 3)).toBe(0);
    expect(mulDivRound(2, 1, 3)).toBe(1);
    expect(mulDivRound(0, 5, 7)).toBe(0);
    expect(Object.is(mulDivRound(-1, 1, 3), 0)).toBe(true);
  });
  it("takes 20 % of amounts to the centime", () => {
    expect(applyBps(100_000, 2000)).toBe(20_000);
    expect(applyBps(12_345, 2000)).toBe(2469); // 2469.0
    expect(applyBps(12_347, 2000)).toBe(2469); // 2469.4
    expect(applyBps(12_348, 2000)).toBe(2470); // 2469.6
    expect(applyBps(25, 2000)).toBe(5);
    expect(applyBps(2, 2500)).toBe(1); // 0.5 → 1
    expect(applyBps(99_999, 1550)).toBe(15_500); // 15499.845
  });
  it("is exact past 2^53 intermediate products", () => {
    expect(mulDivRound(900_000_000_000, 10_000, 10_000)).toBe(900_000_000_000);
    expect(mulDivRound(2 ** 52, 3, 3)).toBe(2 ** 52);
  });
  it("refuses floats and a zero divisor", () => {
    expect(() => mulDivRound(1.5, 1, 1)).toThrow(RangeError);
    expect(() => mulDivRound(1, 1, 0)).toThrow(RangeError);
  });
});

describe("allocate (largest remainder)", () => {
  it("shares exactly, remainders to the largest fractions, ties to the first", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(200, [1, 1, 1])).toEqual([67, 67, 66]);
    expect(allocate(10, [2, 1])).toEqual([7, 3]);
    expect(allocate(1, [1, 1])).toEqual([1, 0]);
    expect(allocate(0, [3, 4])).toEqual([0, 0]);
    expect(allocate(7, [0, 5])).toEqual([0, 7]);
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocate(5, [3])).toEqual([5]);
  });
  it("refuses zero weights for a non-zero amount and invalid weights", () => {
    expect(allocate(0, [0, 0])).toEqual([0, 0]);
    expect(() => allocate(1, [0, 0])).toThrow(RangeError);
    expect(() => allocate(1, [-1, 2])).toThrow(RangeError);
    expect(() => allocate(1, [0.5])).toThrow(RangeError);
  });
  it("property: always sums to the total, each share within one centime of its quota (seed 6)", () => {
    const r = prng(6);
    for (let i = 0; i < 2000; i++) {
      const weights = Array.from({ length: r.int(1, 12) }, () => r.int(0, 31));
      if (!weights.some((w) => w > 0)) weights[0] = 1;
      const total = r.int(-5_000_000, 50_000_000);
      const shares = allocate(total, weights);
      const W = weights.reduce((s, w) => s + w, 0);
      expect(shares.reduce((s, x) => s + x, 0)).toBe(total);
      shares.forEach((s, k) => {
        expect(Number.isInteger(s)).toBe(true);
        expect(Math.abs(s - (total * weights[k]) / W)).toBeLessThan(1);
        if (weights[k] === 0) expect(s).toBe(0);
      });
    }
  });
});

describe("exchange rates", () => {
  it("parses rates with up to six decimals, comma or point", () => {
    expect(parseRate("10,85")).toBe(10_850_000);
    expect(parseRate("10.8512")).toBe(10_851_200);
    expect(parseRate(" 11 ")).toBe(11_000_000);
    expect(parseRate("0,000001")).toBe(1);
    for (const bad of ["", "0", "0,0", "-10", "10,1234567", "1e3", "abc", "10001"]) expect(parseRate(bad)).toBeNull();
  });
  it("formats rates without trailing zeros", () => {
    expect(formatRate(10_850_000)).toBe("10,85");
    expect(formatRate(11_000_000)).toBe("11");
    expect(formatRate(1)).toBe("0,000001");
  });
  it("converts foreign cents to centimes, rounded to the centime", () => {
    expect(convertToMad(100_00, 10_850_000)).toBe(1085_00); // 100 € at 10,85
    expect(convertToMad(1, 10_850_000)).toBe(11); // 10,85 centimes → 11
    expect(convertToMad(123_45, 10_851_200)).toBe(133_958); // 133 958,064
    expect(() => convertToMad(100, 0)).toThrow(RangeError);
  });
});

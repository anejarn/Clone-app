import { describe, expect, it } from "vitest";
import { bpsToPercent, centimesToDirhams, dirhamsToCentimes, percentToBps } from "@/lib/money";

describe("dirhams typed in a form ↔ centimes stored", () => {
  it("reads whole dirhams, decimal comma or point, and thousands spaces", () => {
    expect(dirhamsToCentimes("1200")).toBe(120_000);
    expect(dirhamsToCentimes("1 200")).toBe(120_000);
    expect(dirhamsToCentimes("1 200,50")).toBe(120_050);
    expect(dirhamsToCentimes("1 200.5")).toBe(120_050);
    expect(dirhamsToCentimes(" 19,99 ")).toBe(1_999);
    expect(dirhamsToCentimes("0,01")).toBe(1);
    expect(dirhamsToCentimes("0")).toBe(0);
    expect(dirhamsToCentimes("999999999,99")).toBe(99_999_999_999);
  });

  it("is exact where floating point is not (0,29 × 100 = 28,999…)", () => {
    expect(dirhamsToCentimes("0,29")).toBe(29);
    expect(dirhamsToCentimes("1,15")).toBe(115);
    expect(dirhamsToCentimes("4,35")).toBe(435);
  });

  it("refuses anything that is not a positive amount with at most two decimals", () => {
    for (const bad of ["", " ", "-5", "+5", "1,234", "12,", ",5", "1e3", "1.2.3", "12 MAD", "abc", "1_000", "Infinity", "NaN", "0x10", "1000000000"]) {
      expect(dirhamsToCentimes(bad), bad).toBeNull();
    }
  });

  it("writes centimes back as the form shows them", () => {
    expect(centimesToDirhams(120_000)).toBe("1200");
    expect(centimesToDirhams(120_050)).toBe("1200,50");
    expect(centimesToDirhams(1_999)).toBe("19,99");
    expect(centimesToDirhams(5)).toBe("0,05");
    expect(centimesToDirhams(0)).toBe("0");
    expect(() => centimesToDirhams(-1)).toThrow(RangeError);
    expect(() => centimesToDirhams(1.5)).toThrow(RangeError);
  });

  it("round-trips every amount", () => {
    for (const c of [0, 1, 9, 10, 99, 100, 101, 12_345, 99_999, 1_000_000, 100_000_000]) {
      expect(dirhamsToCentimes(centimesToDirhams(c))).toBe(c);
    }
  });
});

describe("percent typed in a form ↔ basis points stored", () => {
  it("converts commissions", () => {
    expect(percentToBps("20")).toBe(2_000);
    expect(percentToBps("17,5")).toBe(1_750);
    expect(percentToBps("12.34")).toBe(1_234);
    expect(percentToBps("0")).toBe(0);
    expect(percentToBps("100")).toBe(10_000);
    expect(percentToBps("12,345")).toBeNull();
    expect(percentToBps("-1")).toBeNull();
  });

  it("writes basis points back without trailing zeros", () => {
    expect(bpsToPercent(2_000)).toBe("20");
    expect(bpsToPercent(1_750)).toBe("17,5");
    expect(bpsToPercent(1_234)).toBe("12,34");
    expect(bpsToPercent(1_505)).toBe("15,05");
    expect(bpsToPercent(0)).toBe("0");
    for (const b of [0, 1, 10, 1_500, 1_750, 2_000, 9_999, 10_000]) expect(percentToBps(bpsToPercent(b))).toBe(b);
  });
});

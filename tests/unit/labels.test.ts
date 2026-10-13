import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/format";
import { classificationLabel, liftDistanceLabel, minNightsLabel, SKI_IN_MAX_M } from "@/lib/labels";

const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("listing labels", () => {
  it("names the classification", () => {
    expect(classificationLabel(3)).toBe("Meublé 3★");
    expect(classificationLabel(null)).toBe("Non classé");
  });
  it("says 'Ski aux pieds' up to 50 m, the distance beyond, with a non-breaking space before the unit", () => {
    expect(liftDistanceLabel(0)).toBe("Ski aux pieds");
    expect(liftDistanceLabel(SKI_IN_MAX_M)).toBe("Ski aux pieds");
    expect(liftDistanceLabel(51)).toBe("À 51 m des pistes");
    expect(liftDistanceLabel(350)).toBe("À 350 m des pistes");
  });
  it("words the minimum stay", () => {
    expect(minNightsLabel(3)).toBe("Séjour de 3 nuits minimum");
  });
});

describe("formatPrice", () => {
  it("shows cents only when there are some, euro sign after a non-breaking space", () => {
    expect(formatPrice(36_000)).toBe("360 €");
    expect(plain(formatPrice(297))).toBe("2,97 €");
    expect(plain(formatPrice(123_450))).toBe("1 234,50 €");
    expect(formatPrice(297)).toMatch(/ €$/);
  });
});

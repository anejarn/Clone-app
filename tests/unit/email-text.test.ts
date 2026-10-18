import { describe, expect, it } from "vitest";
import { parseAmount, parseDate, parseGuests, parseNumberToCents, valueAfter } from "@/lib/channels/email/text";

/** Values read from the booking e-mails' text in French, English and Spanish (lib/channels/email/text.ts). */

const REF = new Date("2027-06-01T00:00:00Z");

describe("dates", () => {
  it.each([
    ["lun. 12 juil. 2027", "2027-07-12"],
    ["jeudi 1er août 2027", "2027-08-01"],
    ["12 juillet 2027", "2027-07-12"],
    ["Tue, Aug 3, 2027", "2027-08-03"],
    ["Sunday, October 10th 2027", "2027-10-10"],
    ["Sun 10 Oct 2027", "2027-10-10"],
    ["October 21, 2027", "2027-10-21"],
    ["14 de septiembre de 2027", "2027-09-14"],
    ["sáb., 17 de julio de 2027", "2027-07-17"],
    ["mar. 3 août 2027", "2027-08-03"],
    ["mar., 13 de julio de 2027", "2027-07-13"],
    ["12/07/2027", "2027-07-12"],
    ["03.11.2027", "2027-11-03"],
    ["2027-11-02", "2027-11-02"],
    ["2027/11/02 14:00", "2027-11-02"],
  ])("%s → %s", (s, want) => {
    expect(parseDate(s, REF)).toBe(want);
  });

  it("without a year: the next occurrence, not more than 60 days in the past", () => {
    expect(parseDate("ven. 12 juil.", REF)).toBe("2027-07-12");
    expect(parseDate("mar. 3 août", REF)).toBe("2027-08-03");
    expect(parseDate("Jan 5", REF)).toBe("2028-01-05");
    expect(parseDate("15 mai", REF)).toBe("2027-05-15");
    expect(parseDate("15 mars", REF)).toBe("2028-03-15");
  });

  it("refuses impossible dates and text without a date", () => {
    expect(parseDate("31/02/2027", REF)).toBeNull();
    expect(parseDate("2027-13-01", REF)).toBeNull();
    expect(parseDate("Arrivée à 15:00", REF)).toBeNull();
    expect(parseDate("Order 1290000000001", REF)).toBeNull();
  });
});

describe("amounts", () => {
  it.each([
    ["1 234,56 MAD", 123_456, "MAD"],
    ["4 512,00 MAD", 451_200, "MAD"],
    ["MAD 4 512,00", 451_200, "MAD"],
    ["€1,234.56", 123_456, "EUR"],
    ["1.234,56 €", 123_456, "EUR"],
    ["€ 480.00", 48_000, "EUR"],
    ["612,40 €", 61_240, "EUR"],
    ["US$ 300.00", 30_000, "USD"],
    ["USD 360", 36_000, "USD"],
    ["$99.5", 9_950, "USD"],
    ["EUR 390.00", 39_000, "EUR"],
    ["450 DH", 45_000, "MAD"],
    ["2 200 Dhs", 220_000, "MAD"],
    ["£1,000", 100_000, "GBP"],
    ["12 600,00 MAD", 1_260_000, "MAD"],
    ["Total (MAD) 5 280,00 MAD", 528_000, "MAD"],
  ])("%s", (s, cents, currency) => {
    expect(parseAmount(s)).toEqual({ cents, currency });
  });

  it("no currency, no amount; zero is not an amount", () => {
    expect(parseAmount("3 nuits")).toBeNull();
    expect(parseAmount("1234")).toBeNull();
    expect(parseAmount("0,00 €")).toBeNull();
  });

  it("numbers: decimal comma or point, thousands separators", () => {
    expect(parseNumberToCents("1 234,56")).toBe(123_456);
    expect(parseNumberToCents("1,234.56")).toBe(123_456);
    expect(parseNumberToCents("1.234")).toBe(123_400);
    expect(parseNumberToCents("1,234,567")).toBe(123_456_700);
    expect(parseNumberToCents("12,5")).toBe(1_250);
    expect(parseNumberToCents("1.2.3")).toBeNull();
    expect(parseNumberToCents("1,23,45")).toBeNull();
    expect(parseNumberToCents("abc")).toBeNull();
  });
});

describe("guests and labels", () => {
  it("guest counts in three languages", () => {
    expect(parseGuests("2 adultes, 1 enfant, 1 bébé")).toEqual({ adults: 2, children: 1, infants: 1, total: 3 });
    expect(parseGuests("2 adults, 0 children")).toEqual({ adults: 2, children: 0, infants: null, total: 2 });
    expect(parseGuests("2 adultos, 1 niño")).toMatchObject({ adults: 2, children: 1, total: 3 });
    expect(parseGuests("4 voyageurs")).toMatchObject({ adults: 4, total: 4 });
    expect(parseGuests("3 huéspedes")).toMatchObject({ adults: 3, total: 3 });
    expect(parseGuests("")).toEqual({ adults: null, children: null, infants: null, total: null });
  });

  it("the value after a label: same line, next line, accents and case ignored, longer labels not taken for shorter ones, a value that must pass a check", () => {
    const t = "Arrivée : lun. 12 juil. 2027\nCheck-in time\n15:00\nDÉPART\n\njeu. 15 juil. 2027\nGuests\n2 adults";
    expect(valueAfter(t, ["Arrivée"])).toBe("lun. 12 juil. 2027");
    expect(valueAfter(t, ["Départ"])).toBe("jeu. 15 juil. 2027");
    expect(valueAfter(t, ["Check-in"])).toBe("time");
    expect(valueAfter(t, ["Check-in"], 1, (v) => /\d{4}/.test(v))).toBeNull();
    expect(valueAfter("Check-in time\n15:00\nCheck-in\nTue, Aug 3, 2027", ["Check-in"], 1, (v) => /\d{4}/.test(v))).toBe("Tue, Aug 3, 2027");
    expect(valueAfter(t, ["Guest"])).toBeNull();
    expect(valueAfter(t, ["Guests"])).toBe("2 adults");
    expect(valueAfter("Total\n3 nuits\n4 980,00 MAD", ["Total"], 2)).toBe("3 nuits 4 980,00 MAD");
  });
});

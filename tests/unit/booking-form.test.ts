import { describe, expect, it } from "vitest";
import { directAmounts, parseEntryForm, parseRescheduleForm, platformAmounts, rescheduledAmounts, type EntryValues } from "@/lib/admin/booking-form";

/** Money of bookings typed by the team (CLAUDE.md: every financial computation is tested). Centimes of MAD. */

const riad = { priceCents: 125_000, cleaningFeeCents: 29_000 };

describe("directAmounts: nightly price × nights + cleaning fee", () => {
  it("uses the listing's prices by default, and the lines sum to the total", () => {
    const a = directAmounts(riad, 3);
    expect(a).toEqual({ nights: 3, nightlyCents: 125_000, stayCents: 375_000, cleaningFeeCents: 29_000, serviceFeeCents: 0, totalCents: 404_000 });
    expect(a.stayCents + a.cleaningFeeCents + a.serviceFeeCents).toBe(a.totalCents);
  });

  it("takes the team's nightly price and cleaning fee when typed, each on its own", () => {
    expect(directAmounts(riad, 2, { nightlyCents: 99_950 })).toMatchObject({ nightlyCents: 99_950, stayCents: 199_900, cleaningFeeCents: 29_000, totalCents: 228_900 });
    expect(directAmounts(riad, 2, { cleaningFeeCents: 0 })).toMatchObject({ nightlyCents: 125_000, cleaningFeeCents: 0, totalCents: 250_000 });
    expect(directAmounts(riad, 2, { nightlyCents: null, cleaningFeeCents: null })).toEqual(directAmounts(riad, 2));
  });

  it("is exact in centimes, with no floating point drift", () => {
    // 19,99 MAD × 7 nights + 0,07 MAD
    expect(directAmounts({ priceCents: 1_999, cleaningFeeCents: 7 }, 7).totalCents).toBe(14_000);
    // A long stay at a high price stays exact.
    expect(directAmounts({ priceCents: 4_290_050, cleaningFeeCents: 35_000 }, 365).totalCents).toBe(4_290_050 * 365 + 35_000);
  });

  it("is zero when everything is offered (the server then refuses it: a direct booking's total is > 0)", () => {
    expect(directAmounts(riad, 2, { nightlyCents: 0, cleaningFeeCents: 0 }).totalCents).toBe(0);
  });
});

describe("platformAmounts: the platform's total, cleaning included", () => {
  it("keeps the total exactly as typed and stores the average nightly price", () => {
    expect(platformAmounts(400_000, 30_000, 3)).toEqual({ nights: 3, nightlyCents: 123_333, stayCents: 370_000, cleaningFeeCents: 30_000, serviceFeeCents: 0, totalCents: 400_000 });
    // Average rounded to the centime (half up); the total is not recomputed from it.
    expect(platformAmounts(100_001, 0, 2)).toMatchObject({ nightlyCents: 50_001, totalCents: 100_001 });
  });

  it("refuses a cleaning fee above the total", () => {
    expect(() => platformAmounts(10_000, 10_001, 1)).toThrow(RangeError);
  });
});

describe("rescheduledAmounts: new dates", () => {
  const direct = { source: "DIRECT" as const, nightlyCents: 80_000, cleaningFeeCents: 20_000, serviceFeeCents: 0, totalCents: 260_000 };

  it("re-prices a direct booking at its own nightly price and cleaning fee", () => {
    expect(rescheduledAmounts(direct, 5)).toEqual({ nightlyCents: 80_000, cleaningFeeCents: 20_000, serviceFeeCents: 0, totalCents: 420_000 });
    expect(rescheduledAmounts(direct, 1)).toMatchObject({ totalCents: 100_000 });
  });

  it("keeps a platform booking's total, and gives owner blocks and unknown amounts none", () => {
    const airbnb = { ...direct, source: "AIRBNB" as const, totalCents: 333_300 };
    expect(rescheduledAmounts(airbnb, 9)).toMatchObject({ totalCents: 333_300, nightlyCents: 80_000 });
    expect(rescheduledAmounts({ source: "OWNER", nightlyCents: null, cleaningFeeCents: null, serviceFeeCents: null, totalCents: null }, 4)).toBeNull();
    expect(rescheduledAmounts({ source: "BOOKING", nightlyCents: null, cleaningFeeCents: null, serviceFeeCents: null, totalCents: null }, 4)).toBeNull();
  });
});

describe("parseEntryForm", () => {
  const base: EntryValues = { listingId: "1000", checkIn: "2027-05-10", checkOut: "2027-05-13" };
  const direct: EntryValues = { ...base, adults: "2", guestName: "Yassine El Amrani", guestPhone: "+212 6 12 34 56 78", channel: "WHATSAPP", nightly: "", cleaning: "" };

  it("reads a phone booking: dates, counts, contact, no override", () => {
    const r = parseEntryForm("directe", direct);
    expect(r.ok && r.entry).toMatchObject({
      kind: "directe",
      checkIn: new Date("2027-05-10T00:00:00Z"),
      checkOut: new Date("2027-05-13T00:00:00Z"),
      adults: 2,
      children: 0,
      channel: "WHATSAPP",
      nightly: null,
      cleaning: null,
      allowShortStay: false,
    });
  });

  it("reads typed amounts in dirhams as centimes, and the short-stay override", () => {
    const r = parseEntryForm("directe", { ...direct, nightly: "1 100,50", cleaning: "0", allowShortStay: "on" });
    expect(r.ok && r.entry).toMatchObject({ nightly: 110_050, cleaning: 0, allowShortStay: true });
    const bad = parseEntryForm("directe", { ...direct, nightly: "12.345" });
    expect(!bad.ok && bad.fieldErrors.nightly).toMatch(/montant en dirhams/);
  });

  it("needs a name and a phone or an e-mail for a direct booking, and checks them", () => {
    expect(parseEntryForm("directe", { ...direct, guestName: "" })).toMatchObject({ ok: false, fieldErrors: { guestName: "Nom du voyageur : champ obligatoire" } });
    expect(parseEntryForm("directe", { ...direct, guestPhone: "" })).toMatchObject({ ok: false, fieldErrors: { guestPhone: expect.stringContaining("un téléphone ou un e-mail") } });
    expect(parseEntryForm("directe", { ...direct, guestPhone: "", guestEmail: "y@exemple.ma" }).ok).toBe(true);
    expect(parseEntryForm("directe", { ...direct, guestPhone: "12" })).toMatchObject({ ok: false, fieldErrors: { guestPhone: expect.stringContaining("numéro invalide") } });
    expect(parseEntryForm("directe", { ...direct, guestEmail: "pas-un-email" })).toMatchObject({ ok: false, fieldErrors: { guestEmail: "E-mail : adresse invalide" } });
    expect(parseEntryForm("directe", { ...direct, channel: "PIGEON" })).toMatchObject({ ok: false, fieldErrors: { channel: expect.any(String) } });
  });

  it("refuses departure before arrival, impossible dates and stays over 365 nights", () => {
    expect(parseEntryForm("blocage", { ...base, checkOut: "2027-05-10", note: "Famille" })).toMatchObject({ ok: false, fieldErrors: { checkOut: "Départ : après l'arrivée" } });
    expect(parseEntryForm("blocage", { ...base, checkIn: "2027-02-30", note: "Famille" })).toMatchObject({ ok: false, fieldErrors: { checkIn: "Arrivée : date invalide" } });
    expect(parseEntryForm("blocage", { ...base, checkOut: "2028-05-12", note: "Famille" })).toMatchObject({ ok: false, fieldErrors: { checkOut: expect.stringContaining("365") } });
  });

  it("a platform booking needs its platform and code; amounts are optional, the cleaning fee within the total", () => {
    const p: EntryValues = { ...base, adults: "1", source: "AIRBNB", externalRef: "HMABCD1234" };
    expect(parseEntryForm("plateforme", p)).toMatchObject({ ok: true, entry: { source: "AIRBNB", externalRef: "HMABCD1234", total: null, cleaning: null } });
    expect(parseEntryForm("plateforme", { ...p, externalRef: "  " })).toMatchObject({ ok: false, fieldErrors: { externalRef: "Référence de la plateforme : champ obligatoire" } });
    expect(parseEntryForm("plateforme", { ...p, source: "OWNER" })).toMatchObject({ ok: false, fieldErrors: { source: expect.any(String) } });
    expect(parseEntryForm("plateforme", { ...p, source: "DIRECT" }).ok).toBe(false);
    expect(parseEntryForm("plateforme", { ...p, total: "4 000", cleaning: "300" })).toMatchObject({ ok: true, entry: { total: 400_000, cleaning: 30_000 } });
    expect(parseEntryForm("plateforme", { ...p, cleaning: "300" })).toMatchObject({ ok: false, fieldErrors: { total: expect.stringContaining("obligatoire") } });
    expect(parseEntryForm("plateforme", { ...p, total: "200", cleaning: "300" })).toMatchObject({ ok: false, fieldErrors: { cleaning: expect.stringContaining("pas plus") } });
    expect(parseEntryForm("plateforme", { ...p, total: "0" })).toMatchObject({ ok: false, fieldErrors: { total: expect.stringContaining("supérieur à 0") } });
  });

  it("an owner block is dates and a reason; nothing else is read", () => {
    const r = parseEntryForm("blocage", { ...base, note: "Séjour du propriétaire", guestName: "Intrus", total: "999" });
    expect(r).toEqual({ ok: true, entry: { kind: "blocage", listingId: "1000", checkIn: new Date("2027-05-10T00:00:00Z"), checkOut: new Date("2027-05-13T00:00:00Z"), note: "Séjour du propriétaire" } });
    expect(parseEntryForm("blocage", { ...base, note: "" })).toMatchObject({ ok: false, fieldErrors: { note: "Motif : champ obligatoire" } });
  });

  it("refuses control characters and ids that cannot exist", () => {
    expect(parseEntryForm("directe", { ...direct, guestName: "Nom\u0000" })).toMatchObject({ ok: false, fieldErrors: { guestName: expect.stringContaining("caractères non autorisés") } });
    expect(parseEntryForm("directe", { ...direct, listingId: "../1000" })).toMatchObject({ ok: false, fieldErrors: { listingId: expect.any(String) } });
  });
});

describe("parseRescheduleForm", () => {
  it("reads the new dates and the override", () => {
    expect(parseRescheduleForm({ checkIn: "2027-06-01", checkOut: "2027-06-04", allowShortStay: "on" })).toEqual({
      ok: true,
      input: { checkIn: new Date("2027-06-01T00:00:00Z"), checkOut: new Date("2027-06-04T00:00:00Z"), allowShortStay: true },
    });
    expect(parseRescheduleForm({ checkIn: "2027-06-04", checkOut: "2027-06-01" }).ok).toBe(false);
  });
});

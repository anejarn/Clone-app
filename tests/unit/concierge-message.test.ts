import { describe, expect, it } from "vitest";
import { allowedMoves, canSeePartnerPrices, checkMove, paymentRecordable, priceEditable, requestReference, statusTimestamps } from "@/lib/concierge/catalog";
import { parseFinalPriceForm, parsePartnerForm, parseServiceForm, readServiceOptions } from "@/lib/concierge/form";
import { buildPartnerMessage, partnerMailtoLink, partnerMessageSubject, partnerWhatsappLink, type PartnerMessageInput } from "@/lib/concierge/partner-message";
import { formatMad } from "@/lib/format";

/** Conciergerie (Lot 4b): the partner's message and links, the status rules, the back-office forms. */

const NBSP = " ";
const NNBSP = " ";

const msg: PartnerMessageInput = {
  organizationName: "Sigma",
  partnerName: "Hammam des Jardins (démo)",
  reference: "AB12CD",
  title: "Hammam traditionnel et gommage",
  serviceDate: new Date("2026-11-22T00:00:00Z"),
  startMinutes: 18 * 60,
  pricingModel: "PER_PERSON",
  quantity: 2,
  persons: 2,
  options: ["Massage 30 min"],
  place: { address: "Derb Sidi Ahmed 12", placeName: "Médina", city: "Marrakech" },
  guestFirstName: "Lucía",
  contactPhone: "+34 600 000 000",
  guestNote: "Deux femmes,\nmerci",
  partnerTotalCents: 80_000,
};

describe("buildPartnerMessage", () => {
  it("has what the partner needs, in French, with the partner's price only", () => {
    const text = buildPartnerMessage(msg);
    expect(text).toBe(
      [
        "Bonjour Hammam des Jardins (démo),",
        "",
        "Nouvelle demande de Sigma (réf. AB12CD) :",
        "• Service : Hammam traditionnel et gommage",
        "• Date : 22/11/2026 à 18:00",
        "• Personnes : 2",
        "• Options : Massage 30 min",
        "• Lieu : Derb Sidi Ahmed 12, Médina, Marrakech",
        "• Client : Lucía, +34 600 000 000",
        "• Note du client : Deux femmes, merci",
        `• Votre prix : 800${NBSP}MAD`,
        "",
        "Merci de nous confirmer la disponibilité en répondant à ce message.",
        "Sigma",
      ].join("\n"),
    );
  });

  it("names the quantity for other models, asks for a quote, and uses the organization's own name", () => {
    const text = buildPartnerMessage({ ...msg, organizationName: "Riad Conciergerie", pricingModel: "PER_DAY", quantity: 3, options: [], guestNote: "", partnerTotalCents: null, guestFirstName: null });
    expect(text).toContain("Nouvelle demande de Riad Conciergerie");
    expect(text).toContain("• Jours : 3");
    expect(text).toContain("• Prix : à nous indiquer (devis)");
    expect(text).toContain("• Client : voyageur, +34 600 000 000");
    expect(text).not.toContain("Options");
    expect(text).not.toContain("Note du client");
    expect(text).not.toContain("Sigma");
  });

  it("doesn't repeat the neighbourhood when the address has it", () => {
    expect(buildPartnerMessage({ ...msg, place: { address: "12 rue X, Médina", placeName: "Médina", city: "Marrakech" } })).toContain("• Lieu : 12 rue X, Médina, Marrakech");
  });

  it("subject", () => {
    expect(partnerMessageSubject(msg)).toBe("Sigma — demande AB12CD : Hammam traditionnel et gommage le 22/11/2026");
  });
});

describe("links", () => {
  it("wa.me with the international number and the text percent-encoded", () => {
    const link = partnerWhatsappLink("+212 6 00 00 01 05", "Bonjour\nréf. 1 & 2");
    expect(link).toBe("https://wa.me/212600000105?text=Bonjour%0Ar%C3%A9f.%201%20%26%202");
    expect(partnerWhatsappLink("06 00 00 01 05", "x")).toBe("https://wa.me/212600000105?text=x");
    expect(partnerWhatsappLink(null, "x")).toBeNull();
    expect(partnerWhatsappLink("12", "x")).toBeNull();
  });

  it("mailto: with subject and body, CRLF line breaks", () => {
    expect(partnerMailtoLink("hammam@demo.sigma.test", "Réf. A", "a\nb")).toBe("mailto:hammam@demo.sigma.test?subject=R%C3%A9f.%20A&body=a%0D%0Ab");
    expect(partnerMailtoLink(null, "s", "b")).toBeNull();
    expect(partnerMailtoLink("a@b?cc=x@y", "s", "b")).toBeNull();
  });

  it("the whole message round-trips through the wa.me link", () => {
    const text = buildPartnerMessage(msg);
    const url = new URL(partnerWhatsappLink("+212600000105", text)!);
    expect(url.searchParams.get("text")).toBe(text);
  });
});

describe("formatMad", () => {
  it("keeps centimes, groups thousands", () => {
    expect(formatMad(125_050)).toBe(`1${NNBSP}250,50${NBSP}MAD`);
    expect(formatMad(35_000)).toBe(`350${NBSP}MAD`);
    expect(formatMad(5)).toBe(`0,05${NBSP}MAD`);
    expect(formatMad(-1_000)).toBe(`-10${NBSP}MAD`);
    expect(() => formatMad(1.5)).toThrow(RangeError);
  });
});

describe("status rules", () => {
  const req = (status: Parameters<typeof checkMove>[0]["status"], extra: Partial<Parameters<typeof checkMove>[0]> = {}) => ({ status, saleTotalCents: 1000, paidAt: null, ...extra });

  it("NEW → sent, cancelled, refused; sent → confirmed …; final states don't move", () => {
    expect(allowedMoves("NEW")).toEqual(["SENT_TO_PARTNER", "CANCELLED", "REFUSED"]);
    expect(allowedMoves("SENT_TO_PARTNER")).toEqual(["SENT_TO_PARTNER", "CONFIRMED", "CANCELLED", "REFUSED"]);
    expect(allowedMoves("CONFIRMED")).toEqual(["DONE", "CANCELLED"]);
    for (const s of ["DONE", "CANCELLED", "REFUSED"] as const) expect(allowedMoves(s)).toEqual([]);
    expect(checkMove(req("NEW"), "CONFIRMED")).toEqual({ ok: false, reason: "NOT_ALLOWED" });
    expect(checkMove(req("DONE"), "CANCELLED")).toEqual({ ok: false, reason: "NOT_ALLOWED" });
  });

  it("confirming needs a price; cancelling a paid request needs the payment taken back first", () => {
    expect(checkMove(req("SENT_TO_PARTNER", { saleTotalCents: null }), "CONFIRMED")).toEqual({ ok: false, reason: "NO_PRICE" });
    expect(checkMove(req("SENT_TO_PARTNER"), "CONFIRMED")).toEqual({ ok: true });
    expect(checkMove(req("CONFIRMED", { paidAt: new Date() }), "CANCELLED")).toEqual({ ok: false, reason: "PAID" });
    expect(checkMove(req("CONFIRMED", { paidAt: new Date() }), "DONE")).toEqual({ ok: true });
  });

  it("price editable before confirmation, payment after", () => {
    expect(["NEW", "SENT_TO_PARTNER"].every((s) => priceEditable(s as never))).toBe(true);
    expect(["CONFIRMED", "DONE", "CANCELLED", "REFUSED"].some((s) => priceEditable(s as never))).toBe(false);
    expect(paymentRecordable("CONFIRMED") && paymentRecordable("DONE")).toBe(true);
    expect(paymentRecordable("NEW") || paymentRecordable("CANCELLED")).toBe(false);
  });

  it("timestamps per status, partner prices for associés only, short references", () => {
    const now = new Date("2026-11-22T10:00:00Z");
    expect(statusTimestamps("CONFIRMED", now)).toEqual({ confirmedAt: now });
    expect(statusTimestamps("REFUSED", now)).toEqual({ refusedAt: now });
    expect(statusTimestamps("NEW", now)).toEqual({});
    expect(canSeePartnerPrices("ADMIN")).toBe(true);
    for (const r of ["AGENT", "OWNER", "GUEST"] as const) expect(canSeePartnerPrices(r)).toBe(false);
    expect(requestReference("cmabcdefgh12xyz9")).toBe("12XYZ9");
  });
});

describe("back-office forms", () => {
  it("a partner needs a name and the contact of its preferred channel", () => {
    expect(parsePartnerForm({ name: "Atlas", type: "CAR", whatsapp: "+212 600 000 101", preferredChannel: "WHATSAPP", active: "on" })).toEqual({
      ok: true,
      input: { name: "Atlas", type: "CAR", phone: null, whatsapp: "+212 600 000 101", email: null, preferredChannel: "WHATSAPP", notes: "", active: true },
    });
    expect(parsePartnerForm({ name: "Atlas", type: "CAR" })).toMatchObject({ ok: false, fieldErrors: { phone: expect.stringContaining("au moins") } });
    expect(parsePartnerForm({ name: "Atlas", type: "CAR", phone: "+212600000101", preferredChannel: "EMAIL" })).toMatchObject({ ok: false, fieldErrors: { preferredChannel: expect.any(String) } });
    expect(parsePartnerForm({ name: "", type: "SPA", email: "pas-un-email", preferredChannel: "EMAIL" })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String), type: expect.any(String), email: expect.any(String) } });
  });

  const service = { partnerId: "ptn_demo_hammam", category: "HAMMAM", pricingModel: "PER_PERSON", title_fr: "Hammam", salePrice: "300", partnerPrice: "220", leadTimeHours: "4", position: "0", active: "on" };

  it("a service: dirhams to centimes, options with ids, partner ≤ sale", () => {
    let n = 0;
    const r = parseServiceForm({ ...service, title_es: "Hammam (es)", option0_label_fr: "Massage", option0_sale: "250", option0_partner: "180", option0_perUnit: "on", option1_label_fr: "", option1_sale: "999", option2_id: "keepme", option2_label_fr: "Thé", option2_sale: "", option2_partner: "" }, () => `gen${++n}`);
    expect(r).toEqual({
      ok: true,
      input: {
        partnerId: "ptn_demo_hammam",
        category: "HAMMAM",
        title: { fr: "Hammam", es: "Hammam (es)" },
        description: {},
        availability: {},
        pricingModel: "PER_PERSON",
        salePriceCents: 30_000,
        partnerPriceCents: 22_000,
        options: [
          { id: "gen1", label: { fr: "Massage" }, saleCents: 25_000, partnerCents: 18_000, perUnit: true },
          { id: "keepme", label: { fr: "Thé" }, saleCents: 0, partnerCents: 0, perUnit: false },
        ],
        leadTimeHours: 4,
        position: 0,
        active: true,
      },
    });
  });

  it("refuses a negative margin, a missing French title, a bad lead time; on quote has no price", () => {
    expect(parseServiceForm({ ...service, partnerPrice: "301" })).toMatchObject({ ok: false, fieldErrors: { partnerPrice: expect.stringContaining("marge négative") } });
    expect(parseServiceForm({ ...service, title_fr: "", title_en: "Hammam" })).toMatchObject({ ok: false, fieldErrors: { title_fr: expect.any(String) } });
    expect(parseServiceForm({ ...service, leadTimeHours: "721" })).toMatchObject({ ok: false, fieldErrors: { leadTimeHours: expect.any(String) } });
    expect(parseServiceForm({ ...service, option0_label_fr: "X", option0_sale: "10", option0_partner: "20" })).toMatchObject({ ok: false, fieldErrors: { option0_partner: expect.any(String) } });
    const quote = parseServiceForm({ ...service, pricingModel: "ON_QUOTE", salePrice: "", partnerPrice: "" });
    expect(quote).toMatchObject({ ok: true, input: { salePriceCents: null, partnerPriceCents: null } });
    expect(parseServiceForm({ ...service, pricingModel: "ON_QUOTE", option0_label_fr: "X", option0_sale: "10" })).toMatchObject({ ok: false });
  });

  it("reads stored options defensively", () => {
    expect(readServiceOptions([{ id: "a1", label: { fr: "A" }, saleCents: 100, partnerCents: 50, perUnit: true }, { id: "BAD", label: { fr: "B" }, saleCents: 1, partnerCents: 0 }, { id: "c", label: {}, saleCents: 1, partnerCents: 0 }, { id: "d", label: { fr: "D" }, saleCents: 1, partnerCents: 2 }, null])).toEqual([
      { id: "a1", label: { fr: "A" }, saleCents: 100, partnerCents: 50, perUnit: true },
    ]);
    expect(readServiceOptions("nope")).toEqual([]);
  });

  it("final price: totals in dirhams, partner ≤ sale", () => {
    expect(parseFinalPriceForm({ saleTotal: "1 200", partnerTotal: "950,50" })).toEqual({ ok: true, input: { saleTotalCents: 120_000, partnerTotalCents: 95_050 } });
    expect(parseFinalPriceForm({ saleTotal: "100", partnerTotal: "120" })).toMatchObject({ ok: false, fieldErrors: { partnerTotal: expect.any(String) } });
    expect(parseFinalPriceForm({ saleTotal: "", partnerTotal: "-1" })).toMatchObject({ ok: false, fieldErrors: { saleTotal: expect.any(String), partnerTotal: expect.any(String) } });
  });
});

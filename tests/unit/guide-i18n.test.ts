import { describe, expect, it } from "vitest";
import { generateGuideToken, GUIDE_TOKEN_RE, guideTokenMatches, guideUrl, hashGuideToken } from "@/lib/guide/token";
import { parseAccessCode, parseConcierge, parseGuideTexts, parseRecommendation, parseWifi } from "@/lib/guide/form";
import { GUEST_LOCALES, localeDir, matchLocale, negotiateLocale, parseAcceptLanguage } from "@/lib/i18n/locales";
import { localizedLanguages, pickLocalized, readLocalized } from "@/lib/i18n/localized";
import { fill, MESSAGES } from "@/lib/i18n/messages";

/** Guest languages, message catalogs, guide tokens and the guide forms of the back-office. */

describe("locale negotiation", () => {
  it("parses Accept-Language by preference", () => {
    expect(parseAcceptLanguage("de-DE,de;q=0.9,es;q=0.8,en;q=0.7")).toEqual(["de-DE", "de", "es", "en"]);
    expect(parseAcceptLanguage("en;q=0.5, fr")).toEqual(["fr", "en"]);
    expect(parseAcceptLanguage("es;q=0, en;q=abc, ;;, it")).toEqual(["it"]);
    expect(parseAcceptLanguage(null)).toEqual([]);
  });

  it("?lang= first, then the booking's language, then the browser, then French", () => {
    expect(negotiateLocale({ query: "es", preferred: "en", acceptLanguage: "fr" })).toBe("es");
    expect(negotiateLocale({ query: ["en", "es"] })).toBe("en");
    expect(negotiateLocale({ query: "de", preferred: "en", acceptLanguage: "es" })).toBe("en");
    expect(negotiateLocale({ query: "xx", acceptLanguage: "de-DE,es-MX;q=0.8,en;q=0.5" })).toBe("es");
    expect(negotiateLocale({ acceptLanguage: "ja,zh-CN" })).toBe("fr");
    expect(negotiateLocale({})).toBe("fr");
    expect(matchLocale("EN-gb")).toBe("en");
    expect(matchLocale("<script>")).toBeNull();
  });

  it("is ready for right-to-left languages", () => {
    expect(localeDir("ar")).toBe("rtl");
    expect(localeDir("ar-MA")).toBe("rtl");
    for (const l of GUEST_LOCALES) expect(localeDir(l)).toBe("ltr");
  });
});

describe("message catalogs", () => {
  const keys = (o: object, prefix = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

  it("have the same keys in every language, none empty", () => {
    const fr = keys(MESSAGES.fr).sort();
    for (const l of GUEST_LOCALES) {
      expect(keys(MESSAGES[l]).sort(), l).toEqual(fr);
      const values = (o: object): string[] => Object.values(o).flatMap((v) => (typeof v === "object" ? values(v) : [v as string]));
      for (const v of values(MESSAGES[l])) expect(v.trim(), l).not.toBe("");
    }
  });

  it("keep the same placeholders in every language", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const l of GUEST_LOCALES) {
      expect(ph(MESSAGES[l].codes.before)).toEqual(["{date}", "{time}"]);
      expect(ph(MESSAGES[l].share.text)).toEqual(["{link}", "{listing}", "{name}"]);
      expect(ph(MESSAGES[l].stayDates)).toEqual(["{from}", "{to}"]);
    }
    expect(fill(MESSAGES.es.codes.before, { date: "21/10/2026", time: "15:00" })).toBe("Los códigos se mostrarán aquí a partir del 21/10/2026 a las 15:00 (hora de Marrakech).");
    expect(fill("{a} {b}", { a: 1 })).toBe("1 {b}");
  });
});

describe("texts in several languages", () => {
  it("falls back to French, then to any language present", () => {
    const v = { fr: "Bonjour", en: "Hello", es: "  ", xx: "?" };
    expect(readLocalized(v)).toEqual({ fr: "Bonjour", en: "Hello" });
    expect(pickLocalized(v, "en")).toEqual({ text: "Hello", locale: "en" });
    expect(pickLocalized(v, "es")).toEqual({ text: "Bonjour", locale: "fr" });
    expect(pickLocalized({ en: "Only English" }, "es")).toEqual({ text: "Only English", locale: "en" });
    expect(pickLocalized(null, "fr")).toBeNull();
    expect(pickLocalized(["fr"], "fr")).toBeNull();
    expect(localizedLanguages(v)).toEqual(["fr", "en"]);
  });
});

describe("guide tokens", () => {
  it("are 256 random bits in base64url, stored as a SHA-256", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateGuideToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(GUIDE_TOKEN_RE);
    const t = [...tokens][0];
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(hashGuideToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(guideTokenMatches(t, hashGuideToken(t))).toBe(true);
    expect(guideTokenMatches([...tokens][1], hashGuideToken(t))).toBe(false);
    expect(guideTokenMatches(t, "abc")).toBe(false);
    expect(guideUrl("https://sigma.ma/", t, "es")).toBe(`https://sigma.ma/guide/${t}?lang=es`);
  });
});

describe("guide forms", () => {
  it("texts: maps link in https, languages kept apart, French rules left to Biens", () => {
    const r = parseGuideTexts({ mapsUrl: "https://maps.app.goo.gl/x", directions_fr: " Taxi ", directions_es: "", access_en: "Key box", rules_fr: "ignored", rules_es: "Sin fiestas", useOrgRecommendations: "on" });
    expect(r).toEqual({
      ok: true,
      input: { mapsUrl: "https://maps.app.goo.gl/x", directions: { fr: "Taxi" }, accessInstructions: { en: "Key box" }, houseRulesTranslations: { es: "Sin fiestas" }, useOrgRecommendations: true },
    });
    expect(parseGuideTexts({ mapsUrl: "javascript:alert(1)" })).toMatchObject({ ok: false, fieldErrors: { mapsUrl: expect.any(String) } });
    expect(parseGuideTexts({ access_fr: "x".repeat(4001) })).toMatchObject({ ok: false, fieldErrors: { access_fr: expect.any(String) } });
    expect(parseGuideTexts({ access_es: "a\u0000b" })).toMatchObject({ ok: false });
    expect(parseGuideTexts({})).toMatchObject({ ok: true, input: { mapsUrl: null, useOrgRecommendations: false } });
  });

  it("Wi-Fi: an empty password keeps the stored one; « Supprimer » removes it", () => {
    expect(parseWifi({ wifiName: "Riad", wifiPassword: "" })).toEqual({ ok: true, input: { wifiName: "Riad", wifiPassword: undefined } });
    expect(parseWifi({ wifiName: "", wifiPassword: " pass word " })).toEqual({ ok: true, input: { wifiName: null, wifiPassword: " pass word " } });
    expect(parseWifi({ wifiName: "Riad", clearWifiPassword: "on" })).toEqual({ ok: true, input: { wifiName: "Riad", wifiPassword: null } });
    expect(parseWifi({ wifiPassword: "x", clearWifiPassword: "on" })).toMatchObject({ ok: false });
  });

  it("codes: a known kind, a value when adding", () => {
    expect(parseAccessCode({ kind: "KEYBOX", label: "", value: "1234" }, { requireValue: true })).toEqual({ ok: true, input: { kind: "KEYBOX", label: "", value: "1234" } });
    expect(parseAccessCode({ kind: "KEYBOX", value: "" }, { requireValue: true })).toMatchObject({ ok: false, fieldErrors: { value: expect.any(String) } });
    expect(parseAccessCode({ kind: "KEYBOX", value: "" }, { requireValue: false })).toMatchObject({ ok: true, input: { value: undefined } });
    expect(parseAccessCode({ kind: "SAFE", value: "1" }, { requireValue: true })).toMatchObject({ ok: false, fieldErrors: { kind: expect.any(String) } });
  });

  it("recommendations and the conciergerie's numbers", () => {
    expect(parseRecommendation({ category: "HAMMAM", name: "Hammam", description_fr: "Près du riad", url: "" })).toEqual({
      ok: true,
      input: { category: "HAMMAM", name: "Hammam", description: { fr: "Près du riad" }, url: null },
    });
    expect(parseRecommendation({ category: "HAMMAM", name: "", url: "ftp://x" })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String), url: expect.any(String) } });
    expect(parseConcierge({ conciergePhone: "05 24 00 00 00", conciergeWhatsapp: "+212 6 12 34 56 78" })).toEqual({
      ok: true,
      input: { conciergePhone: "+212524000000", conciergeWhatsapp: "+212612345678" },
    });
    expect(parseConcierge({ conciergePhone: "", conciergeWhatsapp: "" })).toEqual({ ok: true, input: { conciergePhone: null, conciergeWhatsapp: null } });
    expect(parseConcierge({ conciergePhone: "abc" })).toMatchObject({ ok: false, fieldErrors: { conciergePhone: expect.any(String) } });
  });
});

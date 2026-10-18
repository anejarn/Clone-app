/**
 * Guest-facing languages (Lot 4: welcome guide). V1 has French (default), Spanish and English; the others planned in
 * CLAUDE.md (Dutch, German, Italian, Arabic, then simplified Chinese, Korean, Japanese) are added by giving them a
 * catalog in lib/i18n/messages/ and an entry below — Arabic with dir "rtl", which the pages already apply.
 * Pure: used by server pages, the back-office and the tests.
 */

export const GUEST_LOCALES = ["fr", "es", "en"] as const;
export type GuestLocale = (typeof GUEST_LOCALES)[number];
export const DEFAULT_GUEST_LOCALE: GuestLocale = "fr";

export interface LocaleInfo {
  /** The language's own name, for the switcher. */
  nativeName: string;
  /** Its name in French, for the back-office. */
  frenchName: string;
  dir: "ltr" | "rtl";
}

export const LOCALE_INFO: Record<GuestLocale, LocaleInfo> = {
  fr: { nativeName: "Français", frenchName: "Français", dir: "ltr" },
  es: { nativeName: "Español", frenchName: "Espagnol", dir: "ltr" },
  en: { nativeName: "English", frenchName: "Anglais", dir: "ltr" },
};

/** Languages whose script runs right to left: the guide sets dir="rtl" for them (Arabic, later). */
export const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);

export function isGuestLocale(v: unknown): v is GuestLocale {
  return typeof v === "string" && (GUEST_LOCALES as readonly string[]).includes(v);
}

export function localeDir(locale: string): "ltr" | "rtl" {
  return RTL_LANGUAGES.has(locale.split("-")[0].toLowerCase()) ? "rtl" : "ltr";
}

/** "es-ES" → "es", "EN" → "en", "zh-Hans-CN" → "zh"; null when not a language tag. */
function baseLanguage(tag: string): string | null {
  const m = /^([a-zA-Z]{2,3})(?:[-_][a-zA-Z0-9]{1,8})*$/.exec(tag.trim());
  return m ? m[1].toLowerCase() : null;
}

/** The supported locale a tag means, if any ("es-MX" → "es"). */
export function matchLocale(tag: string | null | undefined): GuestLocale | null {
  if (!tag) return null;
  const base = baseLanguage(tag);
  return base && isGuestLocale(base) ? base : null;
}

/**
 * An Accept-Language header as language tags by preference (q descending, then order); q=0 and malformed entries
 * are dropped. At most 20 entries are read.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  const entries: { tag: string; q: number; i: number }[] = [];
  for (const [i, part] of header.split(",").slice(0, 20).entries()) {
    const [tagPart, ...params] = part.trim().split(";");
    const tag = tagPart.trim();
    if (!tag || (tag !== "*" && !baseLanguage(tag))) continue;
    let q = 1;
    for (const p of params) {
      if (!/^\s*q\s*=/.test(p)) continue;
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p);
      q = m ? Number(m[1]) : NaN;
    }
    if (!Number.isFinite(q) || q <= 0 || q > 1) continue;
    entries.push({ tag, q, i });
  }
  return entries.sort((a, b) => b.q - a.q || a.i - b.i).map((e) => e.tag);
}

/**
 * The guide's language: `?lang=` when supported, else the booking's guest language, else the browser's
 * (Accept-Language), else French.
 */
export function negotiateLocale(opts: { query?: string | string[] | null; preferred?: string | null; acceptLanguage?: string | null }): GuestLocale {
  const query = Array.isArray(opts.query) ? opts.query[0] : opts.query;
  const fromQuery = matchLocale(query);
  if (fromQuery) return fromQuery;
  const fromBooking = matchLocale(opts.preferred);
  if (fromBooking) return fromBooking;
  for (const tag of parseAcceptLanguage(opts.acceptLanguage)) {
    const m = matchLocale(tag);
    if (m) return m;
  }
  return DEFAULT_GUEST_LOCALE;
}

import { DEFAULT_GUEST_LOCALE, GUEST_LOCALES, isGuestLocale, type GuestLocale } from "./locales";

/**
 * Text typed by the team in several languages (guide instructions, recommendations…), stored as a JSON object
 * { fr: "…", es: "…", en: "…" }. French is the reference; a missing language falls back to French, then to any
 * language present. Pure.
 */

export type Localized = Partial<Record<GuestLocale, string>>;

/** Keeps the supported languages with non-blank text; anything else stored is ignored. */
export function readLocalized(value: unknown): Localized {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Localized = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isGuestLocale(k) && typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

/** The text in `locale`, else French, else the first language present; null when there is none. */
export function pickLocalized(value: unknown, locale: GuestLocale): { text: string; locale: GuestLocale } | null {
  const l = readLocalized(value);
  const order: GuestLocale[] = [locale, DEFAULT_GUEST_LOCALE, ...GUEST_LOCALES];
  for (const c of order) {
    const text = l[c];
    if (text) return { text, locale: c };
  }
  return null;
}

/** The languages that have their own text (for the back-office: « traduit en … »). */
export function localizedLanguages(value: unknown): GuestLocale[] {
  const l = readLocalized(value);
  return GUEST_LOCALES.filter((c) => !!l[c]);
}

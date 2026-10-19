import { parseAcceptLanguage } from "../locales";
import { ar } from "./ar";
import { en } from "./en";
import { fr } from "./fr";

/**
 * The owner portal's languages (Lot 6b; CLAUDE.md: team and owners in French, Arabic — right to left from the start —
 * and English). Typed catalogs, server-side only, like the guest ones (lib/i18n/messages/). The choice is kept in a
 * cookie (OWNER_LOCALE_COOKIE, set by /proprietaire/langue), else the browser's Accept-Language, else French.
 */

export const OWNER_LOCALES = ["fr", "ar", "en"] as const;
export type OwnerLocale = (typeof OWNER_LOCALES)[number];
export const DEFAULT_OWNER_LOCALE: OwnerLocale = "fr";
export const OWNER_LOCALE_COOKIE = "sigma_owner_lang";

export const OWNER_LOCALE_INFO: Record<OwnerLocale, { nativeName: string; dir: "ltr" | "rtl"; intl: string }> = {
  fr: { nativeName: "Français", dir: "ltr", intl: "fr-FR" },
  ar: { nativeName: "العربية", dir: "rtl", intl: "ar-MA" },
  en: { nativeName: "English", dir: "ltr", intl: "en-GB" },
};

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type OwnerMessages = Widen<typeof fr>;

const CATALOGS: Record<OwnerLocale, OwnerMessages> = { fr, ar, en };

export function isOwnerLocale(v: unknown): v is OwnerLocale {
  return typeof v === "string" && (OWNER_LOCALES as readonly string[]).includes(v);
}

export function ownerMessages(locale: OwnerLocale): OwnerMessages {
  return CATALOGS[locale] ?? CATALOGS[DEFAULT_OWNER_LOCALE];
}

/** The cookie's language when supported, else the first supported one of Accept-Language, else French. */
export function negotiateOwnerLocale(opts: { cookie?: string | null; acceptLanguage?: string | null }): OwnerLocale {
  if (isOwnerLocale(opts.cookie)) return opts.cookie;
  for (const tag of parseAcceptLanguage(opts.acceptLanguage)) {
    const base = tag.split(/[-_]/)[0].toLowerCase();
    if (isOwnerLocale(base)) return base;
  }
  return DEFAULT_OWNER_LOCALE;
}

export { fill } from "../messages";

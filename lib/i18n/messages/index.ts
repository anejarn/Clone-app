import { DEFAULT_GUEST_LOCALE, type GuestLocale } from "../locales";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";

/**
 * Guest-facing message catalogs (welcome guide). Small typed modules rather than JSON: a key missing in one
 * language is a type error, and every catalog is in the server bundle only (pages are Server Components; client
 * components get the few strings they need as props). Adding a language: a catalog here + lib/i18n/locales.ts.
 */

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type GuestMessages = Widen<typeof fr>;

export const MESSAGES: Record<GuestLocale, GuestMessages> = { fr, es, en };

export function messages(locale: GuestLocale): GuestMessages {
  return MESSAGES[locale] ?? MESSAGES[DEFAULT_GUEST_LOCALE];
}

/** "Du {from} au {to}" + { from, to }; an unknown placeholder stays as it is. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

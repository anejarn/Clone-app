import { OWNER_LOCALE_INFO, type OwnerLocale } from "./owner";

/**
 * Formatting for the owner portal in a right-to-left language (Arabic). Amounts, dates and references keep Latin
 * digits and read left to right inside Arabic text: they are wrapped in Unicode isolates (LRI … PDI), so that
 * « 1 234,50 MAD » or « 31/10/2026 » is never reordered by the surrounding right-to-left text (in JSX, <bdi dir="ltr">
 * does the same). In a left-to-right language nothing is added. Pure.
 */

export const LRI = "⁦";
export const PDI = "⁩";

export function dirOf(locale: OwnerLocale): "ltr" | "rtl" {
  return OWNER_LOCALE_INFO[locale].dir;
}

/** `text` as an isolated left-to-right run in a right-to-left locale; unchanged otherwise. */
export function ltr(text: string, locale: OwnerLocale): string {
  return dirOf(locale) === "rtl" ? `${LRI}${text}${PDI}` : text;
}

/**
 * An amount in centimes of dirham: « 1 234,50 MAD » (French and Arabic: space between thousands, decimal comma),
 * « MAD 1,234.50 » in English. Always two decimals (statements, revenue). Negative amounts keep their sign.
 */
export function ownerAmount(cents: number, locale: OwnerLocale): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`not an amount of centimes: ${cents}`);
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : "";
  const dec = String(abs % 100).padStart(2, "0");
  const whole = String(Math.floor(abs / 100));
  const text = locale === "en" ? `${sign}MAD ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}` : `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${dec} MAD`;
  return ltr(text, locale);
}

/** "2026-10-31" → « 31/10/2026 » (JJ/MM/AAAA in every language, CLAUDE.md), isolated in Arabic. */
export function ownerDate(iso: string, locale: OwnerLocale): string {
  return ltr(`${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`, locale);
}

/** "2026-10-31" → « 31/10/2026 », instants in Marrakech time. */
export function ownerInstantDate(instant: Date | string, locale: OwnerLocale): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return ownerDate(ymd, locale);
}

const MONTHS = new Map<OwnerLocale, Intl.DateTimeFormat>();

/** "2026-10" → « octobre 2026 », « October 2026 », « أكتوبر 2026 » (Latin digits in Arabic too). */
export function ownerMonth(month: string, locale: OwnerLocale): string {
  let f = MONTHS.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(OWNER_LOCALE_INFO[locale].intl, { month: "long", year: "numeric", timeZone: "UTC", numberingSystem: "latn" });
    MONTHS.set(locale, f);
  }
  return f.format(new Date(`${month}-01T00:00:00Z`));
}

/** 2000 basis points → « 20 » (French and Arabic « 17,5 », English « 17.5 »). */
export function ownerPercent(bps: number, locale: OwnerLocale): string {
  const s = (bps / 100).toFixed(2).replace(/\.?0+$/, "");
  return locale === "en" ? s : s.replace(".", ",");
}

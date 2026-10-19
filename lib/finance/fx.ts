import { mulDivRound } from "./rounding";

/**
 * Exchange rates typed by an associé (no live exchange-rate service: choosing one is a provider decision). A rate is
 * stored as an integer number of millionths of dirham per unit of the foreign currency: 10,8512 MAD for 1 € =
 * 10 851 200. It converts a platform's amount (Booking.platformAmountCents in its currency) to centimes of dirham:
 * MAD centimes = foreign cents × rate / 1 000 000, rounded to the centime (halves away from zero).
 * The rate to use (the platform's own, the bank's on the day of the payout, Bank Al-Maghrib's…) is for the
 * accountant to decide; the one typed is stored on the booking's split with who typed it and when.
 */

export const RATE_SCALE = 1_000_000;
/** 0,000001 to 1 000 MAD per unit. */
export const MAX_RATE_MICROS = 1_000 * RATE_SCALE;

const RATE_RE = /^(\d{1,4})(?:[.,](\d{1,6}))?$/;

/** "10,85" → 10 850 000; null when it isn't a positive rate with at most six decimals. */
export function parseRate(input: string): number | null {
  const m = RATE_RE.exec(input.trim().replace(/[\s  ]/g, ""));
  if (!m) return null;
  const micros = Number(m[1]) * RATE_SCALE + Number((m[2] ?? "").padEnd(6, "0"));
  return micros > 0 && micros <= MAX_RATE_MICROS ? micros : null;
}

/** 10 850 000 → "10,85" (no trailing zeros). */
export function formatRate(micros: number): string {
  if (!Number.isSafeInteger(micros) || micros <= 0) throw new RangeError(`not a rate: ${micros}`);
  const whole = Math.floor(micros / RATE_SCALE);
  const frac = String(micros % RATE_SCALE).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole},${frac}` : String(whole);
}

/** Foreign cents to centimes of dirham at `rateMicros`. */
export function convertToMad(foreignCents: number, rateMicros: number): number {
  if (!Number.isSafeInteger(rateMicros) || rateMicros <= 0) throw new RangeError(`not a rate: ${rateMicros}`);
  return mulDivRound(foreignCents, rateMicros, RATE_SCALE);
}

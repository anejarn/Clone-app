/**
 * Amounts typed by the team, in dirhams (MAD) or percent, to the integers the database stores: centimes of
 * dirham and basis points. Pure string arithmetic, no floating point, so "19,99" is exactly 1 999 centimes.
 * Accepted: digits with an optional decimal comma or point (at most two decimals), spaces (also no-break spaces)
 * between thousands. Refused: signs, exponents, empty input, anything else.
 */

const AMOUNT_RE = /^(\d{1,9})(?:[.,](\d{1,2}))?$/;

function parseHundredths(input: string): number | null {
  const compact = input.trim().replace(/[\s  ]/g, "");
  const m = AMOUNT_RE.exec(compact);
  if (!m) return null;
  const whole = Number(m[1]);
  const fraction = Number((m[2] ?? "").padEnd(2, "0"));
  return whole * 100 + fraction;
}

/** "1 200" → 120 000 centimes, "19,9" → 1 990, "0" → 0; null when the text isn't an amount. */
export function dirhamsToCentimes(input: string): number | null {
  return parseHundredths(input);
}

/** 120 000 → "1200", 1 990 → "19,90": the value to put back in a form field. */
export function centimesToDirhams(centimes: number): string {
  if (!Number.isInteger(centimes) || centimes < 0) throw new RangeError(`not a positive amount of centimes: ${centimes}`);
  const whole = Math.floor(centimes / 100);
  const rest = centimes % 100;
  return rest === 0 ? String(whole) : `${whole},${String(rest).padStart(2, "0")}`;
}

/** "20" → 2 000 basis points, "17,5" → 1 750; null when the text isn't a number with at most two decimals. */
export function percentToBps(input: string): number | null {
  return parseHundredths(input);
}

/** 2 000 → "20", 1 750 → "17,5", 1 234 → "12,34": for form fields and display ("20 %"). */
export function bpsToPercent(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) throw new RangeError(`not a positive number of basis points: ${bps}`);
  const whole = Math.floor(bps / 100);
  const rest = bps % 100;
  if (rest === 0) return String(whole);
  return `${whole},${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}

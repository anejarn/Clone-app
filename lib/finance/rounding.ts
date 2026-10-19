/**
 * Integer money arithmetic for the finances (Lot 6). Amounts are integer centimes of dirham, rates integer basis
 * points (1 % = 100) or millionths: no floating point anywhere, products go through BigInt so that nothing is lost
 * past 2^53.
 *
 * - **Rounding of a product** (commission, estimated platform fee, conversion): to the nearest centime, halves away
 *   from zero (0,5 centime → 1 centime; −0,5 → −1), the usual commercial rounding.
 * - **Sharing an amount** (a part of a stay between the months of its nights): largest remainder (Hamilton): every
 *   share gets the floor of its exact quota, then the centimes left over go one by one to the largest remainders,
 *   ties to the earliest share. The shares always add up exactly to the amount.
 */

function assertAmount(n: number, what: string): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} is not a safe integer: ${n}`);
}

/** a × b / c rounded to the nearest integer, halves away from zero. c > 0. */
export function mulDivRound(a: number, b: number, c: number): number {
  assertAmount(a, "a");
  assertAmount(b, "b");
  assertAmount(c, "c");
  if (c <= 0) throw new RangeError(`divisor must be positive: ${c}`);
  const p = BigInt(a) * BigInt(b);
  const neg = p < BigInt(0);
  const abs = neg ? -p : p;
  const C = BigInt(c);
  const q = (abs * BigInt(2) + C) / (BigInt(2) * C);
  const r = Number(neg ? -q : q);
  return r === 0 ? 0 : r;
}

/** `bps` basis points of an amount (2000 = 20 %), rounded to the centime. */
export function applyBps(amountCents: number, bps: number): number {
  return mulDivRound(amountCents, bps, 10_000);
}

/**
 * Shares `total` (any sign) in proportion to `weights` (non-negative integers, not all zero) by largest remainder.
 * The result has one integer per weight, of the sign of `total`, and adds up exactly to it.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  assertAmount(total, "total");
  for (const w of weights) if (!Number.isSafeInteger(w) || w < 0) throw new RangeError(`invalid weight: ${w}`);
  const W = weights.reduce((s, w) => s + w, 0);
  if (W === 0) {
    if (total === 0) return weights.map(() => 0);
    throw new RangeError("cannot share a non-zero amount between zero weights");
  }
  const sign = total < 0 ? -1 : 1;
  const T = BigInt(Math.abs(total));
  const BW = BigInt(W);
  const quotas = weights.map((w) => T * BigInt(w));
  const shares = quotas.map((q) => q / BW);
  const remainders = quotas.map((q, i) => ({ i, r: q % BW }));
  let left = Number(T - shares.reduce((s, x) => s + x, BigInt(0)));
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left <= 0) break;
    shares[i] += BigInt(1);
    left -= 1;
  }
  return shares.map((s) => {
    const n = Number(s) * sign;
    return n === 0 ? 0 : n;
  });
}

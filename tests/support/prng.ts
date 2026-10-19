/** A small seeded pseudo-random generator (mulberry32), for property-style tests that are the same on every run. */
export function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** Integer in [min, max]. */
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  return { next, int, pick };
}

import "server-only";

/**
 * A small in-memory limiter of failed attempts per key (an IP address): after `max` failures within `windowMs` the
 * key is blocked until the window ends. Used by the public guide links (/guide/<token>) so nobody can try tokens in
 * a loop — on top of 256-bit tokens, which can't be guessed anyway. Per process: with several app servers each
 * counts on its own, which is enough for this purpose.
 */
export class FailureLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  blocked(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h) return false;
    if (h.resetAt <= now) {
      this.hits.delete(key);
      return false;
    }
    return h.count >= this.max;
  }

  fail(key: string, now = Date.now()): void {
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    else h.count += 1;
    // Keeps the map small under a flood of distinct keys.
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
      if (this.hits.size > 10_000) this.hits.clear();
    }
  }

  reset(): void {
    this.hits.clear();
  }
}

/**
 * The client's address as the reverse proxy reports it (first X-Forwarded-For entry, or X-Real-IP); undefined
 * without one (no limiting then: one shared key would let a single client lock everybody out). The hosting's proxy
 * must set these headers itself for the limit to mean anything.
 */
export function clientKey(headers: Headers): string | undefined {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || undefined;
}

/**
 * Counts every request per key in a fixed window (lot 7b: the booking e-mail webhook, per organization): over `max`
 * within `windowMs`, refused until the window ends. Per process, like FailureLimiter.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records a request; false when the key is over its limit (the request is then not counted). */
  take(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
      return true;
    }
    if (h.count >= this.max) return false;
    h.count += 1;
    return true;
  }

  reset(): void {
    this.hits.clear();
  }
}

import "server-only";

/**
 * Fixed-window request counter kept in this server process's memory: each server instance counts on its own
 * and forgets everything on restart. Good enough to slow a script down on one instance; a multi-instance
 * deployment would need a shared store.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const windows = new Map<string, { count: number; resetAt: number }>();

  function prune(now: number) {
    for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
  }

  return {
    /** Counts one request for `key`; false once `limit` requests were already counted in the current window. */
    take(key: string, now = Date.now()): boolean {
      // Keeps memory bounded under many distinct keys.
      if (windows.size > 10_000) prune(now);
      const w = windows.get(key);
      if (!w || w.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (w.count >= limit) return false;
      w.count += 1;
      return true;
    },
    reset() {
      windows.clear();
    },
  };
}

/**
 * The client's IP: the first x-forwarded-for entry, else x-real-ip. `next start` fills x-forwarded-for with the
 * socket address when no proxy did; behind a proxy, that proxy must set or overwrite the header, or a client
 * can pick its own key. Null when neither header is present (a handler called directly, as in tests).
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

/** AUTH_RATE_LIMIT=off (the e2e and integration runs) turns off Better Auth's limits and these. Read per request. */
export function rateLimitsEnabled(): boolean {
  return process.env.AUTH_RATE_LIMIT !== "off";
}

import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "@/lib/server/rate-limit";

describe("rate limiter", () => {
  it("counts per key in fixed windows", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    const t = 1_000_000;
    expect([1, 2, 3, 4].map(() => limiter.take("a", t))).toEqual([true, true, true, false]);
    expect(limiter.take("b", t)).toBe(true);
    expect(limiter.take("a", t + 999)).toBe(false);
    // A new window starts once the previous one has passed.
    expect(limiter.take("a", t + 1000)).toBe(true);
  });
});

describe("clientIp", () => {
  it("reads the first x-forwarded-for entry, else x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1", "x-real-ip": "10.9.9.9" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers({ "x-forwarded-for": "", "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBeNull();
  });
});

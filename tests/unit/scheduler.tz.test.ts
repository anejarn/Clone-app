import { describe, expect, it } from "vitest";
import { isDue, MemoryLocker, nextDailyRun, nextFeedRun, runExclusive, FEED_INTERVAL_MS, FEED_JITTER_MS } from "@/lib/jobs/scheduler";

/** The worker's timing and exclusion (lib/jobs/scheduler.ts); also run under UTC+14 and UTC−8. */

describe("timing", () => {
  it("feeds every 10 minutes ± 1 minute", () => {
    const now = Date.UTC(2027, 0, 1, 12);
    expect(nextFeedRun(now, 0).getTime() - now).toBe(FEED_INTERVAL_MS - FEED_JITTER_MS);
    expect(nextFeedRun(now, 0.5).getTime() - now).toBe(FEED_INTERVAL_MS);
    expect(nextFeedRun(now, 0.999999).getTime() - now).toBeLessThanOrEqual(FEED_INTERVAL_MS + FEED_JITTER_MS);
  });

  it("daily jobs at their hour in Marrakech, the next day once passed, Ramadan included", () => {
    // 03:00 in Marrakech in January = 02:00 UTC.
    expect(nextDailyRun(Date.UTC(2027, 0, 10, 1, 0), 180, 0).toISOString()).toBe("2027-01-10T02:00:00.000Z");
    expect(nextDailyRun(Date.UTC(2027, 0, 10, 2, 0), 180, 0).toISOString()).toBe("2027-01-11T02:00:00.000Z");
    // During Ramadan (UTC+0): 03:00 UTC.
    expect(nextDailyRun(Date.UTC(2027, 1, 20, 1, 0), 180, 0).toISOString()).toBe("2027-02-20T03:00:00.000Z");
    // Jitter: up to 10 minutes later.
    const j = nextDailyRun(Date.UTC(2027, 0, 10, 1, 0), 180, 0.99).getTime() - Date.UTC(2027, 0, 10, 2, 0);
    expect(j).toBeGreaterThan(9 * 60_000);
    expect(j).toBeLessThan(10 * 60_000);
  });

  it("due", () => {
    expect(isDue(null, 0)).toBe(true);
    expect(isDue(new Date(1000), 1000)).toBe(true);
    expect(isDue(new Date(1001), 1000)).toBe(false);
  });
});

describe("exclusion", () => {
  it("two workers never run the same job at once; different jobs run side by side", async () => {
    const locker = new MemoryLocker();
    let running = 0;
    let max = 0;
    let runs = 0;
    const job = async () => {
      running += 1;
      runs += 1;
      max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 20));
      running -= 1;
    };
    const results = await Promise.all([runExclusive(locker, "feed:a", job), runExclusive(locker, "feed:a", job), runExclusive(locker, "feed:b", job)]);
    expect(results.map((r) => r.ran)).toEqual([true, false, true]);
    expect(runs).toBe(2);
    expect(max).toBe(2);
    // Free again afterwards.
    expect((await runExclusive(locker, "feed:a", async () => 1)).ran).toBe(true);
  });

  it("the lock is released when the job throws", async () => {
    const locker = new MemoryLocker();
    await expect(runExclusive(locker, "job:x", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await runExclusive(locker, "job:x", async () => "ok")).toEqual({ ran: true, value: "ok" });
  });
});

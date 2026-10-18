import { addDays } from "../admin/calendar";
import { todayInTimeZone } from "../dates";
import { MARRAKECH_TIMEZONE } from "../neighbourhoods";
import { localInstant } from "../operations/schedule";

/**
 * The background worker's timing and exclusion rules (Lot 7), pure: scripts/worker.ts and lib/server/jobs/ use them
 * with Postgres advisory locks; the unit tests with an in-memory locker.
 * - each iCal feed is read every 10 minutes, ± a jitter (so 200 feeds don't all go at the same second);
 * - daily jobs run once a day at their hour in Marrakech, ± a jitter;
 * - a job runs only under its lock: a second worker (or « Synchroniser maintenant » at the same time) that can't take
 *   it skips the job instead of running it twice.
 */

export const FEED_INTERVAL_MS = 10 * 60_000;
export const FEED_JITTER_MS = 60_000;

/** The next read of a feed: interval ± jitter. `random` in [0, 1). */
export function nextFeedRun(now: number, random: number = Math.random(), interval = FEED_INTERVAL_MS, jitter = FEED_JITTER_MS): Date {
  return new Date(now + interval + Math.round((random * 2 - 1) * jitter));
}

/** The next run of a daily job at `minutes` after midnight (Marrakech) strictly after `now`, + jitter (0…jitterMs). */
export function nextDailyRun(now: number, minutes: number, random: number = Math.random(), jitterMs = 10 * 60_000, timeZone = MARRAKECH_TIMEZONE): Date {
  const today = todayInTimeZone(timeZone, now);
  let at = localInstant(today, minutes, timeZone).getTime();
  if (at <= now) at = localInstant(addDays(today, 1), minutes, timeZone).getTime();
  return new Date(at + Math.floor(random * jitterMs));
}

export function isDue(nextRunAt: Date | null, now: number): boolean {
  return nextRunAt === null || nextRunAt.getTime() <= now;
}

/** A lock held by one worker at a time. tryLock resolves to a release function, or null when someone holds it. */
export interface Locker {
  tryLock(key: string): Promise<(() => Promise<void>) | null>;
}

export type Exclusive<T> = { ran: true; value: T } | { ran: false };

/** Runs fn under the lock of `key`, or not at all when another holder has it. The lock is released even on error. */
export async function runExclusive<T>(locker: Locker, key: string, fn: () => Promise<T>): Promise<Exclusive<T>> {
  const release = await locker.tryLock(key);
  if (!release) return { ran: false };
  try {
    return { ran: true, value: await fn() };
  } finally {
    await release();
  }
}

/** A locker in memory (one process): the unit tests' and a single worker's fallback. */
export class MemoryLocker implements Locker {
  private readonly held = new Set<string>();
  async tryLock(key: string) {
    if (this.held.has(key)) return null;
    this.held.add(key);
    return async () => {
      this.held.delete(key);
    };
  }
}

export interface DailyJob {
  name: string;
  /** Minutes after midnight, Marrakech. */
  at: number;
  run: () => Promise<Record<string, unknown>>;
}

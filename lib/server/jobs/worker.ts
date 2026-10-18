import "server-only";
import { isDue, nextDailyRun, runExclusive, type DailyJob, type Locker } from "@/lib/jobs/scheduler";
import type { Prisma } from "@/lib/generated/prisma/client";
import { alertStaleFeeds } from "../channels/alerts";
import { dueFeeds, syncFeed } from "../channels/sync";
import { db } from "../db";
import { purgeIdentities } from "../declarations/purge";
import { inboundEmailSources } from "@/lib/channels/email/sources";
import { ingestInboundEmail } from "../channels/email/process";
import { purgeDonePriceReminders, purgeInboundEmails } from "../channels/email/purge";
import { jobLocker } from "./locks";

/**
 * The background worker (scripts/worker.ts, `pnpm worker`: a process of its own, never inside a web request). Each
 * tick (every 30 s):
 * - reads the iCal feeds that are due (each every 10 minutes ± 1 min; lib/server/channels/sync.ts), a few at a time;
 * - tells the associés about feeds not read successfully for more than an hour (once per feed);
 * - reads the booking e-mails of the pull sources (lib/channels/email/sources.ts: none until a receiving service is
 *   chosen; a push service posts to /api/inbound-email/<token> instead);
 * - runs the daily jobs that are due (DAILY_JOBS), at their hour in Marrakech.
 * Every job and feed runs under its Postgres advisory lock: several workers can run side by side, never the same job
 * twice at once. scheduled_jobs keeps when each daily job runs next and how its last run went.
 */

export const TICK_MS = 30_000;
const FEED_CONCURRENCY = 4;
const DAY = 86_400_000;

export const DAILY_JOBS: readonly DailyJob[] = [
  {
    // Travellers' identity data past the organization's retention delay (Lot 5, lib/server/declarations/purge.ts).
    name: "identity-purge",
    at: 3 * 60,
    run: async () => {
      const r = await purgeIdentities({ log: (l) => console.log(`[identity-purge] ${l}`) });
      return { stays: r.candidates.length, travelers: r.purgedTravelers, documents: r.purgedDocuments, failedFiles: r.failedFiles.length };
    },
  },
  {
    // « Ma journée »'s idempotency records (task_sync_operations) are kept 30 days.
    name: "task-sync-operations-purge",
    at: 3 * 60 + 20,
    run: async () => ({ deleted: (await db.taskSyncOperation.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * DAY) } } })).count }),
  },
  {
    // The synchronisation journal is kept 90 days.
    name: "channel-sync-runs-purge",
    at: 3 * 60 + 40,
    run: async () => ({ deleted: (await db.channelSyncRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - 90 * DAY) } } })).count }),
  },
  {
    // Booking e-mails (lot 7b): raw messages and details after 30 days, rows after 400 (lib/server/channels/email/purge.ts).
    name: "inbound-email-purge",
    at: 3 * 60 + 50,
    run: async () => ({ ...(await purgeInboundEmails()) }),
  },
  {
    // Price reminders marked done, after 180 days.
    name: "price-reminders-purge",
    at: 4 * 60,
    run: async () => ({ ...(await purgeDonePriceReminders()) }),
  },
];

/** Reads every pull source of booking e-mails (none until a receiving service is chosen). */
export async function pollInboundEmails(): Promise<{ received: number; failed: number }> {
  let received = 0;
  let failed = 0;
  for (const source of inboundEmailSources()) {
    for (const organizationId of await source.organizations()) {
      for (const m of await source.fetchNew(organizationId)) {
        try {
          await ingestInboundEmail({ organizationId, raw: m.raw, via: "WEBHOOK", now: m.receivedAt });
          received++;
        } catch (e) {
          failed++;
          console.error(`[worker] e-mail from ${source.id}: ${(e as Error).message}`);
        }
      }
    }
  }
  return { received, failed };
}

/** Runs one daily job if it is due and nobody else is running it. Returns whether it ran. */
export async function runDailyJob(job: DailyJob, opts: { locker?: Locker; now?: Date; force?: boolean } = {}): Promise<boolean> {
  const locker = opts.locker ?? jobLocker();
  const r = await runExclusive(locker, `job:${job.name}`, async () => {
    const now = opts.now ?? new Date();
    const row = await db.scheduledJob.findUnique({ where: { name: job.name } });
    if (!row) {
      await db.scheduledJob.create({ data: { name: job.name, nextRunAt: opts.force ? now : nextDailyRun(now.getTime(), job.at) } });
      if (!opts.force) return false;
    } else if (!opts.force && !isDue(row.nextRunAt, now.getTime())) return false;
    await db.scheduledJob.update({ where: { name: job.name }, data: { lastStartedAt: now } });
    let ok = true;
    let details: Record<string, unknown> = {};
    let error: string | null = null;
    try {
      details = await job.run();
    } catch (e) {
      ok = false;
      error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      console.error(`[worker] job ${job.name} failed: ${error}`);
    }
    await db.scheduledJob.update({
      where: { name: job.name },
      data: { lastFinishedAt: new Date(), lastOk: ok, lastError: error, lastDetails: details as Prisma.InputJsonObject, runCount: { increment: 1 }, nextRunAt: nextDailyRun(Date.now(), job.at) },
    });
    return true;
  });
  return r.ran && r.value;
}

/** Reads the due feeds, FEED_CONCURRENCY at a time. */
export async function syncDueFeeds(now = new Date()): Promise<{ read: number; skipped: number }> {
  const ids = await dueFeeds(now);
  let read = 0;
  let skipped = 0;
  for (let i = 0; i < ids.length; i += FEED_CONCURRENCY) {
    const results = await Promise.all(
      ids.slice(i, i + FEED_CONCURRENCY).map(async (id) => {
        // Another worker may have read it since the list was made: syncFeed's lock skips it then, and a fresh
        // nextSyncAt is checked again under the lock.
        const f = await db.channelFeed.findUnique({ where: { id }, select: { nextSyncAt: true } });
        if (!f || f.nextSyncAt > new Date()) return true;
        return (await syncFeed(id, { trigger: "SCHEDULED" })).skipped;
      }),
    );
    for (const s of results) {
      if (s) skipped++;
      else read++;
    }
  }
  return { read, skipped };
}

export async function tick(): Promise<void> {
  try {
    const r = await syncDueFeeds();
    if (r.read) console.log(`[worker] ${r.read} calendrier(s) lu(s)`);
  } catch (e) {
    console.error(`[worker] feeds: ${(e as Error).message}`);
  }
  try {
    await runExclusive(jobLocker(), "job:stale-feed-alerts", () => alertStaleFeeds());
  } catch (e) {
    console.error(`[worker] stale alerts: ${(e as Error).message}`);
  }
  try {
    if (inboundEmailSources().length) await runExclusive(jobLocker(), "job:inbound-email-poll", () => pollInboundEmails());
  } catch (e) {
    console.error(`[worker] booking e-mails: ${(e as Error).message}`);
  }
  for (const job of DAILY_JOBS) {
    try {
      if (await runDailyJob(job)) console.log(`[worker] job ${job.name} done`);
    } catch (e) {
      console.error(`[worker] job ${job.name}: ${(e as Error).message}`);
    }
  }
}

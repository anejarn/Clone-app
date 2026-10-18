/**
 * The background worker (`pnpm worker`), a process separate from the web server: iCal reads every 10 minutes per feed,
 * alerts on broken feeds, daily jobs (identity purge, purges of old records). See lib/server/jobs/worker.ts.
 * Options: --once (one tick, then exit: for cron or a check), --job=<name> (run that daily job now and exit).
 * Several workers may run at once (advisory locks). Stops cleanly on SIGINT / SIGTERM after the current tick.
 *
 * Runs with the react-server condition (package.json) so that the app's server modules load outside Next.js.
 */
import "dotenv/config";
import { db } from "@/lib/server/db";
import { closeLockPool } from "@/lib/server/jobs/locks";
import { DAILY_JOBS, runDailyJob, tick, TICK_MS } from "@/lib/server/jobs/worker";

let stopping = false;
let wake: (() => void) | null = null;

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--once" && !a.startsWith("--job="));
  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.join(" ")}. Usage: pnpm worker [--once] [--job=<${DAILY_JOBS.map((j) => j.name).join("|")}>]`);
  const jobName = args.find((a) => a.startsWith("--job="))?.slice("--job=".length);
  if (jobName) {
    const job = DAILY_JOBS.find((j) => j.name === jobName);
    if (!job) throw new Error(`Unknown job "${jobName}".`);
    console.log((await runDailyJob(job, { force: true })) ? `Job ${jobName} done.` : `Job ${jobName} is running elsewhere.`);
    return;
  }
  if (args.includes("--once")) {
    await tick();
    return;
  }
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      stopping = true;
      wake?.();
    });
  }
  console.log(`[worker] started (tick every ${TICK_MS / 1000} s)`);
  while (!stopping) {
    await tick();
    if (stopping) break;
    await new Promise<void>((resolve) => {
      wake = resolve;
      setTimeout(resolve, TICK_MS);
    });
  }
  console.log("[worker] stopped");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeLockPool();
    await db.$disconnect();
  });

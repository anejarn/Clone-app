/**
 * Deletes the travellers' identity data (fiches and document scans) of the stays whose departure is older than the
 * organization's retention delay (`pnpm identity:purge`; lib/server/declarations/purge.ts). `--dry-run` lists what
 * would be deleted and changes nothing; `--org=<slug>` limits it to one organization. Logs one line per stay, no
 * personal data. Lot 7's background scheduler will run it every day; until then, run it daily by hand or from cron.
 *
 * Runs with the react-server condition (see package.json) so that the app's server modules load outside Next.js.
 */
import "dotenv/config";
import { purgeIdentities } from "@/lib/server/declarations/purge";
import { db } from "@/lib/server/db";

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--dry-run" && !a.startsWith("--org="));
  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.join(" ")}. Usage: pnpm identity:purge [--dry-run] [--org=<slug>]`);
  const dryRun = args.includes("--dry-run");
  const slug = args.find((a) => a.startsWith("--org="))?.slice("--org=".length);
  let organizationId: string | undefined;
  if (slug) {
    const org = await db.organization.findUnique({ where: { slug }, select: { id: true } });
    if (!org) throw new Error(`Organization "${slug}" not found.`);
    organizationId = org.id;
  }
  const report = await purgeIdentities({ dryRun, organizationId, log: (l) => console.log(l) });
  if (report.failedFiles.length) {
    console.error(`${report.failedFiles.length} file(s) could not be deleted; their stays were left for the next run.`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

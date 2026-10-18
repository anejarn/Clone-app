import "server-only";
import { isoDay } from "@/lib/admin/calendar";
import { todayInTimeZone } from "@/lib/dates";
import { purgeCutoff } from "@/lib/declarations/retention";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { fileStorage, type FileStorage } from "@/lib/storage";
import { recordAudit } from "../audit";
import { db } from "../db";

/**
 * The automatic deletion of the travellers' identity data once the organization's retention delay has passed
 * (Lot 5; the deletion the declaration requires, loi 09-08). For every stay whose departure is at least
 * `identityRetentionDays` days ago (Marrakech date): the document scans are deleted from the store first, then the
 * fiches (rows of travelers and traveler_documents), leaving an IdentityPurge row (booking id, counts, date — no
 * personal data) and an audit entry « identity.purged » (actor: the system). The taxe de séjour snapshot stays: it
 * holds no personal data. Stays not past the delay are never touched.
 *
 * Run by `pnpm identity:purge` (scripts/identity-purge.ts, `--dry-run` to only list what would go) until the
 * background scheduler of lot 7 runs it daily. Idempotent: a second run finds nothing.
 */

export interface PurgeCandidate {
  organizationId: string;
  bookingId: string;
  checkOut: string;
  retentionDays: number;
  travelers: number;
  documents: number;
}

export interface PurgeReport {
  dryRun: boolean;
  today: string;
  candidates: PurgeCandidate[];
  purgedTravelers: number;
  purgedDocuments: number;
  failedFiles: string[];
}

export interface PurgeOptions {
  dryRun?: boolean;
  /** Local date (UTC midnight). Default: today in Marrakech. */
  today?: Date;
  /** Only this organization. */
  organizationId?: string;
  storage?: FileStorage;
  log?: (line: string) => void;
}

/** The stays whose identity data is due, per organization delay. */
export async function purgeCandidates(today: Date, organizationId?: string): Promise<PurgeCandidate[]> {
  const orgs = await db.organization.findMany({ where: organizationId ? { id: organizationId } : {}, select: { id: true, identityRetentionDays: true } });
  const out: PurgeCandidate[] = [];
  for (const org of orgs) {
    const cutoff = new Date(`${purgeCutoff(isoDay(today), org.identityRetentionDays)}T00:00:00Z`);
    const bookings = await db.booking.findMany({
      where: { organizationId: org.id, checkOut: { lte: cutoff }, travelers: { some: {} } },
      select: { id: true, checkOut: true, travelers: { select: { _count: { select: { documents: true } } } } },
      orderBy: [{ checkOut: "asc" }, { id: "asc" }],
    });
    for (const b of bookings) {
      out.push({
        organizationId: org.id,
        bookingId: b.id,
        checkOut: isoDay(b.checkOut),
        retentionDays: org.identityRetentionDays,
        travelers: b.travelers.length,
        documents: b.travelers.reduce((s, t) => s + t._count.documents, 0),
      });
    }
  }
  return out;
}

export async function purgeIdentities(opts: PurgeOptions = {}): Promise<PurgeReport> {
  const today = opts.today ?? todayInTimeZone(MARRAKECH_TIMEZONE);
  const log = opts.log ?? (() => {});
  const storage = opts.storage ?? fileStorage();
  const candidates = await purgeCandidates(today, opts.organizationId);
  const report: PurgeReport = { dryRun: !!opts.dryRun, today: isoDay(today), candidates, purgedTravelers: 0, purgedDocuments: 0, failedFiles: [] };
  for (const c of candidates) {
    log(`${opts.dryRun ? "[dry-run] would purge" : "purging"} booking ${c.bookingId} (org ${c.organizationId}, departure ${c.checkOut}, delay ${c.retentionDays} days): ${c.travelers} traveller(s), ${c.documents} document file(s)`);
    if (opts.dryRun) continue;
    // Files first: if the database step fails, the next run deletes the rows; a file is never left behind its row.
    const docs = await db.travelerDocument.findMany({ where: { organizationId: c.organizationId, traveler: { bookingId: c.bookingId } }, select: { storageKey: true } });
    let failed = false;
    for (const d of docs) {
      try {
        await storage.delete(d.storageKey);
      } catch (e) {
        failed = true;
        report.failedFiles.push(d.storageKey);
        log(`  could not delete ${d.storageKey}: ${(e as Error).message}`);
      }
    }
    if (failed) continue;
    await db.$transaction(async (tx) => {
      const rows = await tx.traveler.findMany({ where: { organizationId: c.organizationId, bookingId: c.bookingId }, select: { isMinor: true, declaredAt: true, _count: { select: { documents: true } } } });
      if (!rows.length) return;
      const documentCount = rows.reduce((s, t) => s + t._count.documents, 0);
      // Minors first is not needed: guardianId is ON DELETE SET NULL; one statement removes them all.
      await tx.traveler.deleteMany({ where: { organizationId: c.organizationId, bookingId: c.bookingId } });
      const trace = {
        organizationId: c.organizationId,
        bookingId: c.bookingId,
        checkOut: new Date(`${c.checkOut}T00:00:00Z`),
        travelerCount: rows.length,
        minorCount: rows.filter((t) => t.isMinor).length,
        declaredCount: rows.filter((t) => t.declaredAt).length,
        documentCount,
        retentionDays: c.retentionDays,
      };
      await tx.identityPurge.create({ data: trace });
      await recordAudit(tx, {
        organizationId: c.organizationId,
        actorId: null,
        action: "identity.purged",
        targetType: "booking",
        targetId: c.bookingId,
        details: { travelers: trace.travelerCount, documents: documentCount, retentionDays: c.retentionDays, checkOut: c.checkOut },
      });
      report.purgedTravelers += rows.length;
      report.purgedDocuments += documentCount;
    });
  }
  log(
    opts.dryRun
      ? `[dry-run] ${candidates.length} stay(s) due on ${report.today}; nothing deleted.`
      : `${report.purgedTravelers} traveller(s) and ${report.purgedDocuments} document(s) deleted from ${candidates.length} stay(s) on ${report.today}.`,
  );
  return report;
}

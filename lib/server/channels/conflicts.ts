import "server-only";
import { isoDay } from "@/lib/admin/calendar";
import { todayInTimeZone } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { BookingSource, ChannelConflictResolution, ChannelSyncOutcome, ChannelSyncTrigger } from "@/lib/generated/prisma/enums";
import { syncBookingTasks } from "@/lib/operations/sync";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { refreshExistingBookingTax } from "../declarations/tax";
import { AppError } from "../errors";
import { feedHealth, type FeedHealth } from "./feeds";

/**
 * Double-booking conflicts and the synchronisation's state (section Synchronisation, ADMIN only), for one organization.
 * Resolving a conflict:
 * - « Annuler la réservation en place et garder l'import » (REPLACED): the booking holding the nights is cancelled
 *   (field tasks follow; if it is another platform's, it must be cancelled on that platform too: the page says so) and
 *   the imported reservation takes the nights (created, or the imported booking re-dated);
 * - « Marquer comme traité » (DISMISSED): nothing changes in the bookings; the same event on the same nights won't open
 *   a conflict again (it was handled on the platform), new dates would.
 */

const conflictNotFound = () => new AppError(404, "NOT_FOUND", "Conflit introuvable.");

export interface ConflictView {
  id: string;
  listingId: string;
  listingTitle: string;
  source: BookingSource;
  externalRef: string;
  checkIn: string;
  checkOut: string;
  block: boolean;
  blockingBookingId: string | null;
  blockingSource: BookingSource;
  blockingRef: string | null;
  blockingCheckIn: string;
  blockingCheckOut: string;
  ownBookingId: string | null;
  status: "OPEN" | "RESOLVED";
  resolution: ChannelConflictResolution | null;
  detectedAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
}

const conflictSelect = {
  id: true,
  listingId: true,
  source: true,
  externalRef: true,
  checkIn: true,
  checkOut: true,
  block: true,
  blockingBookingId: true,
  blockingSource: true,
  blockingRef: true,
  blockingCheckIn: true,
  blockingCheckOut: true,
  ownBookingId: true,
  status: true,
  resolution: true,
  detectedAt: true,
  lastSeenAt: true,
  resolvedAt: true,
  listing: { select: { title: true } },
} satisfies Prisma.ChannelConflictSelect;

function toView(c: Prisma.ChannelConflictGetPayload<{ select: typeof conflictSelect }>): ConflictView {
  return {
    ...c,
    listingTitle: c.listing.title,
    checkIn: isoDay(c.checkIn),
    checkOut: isoDay(c.checkOut),
    blockingCheckIn: isoDay(c.blockingCheckIn),
    blockingCheckOut: isoDay(c.blockingCheckOut),
  };
}

export async function listConflicts(organizationId: string, opts: { status?: "OPEN" | "RESOLVED"; listingId?: string; take?: number } = {}): Promise<ConflictView[]> {
  const rows = await db.channelConflict.findMany({
    where: { organizationId, ...(opts.status && { status: opts.status }), ...(opts.listingId && { listingId: opts.listingId }) },
    select: conflictSelect,
    orderBy: [{ status: "asc" }, { checkIn: "asc" }, { id: "asc" }],
    take: opts.take ?? 100,
  });
  return rows.map(toView);
}

export async function openConflictCount(organizationId: string): Promise<number> {
  return db.channelConflict.count({ where: { organizationId, status: "OPEN" } });
}

function overlapError(e: unknown): boolean {
  const text = e instanceof Error ? `${e.message} ${JSON.stringify((e as { meta?: unknown }).meta ?? "")}` : "";
  return text.includes("bookings_no_overlap") || text.includes("23P01") || text.includes("40P01");
}

export async function resolveConflict(actor: Authorized, conflictId: string, how: "REPLACE" | "DISMISS", today?: Date): Promise<{ cancelledSource: BookingSource | null }> {
  const { organizationId } = actor;
  try {
    return await db.$transaction(async (tx) => {
      const c = await tx.channelConflict.findFirst({
        where: { id: conflictId, organizationId },
        select: { id: true, listingId: true, feedId: true, source: true, externalRef: true, checkIn: true, checkOut: true, block: true, blockingBookingId: true, ownBookingId: true, status: true, listing: { select: { place: { select: { timezone: true } } } } },
      });
      if (!c) throw conflictNotFound();
      if (c.status !== "OPEN") throw new AppError(409, "RESOLVED", "Ce conflit est déjà résolu.");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sigma:listing:${c.listingId}`}, 0))`;
      const localToday = today ?? todayInTimeZone(c.listing.place.timezone);
      const now = new Date();
      let cancelledSource: BookingSource | null = null;
      if (how === "REPLACE") {
        if (c.blockingBookingId) {
          const blocker = await tx.booking.findFirst({ where: { id: c.blockingBookingId, organizationId, status: "CONFIRMED" }, select: { id: true, source: true, checkIn: true, checkOut: true } });
          if (blocker) {
            await tx.booking.update({ where: { id: blocker.id }, data: { status: "CANCELLED", cancelledAt: now } });
            await syncBookingTasks(tx, blocker.id, { today: localToday });
            await recordAudit(tx, {
              organizationId,
              actorId: actor.user.id,
              action: blocker.source === "OWNER" ? "owner_block.cancelled" : "booking.cancelled",
              targetType: "booking",
              targetId: blocker.id,
              details: { source: blocker.source, checkIn: isoDay(blocker.checkIn), checkOut: isoDay(blocker.checkOut), conflictId: c.id },
            });
            cancelledSource = blocker.source;
          }
        }
        const clash = await tx.booking.findFirst({
          where: { listingId: c.listingId, status: "CONFIRMED", checkIn: { lt: c.checkOut }, checkOut: { gt: c.checkIn }, ...(c.ownBookingId && { id: { not: c.ownBookingId } }) },
          select: { id: true },
        });
        if (clash) throw new AppError(409, "STILL_TAKEN", "D'autres réservations occupent encore ces nuits : annulez-les d'abord depuis Réservations.");
        const own = c.ownBookingId ? await tx.booking.findFirst({ where: { id: c.ownBookingId, organizationId }, select: { id: true, checkIn: true, checkOut: true } }) : null;
        let bookingId: string;
        if (own) {
          await tx.booking.update({ where: { id: own.id }, data: { checkIn: c.checkIn, checkOut: c.checkOut, status: "CONFIRMED", cancelledAt: null, channelBlock: c.block } });
          await syncBookingTasks(tx, own.id, { today: localToday, previous: own });
          await refreshExistingBookingTax(tx, organizationId, own.id, actor.user.id);
          bookingId = own.id;
        } else {
          const existing = await tx.booking.findFirst({ where: { organizationId, source: c.source, externalRef: c.externalRef }, select: { id: true, listingId: true, checkIn: true, checkOut: true } });
          if (existing && existing.listingId !== c.listingId) throw new AppError(409, "REF_ELSEWHERE", "Cette référence est déjà enregistrée sur un autre bien.");
          if (existing) {
            await tx.booking.update({ where: { id: existing.id }, data: { checkIn: c.checkIn, checkOut: c.checkOut, status: "CONFIRMED", cancelledAt: null, channelFeedId: c.feedId, channelBlock: c.block } });
            await syncBookingTasks(tx, existing.id, { today: localToday, previous: existing });
            bookingId = existing.id;
          } else {
            const b = await tx.booking.create({
              data: { organizationId, listingId: c.listingId, source: c.source, externalRef: c.externalRef, channelFeedId: c.feedId, channelBlock: c.block, checkIn: c.checkIn, checkOut: c.checkOut, adults: 1 },
              select: { id: true },
            });
            await syncBookingTasks(tx, b.id, { today: localToday });
            bookingId = b.id;
          }
        }
        await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "channel.booking_imported", targetType: "booking", targetId: bookingId, details: { source: c.source, feedId: c.feedId, checkIn: isoDay(c.checkIn), checkOut: isoDay(c.checkOut), conflictId: c.id } });
      }
      const resolution: ChannelConflictResolution = how === "REPLACE" ? "REPLACED" : "DISMISSED";
      await tx.channelConflict.update({ where: { id: c.id }, data: { status: "RESOLVED", resolution, resolvedAt: now, resolvedById: actor.user.id } });
      await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "channel.conflict_resolved", targetType: "channel_conflict", targetId: c.id, details: { resolution, ...(cancelledSource && { cancelledSource }) } });
      return { cancelledSource };
    });
  } catch (e) {
    if (overlapError(e)) throw new AppError(409, "STILL_TAKEN", "Ces nuits viennent d'être prises par une autre réservation : rechargez la page.");
    throw e;
  }
}

// ---------- Synchronisation overview ----------

export interface FeedStatusRow {
  id: string;
  listingId: string;
  listingTitle: string;
  source: BookingSource;
  importHost: string | null;
  health: FeedHealth;
  lastSuccessAt: Date | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  exportActive: boolean;
}

export async function feedStatuses(organizationId: string, now = Date.now()): Promise<FeedStatusRow[]> {
  const rows = await db.channelFeed.findMany({
    where: { organizationId },
    select: {
      id: true,
      listingId: true,
      source: true,
      importHost: true,
      importUrlEnc: true,
      importEnabled: true,
      importUrlSetAt: true,
      lastSuccessAt: true,
      lastSyncAt: true,
      lastStatus: true,
      lastError: true,
      exportRevokedAt: true,
      listing: { select: { title: true } },
    },
    orderBy: [{ listing: { title: "asc" } }, { source: "asc" }],
  });
  return rows.map((f) => ({
    id: f.id,
    listingId: f.listingId,
    listingTitle: f.listing.title,
    source: f.source,
    importHost: f.importHost,
    health: feedHealth(f, now),
    lastSuccessAt: f.lastSuccessAt,
    lastSyncAt: f.lastSyncAt,
    lastError: f.lastError,
    exportActive: !f.exportRevokedAt,
  }));
}

export interface SyncAlerts {
  openConflicts: number;
  failing: number;
  stale: number;
}

/** What the back-office banner and the dashboard say. */
export async function syncAlerts(organizationId: string, now = Date.now()): Promise<SyncAlerts> {
  const [openConflicts, feeds] = await Promise.all([
    openConflictCount(organizationId),
    db.channelFeed.findMany({
      where: { organizationId, importUrlEnc: { not: null }, importEnabled: true },
      select: { importEnabled: true, lastStatus: true, lastSuccessAt: true, importUrlSetAt: true },
    }),
  ]);
  const health = feeds.map((f) => feedHealth({ ...f, hasImport: true }, now));
  return { openConflicts, failing: health.filter((h) => h === "FAILING").length, stale: health.filter((h) => h === "STALE").length };
}

export interface RunView {
  id: string;
  listingId: string;
  listingTitle: string;
  source: BookingSource;
  trigger: ChannelSyncTrigger;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: ChannelSyncOutcome | null;
  httpStatus: number | null;
  eventsSeen: number;
  created: number;
  updated: number;
  cancelled: number;
  conflicts: number;
  ignored: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export async function syncJournal(organizationId: string, opts: { listingId?: string; take?: number } = {}): Promise<RunView[]> {
  const rows = await db.channelSyncRun.findMany({
    where: { organizationId, ...(opts.listingId && { listingId: opts.listingId }) },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: opts.take ?? 50,
    include: { feed: { select: { listing: { select: { title: true } } } } },
  });
  return rows.map(({ feed, organizationId: _o, requestedById: _r, ...r }) => {
    void _o;
    void _r;
    return { ...r, listingTitle: feed.listing.title };
  });
}

/** The feed of an organization, for « Synchroniser maintenant » (null: unknown or another organization's). */
export async function orgFeed(organizationId: string, listingId: string, source: BookingSource) {
  return db.channelFeed.findFirst({ where: { organizationId, listingId, source }, select: { id: true, importUrlEnc: true } });
}

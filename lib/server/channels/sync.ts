import "server-only";
import { isPlatformSource, type PlatformSource } from "@/lib/admin/booking-sources";
import { isoDay } from "@/lib/admin/calendar";
import { adapterFor } from "@/lib/channels";
import { FeedFetchError } from "@/lib/channels/fetch";
import { IcalParseError } from "@/lib/channels/ical/parse";
import { platform } from "@/lib/channels/platforms";
import { planSync, type Action, type Plan } from "@/lib/channels/reconcile";
import type { ImportResult } from "@/lib/channels/types";
import { todayInTimeZone } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ChannelSyncOutcome, ChannelSyncTrigger } from "@/lib/generated/prisma/enums";
import { nextFeedRun, runExclusive } from "@/lib/jobs/scheduler";
import { syncBookingTasks } from "@/lib/operations/sync";
import { recordAudit } from "../audit";
import { db } from "../db";
import { refreshExistingBookingTax } from "../declarations/tax";
import { jobLocker } from "../jobs/locks";
import { notifyConflicts, type ConflictAlert } from "./alerts";
import { exportedRanges } from "./export";
import { importUrlOf } from "./feeds";

/**
 * One read of a platform's iCal link and what it changes in Sigma (Lot 7), for the worker (every 10 minutes) and
 * « Synchroniser maintenant ». Under the feed's advisory lock (two runs of one feed never overlap: the second is
 * skipped), journaled in channel_sync_runs whatever happens, then applied in one transaction holding the listing's
 * advisory lock (imports of two platforms of one home are applied one after the other): bookings created, re-dated,
 * cancelled (lib/channels/reconcile.ts decides), their field tasks (lib/operations/sync.ts) and taxe de séjour
 * snapshot follow, conflicts recorded, every change audited (actor: null, or the associé who asked). New conflicts are
 * notified after the commit. A failed read changes no booking: the error goes to the journal and the feed's health.
 */

export interface SyncSummary {
  skipped: boolean;
  runId: string | null;
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

export interface SyncOptions {
  trigger: ChannelSyncTrigger;
  actorId?: string | null;
  now?: Date;
  /** Local date (tests). Default: today at the home. */
  today?: Date;
}

class SyncError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number | null = null,
  ) {
    super(message);
  }
}

function isOverlapViolation(e: unknown): boolean {
  const text = e instanceof Error ? `${e.message} ${JSON.stringify((e as { meta?: unknown }).meta ?? "")}` : "";
  return text.includes("bookings_no_overlap") || text.includes("23P01") || text.includes("40P01");
}

const empty = (): Omit<SyncSummary, "skipped" | "runId" | "outcome" | "httpStatus" | "errorCode" | "errorMessage"> => ({
  eventsSeen: 0,
  created: 0,
  updated: 0,
  cancelled: 0,
  conflicts: 0,
  ignored: 0,
});

export async function syncFeed(feedId: string, opts: SyncOptions): Promise<SyncSummary> {
  const r = await runExclusive(jobLocker(), `feed:${feedId}`, () => syncLocked(feedId, opts));
  if (!r.ran) return { skipped: true, runId: null, outcome: null, httpStatus: null, ...empty(), errorCode: "LOCKED", errorMessage: "Une lecture de ce calendrier est déjà en cours." };
  return r.value;
}

async function syncLocked(feedId: string, opts: SyncOptions): Promise<SyncSummary> {
  const now = opts.now ?? new Date();
  const feed = await db.channelFeed.findUnique({ where: { id: feedId }, include: { listing: { select: { title: true, place: { select: { timezone: true } } } } } });
  if (!feed || !feed.importUrlEnc || !isPlatformSource(feed.source)) {
    return { skipped: true, runId: null, outcome: null, httpStatus: null, ...empty(), errorCode: "NO_IMPORT", errorMessage: "Aucun lien d'import." };
  }
  const source: PlatformSource = feed.source;
  const run = await db.channelSyncRun.create({
    data: { organizationId: feed.organizationId, feedId: feed.id, listingId: feed.listingId, source, trigger: opts.trigger, requestedById: opts.actorId ?? null, startedAt: now },
    select: { id: true },
  });
  const today = opts.today ?? todayInTimeZone(feed.listing.place.timezone, now.getTime());
  let result: ImportResult;
  const counts = empty();
  let outcome: ChannelSyncOutcome = "SUCCESS";
  let httpStatus: number | null = null;
  let error: SyncError | null = null;
  let alerts: ConflictAlert[] = [];
  try {
    const url = importUrlOf(feed);
    if (!url) throw new SyncError("NO_IMPORT", "Aucun lien d'import.");
    try {
      result = await adapterFor(source).importEvents(platform(source), { url, etag: feed.etag, lastModified: feed.lastModified });
    } catch (e) {
      if (e instanceof FeedFetchError) throw new SyncError(e.code, e.message, e.httpStatus);
      if (e instanceof IcalParseError) throw new SyncError(`INVALID_FILE`, e.message, 200);
      throw e;
    }
    httpStatus = result.httpStatus;
    if (result.notModified) outcome = "NOT_MODIFIED";
    else {
      counts.eventsSeen = result.events.length;
      counts.ignored = result.skipped.length;
      const applied = await applyWithRetry(feed, source, result, today, opts.actorId ?? null);
      counts.created = applied.plan.counts.created;
      counts.updated = applied.plan.counts.updated;
      counts.cancelled = applied.plan.counts.cancelled;
      counts.conflicts = applied.plan.counts.conflicts;
      counts.ignored += applied.plan.ignored.length;
      alerts = applied.alerts;
    }
  } catch (e) {
    error = e instanceof SyncError ? e : new SyncError("INTERNAL", "Erreur interne pendant la synchronisation.");
    if (!(e instanceof SyncError)) console.error(`sync of feed ${feed.id} failed:`, e);
    outcome = "ERROR";
    httpStatus = error.httpStatus;
  }

  const finished = new Date(Math.max(Date.now(), now.getTime()));
  const message = error?.message.slice(0, 500) ?? null;
  await db.$transaction([
    db.channelSyncRun.update({
      where: { id: run.id },
      data: { finishedAt: finished, outcome, httpStatus, ...counts, errorCode: error?.code ?? null, errorMessage: message },
    }),
    db.channelFeed.update({
      where: { id: feed.id },
      data: {
        lastSyncAt: finished,
        lastStatus: outcome,
        nextSyncAt: nextFeedRun(finished.getTime()),
        ...(error
          ? { lastError: message, consecutiveFailures: { increment: 1 } }
          : {
              lastError: null,
              lastSuccessAt: finished,
              consecutiveFailures: 0,
              staleAlertedAt: null,
              ...(outcome === "SUCCESS" && result! && !result.notModified && { etag: result.etag, lastModified: result.lastModified }),
            }),
      },
    }),
  ]);
  if (alerts.length) await notifyConflicts(feed.organizationId, alerts);
  return { skipped: false, runId: run.id, outcome, httpStatus, ...counts, errorCode: error?.code ?? null, errorMessage: message };
}

type FeedRow = { id: string; organizationId: string; listingId: string; listing: { title: string } };

async function applyWithRetry(feed: FeedRow, source: PlatformSource, result: Extract<ImportResult, { notModified: false }>, today: Date, actorId: string | null) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction((tx) => applyImport(tx, feed, source, result, today, actorId), { timeout: 60_000, maxWait: 15_000 });
    } catch (e) {
      // A booking typed meanwhile took the nights: read again, the conflict is then seen.
      if (attempt === 0 && isOverlapViolation(e)) continue;
      if (e instanceof SyncError) throw e;
      if (isOverlapViolation(e)) throw new SyncError("CONCURRENT_WRITE", "Des réservations ont changé pendant la lecture : nouvel essai au prochain passage.");
      throw e;
    }
  }
}

async function applyImport(
  tx: Prisma.TransactionClient,
  feed: FeedRow,
  source: PlatformSource,
  result: Extract<ImportResult, { notModified: false }>,
  today: Date,
  actorId: string | null,
): Promise<{ plan: Plan; alerts: ConflictAlert[] }> {
  const { organizationId, listingId } = feed;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sigma:listing:${listingId}`}, 0))`;
  const listing = await tx.listing.findUniqueOrThrow({ where: { id: listingId }, select: { id: true, organizationId: true, preparationDays: true, minNoticeDays: true } });
  const refs = result.events.map((e) => e.ref);
  const [own, sameRef, others, openConflicts, dismissed, exported] = await Promise.all([
    tx.booking.findMany({ where: { channelFeedId: feed.id }, select: { id: true, externalRef: true, checkIn: true, checkOut: true, status: true, channelBlock: true } }),
    refs.length
      ? tx.booking.findMany({ where: { organizationId, source, externalRef: { in: refs }, OR: [{ channelFeedId: null }, { channelFeedId: { not: feed.id } }] }, select: { id: true, listingId: true, channelFeedId: true, externalRef: true, checkIn: true, checkOut: true, status: true, channelBlock: true } })
      : [],
    tx.booking.findMany({
      where: { listingId, organizationId, status: "CONFIRMED", checkOut: { gt: today }, OR: [{ channelFeedId: null }, { channelFeedId: { not: feed.id } }] },
      select: { id: true, source: true, externalRef: true, checkIn: true, checkOut: true },
    }),
    tx.channelConflict.findMany({ where: { feedId: feed.id, status: "OPEN" }, select: { id: true, externalRef: true, checkIn: true, checkOut: true } }),
    tx.channelConflict.findMany({ where: { feedId: feed.id, resolution: "DISMISSED" }, select: { externalRef: true, checkIn: true, checkOut: true } }),
    exportedRanges(tx, listing, source, today),
  ]);
  const ownRow = (b: (typeof own)[number]) => ({ id: b.id, ref: b.externalRef!, checkIn: b.checkIn, checkOut: b.checkOut, status: b.status, block: b.channelBlock });
  const adoptable = sameRef.filter((b) => b.listingId === listingId && b.channelFeedId === null);
  const plan = planSync({
    today,
    source,
    events: result.events,
    own: own.map(ownRow),
    adoptable: adoptable.map(ownRow),
    takenRefs: new Set(sameRef.filter((b) => !adoptable.includes(b)).map((b) => b.externalRef!)),
    others: others.map((o) => ({ id: o.id, source: o.source, ref: o.externalRef, checkIn: o.checkIn, checkOut: o.checkOut })),
    exported,
    openConflicts: openConflicts.map((c) => ({ id: c.id, ref: c.externalRef, checkIn: c.checkIn, checkOut: c.checkOut })),
    dismissed: dismissed.map((d) => ({ ref: d.externalRef, checkIn: d.checkIn, checkOut: d.checkOut })),
  });
  if (plan.suspectEmpty) {
    throw new SyncError("EMPTY_FEED", "Le calendrier de la plateforme est vide alors que plusieurs réservations à venir en viennent : rien n'a été annulé. Vérifiez sur la plateforme.");
  }
  const alerts: ConflictAlert[] = [];
  const audit = (action: Parameters<typeof recordAudit>[1]["action"], targetType: "booking" | "channel_conflict", targetId: string, details: Prisma.InputJsonObject) =>
    recordAudit(tx, { organizationId, actorId, action, targetType, targetId, details: { source, feedId: feed.id, ...details } });
  const nights = (ev: { checkIn: Date; checkOut: Date }) => ({ checkIn: isoDay(ev.checkIn), checkOut: isoDay(ev.checkOut) });

  // Bookings created by this run, by ref: an event of the same file may conflict with one of them.
  const createdIds = new Map<string, string>();
  for (const a of plan.actions) await applyAction(a);
  return { plan, alerts };

  async function applyAction(a: Action) {
    const now = new Date();
    switch (a.type) {
      case "create": {
        const b = await tx.booking.create({
          data: { organizationId, listingId, source, externalRef: a.ev.ref, channelFeedId: feed.id, channelBlock: a.ev.kind === "block", checkIn: a.ev.checkIn, checkOut: a.ev.checkOut, adults: 1 },
          select: { id: true },
        });
        createdIds.set(a.ev.ref, b.id);
        await syncBookingTasks(tx, b.id, { today });
        await audit("channel.booking_imported", "booking", b.id, { ...nights(a.ev), block: a.ev.kind === "block" });
        return;
      }
      case "update":
      case "adopt":
      case "reactivate": {
        const prev = await tx.booking.findUniqueOrThrow({ where: { id: a.bookingId }, select: { checkIn: true, checkOut: true } });
        await tx.booking.update({
          where: { id: a.bookingId },
          data: { checkIn: a.ev.checkIn, checkOut: a.ev.checkOut, channelBlock: a.ev.kind === "block", channelFeedId: feed.id, status: "CONFIRMED", cancelledAt: null },
        });
        await syncBookingTasks(tx, a.bookingId, { today, previous: prev });
        await refreshExistingBookingTax(tx, organizationId, a.bookingId, actorId);
        const action = a.type === "adopt" ? "channel.booking_adopted" : a.type === "reactivate" ? "channel.booking_imported" : "channel.booking_updated";
        await audit(action, "booking", a.bookingId, { from: nights(prev), to: nights(a.ev), ...(a.type === "reactivate" && { reactivated: true }) });
        return;
      }
      case "cancel": {
        const b = await tx.booking.update({ where: { id: a.bookingId, status: "CONFIRMED" }, data: { status: "CANCELLED", cancelledAt: now }, select: { checkIn: true, checkOut: true } });
        await syncBookingTasks(tx, a.bookingId, { today });
        await audit("channel.booking_cancelled", "booking", a.bookingId, nights(b));
        return;
      }
      case "conflict": {
        const blockerId = a.blocker.id.startsWith("new:") ? (createdIds.get(a.blocker.id.slice(4)) ?? null) : a.blocker.id;
        const data = {
          checkIn: a.ev.checkIn,
          checkOut: a.ev.checkOut,
          block: a.ev.kind === "block",
          blockingBookingId: blockerId,
          blockingSource: a.blocker.source,
          blockingRef: a.blocker.ref,
          blockingCheckIn: a.blocker.checkIn,
          blockingCheckOut: a.blocker.checkOut,
          ownBookingId: a.ownBookingId,
          lastSeenAt: now,
        };
        if (a.existingConflictId) {
          const before = await tx.channelConflict.findUniqueOrThrow({ where: { id: a.existingConflictId }, select: { checkIn: true, checkOut: true } });
          await tx.channelConflict.update({ where: { id: a.existingConflictId }, data });
          if (before.checkIn.getTime() === a.ev.checkIn.getTime() && before.checkOut.getTime() === a.ev.checkOut.getTime()) return;
          await audit("channel.conflict_detected", "channel_conflict", a.existingConflictId, { ...nights(a.ev), redated: true });
        } else {
          const c = await tx.channelConflict.create({ data: { organizationId, listingId, feedId: feed.id, source, externalRef: a.ev.ref, ...data }, select: { id: true } });
          await audit("channel.conflict_detected", "channel_conflict", c.id, { ...nights(a.ev), blockingBookingId: blockerId, blockingSource: a.blocker.source });
        }
        alerts.push({ listingTitle: feed.listing.title, source, checkIn: a.ev.checkIn, checkOut: a.ev.checkOut, blockingSource: a.blocker.source, blockingRef: a.blocker.ref });
        return;
      }
      case "resolve": {
        await tx.channelConflict.update({ where: { id: a.conflictId }, data: { status: "RESOLVED", resolution: a.resolution, resolvedAt: now } });
        await audit("channel.conflict_resolved", "channel_conflict", a.conflictId, { resolution: a.resolution });
        return;
      }
    }
  }
}

/** Feeds due for a read (the worker). */
export async function dueFeeds(now = new Date(), take = 50): Promise<string[]> {
  const rows = await db.channelFeed.findMany({
    where: { importUrlEnc: { not: null }, importEnabled: true, nextSyncAt: { lte: now }, listing: { category: "HOME" } },
    select: { id: true },
    orderBy: { nextSyncAt: "asc" },
    take,
  });
  return rows.map((r) => r.id);
}

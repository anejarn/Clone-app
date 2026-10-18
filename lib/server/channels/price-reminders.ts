import "server-only";
import type { PlatformSource } from "@/lib/admin/booking-sources";
import { isoDay } from "@/lib/admin/calendar";
import {
  changedLines,
  isNoop,
  linesOf,
  listingPriceChanged,
  listingSnapshot,
  mergeSnapshots,
  parseLines,
  ruleSnapshot,
  type ListingPriceShape,
  type ReminderLine,
  type RuleShape,
} from "@/lib/channels/price-reminders";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { BookingSource } from "@/lib/generated/prisma/enums";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";

/**
 * Prices to report on the platforms (Lot 7b; iCal carries none). Written in the transaction of the price change itself
 * (lib/server/admin/prices.ts: a season or event created, changed or deleted; lib/server/admin/listings.ts: a home's
 * base price, minimum stay or cleaning fee): one reminder per connected feed (export link active, or import link set)
 * of each home concerned, with the lines before / after. Listed in Synchronisation → Prix à reporter, with a badge and
 * a counter on the dashboard; « Fait » per platform (audited). Rules: lib/channels/price-reminders.ts.
 */

export interface RuleLike {
  shape: RuleShape;
  /** Null: every home of the organization. */
  listingIds: readonly string[] | null;
  startDate: Date;
  endDate: Date;
}

const connected = (organizationId: string, listingIds: readonly string[]): Prisma.ChannelFeedWhereInput => ({
  organizationId,
  listingId: { in: [...listingIds] },
  listing: { category: "HOME" },
  OR: [{ exportRevokedAt: null }, { importUrlEnc: { not: null } }],
});

async function upsert(
  tx: Prisma.TransactionClient,
  organizationId: string,
  feed: { id: string; listingId: string; source: BookingSource },
  subject: { key: string; label: string; periodStart: Date | null; periodEnd: Date | null; recurring: boolean },
  lines: ReminderLine[],
): Promise<void> {
  const open = await tx.priceReminder.findFirst({ where: { feedId: feed.id, subjectKey: subject.key, doneAt: null }, select: { id: true, changes: true } });
  const period = { subjectLabel: subject.label.slice(0, 120), periodStart: subject.periodStart, periodEnd: subject.periodEnd, recurring: subject.recurring };
  if (open) {
    const merged = mergeSnapshots(parseLines(open.changes), lines);
    if (isNoop(merged)) await tx.priceReminder.delete({ where: { id: open.id } });
    else await tx.priceReminder.update({ where: { id: open.id }, data: { ...period, changes: merged as unknown as Prisma.InputJsonArray } });
    return;
  }
  if (isNoop(lines)) return;
  await tx.priceReminder.create({
    data: { organizationId, listingId: feed.listingId, feedId: feed.id, source: feed.source, subjectKey: subject.key, ...period, changes: lines as unknown as Prisma.InputJsonArray },
  });
}

async function homesOf(tx: Prisma.TransactionClient, organizationId: string, ids: readonly string[] | null): Promise<string[]> {
  if (ids) return [...ids];
  return (await tx.listing.findMany({ where: { organizationId, category: "HOME" }, select: { id: true } })).map((l) => l.id);
}

/** A season or event created (before null), changed, or deleted (after null). */
export async function recordRuleChange(tx: Prisma.TransactionClient, organizationId: string, ruleId: string, before: RuleLike | null, after: RuleLike | null): Promise<void> {
  const [homesBefore, homesAfter]: string[][] = await Promise.all([before ? homesOf(tx, organizationId, before.listingIds) : [], after ? homesOf(tx, organizationId, after.listingIds) : []]);
  const all = [...new Set([...homesBefore, ...homesAfter])];
  if (!all.length) return;
  const feeds = await tx.channelFeed.findMany({ where: connected(organizationId, all), select: { id: true, listingId: true, source: true } });
  const ref = after ?? before!;
  const subject = { key: `rule:${ruleId}`, label: ref.shape.name, periodStart: ref.startDate, periodEnd: ref.endDate, recurring: ref.shape.recurring };
  for (const f of feeds) {
    const was = before && homesBefore.includes(f.listingId) ? before.shape : null;
    const now = after && homesAfter.includes(f.listingId) ? after.shape : null;
    await upsert(tx, organizationId, f, subject, linesOf(ruleSnapshot(was), ruleSnapshot(now)));
  }
}

/** A home's base price, minimum stay or cleaning fee changed. */
export async function recordListingPriceChange(tx: Prisma.TransactionClient, organizationId: string, listingId: string, before: ListingPriceShape, after: ListingPriceShape, title: string): Promise<void> {
  if (!listingPriceChanged(before, after)) return;
  const feeds = await tx.channelFeed.findMany({ where: connected(organizationId, [listingId]), select: { id: true, listingId: true, source: true } });
  for (const f of feeds) {
    await upsert(tx, organizationId, f, { key: `listing:${listingId}`, label: `Prix du bien · ${title}`, periodStart: null, periodEnd: null, recurring: false }, linesOf(listingSnapshot(before), listingSnapshot(after)));
  }
}

export interface PriceReminderView {
  id: string;
  listingId: string;
  listingTitle: string;
  source: PlatformSource;
  subjectKey: string;
  subjectLabel: string;
  /** The lines that changed. */
  changes: ReminderLine[];
  periodStart: string | null;
  periodEnd: string | null;
  recurring: boolean;
  createdAt: Date;
  updatedAt: Date;
  doneAt: Date | null;
}

export async function listPriceReminders(organizationId: string, opts: { done?: boolean; listingId?: string; take?: number } = {}): Promise<PriceReminderView[]> {
  const rows = await db.priceReminder.findMany({
    where: { organizationId, doneAt: opts.done ? { not: null } : null, ...(opts.listingId && { listingId: opts.listingId }) },
    select: { id: true, listingId: true, source: true, subjectKey: true, subjectLabel: true, changes: true, periodStart: true, periodEnd: true, recurring: true, createdAt: true, updatedAt: true, doneAt: true, listing: { select: { title: true } } },
    orderBy: opts.done ? [{ doneAt: "desc" }, { id: "asc" }] : [{ listing: { title: "asc" } }, { updatedAt: "desc" }, { source: "asc" }, { id: "asc" }],
    take: opts.take ?? 200,
  });
  return rows.map((r) => ({
    id: r.id,
    listingId: r.listingId,
    listingTitle: r.listing.title,
    source: r.source as PlatformSource,
    subjectKey: r.subjectKey,
    subjectLabel: r.subjectLabel,
    changes: changedLines(parseLines(r.changes)),
    periodStart: r.periodStart ? isoDay(r.periodStart) : null,
    periodEnd: r.periodEnd ? isoDay(r.periodEnd) : null,
    recurring: r.recurring,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    doneAt: r.doneAt,
  }));
}

export async function openPriceReminderCount(organizationId: string): Promise<number> {
  return db.priceReminder.count({ where: { organizationId, doneAt: null } });
}

/** « Fait » : the change was reported on that platform. */
export async function markPriceReminderDone(actor: Authorized, id: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const r = await tx.priceReminder.findFirst({ where: { id, organizationId: actor.organizationId }, select: { id: true, doneAt: true, listingId: true, source: true, subjectKey: true } });
    if (!r) throw new AppError(404, "NOT_FOUND", "Rappel introuvable.");
    if (r.doneAt) throw new AppError(409, "ALREADY_DONE", "Ce rappel est déjà marqué comme fait.");
    await tx.priceReminder.update({ where: { id: r.id }, data: { doneAt: new Date(), doneById: actor.user.id } });
    await recordAudit(tx, { organizationId: actor.organizationId, actorId: actor.user.id, action: "price_reminder.done", targetType: "price_reminder", targetId: r.id, details: { listingId: r.listingId, source: r.source, subject: r.subjectKey } });
  });
}

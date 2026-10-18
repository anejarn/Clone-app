import "server-only";
import { isPlatformSource } from "@/lib/admin/booking-sources";
import { adapterFor } from "@/lib/channels";
import { busyRanges, type BusyRange } from "@/lib/channels/busy";
import { EXPORT_TOKEN_RE, hashExportToken } from "@/lib/channels/token";
import { todayInTimeZone } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { BookingSource } from "@/lib/generated/prisma/enums";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { db } from "../db";
import { touchExportRead } from "./feeds";

/**
 * Sigma's calendar for one home and one platform (/ical/<token>.ics, Lot 7): every busy night of the home except that
 * platform's own reservations (lib/channels/busy.ts). No session: the token is the key (256 bits, looked up by its
 * hash; a revoked token answers 404 like an unknown one).
 */

/** The ranges Sigma exports for a listing to a platform. */
export async function exportedRanges(
  client: Prisma.TransactionClient,
  listing: { id: string; organizationId: string; preparationDays: number; minNoticeDays: number },
  platformSource: BookingSource,
  today: Date,
): Promise<BusyRange[]> {
  const [bookings, conflicts] = await Promise.all([
    client.booking.findMany({
      where: { listingId: listing.id, organizationId: listing.organizationId, status: "CONFIRMED", checkOut: { gte: today } },
      select: { id: true, source: true, checkIn: true, checkOut: true, createdAt: true },
    }),
    client.channelConflict.findMany({
      where: { listingId: listing.id, organizationId: listing.organizationId, status: "OPEN", checkOut: { gte: today } },
      select: { id: true, source: true, checkIn: true, checkOut: true, detectedAt: true },
    }),
  ]);
  return busyRanges({
    platform: platformSource,
    bookings,
    conflicts: conflicts.map((c) => ({ ...c, createdAt: c.detectedAt })),
    preparationDays: listing.preparationDays,
    minNoticeDays: listing.minNoticeDays,
    today,
    salt: listing.organizationId,
  });
}

export async function exportCalendarForToken(token: string, now = new Date()): Promise<{ body: string; contentType: string; source: string } | null> {
  if (!EXPORT_TOKEN_RE.test(token)) return null;
  const feed = await db.channelFeed.findUnique({
    where: { exportTokenHash: hashExportToken(token) },
    select: { id: true, source: true, exportRevokedAt: true, listing: { select: { id: true, organizationId: true, preparationDays: true, minNoticeDays: true, category: true, place: { select: { timezone: true } } } } },
  });
  if (!feed || feed.exportRevokedAt || feed.listing.category !== "HOME" || !isPlatformSource(feed.source)) return null;
  const today = todayInTimeZone(feed.listing.place.timezone || MARRAKECH_TIMEZONE, now.getTime());
  const ranges = await exportedRanges(db, feed.listing, feed.source, today);
  const out = adapterFor(feed.source).exportCalendar({ ranges, now });
  // The connection guide shows that the platform reads the link (lot 7b). Never fails the export.
  await touchExportRead(feed.id, now).catch((e) => console.error(`export read of feed ${feed.id} not recorded: ${(e as Error).message}`));
  return { ...out, source: feed.source };
}

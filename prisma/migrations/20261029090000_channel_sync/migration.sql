-- Lot 7a: calendar synchronisation with the platforms by iCal, without a paid channel manager (lib/channels/).
-- Adds: the « Autre plateforme » source (OTHER: any other site giving an iCal link; Vrbo is Expedia's), per-listing
-- preparation days and minimum notice, the origin feed of imported bookings and their « Not available » flag, the
-- feeds (export link + import URL, encrypted), the sync journal, the double-booking conflicts and the background
-- worker's jobs. Applies to databases holding bookings: every existing row keeps its values (no feed, not a block),
-- every listing gets 0 preparation day and 0 notice (today's behaviour). Nothing is rewritten or dropped.

-- CreateEnum
CREATE TYPE "ChannelSyncOutcome" AS ENUM ('SUCCESS', 'NOT_MODIFIED', 'ERROR');

-- CreateEnum
CREATE TYPE "ChannelSyncTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ChannelConflictStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ChannelConflictResolution" AS ENUM ('REPLACED', 'DISMISSED', 'EVENT_GONE', 'FREED');

-- AlterEnum
-- Not used by any statement below (a value added in a transaction can't be used before it commits).
ALTER TYPE "BookingSource" ADD VALUE 'OTHER' BEFORE 'OWNER';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "channelBlock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "channelFeedId" TEXT;

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "minNoticeDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "preparationDays" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "channel_feeds" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "source" "BookingSource" NOT NULL,
    "exportTokenHash" TEXT NOT NULL,
    "exportTokenEnc" TEXT NOT NULL,
    "exportRevokedAt" TIMESTAMP(3),
    "exportIssuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importUrlEnc" TEXT,
    "importHost" TEXT,
    "importUrlSetAt" TIMESTAMP(3),
    "importEnabled" BOOLEAN NOT NULL DEFAULT true,
    "etag" TEXT,
    "lastModified" TEXT,
    "nextSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastStatus" "ChannelSyncOutcome",
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "staleAlertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_sync_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "source" "BookingSource" NOT NULL,
    "trigger" "ChannelSyncTrigger" NOT NULL,
    "requestedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" "ChannelSyncOutcome",
    "httpStatus" INTEGER,
    "eventsSeen" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "cancelled" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "ignored" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "channel_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_conflicts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "source" "BookingSource" NOT NULL,
    "externalRef" TEXT NOT NULL,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "block" BOOLEAN NOT NULL DEFAULT false,
    "blockingBookingId" TEXT,
    "blockingSource" "BookingSource" NOT NULL,
    "blockingRef" TEXT,
    "blockingCheckIn" DATE NOT NULL,
    "blockingCheckOut" DATE NOT NULL,
    "ownBookingId" TEXT,
    "status" "ChannelConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "ChannelConflictResolution",
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "channel_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_jobs" (
    "name" TEXT NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastOk" BOOLEAN,
    "lastError" TEXT,
    "lastDetails" JSONB NOT NULL DEFAULT '{}',
    "runCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_feeds_exportTokenHash_key" ON "channel_feeds"("exportTokenHash");

-- CreateIndex
CREATE INDEX "channel_feeds_organizationId_idx" ON "channel_feeds"("organizationId");

-- CreateIndex
CREATE INDEX "channel_feeds_nextSyncAt_idx" ON "channel_feeds"("nextSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "channel_feeds_listingId_source_key" ON "channel_feeds"("listingId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "channel_feeds_id_listingId_organizationId_key" ON "channel_feeds"("id", "listingId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_feeds_id_organizationId_key" ON "channel_feeds"("id", "organizationId");

-- CreateIndex
CREATE INDEX "channel_sync_runs_organizationId_startedAt_idx" ON "channel_sync_runs"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "channel_sync_runs_feedId_startedAt_idx" ON "channel_sync_runs"("feedId", "startedAt");

-- CreateIndex
CREATE INDEX "channel_sync_runs_listingId_startedAt_idx" ON "channel_sync_runs"("listingId", "startedAt");

-- CreateIndex
CREATE INDEX "channel_conflicts_organizationId_status_idx" ON "channel_conflicts"("organizationId", "status");

-- CreateIndex
CREATE INDEX "channel_conflicts_listingId_status_idx" ON "channel_conflicts"("listingId", "status");

-- CreateIndex
CREATE INDEX "channel_conflicts_feedId_idx" ON "channel_conflicts"("feedId");

-- CreateIndex
CREATE INDEX "bookings_channelFeedId_idx" ON "bookings"("channelFeedId");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_channelFeedId_listingId_organizationId_fkey" FOREIGN KEY ("channelFeedId", "listingId", "organizationId") REFERENCES "channel_feeds"("id", "listingId", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "channel_feeds" ADD CONSTRAINT "channel_feeds_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_feeds" ADD CONSTRAINT "channel_feeds_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_sync_runs" ADD CONSTRAINT "channel_sync_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_sync_runs" ADD CONSTRAINT "channel_sync_runs_feedId_organizationId_fkey" FOREIGN KEY ("feedId", "organizationId") REFERENCES "channel_feeds"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_conflicts" ADD CONSTRAINT "channel_conflicts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_conflicts" ADD CONSTRAINT "channel_conflicts_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_conflicts" ADD CONSTRAINT "channel_conflicts_feedId_listingId_organizationId_fkey" FOREIGN KEY ("feedId", "listingId", "organizationId") REFERENCES "channel_feeds"("id", "listingId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_conflicts" ADD CONSTRAINT "channel_conflicts_blockingBookingId_fkey" FOREIGN KEY ("blockingBookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_conflicts" ADD CONSTRAINT "channel_conflicts_ownBookingId_fkey" FOREIGN KEY ("ownBookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity rules (hand-written; Prisma can't express them).
-- ---------------------------------------------------------------------------

-- A platform booking carries its code, DIRECT and OWNER never do. Rewritten from 20261019090000_booking_sources so
-- that every platform source (OTHER included) is covered without naming the new value in this transaction.
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_external_ref_check";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_external_ref_check" CHECK (
  CASE WHEN "source" IN ('DIRECT', 'OWNER')
    THEN "externalRef" IS NULL
    ELSE "externalRef" IS NOT NULL AND btrim("externalRef") <> ''
  END
);

-- Only platform bookings come from a feed or are an imported « Not available » block.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_channel_feed_check" CHECK (
  "source" NOT IN ('DIRECT', 'OWNER') OR ("channelFeedId" IS NULL AND "channelBlock" = false)
);

-- Preparation days 0–7, minimum notice 0–30 days.
ALTER TABLE "listings" ADD CONSTRAINT "listings_booking_rules_check"
  CHECK ("preparationDays" BETWEEN 0 AND 7 AND "minNoticeDays" BETWEEN 0 AND 30);

-- A feed is a platform's, its secrets are envelopes (lib/secrets/access-codes.ts), never clear text; the token is
-- looked up by its SHA-256.
ALTER TABLE "channel_feeds" ADD CONSTRAINT "channel_feeds_check" CHECK (
  "source" NOT IN ('DIRECT', 'OWNER')
  AND "exportTokenHash" ~ '^[0-9a-f]{64}$'
  AND "exportTokenEnc" ~ '^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
  AND ("importUrlEnc" IS NULL OR "importUrlEnc" ~ '^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$')
  AND (("importUrlEnc" IS NULL) = ("importHost" IS NULL))
  AND ("importHost" IS NULL OR char_length("importHost") <= 253)
  AND "consecutiveFailures" >= 0
  AND ("lastError" IS NULL OR char_length("lastError") <= 500)
);

ALTER TABLE "channel_sync_runs" ADD CONSTRAINT "channel_sync_runs_check" CHECK (
  "eventsSeen" >= 0 AND "created" >= 0 AND "updated" >= 0 AND "cancelled" >= 0 AND "conflicts" >= 0 AND "ignored" >= 0
  AND ("finishedAt" IS NULL OR "finishedAt" >= "startedAt")
  AND (("finishedAt" IS NULL) = ("outcome" IS NULL))
  AND ("httpStatus" IS NULL OR "httpStatus" BETWEEN 100 AND 599)
  AND ("errorMessage" IS NULL OR char_length("errorMessage") <= 500)
);

-- Nights in order, a reference, a resolution exactly when resolved.
ALTER TABLE "channel_conflicts" ADD CONSTRAINT "channel_conflicts_check" CHECK (
  "checkOut" > "checkIn" AND "blockingCheckOut" > "blockingCheckIn"
  AND btrim("externalRef") <> ''
  AND "source" NOT IN ('DIRECT', 'OWNER')
  AND (("status" = 'OPEN') = ("resolution" IS NULL))
  AND (("status" = 'OPEN') = ("resolvedAt" IS NULL))
);

-- At most one open conflict per feed and event.
CREATE UNIQUE INDEX "channel_conflicts_open_key" ON "channel_conflicts" ("feedId", "externalRef") WHERE "status" = 'OPEN';

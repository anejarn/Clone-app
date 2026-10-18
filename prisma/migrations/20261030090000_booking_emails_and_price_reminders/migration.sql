-- Lot 7b: the platforms' booking e-mails (receiving webhook per organization, parsed messages, manual queue), price
-- reminders to report by hand on each platform, the step-by-step connection guide's ticks and the platform's names of
-- a home. Applies to databases holding bookings: existing rows keep their values (no e-mail code, no platform
-- amount, conflicts found by iCal, no mapping, empty checklist). Nothing is rewritten or dropped.

-- CreateEnum
CREATE TYPE "ChannelConflictOrigin" AS ENUM ('ICAL', 'EMAIL');

-- CreateEnum
CREATE TYPE "PlatformAmountKind" AS ENUM ('PAYOUT', 'GUEST_TOTAL');

-- CreateEnum
CREATE TYPE "InboundEmailStatus" AS ENUM ('PROCESSED', 'PENDING', 'IGNORED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "InboundEmailKind" AS ENUM ('CONFIRMATION', 'MODIFICATION', 'CANCELLATION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InboundEmailVia" AS ENUM ('WEBHOOK', 'MANUAL');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "channelEventRef" TEXT,
ADD COLUMN     "platformAmountCents" INTEGER,
ADD COLUMN     "platformAmountKind" "PlatformAmountKind",
ADD COLUMN     "platformCurrency" TEXT;

-- AlterTable
ALTER TABLE "channel_conflicts" ADD COLUMN     "origin" "ChannelConflictOrigin" NOT NULL DEFAULT 'ICAL';

-- AlterTable
ALTER TABLE "channel_feeds" ADD COLUMN     "exportLastReadAt" TIMESTAMP(3),
ADD COLUMN     "platformListingId" TEXT,
ADD COLUMN     "platformListingName" TEXT,
ADD COLUMN     "setupChecklist" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "inboundEmailTokenEnc" TEXT,
ADD COLUMN     "inboundEmailTokenHash" TEXT,
ADD COLUMN     "inboundEmailTokenIssuedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "inbound_emails" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "via" "InboundEmailVia" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageIdHash" TEXT NOT NULL,
    "rawSha256" TEXT NOT NULL,
    "contentKey" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "senderDomain" TEXT,
    "source" "BookingSource",
    "kind" "InboundEmailKind" NOT NULL DEFAULT 'UNKNOWN',
    "externalRef" TEXT,
    "checkIn" DATE,
    "checkOut" DATE,
    "listingId" TEXT,
    "bookingId" TEXT,
    "conflictId" TEXT,
    "status" "InboundEmailStatus" NOT NULL,
    "reason" TEXT,
    "outcome" TEXT,
    "detailsEnc" TEXT,
    "rawEnc" BYTEA,
    "purgedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "inbound_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_reminders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "source" "BookingSource" NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "subjectLabel" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,

    CONSTRAINT "price_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inbound_emails_organizationId_status_receivedAt_idx" ON "inbound_emails"("organizationId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "inbound_emails_organizationId_contentKey_idx" ON "inbound_emails"("organizationId", "contentKey");

-- CreateIndex
CREATE INDEX "inbound_emails_receivedAt_idx" ON "inbound_emails"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_emails_organizationId_messageIdHash_key" ON "inbound_emails"("organizationId", "messageIdHash");

-- CreateIndex
CREATE INDEX "price_reminders_organizationId_doneAt_idx" ON "price_reminders"("organizationId", "doneAt");

-- CreateIndex
CREATE INDEX "price_reminders_listingId_idx" ON "price_reminders"("listingId");

-- CreateIndex
CREATE INDEX "price_reminders_feedId_idx" ON "price_reminders"("feedId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_inboundEmailTokenHash_key" ON "organizations"("inboundEmailTokenHash");

-- AddForeignKey
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_reminders" ADD CONSTRAINT "price_reminders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_reminders" ADD CONSTRAINT "price_reminders_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_reminders" ADD CONSTRAINT "price_reminders_feedId_listingId_organizationId_fkey" FOREIGN KEY ("feedId", "listingId", "organizationId") REFERENCES "channel_feeds"("id", "listingId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Integrity rules (hand-written; Prisma can't express them).
-- ---------------------------------------------------------------------------

-- The receiving webhook's secret: looked up by SHA-256, kept as an envelope (lib/secrets/access-codes.ts), both or none.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_inbound_email_token_check" CHECK (
  ("inboundEmailTokenHash" IS NULL) = ("inboundEmailTokenEnc" IS NULL)
  AND ("inboundEmailTokenHash" IS NULL) = ("inboundEmailTokenIssuedAt" IS NULL)
  AND ("inboundEmailTokenHash" IS NULL OR "inboundEmailTokenHash" ~ '^[0-9a-f]{64}$')
  AND ("inboundEmailTokenEnc" IS NULL OR "inboundEmailTokenEnc" ~ '^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$')
);

-- A platform's amount from its e-mail: all three or none, positive, an ISO 4217 code, platform bookings only. The
-- feed's own reference is a platform booking's only.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_platform_amount_check" CHECK (
  (("platformAmountCents" IS NULL) = ("platformCurrency" IS NULL) AND ("platformAmountCents" IS NULL) = ("platformAmountKind" IS NULL))
  AND ("platformAmountCents" IS NULL OR ("platformAmountCents" > 0 AND "platformCurrency" ~ '^[A-Z]{3}$' AND "source" NOT IN ('DIRECT', 'OWNER')))
  AND ("channelEventRef" IS NULL OR ("source" NOT IN ('DIRECT', 'OWNER') AND btrim("channelEventRef") <> '' AND char_length("channelEventRef") <= 512))
);

-- The platform's names of a home are short; the guide's ticks are an object.
ALTER TABLE "channel_feeds" ADD CONSTRAINT "channel_feeds_mapping_check" CHECK (
  ("platformListingId" IS NULL OR (btrim("platformListingId") <> '' AND char_length("platformListingId") <= 200))
  AND ("platformListingName" IS NULL OR (btrim("platformListingName") <> '' AND char_length("platformListingName") <= 200))
  AND jsonb_typeof("setupChecklist") = 'object'
);

-- A booking e-mail: hashes, never clear content (envelopes only), a platform source, nights in order, bounded texts,
-- a resolution only once handled, an encrypted raw message in the binary envelope format (lib/secrets/envelope.ts).
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_check" CHECK (
  "messageIdHash" ~ '^[0-9a-f]{64}$'
  AND "rawSha256" ~ '^[0-9a-f]{64}$'
  AND ("contentKey" IS NULL OR "contentKey" ~ '^[0-9a-f]{64}$')
  AND "sizeBytes" BETWEEN 0 AND 5242880
  AND ("senderDomain" IS NULL OR char_length("senderDomain") <= 253)
  AND ("source" IS NULL OR "source" NOT IN ('DIRECT', 'OWNER'))
  AND ("externalRef" IS NULL OR (btrim("externalRef") <> '' AND char_length("externalRef") <= 64))
  AND ("checkIn" IS NULL OR "checkOut" IS NULL OR "checkOut" > "checkIn")
  AND ("reason" IS NULL OR char_length("reason") <= 64)
  AND ("outcome" IS NULL OR char_length("outcome") <= 64)
  AND ("detailsEnc" IS NULL OR "detailsEnc" ~ '^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$')
  AND ("rawEnc" IS NULL OR (octet_length("rawEnc") > 36 AND substring("rawEnc" from 1 for 4) = '\x53474531'::bytea))
  AND ("status" <> 'PENDING' OR "resolvedAt" IS NULL)
);

-- A reminder: a platform, a subject, a list of changes, a period in order, done exactly when doneAt.
ALTER TABLE "price_reminders" ADD CONSTRAINT "price_reminders_check" CHECK (
  "source" NOT IN ('DIRECT', 'OWNER')
  AND "subjectKey" ~ '^(rule|listing):[A-Za-z0-9_-]{1,64}$'
  AND btrim("subjectLabel") <> '' AND char_length("subjectLabel") <= 120
  AND jsonb_typeof("changes") = 'array'
  AND ("periodStart" IS NULL) = ("periodEnd" IS NULL)
  AND ("periodStart" IS NULL OR "periodEnd" >= "periodStart")
  AND ("doneById" IS NULL OR "doneAt" IS NOT NULL)
);

-- At most one open reminder per feed and subject.
CREATE UNIQUE INDEX "price_reminders_open_key" ON "price_reminders" ("feedId", "subjectKey") WHERE "doneAt" IS NULL;

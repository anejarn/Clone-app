-- Ski pivot: two Alpine resorts, "meublé de tourisme" listing data, owner-paid commission, taxe de séjour,
-- owner leads. Generated with `prisma migrate diff`, then edited so it applies to databases that already hold
-- rows: new NOT NULL columns get a temporary default for existing rows, which is dropped right after
-- (`pnpm db:seed` then replaces the demo catalogue). Hand-written integrity rules are at the end.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isFoundingHost" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "places" ADD COLUMN     "altitudeM" INTEGER,
ADD COLUMN     "inseeCode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "places" ALTER COLUMN "inseeCode" DROP DEFAULT;

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "dpeClass" TEXT,
ADD COLUMN     "liftDistanceM" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "minNights" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "registrationNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "stars" INTEGER;
ALTER TABLE "listings" ALTER COLUMN "liftDistanceM" DROP DEFAULT,
ALTER COLUMN "registrationNumber" DROP DEFAULT;

-- AlterTable: the guest service fee is gone; commission, its VAT and the tourist tax are snapshotted instead.
ALTER TABLE "bookings" ADD COLUMN     "commissionBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "commissionCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "commissionVatCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hostPayoutCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "touristTaxCents" INTEGER NOT NULL DEFAULT 0;
-- Existing stays were priced under the old model (no commission, no tourist tax): the host keeps the whole base.
UPDATE "bookings"
SET "hostPayoutCents" = "nightlyCents" * ("checkOut" - "checkIn") + "cleaningFeeCents";
ALTER TABLE "bookings" ALTER COLUMN "commissionBps" DROP DEFAULT,
ALTER COLUMN "commissionCents" DROP DEFAULT,
ALTER COLUMN "commissionVatCents" DROP DEFAULT,
ALTER COLUMN "hostPayoutCents" DROP DEFAULT,
ALTER COLUMN "touristTaxCents" DROP DEFAULT;
ALTER TABLE "bookings" DROP COLUMN "serviceFeeCents";

-- CreateTable
CREATE TABLE "host_leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "placeSlug" TEXT NOT NULL,
    "propertyType" TEXT NOT NULL,
    "beds" INTEGER NOT NULL,
    "openWinterWeeks" INTEGER NOT NULL,
    "registrationNumber" TEXT,
    "message" TEXT,
    "consent" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "host_leads_createdAt_idx" ON "host_leads"("createdAt");

-- ---------------------------------------------------------------------------
-- Integrity rules Prisma's schema language can't express (hand-written).
-- bookings_no_overlap and the checks from the init migration are unchanged.
-- Rules that rows written before this migration can't meet are NOT VALID: enforced on every insert and
-- update from now on, not checked against old rows.
-- ---------------------------------------------------------------------------
ALTER TABLE "listings" ADD CONSTRAINT "listings_ski_check" CHECK (
  ("stars" IS NULL OR "stars" BETWEEN 1 AND 5)
  AND "liftDistanceM" >= 0
  AND "minNights" >= 1
  AND "cleaningFeeCents" >= 0
  AND ("dpeClass" IS NULL OR "dpeClass" IN ('A', 'B', 'C', 'D', 'E', 'F', 'G'))
);
-- Commune INSEE code (5 digits) + 6 digits + 2 uppercase letters, as lib/registration.ts checks.
ALTER TABLE "listings" ADD CONSTRAINT "listings_registration_check"
  CHECK ("registrationNumber" ~ '^[0-9]{5}[0-9]{6}[A-Z]{2}$') NOT VALID;
ALTER TABLE "places" ADD CONSTRAINT "places_insee_check" CHECK ("inseeCode" ~ '^[0-9]{5}$') NOT VALID;

-- Host side of the snapshot: payout + commission + VAT is exactly the base (nightly × nights + cleaning).
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_split_check" CHECK (
  "commissionBps" BETWEEN 0 AND 10000
  AND "commissionCents" >= 0
  AND "commissionVatCents" >= 0
  AND "touristTaxCents" >= 0
  AND "hostPayoutCents" + "commissionCents" + "commissionVatCents"
      = "nightlyCents" * ("checkOut" - "checkIn") + "cleaningFeeCents"
);
-- Guest side: the total is the base plus the tourist tax. Older rows included the removed service fee.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_total_check"
  CHECK ("totalCents" = "nightlyCents" * ("checkOut" - "checkIn") + "cleaningFeeCents" + "touristTaxCents") NOT VALID;

ALTER TABLE "host_leads" ADD CONSTRAINT "host_leads_values_check" CHECK (
  "consent" = true
  AND "beds" >= 1
  AND "openWinterWeeks" >= 1
  AND ("registrationNumber" IS NULL OR "registrationNumber" ~ '^[0-9]{5}[0-9]{6}[A-Z]{2}$')
);

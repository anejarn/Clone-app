-- Lot 1 (third part): where a booking comes from. Applies to databases that already hold bookings: every existing
-- row becomes a DIRECT booking and keeps its guest account and its amounts (nothing is rewritten or dropped).
-- Platform bookings (Airbnb, Booking.com, Agoda, Trip.com, Expedia) may have no guest account and, until their
-- amount is known (iCal carries none), no amounts; owner blocks (OWNER) never have either.

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('DIRECT', 'AIRBNB', 'BOOKING', 'AGODA', 'TRIPCOM', 'EXPEDIA', 'OWNER');

-- AlterTable: the default makes every existing row DIRECT; guestId and the amounts become optional.
ALTER TABLE "bookings" ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "guestEmail" TEXT,
ADD COLUMN     "guestName" TEXT,
ADD COLUMN     "guestPhone" TEXT,
ADD COLUMN     "source" "BookingSource" NOT NULL DEFAULT 'DIRECT',
ALTER COLUMN "guestId" DROP NOT NULL,
ALTER COLUMN "nightlyCents" DROP NOT NULL,
ALTER COLUMN "cleaningFeeCents" DROP NOT NULL,
ALTER COLUMN "totalCents" DROP NOT NULL,
ALTER COLUMN "serviceFeeCents" DROP NOT NULL;

-- CreateIndex: a platform code is unique per source within an organization, not across organizations. Two
-- managers (V3) may import the same platform feed (an owner switching concierge, or a mistaken link): a global
-- index would let one organization's import fail on, and so reveal the existence of, another's booking. Within an
-- organization, the same code twice is always a duplicate import. NULLs (DIRECT, OWNER) never collide.
CREATE UNIQUE INDEX "bookings_organizationId_source_externalRef_key" ON "bookings"("organizationId", "source", "externalRef");

-- ---------------------------------------------------------------------------
-- Integrity rules by source (hand-written; Prisma can't express them).
-- ---------------------------------------------------------------------------

-- Replaces the init checks: an owner block has no amounts and no guests.
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_amounts_check",
DROP CONSTRAINT "bookings_guests_check";

-- Guest counts: at least one adult, except owner blocks (bookings_owner_block_check sets them all to 0).
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guests_check"
  CHECK ("children" >= 0 AND "infants" >= 0 AND "pets" >= 0 AND ("adults" >= 1 OR "source" = 'OWNER'));

-- Amounts are all known (total > 0) or all unknown; DIRECT always knows them, an owner block never has any.
-- Every NULL is tested explicitly: a comparison with NULL is unknown, and a CHECK lets unknown through.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_amounts_check" CHECK (
  (
    "nightlyCents" IS NULL AND "cleaningFeeCents" IS NULL AND "serviceFeeCents" IS NULL AND "totalCents" IS NULL
    AND "source" <> 'DIRECT'
  ) OR (
    "nightlyCents" IS NOT NULL AND "cleaningFeeCents" IS NOT NULL AND "serviceFeeCents" IS NOT NULL AND "totalCents" IS NOT NULL
    AND "nightlyCents" >= 0 AND "cleaningFeeCents" >= 0 AND "serviceFeeCents" >= 0 AND "totalCents" > 0
    AND "source" <> 'OWNER'
  )
);

-- An owner block: dates only. No guest (account or contact), no platform code, no amounts, no guest counts.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_owner_block_check" CHECK (
  "source" <> 'OWNER' OR (
    "guestId" IS NULL AND "guestName" IS NULL AND "guestEmail" IS NULL AND "guestPhone" IS NULL
    AND "externalRef" IS NULL
    AND "nightlyCents" IS NULL AND "cleaningFeeCents" IS NULL AND "serviceFeeCents" IS NULL AND "totalCents" IS NULL
    AND "adults" = 0 AND "children" = 0 AND "infants" = 0 AND "pets" = 0
  )
);

-- A platform booking always carries the platform's code (non-blank); DIRECT and OWNER rows never do.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_external_ref_check" CHECK (
  CASE WHEN "source" IN ('AIRBNB', 'BOOKING', 'AGODA', 'TRIPCOM', 'EXPEDIA')
    THEN "externalRef" IS NOT NULL AND btrim("externalRef") <> ''
    ELSE "externalRef" IS NULL
  END
);

-- A direct booking has a guest: an account, or at least a name (booked by phone or WhatsApp).
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_direct_guest_check"
  CHECK ("source" <> 'DIRECT' OR "guestId" IS NOT NULL OR btrim(coalesce("guestName", '')) <> '');

-- bookings_no_overlap (init migration) is unchanged on purpose: it excludes overlapping CONFIRMED rows of a listing
-- whatever their source, so owner blocks and platform bookings already block the dates like direct stays.

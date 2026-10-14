-- Back to the airbnb.fr replica: undoes 20261013170315_ski_pivot (two ski resorts, owner commission, taxe de
-- séjour, owner leads). It is a new migration rather than a deleted one because databases have already applied
-- ski_pivot; `pnpm db:seed` then reloads the replica catalogue.

-- Hand-written checks from ski_pivot. Dropping their columns would remove most of them anyway; say it explicitly.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_split_check",
DROP CONSTRAINT IF EXISTS "bookings_total_check";
ALTER TABLE "listings" DROP CONSTRAINT IF EXISTS "listings_ski_check",
DROP CONSTRAINT IF EXISTS "listings_registration_check";
ALTER TABLE "places" DROP CONSTRAINT IF EXISTS "places_insee_check";

-- AlterTable: the guest service fee comes back. Stays booked under the ski model had none, so existing rows get 0
-- and keep their stored total.
ALTER TABLE "bookings" ADD COLUMN     "serviceFeeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "bookings" ALTER COLUMN "serviceFeeCents" DROP DEFAULT;
ALTER TABLE "bookings" DROP COLUMN "commissionBps",
DROP COLUMN "commissionCents",
DROP COLUMN "commissionVatCents",
DROP COLUMN "hostPayoutCents",
DROP COLUMN "touristTaxCents";

-- AlterTable
ALTER TABLE "listings" DROP COLUMN "dpeClass",
DROP COLUMN "liftDistanceM",
DROP COLUMN "minNights",
DROP COLUMN "registrationNumber",
DROP COLUMN "stars";

-- AlterTable
ALTER TABLE "places" DROP COLUMN "altitudeM",
DROP COLUMN "inseeCode";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "isFoundingHost";

-- DropTable (its check constraint goes with it)
DROP TABLE "host_leads";

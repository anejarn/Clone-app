-- Lot 2b: listing management in the back-office. Listings get a publication status (existing rows stay
-- PUBLISHED, so the public catalogue is unchanged), a city, house rules and an update time; uploaded photos record
-- their storage key (lib/storage) so they can be deleted. Non-destructive: only new columns, defaults and checks.

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "city" TEXT NOT NULL DEFAULT 'Marrakech',
ADD COLUMN     "houseRules" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "status" "ListingStatus" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "photos" ADD COLUMN     "storageKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "photos_storageKey_key" ON "photos"("storageKey");

-- A sub-let (sous-location) earns Sigma the rent margin, not a commission: its commission is 0. Sub-lets created
-- before this rule carried the organization's default, which meant nothing for them.
UPDATE "listings" SET "commissionBps" = 0 WHERE "managementType" = 'SUBLEASE' AND "commissionBps" <> 0;
ALTER TABLE "listings" ADD CONSTRAINT "listings_sublease_commission_check" CHECK ("managementType" <> 'SUBLEASE' OR "commissionBps" = 0);

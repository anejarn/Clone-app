-- Lot 1 (second part): listings belong to an owner (propriétaire) and carry Sigma's management terms.
-- Applies to databases that already hold listings: hostId is renamed ownerId (no row loses its owner), every
-- former host becomes an OWNER of the listing's organization, and the new columns are backfilled.

-- Refuse, before changing anything, data this migration can't convert safely: a host who is a team member
-- (ADMIN, AGENT) would have to be demoted, and a host with listings in two organizations can't belong to both.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "listings" l JOIN "users" u ON u."id" = l."hostId"
    WHERE u."role" NOT IN ('GUEST', 'OWNER') OR (u."organizationId" IS NOT NULL AND u."organizationId" <> l."organizationId")
  ) OR EXISTS (
    SELECT 1 FROM "listings" GROUP BY "hostId" HAVING COUNT(DISTINCT "organizationId") > 1
  ) THEN
    RAISE EXCEPTION 'listing_owners: some hosts are team members or span organizations; reassign those listings first';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "ManagementType" AS ENUM ('MANAGED', 'SUBLEASE');

-- AlterEnum
ALTER TYPE "PropertyType" ADD VALUE 'RIAD';

-- Former hosts become owners in their listings' organization.
UPDATE "users" u SET "role" = 'OWNER', "organizationId" = l."organizationId"
FROM (SELECT DISTINCT "hostId", "organizationId" FROM "listings") l
WHERE u."id" = l."hostId";

-- Rename instead of drop + add: the owner of every existing listing is kept.
ALTER TABLE "listings" DROP CONSTRAINT "listings_hostId_fkey";
ALTER TABLE "listings" RENAME COLUMN "hostId" TO "ownerId";

-- AlterTable: new columns, backfilled, then required where the schema says so.
ALTER TABLE "listings"
ADD COLUMN     "address" TEXT,
ADD COLUMN     "commissionBps" INTEGER NOT NULL DEFAULT 2000,
ADD COLUMN     "licenseExpiresAt" DATE,
ADD COLUMN     "licenseNumber" TEXT,
ADD COLUMN     "managementType" "ManagementType" NOT NULL DEFAULT 'MANAGED',
ADD COLUMN     "minNights" INTEGER NOT NULL DEFAULT 1;

UPDATE "listings" l SET "address" = p."name" || ', Marrakech' FROM "places" p WHERE p."id" = l."placeId";
UPDATE "listings" l SET "commissionBps" = o."defaultCommissionBps" FROM "organizations" o WHERE o."id" = l."organizationId";
ALTER TABLE "listings" ALTER COLUMN "address" SET NOT NULL;

-- CreateIndex
CREATE INDEX "listings_ownerId_idx" ON "listings"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_organizationId_key" ON "users"("id", "organizationId");

-- AddForeignKey: through (ownerId, organizationId), an owner is always a member of the listing's organization.
-- RESTRICT on update too: moving an owner to another organization must not drag their listings along.
ALTER TABLE "listings" ADD CONSTRAINT "listings_ownerId_organizationId_fkey" FOREIGN KEY ("ownerId", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Hand-written checks (Prisma can't express them).
ALTER TABLE "listings" ADD CONSTRAINT "listings_commission_bps_check" CHECK ("commissionBps" BETWEEN 0 AND 10000);
ALTER TABLE "listings" ADD CONSTRAINT "listings_min_nights_check" CHECK ("minNights" >= 1);

-- The owner of a listing has the OWNER role, checked on write (a CHECK can't look at another table).
-- FOR SHARE keeps the owner's role from changing until the listing is written.
CREATE FUNCTION "listings_owner_role_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "users" WHERE "id" = NEW."ownerId" AND "role" = 'OWNER' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listings_owner_role_check: the owner of a listing must have the OWNER role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "listings_owner_role_check" BEFORE INSERT OR UPDATE OF "ownerId" ON "listings"
FOR EACH ROW EXECUTE FUNCTION "listings_owner_role_check"();

-- And keeps it: an owner of listings can't be given another role until the listings are reassigned.
CREATE FUNCTION "users_owner_role_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."role" = 'OWNER' AND NEW."role" <> 'OWNER' AND EXISTS (SELECT 1 FROM "listings" WHERE "ownerId" = OLD."id") THEN
    RAISE EXCEPTION 'listings_owner_role_check: this user owns listings and must keep the OWNER role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "users_owner_role_check" BEFORE UPDATE OF "role" ON "users"
FOR EACH ROW EXECUTE FUNCTION "users_owner_role_check"();

-- Lot 1 (first part): organizations and roles. Applies to databases that already hold listings and bookings:
-- the Sigma organization is created first, existing rows are attached to it, then the columns become required.

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'AGENT', 'OWNER', 'GUEST');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "defaultCommissionBps" INTEGER NOT NULL DEFAULT 2000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- The first organization. Same id as prisma/seed.ts, which upserts it by slug.
INSERT INTO "organizations" ("id", "name", "slug") VALUES ('org_sigma', 'Sigma', 'sigma');

-- AlterTable: everyone existing is a guest; the seed (or an ADMIN) gives staff their role and organization.
ALTER TABLE "users" DROP COLUMN "isProfessional",
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'GUEST';

-- AlterTable: backfill, then required.
ALTER TABLE "listings" ADD COLUMN     "organizationId" TEXT;
UPDATE "listings" SET "organizationId" = 'org_sigma';
ALTER TABLE "listings" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable: a booking takes its listing's organization.
ALTER TABLE "bookings" ADD COLUMN     "organizationId" TEXT;
UPDATE "bookings" b SET "organizationId" = l."organizationId" FROM "listings" l WHERE l."id" = b."listingId";
ALTER TABLE "bookings" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "bookings_organizationId_checkIn_idx" ON "bookings"("organizationId", "checkIn");

-- CreateIndex
CREATE INDEX "listings_organizationId_category_idx" ON "listings"("organizationId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "listings_id_organizationId_key" ON "listings"("id", "organizationId");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: replaces bookings_listingId_fkey. Through (listingId, organizationId), a booking can never sit in
-- another organization than its listing.
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_listingId_fkey";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written check (Prisma can't express it): team roles belong to an organization; only guests may have none.
ALTER TABLE "users" ADD CONSTRAINT "users_staff_organization_check" CHECK ("role" = 'GUEST' OR "organizationId" IS NOT NULL);

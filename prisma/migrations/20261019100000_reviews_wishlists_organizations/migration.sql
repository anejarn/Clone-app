-- Lot 1 (multi-organisation, end): reviews, wishlists and wishlist items belong to an organization in the database
-- too, not only through the queries. Applies to databases that already hold them, without loss:
-- - a review takes its listing's organization;
-- - a wishlist takes the organization of its listings (an empty one, the first organization, "sigma");
--   a wishlist holding listings of several organizations is split into one list per organization, same name;
-- - an item takes its listing's organization and moves to its wishlist's copy in that organization.
-- Composite foreign keys then keep a review on its listing's organization, and an item's wishlist and listing in
-- the same organization.

-- Reviews.
ALTER TABLE "reviews" ADD COLUMN     "organizationId" TEXT;
UPDATE "reviews" r SET "organizationId" = l."organizationId" FROM "listings" l WHERE l."id" = r."listingId";
ALTER TABLE "reviews" ALTER COLUMN "organizationId" SET NOT NULL;

-- Wishlists: one list name per user and organization (replaces the per-user unique name).
DROP INDEX "wishlists_userId_name_key";
ALTER TABLE "wishlists" ADD COLUMN     "organizationId" TEXT;
UPDATE "wishlists" w SET "organizationId" = (
  SELECT l."organizationId" FROM "wishlist_items" i JOIN "listings" l ON l."id" = i."listingId"
  WHERE i."wishlistId" = w."id" ORDER BY i."createdAt", i."listingId" LIMIT 1
);
UPDATE "wishlists" SET "organizationId" = coalesce(
  (SELECT "id" FROM "organizations" WHERE "slug" = 'sigma'),
  (SELECT "id" FROM "organizations" ORDER BY "createdAt", "id" LIMIT 1)
) WHERE "organizationId" IS NULL;

-- Split lists that span organizations: deterministic ids, so the items below find their new list.
INSERT INTO "wishlists" ("id", "organizationId", "userId", "name", "createdAt")
SELECT DISTINCT 'wl_' || md5(w."id" || ':' || l."organizationId"), l."organizationId", w."userId", w."name", w."createdAt"
FROM "wishlist_items" i
JOIN "wishlists" w ON w."id" = i."wishlistId"
JOIN "listings" l ON l."id" = i."listingId"
WHERE l."organizationId" <> w."organizationId";
ALTER TABLE "wishlists" ALTER COLUMN "organizationId" SET NOT NULL;

-- Wishlist items.
ALTER TABLE "wishlist_items" ADD COLUMN     "organizationId" TEXT;
UPDATE "wishlist_items" i SET "organizationId" = l."organizationId" FROM "listings" l WHERE l."id" = i."listingId";
UPDATE "wishlist_items" i SET "wishlistId" = 'wl_' || md5(i."wishlistId" || ':' || i."organizationId")
FROM "wishlists" w WHERE w."id" = i."wishlistId" AND w."organizationId" <> i."organizationId";
ALTER TABLE "wishlist_items" ALTER COLUMN "organizationId" SET NOT NULL;

-- DropForeignKey: replaced by the composite keys below.
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_listingId_fkey";
ALTER TABLE "wishlist_items" DROP CONSTRAINT "wishlist_items_listingId_fkey";
ALTER TABLE "wishlist_items" DROP CONSTRAINT "wishlist_items_wishlistId_fkey";

-- CreateIndex
CREATE INDEX "reviews_organizationId_listingId_idx" ON "reviews"("organizationId", "listingId");

-- CreateIndex
CREATE INDEX "wishlist_items_organizationId_listingId_idx" ON "wishlist_items"("organizationId", "listingId");

-- CreateIndex
CREATE INDEX "wishlists_userId_idx" ON "wishlists"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wishlists_organizationId_userId_name_key" ON "wishlists"("organizationId", "userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "wishlists_id_organizationId_key" ON "wishlists"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: through (listingId, organizationId), a review is always in its listing's organization.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: an item's wishlist and listing are both in the item's organization.
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_wishlistId_organizationId_fkey" FOREIGN KEY ("wishlistId", "organizationId") REFERENCES "wishlists"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

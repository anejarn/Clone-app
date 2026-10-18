-- Lot 4a: the welcome guide of each home (listing_guides: texts in several languages, Wi-Fi, maps link), its access
-- codes (guide_access_codes, encrypted), photos (guide_photos) and recommendations (guide_recommendations, of a home or
-- of the organization), the secret link of each stay's guide (guide_links: the token's SHA-256 and the token
-- encrypted), the guest's language on bookings and the conciergerie's contact on organizations.
-- Secrets are AES-256-GCM envelopes made by the app (lib/secrets/access-codes.ts): "v1.<key id>.<iv>.<tag>.<data>",
-- base64url; the checks below refuse anything else, so a plain code or password can't be stored by mistake.


-- CreateEnum
CREATE TYPE "GuideAccessCodeKind" AS ENUM ('DOOR', 'KEYBOX', 'ALARM', 'GATE', 'PARKING', 'OTHER');

-- CreateEnum
CREATE TYPE "GuideRecommendationCategory" AS ENUM ('RESTAURANT', 'CAFE', 'HAMMAM', 'SOUK', 'CULTURE', 'NATURE', 'SHOPPING', 'OTHER');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "guestLocale" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "conciergePhone" TEXT,
ADD COLUMN     "conciergeWhatsapp" TEXT;

-- CreateTable
CREATE TABLE "listing_guides" (
    "listingId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mapsUrl" TEXT,
    "directions" JSONB NOT NULL DEFAULT '{}',
    "accessInstructions" JSONB NOT NULL DEFAULT '{}',
    "houseRulesTranslations" JSONB NOT NULL DEFAULT '{}',
    "wifiName" TEXT,
    "wifiPasswordEnc" TEXT,
    "useOrgRecommendations" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_guides_pkey" PRIMARY KEY ("listingId")
);

-- CreateTable
CREATE TABLE "guide_access_codes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "kind" "GuideAccessCodeKind" NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "valueEnc" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guide_access_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_photos" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_recommendations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT,
    "category" "GuideRecommendationCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "description" JSONB NOT NULL DEFAULT '{}',
    "url" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guide_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_links" (
    "bookingId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "guide_links_pkey" PRIMARY KEY ("bookingId")
);

-- CreateIndex
CREATE INDEX "listing_guides_organizationId_idx" ON "listing_guides"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "listing_guides_listingId_organizationId_key" ON "listing_guides"("listingId", "organizationId");

-- CreateIndex
CREATE INDEX "guide_access_codes_listingId_position_idx" ON "guide_access_codes"("listingId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "guide_photos_storageKey_key" ON "guide_photos"("storageKey");

-- CreateIndex
CREATE INDEX "guide_photos_listingId_position_idx" ON "guide_photos"("listingId", "position");

-- CreateIndex
CREATE INDEX "guide_recommendations_organizationId_listingId_position_idx" ON "guide_recommendations"("organizationId", "listingId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "guide_links_tokenHash_key" ON "guide_links"("tokenHash");

-- CreateIndex
CREATE INDEX "guide_links_organizationId_idx" ON "guide_links"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "guide_links_bookingId_organizationId_key" ON "guide_links"("bookingId", "organizationId");

-- AddForeignKey
ALTER TABLE "listing_guides" ADD CONSTRAINT "listing_guides_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_guides" ADD CONSTRAINT "listing_guides_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_access_codes" ADD CONSTRAINT "guide_access_codes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_access_codes" ADD CONSTRAINT "guide_access_codes_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_photos" ADD CONSTRAINT "guide_photos_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_photos" ADD CONSTRAINT "guide_photos_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_recommendations" ADD CONSTRAINT "guide_recommendations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_recommendations" ADD CONSTRAINT "guide_recommendations_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_links" ADD CONSTRAINT "guide_links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_links" ADD CONSTRAINT "guide_links_bookingId_organizationId_fkey" FOREIGN KEY ("bookingId", "organizationId") REFERENCES "bookings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Checks ----------

-- An envelope: version, key id (8 hex), 12-byte IV, 16-byte tag, data (never empty).
ALTER TABLE "listing_guides" ADD CONSTRAINT "listing_guides_secret_check"
  CHECK ("wifiPasswordEnc" IS NULL OR "wifiPasswordEnc" ~ '^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$');
ALTER TABLE "listing_guides" ADD CONSTRAINT "listing_guides_fields_check"
  CHECK (("mapsUrl" IS NULL OR ("mapsUrl" ~ '^https://' AND char_length("mapsUrl") <= 500))
    AND ("wifiName" IS NULL OR char_length("wifiName") BETWEEN 1 AND 100)
    AND jsonb_typeof("directions") = 'object' AND jsonb_typeof("accessInstructions") = 'object'
    AND jsonb_typeof("houseRulesTranslations") = 'object');

ALTER TABLE "guide_access_codes" ADD CONSTRAINT "guide_access_codes_value_check"
  CHECK ("valueEnc" ~ '^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$' AND char_length("label") <= 80);

ALTER TABLE "guide_photos" ADD CONSTRAINT "guide_photos_fields_check" CHECK (char_length("caption") <= 200);

ALTER TABLE "guide_recommendations" ADD CONSTRAINT "guide_recommendations_fields_check"
  CHECK (char_length("name") BETWEEN 1 AND 120 AND ("url" IS NULL OR ("url" ~ '^https?://' AND char_length("url") <= 500))
    AND jsonb_typeof("description") = 'object');

ALTER TABLE "guide_links" ADD CONSTRAINT "guide_links_token_check"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$' AND "tokenEnc" ~ '^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$');

-- A language code: "fr", "es", "en", later "zh-Hans"…
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_locale_check"
  CHECK ("guestLocale" IS NULL OR "guestLocale" ~ '^[a-z]{2}(-[A-Za-z]{2,4})?$');

-- ---------- Triggers ----------

-- A home's recommendation belongs to the home's organization.
CREATE FUNCTION "guide_recommendations_listing_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."listingId" IS NOT NULL THEN
    PERFORM 1 FROM "listings" WHERE "id" = NEW."listingId" AND "organizationId" = NEW."organizationId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'guide_recommendations_listing_check: the home is not of the recommendation''s organization' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "guide_recommendations_listing_check" BEFORE INSERT OR UPDATE OF "listingId", "organizationId" ON "guide_recommendations"
FOR EACH ROW EXECUTE FUNCTION "guide_recommendations_listing_check"();

-- Owner blocks have no guest, hence no guide.
CREATE FUNCTION "guide_links_booking_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "bookings" WHERE "id" = NEW."bookingId" AND "source" <> 'OWNER';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'guide_links_booking_check: an owner block has no welcome guide' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "guide_links_booking_check" BEFORE INSERT OR UPDATE OF "bookingId" ON "guide_links"
FOR EACH ROW EXECUTE FUNCTION "guide_links_booking_check"();

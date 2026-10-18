-- Lot 5: the travellers of each stay for the police declaration (travelers: every personal field in one encrypted
-- envelope; traveler_documents: scans encrypted before storage; identity_purges: the non-personal trace left by the
-- automatic deletion after the retention delay, organizations.identityRetentionDays), and the taxe de séjour (rate
-- versions of the organization, tourist_tax_rates, and of a home, listing_tourist_tax_rates; the snapshot of each
-- stay, booking_tourist_taxes).
-- Identity envelopes are made by the app (lib/secrets/identity.ts, IDENTITY_DOCS_KEY): "v1.<key id>.<iv>.<tag>.<data>",
-- base64url; the checks below refuse anything else, so a name or a document number can't be stored in clear.
-- The default retention (365 days) and the rates are NOT legal values: to be confirmed by Sigma (lawyer, commune).


-- CreateEnum
CREATE TYPE "TouristTaxBasis" AS ENUM ('TRAVELERS', 'BOOKING');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "identityRetentionDays" INTEGER NOT NULL DEFAULT 365;

-- CreateTable
CREATE TABLE "travelers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "identityEnc" TEXT NOT NULL,
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "guardianId" TEXT,
    "declaredAt" TIMESTAMP(3),
    "declaredById" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travelers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traveler_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "travelerId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traveler_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_purges" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "checkOut" DATE NOT NULL,
    "travelerCount" INTEGER NOT NULL,
    "minorCount" INTEGER NOT NULL,
    "declaredCount" INTEGER NOT NULL,
    "documentCount" INTEGER NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "purgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_purges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tourist_tax_rates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "rateCents" INTEGER NOT NULL,
    "minorsExemptUnder" INTEGER DEFAULT 18,
    "residentsExempt" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tourist_tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_tourist_tax_rates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "rateCents" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_tourist_tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_tourist_taxes" (
    "bookingId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "nights" INTEGER NOT NULL,
    "taxableGuestNights" INTEGER NOT NULL,
    "exemptGuestNights" INTEGER NOT NULL,
    "missingRateNights" INTEGER NOT NULL,
    "basis" "TouristTaxBasis" NOT NULL,
    "lines" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "computedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,

    CONSTRAINT "booking_tourist_taxes_pkey" PRIMARY KEY ("bookingId")
);

-- CreateIndex
CREATE INDEX "travelers_bookingId_idx" ON "travelers"("bookingId");

-- CreateIndex
CREATE INDEX "travelers_organizationId_declaredAt_idx" ON "travelers"("organizationId", "declaredAt");

-- CreateIndex
CREATE UNIQUE INDEX "travelers_id_organizationId_key" ON "travelers"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "traveler_documents_storageKey_key" ON "traveler_documents"("storageKey");

-- CreateIndex
CREATE INDEX "traveler_documents_travelerId_idx" ON "traveler_documents"("travelerId");

-- CreateIndex
CREATE INDEX "identity_purges_organizationId_purgedAt_idx" ON "identity_purges"("organizationId", "purgedAt");

-- CreateIndex
CREATE INDEX "identity_purges_bookingId_idx" ON "identity_purges"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "tourist_tax_rates_organizationId_effectiveFrom_key" ON "tourist_tax_rates"("organizationId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "listing_tourist_tax_rates_organizationId_idx" ON "listing_tourist_tax_rates"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "listing_tourist_tax_rates_listingId_effectiveFrom_key" ON "listing_tourist_tax_rates"("listingId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "booking_tourist_taxes_organizationId_idx" ON "booking_tourist_taxes"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_tourist_taxes_bookingId_organizationId_key" ON "booking_tourist_taxes"("bookingId", "organizationId");

-- AddForeignKey
ALTER TABLE "travelers" ADD CONSTRAINT "travelers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travelers" ADD CONSTRAINT "travelers_bookingId_organizationId_fkey" FOREIGN KEY ("bookingId", "organizationId") REFERENCES "bookings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travelers" ADD CONSTRAINT "travelers_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "travelers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler_documents" ADD CONSTRAINT "traveler_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler_documents" ADD CONSTRAINT "traveler_documents_travelerId_organizationId_fkey" FOREIGN KEY ("travelerId", "organizationId") REFERENCES "travelers"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_purges" ADD CONSTRAINT "identity_purges_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tourist_tax_rates" ADD CONSTRAINT "tourist_tax_rates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_tourist_tax_rates" ADD CONSTRAINT "listing_tourist_tax_rates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_tourist_tax_rates" ADD CONSTRAINT "listing_tourist_tax_rates_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_tourist_taxes" ADD CONSTRAINT "booking_tourist_taxes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_tourist_taxes" ADD CONSTRAINT "booking_tourist_taxes_bookingId_organizationId_fkey" FOREIGN KEY ("bookingId", "organizationId") REFERENCES "bookings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------- Checks ----------

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_identity_retention_check"
  CHECK ("identityRetentionDays" BETWEEN 1 AND 3650);

-- Only ciphertext: an envelope (version, key id of 8 hex, 12-byte IV, 16-byte tag, data).
ALTER TABLE "travelers" ADD CONSTRAINT "travelers_identity_check"
  CHECK ("identityEnc" ~ '^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
    AND ("declaredAt" IS NULL OR "declaredById" IS NOT NULL)
    AND ("guardianId" IS NULL OR "isMinor") AND ("guardianId" IS NULL OR "guardianId" <> "id"));

-- Encrypted files only (".enc" under identity/), of an accepted clear type, 5 MB at most (plus the envelope).
ALTER TABLE "traveler_documents" ADD CONSTRAINT "traveler_documents_check"
  CHECK ("storageKey" ~ '^identity/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[0-9a-f]{32}\.enc$'
    AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
    AND "byteSize" BETWEEN 1 AND 5242880);

ALTER TABLE "identity_purges" ADD CONSTRAINT "identity_purges_counts_check"
  CHECK ("travelerCount" >= 0 AND "minorCount" BETWEEN 0 AND "travelerCount" AND "declaredCount" BETWEEN 0 AND "travelerCount"
    AND "documentCount" >= 0 AND "retentionDays" BETWEEN 1 AND 3650);

-- At most 1 000 MAD a guest a night; an age limit for minors between 1 and 25.
ALTER TABLE "tourist_tax_rates" ADD CONSTRAINT "tourist_tax_rates_check"
  CHECK ("rateCents" BETWEEN 0 AND 100000 AND ("minorsExemptUnder" IS NULL OR "minorsExemptUnder" BETWEEN 1 AND 25)
    AND char_length("note") <= 200);
ALTER TABLE "listing_tourist_tax_rates" ADD CONSTRAINT "listing_tourist_tax_rates_check"
  CHECK (("rateCents" IS NULL OR "rateCents" BETWEEN 0 AND 100000) AND char_length("note") <= 200);

ALTER TABLE "booking_tourist_taxes" ADD CONSTRAINT "booking_tourist_taxes_check"
  CHECK ("totalCents" >= 0 AND "nights" >= 0 AND "taxableGuestNights" >= 0 AND "exemptGuestNights" >= 0
    AND "missingRateNights" BETWEEN 0 AND "nights" AND jsonb_typeof("lines") = 'array'
    AND ("closedAt" IS NULL OR "closedById" IS NOT NULL));

-- ---------- Triggers ----------

-- Owner blocks have no guest, hence no traveller to declare.
CREATE FUNCTION "travelers_booking_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "bookings" WHERE "id" = NEW."bookingId" AND "source" <> 'OWNER';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'travelers_booking_check: an owner block has no traveller' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "travelers_booking_check" BEFORE INSERT OR UPDATE OF "bookingId" ON "travelers"
FOR EACH ROW EXECUTE FUNCTION "travelers_booking_check"();

-- A minor's accompanying adult is an adult traveller of the same stay.
CREATE FUNCTION "travelers_guardian_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."guardianId" IS NOT NULL THEN
    PERFORM 1 FROM "travelers" WHERE "id" = NEW."guardianId" AND "bookingId" = NEW."bookingId" AND NOT "isMinor";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'travelers_guardian_check: the accompanying adult must be an adult traveller of the same stay' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "travelers_guardian_check" BEFORE INSERT OR UPDATE OF "guardianId", "bookingId", "isMinor" ON "travelers"
FOR EACH ROW EXECUTE FUNCTION "travelers_guardian_check"();

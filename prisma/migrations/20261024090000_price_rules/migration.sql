-- Lot 2e: prices by season and by event, and minimum stays (Prix). Two new tables, no existing row rewritten: a
-- listing's priceCents stays its base price and minNights its own minimum; rules change them for some nights
-- (lib/pricing/engine.ts). Config, not personal data.
-- CreateEnum
CREATE TYPE "PriceRuleKind" AS ENUM ('SEASON', 'EVENT');

-- CreateEnum
CREATE TYPE "PriceAdjustmentType" AS ENUM ('PERCENT', 'FIXED');

-- CreateTable
CREATE TABLE "price_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "PriceRuleKind" NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "adjustmentType" "PriceAdjustmentType" NOT NULL,
    "percentBps" INTEGER,
    "fixedCents" INTEGER,
    "minNights" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "allListings" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_rule_listings" (
    "ruleId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "price_rule_listings_pkey" PRIMARY KEY ("ruleId","listingId")
);

-- CreateIndex
CREATE INDEX "price_rules_organizationId_endDate_idx" ON "price_rules"("organizationId", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "price_rules_id_organizationId_key" ON "price_rules"("id", "organizationId");

-- CreateIndex
CREATE INDEX "price_rule_listings_organizationId_listingId_idx" ON "price_rule_listings"("organizationId", "listingId");

-- AddForeignKey
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_rule_listings" ADD CONSTRAINT "price_rule_listings_ruleId_organizationId_fkey" FOREIGN KEY ("ruleId", "organizationId") REFERENCES "price_rules"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_rule_listings" ADD CONSTRAINT "price_rule_listings_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Sane values, in the database too (the back-office validates the same in lib/admin/price-rule-form.ts):
-- the last night is on or after the first one;
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_dates_check" CHECK ("endDate" >= "startDate");
-- a yearly range is shorter than a year, so its day-month bounds can't overlap themselves;
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_recurring_span_check" CHECK (NOT "recurring" OR "endDate" < "startDate" + 365);
-- PERCENT has a percentage between −90 % and +500 % (0 % is allowed: a rule that only sets a minimum stay), FIXED a
-- nightly price of at least 1 MAD and at most 10 000 000 MAD; never both;
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_adjustment_check" CHECK (
  ("adjustmentType" = 'PERCENT' AND "percentBps" IS NOT NULL AND "fixedCents" IS NULL AND "percentBps" BETWEEN -9000 AND 50000)
  OR ("adjustmentType" = 'FIXED' AND "fixedCents" IS NOT NULL AND "percentBps" IS NULL AND "fixedCents" BETWEEN 100 AND 1000000000)
);
-- a fixed price is a listing's price: never for every listing at once (exactly one listing, checked by the app);
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_fixed_scope_check" CHECK (NOT ("adjustmentType" = 'FIXED' AND "allListings"));
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_min_nights_check" CHECK ("minNights" IS NULL OR "minNights" BETWEEN 1 AND 365);
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_priority_check" CHECK ("priority" BETWEEN 0 AND 100);
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_name_check" CHECK (char_length(btrim("name")) BETWEEN 2 AND 80);

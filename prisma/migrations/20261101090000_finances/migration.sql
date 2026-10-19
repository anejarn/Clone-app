-- CreateEnum
CREATE TYPE "FeeBeneficiary" AS ENUM ('SIGMA', 'OWNER');

-- CreateEnum
CREATE TYPE "CommissionBase" AS ENUM ('NET_EXCL_CLEANING', 'GROSS_EXCL_CLEANING');

-- CreateEnum
CREATE TYPE "RevenueAllocation" AS ENUM ('NIGHTS', 'CHECKOUT');

-- CreateEnum
CREATE TYPE "FinanceSplitStatus" AS ENUM ('COMPLETE', 'MISSING_AMOUNT', 'MISSING_RATE', 'CANCELLED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "FinanceGrossSource" AS ENUM ('BOOKING', 'EMAIL', 'MANUAL', 'ESTIMATE');

-- CreateEnum
CREATE TYPE "FinanceFeeSource" AS ENUM ('NONE', 'EMAIL', 'MANUAL', 'ESTIMATE');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('BOOKING', 'SERVICE', 'EXPENSE', 'EXPENSE_REVERSAL', 'SUBLEASE_RENT', 'MANUAL_ADJUSTMENT', 'MONTH_CLOSED', 'MONTH_REOPENED');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('PLATFORM_FEE', 'CLEANING_SIGMA', 'CLEANING_OWNER', 'COMMISSION', 'OWNER_SHARE', 'SIGMA_RENTAL', 'TOURIST_TAX', 'SERVICE_MARGIN', 'SERVICE_PARTNER_COST', 'EXPENSE_REBILLED', 'EXPENSE_SIGMA', 'EXPENSE_OWNER_PAID', 'EXPENSE_OWNER_ADVANCE', 'SUBLEASE_RENT', 'OWNER_ADJUSTMENT', 'NONE');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('REPAIR', 'PURCHASE', 'SUPPLIES', 'CLEANING', 'UTILITIES', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpensePayer" AS ENUM ('SIGMA', 'OWNER');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'VALIDATED', 'REVERSED');

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "cleaningFeeBeneficiary" "FeeBeneficiary",
ADD COLUMN     "subleaseRentCents" INTEGER,
ADD COLUMN     "subleaseRentFrom" DATE;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "financeAllocation" "RevenueAllocation" NOT NULL DEFAULT 'NIGHTS',
ADD COLUMN     "financeCleaningBeneficiary" "FeeBeneficiary" NOT NULL DEFAULT 'SIGMA',
ADD COLUMN     "financeCommissionBase" "CommissionBase" NOT NULL DEFAULT 'NET_EXCL_CLEANING',
ADD COLUMN     "platformFeeBps" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "booking_finances" (
    "bookingId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "managementType" "ManagementType" NOT NULL,
    "commissionBps" INTEGER NOT NULL,
    "cleaningBeneficiary" "FeeBeneficiary" NOT NULL,
    "commissionBase" "CommissionBase" NOT NULL,
    "allocation" "RevenueAllocation" NOT NULL,
    "platformFeeBps" INTEGER NOT NULL,
    "grossOverrideCents" INTEGER,
    "platformFeeOverrideCents" INTEGER,
    "fxRateMicros" INTEGER,
    "inputsNote" TEXT NOT NULL DEFAULT '',
    "inputsUpdatedAt" TIMESTAMP(3),
    "inputsUpdatedById" TEXT,
    "status" "FinanceSplitStatus" NOT NULL,
    "grossSource" "FinanceGrossSource",
    "feeSource" "FinanceFeeSource" NOT NULL DEFAULT 'NONE',
    "foreignAmountCents" INTEGER,
    "foreignCurrency" TEXT,
    "nights" INTEGER NOT NULL,
    "grossCents" INTEGER NOT NULL,
    "platformFeeCents" INTEGER NOT NULL,
    "cleaningSigmaCents" INTEGER NOT NULL,
    "cleaningOwnerCents" INTEGER NOT NULL,
    "commissionBaseCents" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "ownerShareCents" INTEGER NOT NULL,
    "sigmaRentalCents" INTEGER NOT NULL,
    "touristTaxCents" INTEGER NOT NULL DEFAULT 0,
    "months" JSONB NOT NULL DEFAULT '[]',
    "computedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_finances_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "financial_entries" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "kind" "LedgerKind" NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "period" TEXT NOT NULL,
    "originPeriod" TEXT,
    "amountCents" INTEGER NOT NULL,
    "listingId" TEXT,
    "ownerId" TEXT,
    "bookingId" TEXT,
    "expenseId" TEXT,
    "serviceRequestId" TEXT,
    "reversesId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "financial_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "ownerId" TEXT,
    "ticketId" TEXT,
    "date" DATE NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "supplier" TEXT NOT NULL DEFAULT '',
    "amountCents" INTEGER NOT NULL,
    "paidBy" "ExpensePayer" NOT NULL,
    "rebillToOwner" BOOLEAN NOT NULL,
    "receiptKey" TEXT,
    "receiptContentType" TEXT,
    "receiptSize" INTEGER,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_month_closings" (
    "organizationId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "closed" BOOLEAN NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_month_closings_pkey" PRIMARY KEY ("organizationId","month")
);

-- CreateIndex
CREATE INDEX "booking_finances_organizationId_status_idx" ON "booking_finances"("organizationId", "status");

-- CreateIndex
CREATE INDEX "booking_finances_organizationId_listingId_idx" ON "booking_finances"("organizationId", "listingId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_finances_bookingId_organizationId_key" ON "booking_finances"("bookingId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entries_seq_key" ON "financial_entries"("seq");

-- CreateIndex
CREATE INDEX "financial_entries_organizationId_period_idx" ON "financial_entries"("organizationId", "period");

-- CreateIndex
CREATE INDEX "financial_entries_organizationId_listingId_period_idx" ON "financial_entries"("organizationId", "listingId", "period");

-- CreateIndex
CREATE INDEX "financial_entries_organizationId_ownerId_period_idx" ON "financial_entries"("organizationId", "ownerId", "period");

-- CreateIndex
CREATE INDEX "financial_entries_bookingId_idx" ON "financial_entries"("bookingId");

-- CreateIndex
CREATE INDEX "financial_entries_expenseId_idx" ON "financial_entries"("expenseId");

-- CreateIndex
CREATE INDEX "financial_entries_serviceRequestId_idx" ON "financial_entries"("serviceRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_receiptKey_key" ON "expenses"("receiptKey");

-- CreateIndex
CREATE INDEX "expenses_organizationId_status_date_idx" ON "expenses"("organizationId", "status", "date");

-- CreateIndex
CREATE INDEX "expenses_listingId_date_idx" ON "expenses"("listingId", "date");

-- CreateIndex
CREATE INDEX "expenses_ticketId_idx" ON "expenses"("ticketId");

-- AddForeignKey
ALTER TABLE "booking_finances" ADD CONSTRAINT "booking_finances_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_finances" ADD CONSTRAINT "booking_finances_bookingId_organizationId_fkey" FOREIGN KEY ("bookingId", "organizationId") REFERENCES "bookings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "finance_month_closings" ADD CONSTRAINT "finance_month_closings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Lot 6: integrity rules (hand-written) ----------
-- Every rule below is NULL-safe: a CHECK whose result is NULL passes, so each nullable column is tested with
-- IS NULL / IS NOT NULL first (or wrapped in COALESCE … false).

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_platform_fee_bps_check" CHECK (jsonb_typeof("platformFeeBps") = 'object');

ALTER TABLE "listings" ADD CONSTRAINT "listings_sublease_rent_check" CHECK (
  ("subleaseRentCents" IS NULL OR "subleaseRentCents" BETWEEN 0 AND 100000000)
  AND ("subleaseRentFrom" IS NULL OR "subleaseRentCents" IS NOT NULL)
);

-- The split of a booking: amounts ≥ 0, the six parts add up exactly to the gross, nothing unless COMPLETE, a sublease
-- has neither commission nor owner share (all the revenue is Sigma's), a mandate has no sublease revenue.
ALTER TABLE "booking_finances" ADD CONSTRAINT "booking_finances_check" CHECK (
  "grossCents" >= 0 AND "platformFeeCents" >= 0 AND "cleaningSigmaCents" >= 0 AND "cleaningOwnerCents" >= 0
  AND "commissionBaseCents" >= 0 AND "commissionCents" >= 0 AND "ownerShareCents" >= 0 AND "sigmaRentalCents" >= 0
  AND "touristTaxCents" >= 0 AND "nights" >= 0 AND "version" >= 1
  AND "platformFeeCents" + "cleaningSigmaCents" + "cleaningOwnerCents" + "commissionCents" + "ownerShareCents" + "sigmaRentalCents" = "grossCents"
  AND "commissionBps" BETWEEN 0 AND 10000
  AND "platformFeeBps" BETWEEN 0 AND 5000
  AND ("grossOverrideCents" IS NULL OR "grossOverrideCents" BETWEEN 0 AND 1000000000)
  AND ("platformFeeOverrideCents" IS NULL OR "platformFeeOverrideCents" BETWEEN 0 AND 1000000000)
  AND ("fxRateMicros" IS NULL OR "fxRateMicros" BETWEEN 1 AND 1000000000)
  AND (("foreignAmountCents" IS NULL) = ("foreignCurrency" IS NULL))
  AND ("foreignCurrency" IS NULL OR "foreignCurrency" ~ '^[A-Z]{3}$')
  AND char_length("inputsNote") <= 500
  AND jsonb_typeof("months") = 'array'
  AND (
    ("status" = 'COMPLETE' AND "grossSource" IS NOT NULL)
    OR ("status" <> 'COMPLETE' AND "grossSource" IS NULL AND "grossCents" = 0 AND "commissionBaseCents" = 0 AND jsonb_array_length("months") = 0)
  )
  AND ("managementType" <> 'SUBLEASE' OR ("commissionCents" = 0 AND "ownerShareCents" = 0 AND "cleaningOwnerCents" = 0))
  AND ("managementType" <> 'MANAGED' OR "sigmaRentalCents" = 0)
);

-- The journal: months yyyy-MM, an adjustment corrects an earlier (closed) month, each kind with its accounts and the
-- reference it needs; closing markers carry no amount.
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_check" CHECK (
  "period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  AND ("originPeriod" IS NULL OR ("originPeriod" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "originPeriod" < "period"))
  AND char_length("description") <= 500
  AND (("account" = 'NONE') = ("kind" IN ('MONTH_CLOSED', 'MONTH_REOPENED')))
  AND ("kind" NOT IN ('MONTH_CLOSED', 'MONTH_REOPENED') OR ("amountCents" = 0 AND "originPeriod" IS NULL))
  AND ("kind" <> 'BOOKING' OR ("bookingId" IS NOT NULL AND "account" IN ('PLATFORM_FEE', 'CLEANING_SIGMA', 'CLEANING_OWNER', 'COMMISSION', 'OWNER_SHARE', 'SIGMA_RENTAL', 'TOURIST_TAX')))
  AND ("kind" <> 'SERVICE' OR ("serviceRequestId" IS NOT NULL AND "account" IN ('SERVICE_MARGIN', 'SERVICE_PARTNER_COST')))
  AND ("kind" NOT IN ('EXPENSE', 'EXPENSE_REVERSAL') OR ("expenseId" IS NOT NULL AND "account" IN ('EXPENSE_REBILLED', 'EXPENSE_SIGMA', 'EXPENSE_OWNER_PAID', 'EXPENSE_OWNER_ADVANCE')))
  AND ("kind" <> 'EXPENSE_REVERSAL' OR "reversesId" IS NOT NULL)
  AND ("kind" <> 'SUBLEASE_RENT' OR ("listingId" IS NOT NULL AND "account" = 'SUBLEASE_RENT'))
  AND ("kind" <> 'MANUAL_ADJUSTMENT' OR ("listingId" IS NOT NULL AND "account" = 'OWNER_ADJUSTMENT'))
);

-- Append-only journal: no UPDATE ever; no DELETE (nor emptying the table) except the cascade of the organization's own
-- deletion (the organization row is already gone; its bookings, homes and expenses forbid that while it has any) and
-- the demo reset of prisma/seed.ts, which sets sigma.ledger_reset = 'on' for its transaction only. In production the
-- application's database role is also to be denied DELETE on this table (to set up with the host).
CREATE FUNCTION "financial_entries_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('sigma.ledger_reset', true) = 'on' THEN
      RETURN OLD;
    END IF;
    IF pg_trigger_depth() > 1 AND NOT EXISTS (SELECT 1 FROM "organizations" WHERE "id" = OLD."organizationId") THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'TRUNCATE' AND current_setting('sigma.ledger_reset', true) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'financial_entries_append_only: the financial journal is append-only (% refused); a correction is a new entry', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;
CREATE TRIGGER "financial_entries_append_only" BEFORE UPDATE OR DELETE ON "financial_entries"
  FOR EACH ROW EXECUTE FUNCTION "financial_entries_append_only"();
CREATE TRIGGER "financial_entries_append_only_truncate" BEFORE TRUNCATE ON "financial_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "financial_entries_append_only"();

-- Expenses: amounts, texts, receipt fields together, timestamps that match the status.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_check" CHECK (
  "amountCents" BETWEEN 1 AND 100000000
  AND char_length(btrim("description")) BETWEEN 2 AND 500
  AND char_length("supplier") <= 120
  AND (("receiptKey" IS NULL) = ("receiptContentType" IS NULL))
  AND (("receiptKey" IS NULL) = ("receiptSize" IS NULL))
  AND ("receiptKey" IS NULL OR "receiptKey" LIKE 'receipts/%')
  AND ("receiptContentType" IS NULL OR "receiptContentType" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'))
  AND ("receiptSize" IS NULL OR "receiptSize" > 0)
  AND (
    ("status" = 'DRAFT' AND "validatedAt" IS NULL AND "validatedById" IS NULL AND "reversedAt" IS NULL AND "reversedById" IS NULL AND "reversalReason" IS NULL)
    OR ("status" = 'VALIDATED' AND "validatedAt" IS NOT NULL AND "ownerId" IS NOT NULL AND "reversedAt" IS NULL AND "reversedById" IS NULL AND "reversalReason" IS NULL)
    OR ("status" = 'REVERSED' AND "validatedAt" IS NOT NULL AND "ownerId" IS NOT NULL AND "reversedAt" IS NOT NULL
        AND "reversalReason" IS NOT NULL AND char_length(btrim("reversalReason")) BETWEEN 2 AND 500)
  )
);

-- A validated expense is frozen: the only changes are VALIDATED → REVERSED (with its reason, who and when) and adding
-- the receipt it didn't have. Only drafts are deleted (and every row by the demo reset of prisma/seed.ts).
CREATE FUNCTION "expenses_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'DRAFT' OR current_setting('sigma.ledger_reset', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'expenses_immutable: a validated expense is never deleted (reverse it)' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW."id", NEW."organizationId", NEW."listingId", NEW."ownerId", NEW."ticketId", NEW."date", NEW."category", NEW."description",
         NEW."supplier", NEW."amountCents", NEW."paidBy", NEW."rebillToOwner", NEW."createdById", NEW."validatedAt", NEW."validatedById", NEW."createdAt")
     IS DISTINCT FROM
     ROW(OLD."id", OLD."organizationId", OLD."listingId", OLD."ownerId", OLD."ticketId", OLD."date", OLD."category", OLD."description",
         OLD."supplier", OLD."amountCents", OLD."paidBy", OLD."rebillToOwner", OLD."createdById", OLD."validatedAt", OLD."validatedById", OLD."createdAt") THEN
    RAISE EXCEPTION 'expenses_immutable: a validated expense never changes (reverse it and type a new one)' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF ROW(NEW."receiptKey", NEW."receiptContentType", NEW."receiptSize") IS DISTINCT FROM ROW(OLD."receiptKey", OLD."receiptContentType", OLD."receiptSize")
     AND (OLD."receiptKey" IS NOT NULL OR OLD."status" = 'REVERSED') THEN
    RAISE EXCEPTION 'expenses_immutable: the receipt of a validated expense is never replaced' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" = 'REVERSED' AND ROW(NEW."status", NEW."reversedAt", NEW."reversedById", NEW."reversalReason") IS DISTINCT FROM ROW(OLD."status", OLD."reversedAt", OLD."reversedById", OLD."reversalReason") THEN
    RAISE EXCEPTION 'expenses_immutable: a reversed expense never changes' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" = 'VALIDATED' AND NEW."status" = 'DRAFT' THEN
    RAISE EXCEPTION 'expenses_immutable: a validated expense never goes back to draft' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "expenses_immutable" BEFORE UPDATE OR DELETE ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION "expenses_immutable"();

ALTER TABLE "finance_month_closings" ADD CONSTRAINT "finance_month_closings_check" CHECK (
  "month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  AND ("closed" = ("closedAt" IS NOT NULL))
);


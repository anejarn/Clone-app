-- ---------- Lot 6b: owner statements, transfers to owners, owner documents — integrity rules (hand-written) ----------
-- A separate migration from 20261102090000_owner_statements_portal: the rules below name the enum values it added
-- (OWNER_PAYOUT), which Postgres only lets a transaction use once the ALTER TYPE … ADD VALUE is committed.
-- Every rule is NULL-safe: a CHECK whose result is NULL passes, so each nullable column is tested with IS NULL /
-- IS NOT NULL first.

-- Statement header (organization parameters): bounded texts, ICE = 15 digits or empty, a logo in lib/storage's
-- branding/ prefix, an indicative EUR rate between 0,000001 and 1 000 MAD.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_statement_branding_check" CHECK (
  char_length("legalName") <= 120
  AND char_length("legalAddress") <= 300
  AND "ice" ~ '^([0-9]{15})?$'
  AND char_length("rcNumber") <= 60
  AND char_length("taxIdNumber") <= 30
  AND ("logoKey" IS NULL OR "logoKey" LIKE 'branding/%')
  AND ("statementEurRateMicros" IS NULL OR "statementEurRateMicros" BETWEEN 1 AND 1000000000)
);

-- The journal (financial_entries_check of 20261101090000_finances, same rules) + a transfer to an owner: kind and
-- account OWNER_PAYOUT together, always for an owner, never an « ajustement après clôture », never zero.
ALTER TABLE "financial_entries" DROP CONSTRAINT "financial_entries_check";
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
  AND (("kind" = 'OWNER_PAYOUT') = ("account" = 'OWNER_PAYOUT'))
  AND ("kind" <> 'OWNER_PAYOUT' OR ("ownerId" IS NOT NULL AND "originPeriod" IS NULL AND "amountCents" <> 0))
);

-- Statements: a month, a version from 1, a PDF under statements/ with its SHA-256 (hex), figures as a JSON object.
ALTER TABLE "owner_statements" ADD CONSTRAINT "owner_statements_check" CHECK (
  "month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  AND "version" >= 1
  AND "fileKey" LIKE 'statements/%'
  AND "sha256" ~ '^[0-9a-f]{64}$'
  AND "dataHash" ~ '^[0-9a-f]{64}$'
  AND "sizeBytes" > 0
  AND jsonb_typeof("data") = 'object'
);

-- A statement never changes and is never deleted: regenerating writes a new version. The only deletions are the
-- demo reset of prisma/seed.ts and the integration tests' cleanup of their own organizations, in a transaction that
-- set sigma.ledger_reset = 'on' (as for the journal). In production, deny UPDATE and DELETE on this table to the
-- application's database role as well.
CREATE FUNCTION "owner_statements_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('sigma.ledger_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'owner_statements_immutable: a statement never changes (% refused); regenerate a new version', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;
CREATE TRIGGER "owner_statements_immutable" BEFORE UPDATE OR DELETE ON "owner_statements"
  FOR EACH ROW EXECUTE FUNCTION "owner_statements_immutable"();

-- Transfers: a positive amount, a bank reference, a month; reversal fields all set or all empty, with a reason.
ALTER TABLE "owner_payouts" ADD CONSTRAINT "owner_payouts_check" CHECK (
  "month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  AND "amountCents" BETWEEN 1 AND 100000000
  AND char_length(btrim("reference")) BETWEEN 2 AND 100
  AND (
    ("reversedAt" IS NULL AND "reversedById" IS NULL AND "reversalReason" IS NULL AND "reversalEntryId" IS NULL)
    OR ("reversedAt" IS NOT NULL AND "reversalEntryId" IS NOT NULL AND "reversalReason" IS NOT NULL
        AND char_length(btrim("reversalReason")) BETWEEN 2 AND 500)
  )
);

-- A transfer is never changed nor deleted; the one change is its reversal, once (the reversal fields from empty to
-- set). Deletions only as for the statements (sigma.ledger_reset).
CREATE FUNCTION "owner_payouts_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('sigma.ledger_reset', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'owner_payouts_immutable: a transfer is never deleted (reverse it)' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."reversedAt" IS NOT NULL
     OR ROW(NEW."id", NEW."organizationId", NEW."ownerId", NEW."month", NEW."statementId", NEW."amountCents", NEW."paidOn",
            NEW."reference", NEW."entryId", NEW."createdById", NEW."createdAt")
        IS DISTINCT FROM
        ROW(OLD."id", OLD."organizationId", OLD."ownerId", OLD."month", OLD."statementId", OLD."amountCents", OLD."paidOn",
            OLD."reference", OLD."entryId", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'owner_payouts_immutable: a transfer never changes (only its reversal, once)' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "owner_payouts_immutable" BEFORE UPDATE OR DELETE ON "owner_payouts"
  FOR EACH ROW EXECUTE FUNCTION "owner_payouts_immutable"();

-- Owner documents: a title, a file under owner-documents/ of an accepted type, its SHA-256.
ALTER TABLE "owner_documents" ADD CONSTRAINT "owner_documents_check" CHECK (
  char_length(btrim("title")) BETWEEN 2 AND 160
  AND "fileKey" LIKE 'owner-documents/%'
  AND "contentType" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  AND "sizeBytes" > 0
  AND "sha256" ~ '^[0-9a-f]{64}$'
);

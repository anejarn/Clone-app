-- CreateEnum
CREATE TYPE "OwnerDocumentKind" AS ENUM ('MANDATE', 'CONTRACT', 'LICENSE', 'INSURANCE', 'OTHER');

-- AlterEnum
ALTER TYPE "LedgerAccount" ADD VALUE 'OWNER_PAYOUT';

-- AlterEnum
ALTER TYPE "LedgerKind" ADD VALUE 'OWNER_PAYOUT';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "ice" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "legalAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "legalName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "logoKey" TEXT,
ADD COLUMN     "rcNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "statementEurRateMicros" INTEGER,
ADD COLUMN     "taxIdNumber" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "owner_statements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "dataHash" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "netDueCents" INTEGER NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,

    CONSTRAINT "owner_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_payouts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "statementId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "reference" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversalReason" TEXT,
    "reversalEntryId" TEXT,

    CONSTRAINT "owner_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "listingId" TEXT,
    "kind" "OwnerDocumentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "owner_statements_fileKey_key" ON "owner_statements"("fileKey");

-- CreateIndex
CREATE INDEX "owner_statements_organizationId_month_idx" ON "owner_statements"("organizationId", "month");

-- CreateIndex
CREATE INDEX "owner_statements_organizationId_ownerId_month_idx" ON "owner_statements"("organizationId", "ownerId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "owner_statements_organizationId_ownerId_month_version_key" ON "owner_statements"("organizationId", "ownerId", "month", "version");

-- CreateIndex
CREATE INDEX "owner_payouts_organizationId_ownerId_month_idx" ON "owner_payouts"("organizationId", "ownerId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "owner_documents_fileKey_key" ON "owner_documents"("fileKey");

-- CreateIndex
CREATE INDEX "owner_documents_organizationId_ownerId_idx" ON "owner_documents"("organizationId", "ownerId");

-- AddForeignKey
ALTER TABLE "owner_statements" ADD CONSTRAINT "owner_statements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_statements" ADD CONSTRAINT "owner_statements_ownerId_organizationId_fkey" FOREIGN KEY ("ownerId", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "owner_payouts" ADD CONSTRAINT "owner_payouts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_payouts" ADD CONSTRAINT "owner_payouts_ownerId_organizationId_fkey" FOREIGN KEY ("ownerId", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "owner_documents" ADD CONSTRAINT "owner_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_documents" ADD CONSTRAINT "owner_documents_ownerId_organizationId_fkey" FOREIGN KEY ("ownerId", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "owner_documents" ADD CONSTRAINT "owner_documents_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;


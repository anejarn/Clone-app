-- Lot 3b: breakdown reports (Pannes: tickets, their thread and photos) and the offline « Ma journée » of field agents
-- (task_sync_operations: one row per change sent from a phone, so that a change sent twice is applied once;
-- tasks.fieldNotes: the agent's own remarks on a task).

-- CreateEnum
CREATE TYPE "TaskSyncOutcome" AS ENUM ('APPLIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('PLUMBING', 'ELECTRICITY', 'AIR_CONDITIONING', 'APPLIANCE', 'LOCK', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketWaitingFor" AS ENUM ('PART', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "TicketEventKind" AS ENUM ('CREATED', 'COMMENT', 'STATUS', 'ASSIGNED', 'PRIORITY', 'COST', 'PHOTO');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "fieldNotes" TEXT;

-- CreateTable
CREATE TABLE "task_sync_operations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "opId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" "TaskSyncOutcome" NOT NULL,
    "code" TEXT,
    "message" TEXT,
    "clientAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "bookingId" TEXT,
    "taskId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" "TicketCategory" NOT NULL,
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "waitingFor" "TicketWaitingFor",
    "reporterId" TEXT,
    "assigneeId" TEXT,
    "costCents" INTEGER,
    "rechargeOwner" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "kind" "TicketEventKind" NOT NULL,
    "body" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_photos" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_sync_operations_organizationId_createdAt_idx" ON "task_sync_operations"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "task_sync_operations_userId_opId_key" ON "task_sync_operations"("userId", "opId");

-- CreateIndex
CREATE INDEX "tickets_organizationId_status_priority_idx" ON "tickets"("organizationId", "status", "priority");

-- CreateIndex
CREATE INDEX "tickets_listingId_idx" ON "tickets"("listingId");

-- CreateIndex
CREATE INDEX "tickets_reporterId_idx" ON "tickets"("reporterId");

-- CreateIndex
CREATE INDEX "tickets_assigneeId_idx" ON "tickets"("assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_id_organizationId_key" ON "tickets"("id", "organizationId");

-- CreateIndex
CREATE INDEX "ticket_events_ticketId_createdAt_idx" ON "ticket_events"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_photos_storageKey_key" ON "ticket_photos"("storageKey");

-- CreateIndex
CREATE INDEX "ticket_photos_ticketId_idx" ON "ticket_photos"("ticketId");

-- AddForeignKey
ALTER TABLE "task_sync_operations" ADD CONSTRAINT "task_sync_operations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_sync_operations" ADD CONSTRAINT "task_sync_operations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticketId_organizationId_fkey" FOREIGN KEY ("ticketId", "organizationId") REFERENCES "tickets"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_photos" ADD CONSTRAINT "ticket_photos_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_photos" ADD CONSTRAINT "ticket_photos_ticketId_organizationId_fkey" FOREIGN KEY ("ticketId", "organizationId") REFERENCES "tickets"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Checks (the app validates the same in lib/admin/ticket-form.ts and lib/server/operations/*.ts) ----------

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_field_notes_check" CHECK ("fieldNotes" IS NULL OR char_length("fieldNotes") <= 2000);

ALTER TABLE "task_sync_operations" ADD CONSTRAINT "task_sync_operations_check" CHECK (
  "opId" ~ '^[A-Za-z0-9_-]{8,64}$'
  AND "kind" IN ('start', 'check', 'note', 'photo', 'complete')
  AND ("message" IS NULL OR char_length("message") <= 500)
);

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_text_check" CHECK (
  char_length(btrim("title")) BETWEEN 1 AND 120 AND char_length("description") <= 4000
);
-- Status dates match the status; "en attente" says of what.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_status_check" CHECK (
  ("status" = 'RESOLVED') = ("resolvedAt" IS NOT NULL)
  AND ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
  AND ("status" = 'WAITING') = ("waitingFor" IS NOT NULL)
);
-- A cost is 0 to 1 000 000 MAD; re-invoicing the owner needs one.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_cost_check" CHECK (
  ("costCents" IS NULL OR "costCents" BETWEEN 0 AND 100000000) AND (NOT "rechargeOwner" OR "costCents" IS NOT NULL)
);
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_check" CHECK (
  ("body" IS NULL OR char_length("body") <= 4000)
  AND ("kind" <> 'COMMENT' OR char_length(btrim(coalesce("body", ''))) >= 1)
  AND jsonb_typeof("details") = 'object'
);

-- The stay and the task a ticket is linked to are of its home (hence of its organization); the reporter is a member
-- of the organization, the assignee an ADMIN or AGENT of it (the app also refuses deactivated accounts).
CREATE FUNCTION "tickets_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."bookingId" IS NOT NULL THEN
    PERFORM 1 FROM "bookings" WHERE "id" = NEW."bookingId" AND "organizationId" = NEW."organizationId" AND "listingId" = NEW."listingId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'tickets_check: the booking is not of the ticket''s home' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."taskId" IS NOT NULL THEN
    PERFORM 1 FROM "tasks" WHERE "id" = NEW."taskId" AND "organizationId" = NEW."organizationId" AND "listingId" = NEW."listingId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'tickets_check: the task is not of the ticket''s home' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."assigneeId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."assigneeId" IS DISTINCT FROM OLD."assigneeId") THEN
    PERFORM 1 FROM "users" WHERE "id" = NEW."assigneeId" AND "organizationId" = NEW."organizationId" AND "role" IN ('ADMIN', 'AGENT') FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'tickets_check: a ticket is assigned to an ADMIN or AGENT of its organization' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NEW."reporterId" IS NOT NULL THEN
    PERFORM 1 FROM "users" WHERE "id" = NEW."reporterId" AND "organizationId" = NEW."organizationId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'tickets_check: the reporter is a member of the ticket''s organization' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tickets_check" BEFORE INSERT OR UPDATE OF "bookingId", "taskId", "listingId", "organizationId", "assigneeId" ON "tickets"
FOR EACH ROW EXECUTE FUNCTION "tickets_check"();

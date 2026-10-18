-- Lot 3a: field tasks (Opérations). Tasks generated for every stay (linen and welcome on arrival, cleaning after
-- departure: lib/operations/sync.ts), manual tasks, check-lists copied from per-organization templates, photos.
-- Check-in / check-out times of the organization (15:00 / 11:00 by default) and optionally of each home.
-- At the end: the default check-list templates of every organization. Tasks of existing stays: pnpm tasks:backfill.
-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('CLEANING', 'LINEN', 'CHECKIN', 'OTHER');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "checkInMinutes" INTEGER,
ADD COLUMN     "checkOutMinutes" INTEGER;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "checkInMinutes" INTEGER NOT NULL DEFAULT 900,
ADD COLUMN     "checkOutMinutes" INTEGER NOT NULL DEFAULT 660;

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "bookingId" TEXT,
    "type" "TaskType" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "title" TEXT,
    "scheduledDate" DATE NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "anchorDate" DATE,
    "turnover" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "TaskType" NOT NULL,
    "items" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_checklist_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "requiresPhoto" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "checkedById" TEXT,

    CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_photos" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "itemId" TEXT,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_organizationId_scheduledDate_idx" ON "tasks"("organizationId", "scheduledDate");

-- CreateIndex
CREATE INDEX "tasks_assigneeId_scheduledDate_idx" ON "tasks"("assigneeId", "scheduledDate");

-- CreateIndex
CREATE INDEX "tasks_listingId_scheduledDate_idx" ON "tasks"("listingId", "scheduledDate");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_bookingId_type_key" ON "tasks"("bookingId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_id_organizationId_key" ON "tasks"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_templates_organizationId_type_key" ON "checklist_templates"("organizationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "task_checklist_items_taskId_position_key" ON "task_checklist_items"("taskId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "task_photos_storageKey_key" ON "task_photos"("storageKey");

-- CreateIndex
CREATE INDEX "task_photos_taskId_idx" ON "task_photos"("taskId");

-- CreateIndex
CREATE INDEX "task_photos_itemId_idx" ON "task_photos"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_id_organizationId_key" ON "bookings"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_listingId_organizationId_fkey" FOREIGN KEY ("listingId", "organizationId") REFERENCES "listings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_bookingId_organizationId_fkey" FOREIGN KEY ("bookingId", "organizationId") REFERENCES "bookings"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "tasks"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_photos" ADD CONSTRAINT "task_photos_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_photos" ADD CONSTRAINT "task_photos_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "tasks"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_photos" ADD CONSTRAINT "task_photos_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "task_checklist_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------- Checks (the app validates the same in lib/admin/task-form.ts and lib/server/operations/tasks.ts) ----------

-- Times are minutes after local midnight.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_task_times_check" CHECK ("checkInMinutes" BETWEEN 0 AND 1439 AND "checkOutMinutes" BETWEEN 0 AND 1439);
ALTER TABLE "listings" ADD CONSTRAINT "listings_task_times_check" CHECK (
  ("checkInMinutes" IS NULL OR "checkInMinutes" BETWEEN 0 AND 1439) AND ("checkOutMinutes" IS NULL OR "checkOutMinutes" BETWEEN 0 AND 1439)
);
-- A window ends after it starts, and lasts at most a day.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_window_check" CHECK ("endsAt" > "startsAt" AND "endsAt" <= "startsAt" + interval '1 day');
-- Status timestamps match the status: completedAt iff DONE, cancelledAt iff CANCELLED, startedAt once started.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_dates_check" CHECK (
  ("status" = 'DONE') = ("completedAt" IS NOT NULL)
  AND ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
  AND ("status" NOT IN ('IN_PROGRESS', 'DONE') OR "startedAt" IS NOT NULL)
);
-- A generated task is a cleaning, linen or welcome task (OTHER is typed by hand); only a cleaning is a turnover;
-- a generated task has its anchor day.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_kind_check" CHECK (
  ("bookingId" IS NULL OR ("type" <> 'OTHER' AND "anchorDate" IS NOT NULL)) AND (NOT "turnover" OR "type" = 'CLEANING')
);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_text_check" CHECK (
  ("title" IS NULL OR char_length(btrim("title")) BETWEEN 1 AND 120) AND ("notes" IS NULL OR char_length("notes") <= 2000)
);
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_check" CHECK ("position" >= 0 AND char_length(btrim("label")) BETWEEN 1 AND 200);
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_items_check" CHECK (jsonb_typeof("items") = 'array');

-- The assignee is an ADMIN or AGENT of the task's organization (the app also refuses deactivated accounts).
CREATE FUNCTION "tasks_assignee_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."assigneeId" IS NOT NULL THEN
    PERFORM 1 FROM "users" WHERE "id" = NEW."assigneeId" AND "organizationId" = NEW."organizationId" AND "role" IN ('ADMIN', 'AGENT') FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'tasks_assignee_check: a task is assigned to an ADMIN or AGENT of its organization' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tasks_assignee_check" BEFORE INSERT OR UPDATE OF "assigneeId" ON "tasks"
FOR EACH ROW EXECUTE FUNCTION "tasks_assignee_check"();

-- ---------- Default templates ----------

-- Default check-lists (French) for every organization; same content as DEFAULT_CHECKLISTS in lib/operations/checklist.ts.
INSERT INTO "checklist_templates" ("id", "organizationId", "type", "items", "updatedAt")
SELECT 'ckl_' || md5(o."id" || t."type"), o."id", t."type"::"TaskType", t."items"::jsonb, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
  ('CLEANING', '[
    {"label": "Chambres : lits faits, poussière, sous les lits", "requiresPhoto": false},
    {"label": "Salle de bain : douche, WC, lavabo, miroir", "requiresPhoto": true},
    {"label": "Cuisine : vaisselle, plans de travail, frigo vidé", "requiresPhoto": true},
    {"label": "Sols aspirés et lavés", "requiresPhoto": false},
    {"label": "Poubelles vidées, sacs neufs", "requiresPhoto": false},
    {"label": "Linge changé (draps et serviettes)", "requiresPhoto": false},
    {"label": "Consommables remis (papier, savon, café, thé)", "requiresPhoto": false},
    {"label": "Photos de chaque pièce", "requiresPhoto": true}
  ]'),
  ('LINEN', '[
    {"label": "Draps et housses pour chaque lit", "requiresPhoto": false},
    {"label": "Serviettes : une grande et une petite par voyageur", "requiresPhoto": false},
    {"label": "Tapis de bain et torchons", "requiresPhoto": false},
    {"label": "Linge vérifié : propre, sans tache ni trou", "requiresPhoto": true}
  ]'),
  ('CHECKIN', '[
    {"label": "Logement vérifié avant l''arrivée (ménage, clim, eau chaude)", "requiresPhoto": false},
    {"label": "Remise des clés", "requiresPhoto": false},
    {"label": "Explication du Wi-Fi (réseau et mot de passe)", "requiresPhoto": false},
    {"label": "Visite du logement et des équipements", "requiresPhoto": false},
    {"label": "Règles de la maison rappelées", "requiresPhoto": false},
    {"label": "Numéro d''urgence Sigma donné", "requiresPhoto": false},
    {"label": "Photo des compteurs (électricité, eau)", "requiresPhoto": true}
  ]'),
  ('OTHER', '[
    {"label": "Tâche réalisée", "requiresPhoto": false}
  ]')
) AS t("type", "items")
ON CONFLICT ("organizationId", "type") DO NOTHING;

-- The tasks of the stays already in the database are NOT created here: their times need the Moroccan time zone
-- rules (UTC+1, UTC+0 during Ramadan), and the Postgres tz database can be older than the app's (Node/ICU) one, e.g.
-- Ubuntu 24.04's stops following Morocco after September 2026. Run `pnpm tasks:backfill` once after this migration
-- (scripts/backfill-tasks.ts: the same code as the app, idempotent); prisma/seed.ts does it for the demo data.

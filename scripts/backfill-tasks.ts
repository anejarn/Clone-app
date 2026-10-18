/**
 * Creates the field tasks (linen, welcome, cleaning) of every confirmed stay not over yet that doesn't have them:
 * run once after the migration 20261025090000_field_tasks on a database holding real bookings
 * (`pnpm tasks:backfill`). Same code as the app (lib/operations/sync.ts), so the times follow the Moroccan time zone
 * rules of the runtime (ICU), not the database's. Idempotent: running it again creates nothing; it never deletes.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { backfillTasks } from "../lib/operations/sync";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

backfillTasks(prisma)
  .then((r) => console.log(`${r.bookings} stays checked: ${r.created} tasks created, ${r.moved} moved, ${r.cancelled} cancelled.`))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

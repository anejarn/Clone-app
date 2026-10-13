import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Not env(): that throws when unset, which would break `prisma generate` (postinstall) on a fresh clone.
    url: process.env.DATABASE_URL,
  },
});

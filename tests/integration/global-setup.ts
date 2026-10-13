import { execSync } from "node:child_process";

/**
 * Brings the test database up to date and reloads demo data before the integration suite.
 * Non-destructive for the schema: `migrate deploy` only applies pending migrations; the seed
 * clears and reloads demo rows (see prisma/seed.ts).
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://nidou:nidou@localhost:5432/nidou_test?schema=public";
  if (!/test/.test(url)) throw new Error(`Refusing to seed a database whose URL doesn't mention "test": ${url}`);
  const env = { ...process.env, DATABASE_URL: url };
  execSync("pnpm exec prisma migrate deploy", { env, stdio: "inherit" });
  execSync("pnpm exec prisma db seed", { env, stdio: "inherit" });
}

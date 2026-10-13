import { execSync } from "node:child_process";
import { TEST_DATABASE_URL } from "../../playwright.config";

/** Same as the integration suite: apply pending migrations, reload demo data. */
export default function setup() {
  if (!/test/.test(TEST_DATABASE_URL)) throw new Error(`Refusing to seed a database whose URL doesn't mention "test"`);
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL };
  execSync("pnpm exec prisma migrate deploy", { env, stdio: "inherit" });
  execSync("pnpm exec prisma db seed", { env, stdio: "inherit" });
}

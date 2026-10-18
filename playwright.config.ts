import { defineConfig, devices } from "@playwright/test";
import { TEST_ACCESS_CODES_KEY } from "./tests/support/secrets";
import { TEST_AUTH_SECRET } from "./tests/support/totp";

const PORT = Number(process.env.PORT ?? 3100);
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://sigma:sigma@localhost:5432/sigma_test?schema=public";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, locale: "fr-FR", trace: "retain-on-failure" },
  projects: [
    // HTTP-only suites (*.api.spec.ts): no browser, run once.
    { name: "api", testMatch: /\.api\.spec\.ts$/ },
    { name: "desktop", testIgnore: /\.api\.spec\.ts$/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", testIgnore: /\.api\.spec\.ts$/, use: { ...devices["Pixel 7"] } },
  ],
  // Runs the production build (`DATABASE_URL=<test db> pnpm build` first) against the test database.
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      AUTH_RATE_LIMIT: "off",
      ACCESS_CODES_KEY: TEST_ACCESS_CODES_KEY,
    },
  },
});

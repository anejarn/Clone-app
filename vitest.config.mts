import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { TEST_ACCESS_CODES_KEY, TEST_IDENTITY_DOCS_KEY } from "./tests/support/secrets";
import { TEST_AUTH_SECRET } from "./tests/support/totp";

const root = fileURLToPath(new URL(".", import.meta.url));
const alias = {
  "@": root,
  // `server-only` throws outside a React Server Components bundler; tests run server code directly.
  "server-only": fileURLToPath(new URL("tests/support/empty.ts", import.meta.url)),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    coverage: {
      provider: "v8",
      include: ["lib/**", "components/search/GuestsPicker.tsx"],
      exclude: ["lib/generated/**"],
      reporter: ["text-summary", "text"],
    },
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.{ts,tsx}"], environment: "node" } },
      // Date logic again, in a timezone far ahead of and far behind UTC.
      ...["Pacific/Kiritimati", "America/Los_Angeles"].map((TZ) => ({
        extends: true as const,
        test: { name: `unit-${TZ}`, include: ["tests/unit/**/*.tz.test.{ts,tsx}"], environment: "node", env: { TZ } },
      })),
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          // Every file deletes the test accounts it created (tests/integration/cleanup-accounts.ts).
          setupFiles: ["tests/integration/cleanup-accounts.ts"],
          // One database, shared: files run one at a time.
          fileParallelism: false,
          // Same Better Auth secret as the seed (global-setup), which encrypts the demo staff's TOTP secrets with it.
          env: {
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://sigma:sigma@localhost:5432/sigma_test?schema=public",
            BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
            BETTER_AUTH_URL: "http://localhost:3100",
            ACCESS_CODES_KEY: TEST_ACCESS_CODES_KEY,
            IDENTITY_DOCS_KEY: TEST_IDENTITY_DOCS_KEY,
            // Lot 7: the tests serve iCal feeds from a local server (never set on a real server).
            CHANNELS_ALLOW_PRIVATE_URLS: "1",
          },
        },
      },
    ],
  },
});

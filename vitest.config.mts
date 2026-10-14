import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
          // One database, shared: files run one at a time.
          fileParallelism: false,
          // Rate limits off, as on the e2e server; the tests that check them turn them back on.
          env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://nidou:nidou@localhost:5432/nidou_test?schema=public", AUTH_RATE_LIMIT: "off" },
        },
      },
    ],
  },
});

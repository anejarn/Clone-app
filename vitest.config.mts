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
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.{ts,tsx}"], environment: "node" } },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          // One database, shared: files run one at a time.
          fileParallelism: false,
          env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://nidou:nidou@localhost:5432/nidou_test?schema=public" },
        },
      },
    ],
  },
});

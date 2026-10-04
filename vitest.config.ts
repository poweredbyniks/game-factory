import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "engine/schemas/src/**/*.test.ts",
      "engine/core/src/**/*.test.ts",
      "engine/mechanics/*/src/**/*.test.ts",
      "tools/src/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "tests/e2e/**"],
    testTimeout: 60_000,
  },
});

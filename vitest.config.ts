import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/core/**"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      // SPEC §6 / TASKS.md T9: src/core must stay at 90% or above.
      // Applied only by `npm run test:coverage` (not wired into `npm run check`). It meant nothing
      // at T0, when src/core did not exist yet; it is enforced for real as core code accumulates
      // from T1 on.
      thresholds: { statements: 90, lines: 90, functions: 90, branches: 80 },
    },
  },
});

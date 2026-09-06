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
      // SPEC §6 / TASKS.md T9: src/core는 90% 이상이어야 한다.
      // `npm run test:coverage`에서만 적용된다(`npm run check`에는 안 물림) —
      // src/core가 아직 없는 T0 시점엔 의미가 없고, T1부터 core 코드가 쌓이며 실제로 강제된다.
      thresholds: { statements: 90, lines: 90, functions: 90, branches: 80 },
    },
  },
});

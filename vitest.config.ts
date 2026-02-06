import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", "build", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: [
        "app/services/**/*.ts",
        "app/lib/**/*.ts",
        "app/jobs/**/*.ts",
        "worker/**/*.ts",
      ],
      exclude: [
        "node_modules",
        "build",
        "dist",
        "**/*.test.ts",
        "**/__tests__/**",
        "app/e2e/**",
        "**/*.d.ts",
      ],
      // Aim for >80% coverage on business logic
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
});

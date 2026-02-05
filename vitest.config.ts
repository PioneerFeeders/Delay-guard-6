import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", "build", "dist"],
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: ["node_modules", "build", "dist", "**/*.test.ts"],
    },
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
});

import { defineConfig } from "vitest/config";
import { ciTimeouts } from "../../vitest.config.base.js";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    // Run serially: tests hit a real DB and rely on TRUNCATE isolation.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    ...ciTimeouts,
  },
});

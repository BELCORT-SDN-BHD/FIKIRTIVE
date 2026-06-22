import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    // Run serially: tests hit a real DB and rely on TRUNCATE isolation.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});

import { defineConfig } from "vitest/config";

// #1350: apps/worker had no vitest config, so Vitest defaulted to fileParallelism — several of
// this package's *.test.ts files (auth-verification-reaper.test.ts foremost) hit the REAL
// fikirtive_test Postgres that the whole monorepo's test run shares (see
// apps/web/vitest.config.ts and packages/db/vitest.config.ts, which serialize their own real-DB
// suites for the identical reason). auth-verification-reaper.test.ts was flaking in CI
// (#1345 run 10, #1349 run 2, #1364 run 1 — reproduced with zero code changes, so it is purely a
// scheduling/timing race, not a logic bug) with exactly the shape a same-table concurrent writer
// produces: fixture rows the test just created were already gone by its first assertion. The
// exact second caller was never pinned down (still true as of #1350), so this removes the whole
// class this package can control — its own test files never run at the same time — while
// auth-verification-reaper.test.ts separately hardens its fixtures against any OTHER process
// that might still race it (see that file's ANCHOR comment).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
  },
});

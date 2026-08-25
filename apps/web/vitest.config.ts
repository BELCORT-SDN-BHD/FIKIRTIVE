import { defineConfig } from "vitest/config";
import path from "node:path";

// apps/web tests are integration-flavored: the resolver + isolation tests hit the
// LOCAL Postgres through the real Prisma client. Single-thread so the 2-org isolation
// test's seed/teardown can't interleave with another file's writes.
//
// #800 tried the obvious speed-up — split into `unit` (the ~216 files that mock Prisma,
// run in parallel) and `integration` (the ~58 that don't, still single-threaded) — and
// MEASURED IT SLOWER, so don't re-attempt it without new evidence. On the CI runner
// apps/web went 101.8s → 213.8s; every component inflated, not just contention:
// collect 25.5s → 85.2s, prepare 0.5s → 34.7s, environment 0.8s → 24.3s, tests 71.6s → 104.2s.
// The cost here is transforming this app's module graph, and one worker running every file
// transforms each module ONCE while N workers transform the shared graph up to N times.
// Same result on an 8-core laptop: 33s single-threaded, 35s at 8 threads, 40s at 4.
// The real lever is making the transform cheaper (deps.optimizer / fewer barrel imports),
// not spreading the same transform across more workers.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` throws in any non-Next.js runtime (including vitest/node).
      // Alias it to an empty stub so server-only-marked modules can be imported
      // in integration tests without a Next.js server context.
      "server-only": path.resolve(__dirname, "lib/__tests__/__stubs__/server-only.ts"),
      // next-auth imports `next/server` (without .js) which only resolves under
      // Next.js's own bundler/runtime. Stub it so vi.mock("@/auth", importOriginal)
      // can load auth.ts and re-export allowed()/isFounderAdmin().
      "next/server": path.resolve(__dirname, "lib/__tests__/__stubs__/next-server.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "lib/**/__tests__/**/*.test.ts", "app/**/__tests__/**/*.test.ts"],
    // F35: refuse to run against a real (non-*_test) DATABASE_URL — the integration tests hit
    // the real Prisma client, so a stray prod DATABASE_URL would mutate that database.
    // 两条都对 node 与 jsdom 两种环境生效(setupFiles 是逐测试文件跑的)。
    // setup-async-local-storage 必须留在这里而不是塞进某几个文件:它修的正是
    // 「跨文件共用一个 globalThis」这件事,见该文件头注释。
    setupFiles: ["./lib/__tests__/setup-db-guard.ts", "./lib/__tests__/setup-async-local-storage.ts"],
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 20000,
  },
});

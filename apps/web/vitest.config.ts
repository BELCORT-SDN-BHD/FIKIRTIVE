import { defineConfig } from "vitest/config";
import path from "node:path";

// apps/web tests are integration-flavored: the resolver + isolation tests hit the
// LOCAL Postgres through the real Prisma client. Single-thread so the 2-org isolation
// test's seed/teardown can't interleave with another file's writes.
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
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 20000,
  },
});

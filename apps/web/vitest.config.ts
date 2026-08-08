import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "node:path";

// apps/web has two kinds of test in one folder tree. A minority are integration tests:
// they hit LOCAL Postgres through the real Prisma client, so they must stay single-threaded
// (the 2-org isolation test's seed/teardown cannot interleave with another file's writes).
// The majority mock Prisma and touch no shared state at all.
//
// Until #800 the whole directory ran single-threaded so that minority could be safe, which
// meant ~230 mocked files queued behind ~40 database ones. Two projects instead:
//
//   unit         — parallel; DATABASE_URL is REMOVED from the environment (setup-no-db.ts)
//   integration  — single-threaded, keeps the real DATABASE_URL and the *_test guard
//
// Removing DATABASE_URL from the unit project is what makes the split safe rather than
// hopeful: if a test is classified as unit but actually reaches Prisma, the client throws
// "DATABASE_URL (or DATABASE_URL_POOLED) is not set" on first use. A misclassification is
// therefore a loud, deterministic failure — never a silent write into a shared database.

const alias = {
  "@": path.resolve(__dirname, "."),
  // `server-only` throws in any non-Next.js runtime (including vitest/node).
  // Alias it to an empty stub so server-only-marked modules can be imported
  // in integration tests without a Next.js server context.
  "server-only": path.resolve(__dirname, "lib/__tests__/__stubs__/server-only.ts"),
  // next-auth imports `next/server` (without .js) which only resolves under
  // Next.js's own bundler/runtime. Stub it so vi.mock("@/auth", importOriginal)
  // can load auth.ts and re-export allowed()/isFounderAdmin().
  "next/server": path.resolve(__dirname, "lib/__tests__/__stubs__/next-server.ts"),
};

/** Every file the previous single `include` matched: lib/**\/*.test.ts + app/**\/__tests__/**\/*.test.ts */
function collectTestFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.resolve(__dirname, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".next") walk(rel);
      } else if (entry.name.endsWith(".test.ts")) {
        found.push(rel);
      }
    }
  };
  walk("lib");
  walk("app");
  return found.filter((f) => f.startsWith("lib/") || f.includes("/__tests__/")).sort();
}

/**
 * A file is integration iff it can reach the real Prisma client: it names `@fikirtive/db`
 * and either does not `vi.mock` it, or mocks it through `importOriginal` (several files spy
 * on the REAL client rather than replacing it — auth-enumeration-structural.test.ts wraps
 * `actual.prisma.$extends`, which is as real a connection as no mock at all).
 *
 * Derived from the file rather than a hand-kept list so a new database test lands in the
 * right project the day it is written, and biased toward integration whenever it is unsure:
 * being wrong that way only costs a slot in the serial queue. `EXTRA_INTEGRATION` covers
 * what reading one file cannot see — a test reaching Prisma through a deeper import — and
 * the unit project's missing DATABASE_URL is what makes those surface as failures.
 */
const EXTRA_INTEGRATION: string[] = [];

function isIntegration(file: string): boolean {
  if (EXTRA_INTEGRATION.includes(file)) return true;
  const source = fs.readFileSync(path.resolve(__dirname, file), "utf8");
  const namesDb = /["']@fikirtive\/db["']/.test(source);
  if (!namesDb) return false;
  const mocksDb = /vi\.mock\(\s*["']@fikirtive\/db["']/.test(source);
  return !mocksDb || /importOriginal/.test(source);
}

const allTestFiles = collectTestFiles();
const integrationFiles = allTestFiles.filter(isIntegration);
const unitFiles = allTestFiles.filter((f) => !integrationFiles.includes(f));

const shared = {
  environment: "node" as const,
  testTimeout: 20000,
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          ...shared,
          name: "unit",
          include: unitFiles,
          // Deletes DATABASE_URL / DATABASE_URL_POOLED, then keeps the F35 *_test guard
          // in force for anything that stubs one back in.
          setupFiles: ["./lib/__tests__/setup-no-db.ts", "./lib/__tests__/setup-db-guard.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          ...shared,
          name: "integration",
          include: integrationFiles,
          // F35: refuse to run against a real (non-*_test) DATABASE_URL — these tests hit the
          // real Prisma client, so a stray prod DATABASE_URL would mutate that database.
          setupFiles: ["./lib/__tests__/setup-db-guard.ts"],
          pool: "threads",
          poolOptions: { threads: { singleThread: true } },
        },
      },
    ],
  },
});

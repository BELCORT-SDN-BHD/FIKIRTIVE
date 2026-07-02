/**
 * F35 — apps/web test DB safety guard (vitest setupFiles).
 *
 * Most apps/web tests mock Prisma and need no database, so an UNSET DATABASE_URL is fine. But
 * the integration-flavored tests (isolation.test.ts etc.) hit the real Prisma client — and
 * `pnpm test` with a real (non-_test) DATABASE_URL in the environment would upsert/delete in
 * that database. This refuses to run the suite when DATABASE_URL points at a database whose
 * name does not end in `_test`, mirroring packages/db/test/setup.ts (minus the truncation).
 */
const dbUrl = process.env.DATABASE_URL;
if (dbUrl) {
  const dbName = dbUrl.split("/").at(-1)?.split("?")[0] ?? "";
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `apps/web tests refuse to run against a non-*_test database — got "${dbName}". ` +
        `Unset DATABASE_URL (mocked tests need none) or point it at a *_test database.`,
    );
  }
}

/**
 * #800 — apps/web `unit` vitest project: no database, therefore parallel-safe.
 *
 * The unit project exists so ~230 Prisma-mocking test files stop queueing behind the ~40 that
 * really talk to Postgres. Running them in parallel is only safe if none of them can reach a
 * shared database — and the honest way to guarantee that is to take the database away rather
 * than to trust the classification in vitest.config.ts.
 *
 * With both URLs removed, `packages/db`'s client throws
 * "DATABASE_URL (or DATABASE_URL_POOLED) is not set" the first time anything touches Prisma.
 * So a file that belongs in the integration project fails loudly and deterministically on the
 * run that misplaces it, instead of quietly writing into another worker's test database.
 *
 * Fix for such a failure: add the file to `EXTRA_INTEGRATION` in apps/web/vitest.config.ts
 * (or mock `@fikirtive/db` in it, if it was never meant to hit the database).
 */
delete process.env.DATABASE_URL;
delete process.env.DATABASE_URL_POOLED;

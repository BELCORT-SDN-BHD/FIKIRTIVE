/**
 * What has to be true before the first journey runs (#799).
 *
 *   1. NOTHING THAT CAN SPEND IS CONFIGURED. A resident suite runs unattended, every night; a
 *      provider credential leaking into its environment would mean it generates for real and
 *      bills a merchant's workspace. Checked here, before a browser exists, and fatal.
 *   2. THE DATABASE IS THE SUITE'S OWN, AND IT IS EMPTY. The `_test` name check lives in
 *      support/env.ts and runs first; the truncate below is what makes a journey's assertions
 *      about counts and history mean anything. Leftovers from a previous run are the classic way
 *      a suite goes green on the wrong evidence.
 *
 * Deliberately NOT here: seeding. Each journey seeds its own workspace, so no journey can be made
 * to pass or fail by another journey's fixtures.
 */
import { e2eDatabaseUrl, PAID_PROVIDER_ENV_NAMES } from "./support/env.js";
import { prisma } from "./support/db.js";

async function truncateEverything(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) {
    throw new Error(
      "e2e: the database has no tables — run `pnpm --filter @fikirtive/db exec prisma migrate deploy` against it first.",
    );
  }
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export default async function globalSetup(): Promise<void> {
  const configured = PAID_PROVIDER_ENV_NAMES.filter((name) => (process.env[name] ?? "").trim() !== "");
  if (configured.length > 0) {
    throw new Error(
      `e2e: refusing to run with ${configured.join(", ")} in the environment. This suite must never be able to spend real money or send real mail; unset them and run again.`,
    );
  }
  e2eDatabaseUrl(); // name check, before anything is destroyed
  await truncateEverything();
  await prisma.$disconnect();
}

/**
 * Vitest setup for @artlio/db integration tests.
 *
 * Safety guard: refuses to run unless DATABASE_URL points to a *_test database.
 * beforeEach: truncates money tables so each test starts clean.
 */
import { beforeEach } from "vitest";
import { prisma } from "../src/index.js";

// ── Hard safety guard (MANDATORY) ──────────────────────────────────────────
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("db tests require a *_test DATABASE_URL — DATABASE_URL is not set");
}
const dbName = dbUrl.split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(
    `db tests require a *_test DATABASE_URL — got database "${dbName}". ` +
      `Set DATABASE_URL to a *_test database before running tests.`,
  );
}

// ── Per-test truncation ─────────────────────────────────────────────────────
beforeEach(async () => {
  // CASCADE handles FK deps. RESTART IDENTITY resets sequences (not strictly
  // needed for UUID/ULID PKs but keeps ledger row ordering deterministic).
  await prisma.$executeRawUnsafe(
    `TRUNCATE "CreditLedger", "CreditAccount", "Organization" RESTART IDENTITY CASCADE`,
  );
});

// ── Seed helper ─────────────────────────────────────────────────────────────
/**
 * Insert a minimal Organization + CreditAccount with the given starting balance.
 * Exported so individual test files can call it in beforeEach / within tests.
 */
export async function seedOrg(orgId: string, balanceInternal: number): Promise<void> {
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: balanceInternal, reserved: 0 } });
}

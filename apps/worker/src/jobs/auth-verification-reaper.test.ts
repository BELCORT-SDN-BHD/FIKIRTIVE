/**
 * #678 r3 — the expired-verification sweep, against the REAL table.
 *
 * A review found that nothing in the repository ever deleted `ba_verification` rows: Better Auth
 * consumes a token on a successful redemption, so what accumulates is precisely the tokens nobody
 * redeemed. Every other reaper in this folder is unit-tested against a mocked Prisma, which is
 * fine when the claim is about control flow. Here the claim is about a WHERE clause — "deletes
 * what has expired, keeps what has not" — and a mocked `deleteMany` can only prove that the mock
 * was called, so this one uses the real database.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@fikirtive/db";
import { reapExpiredAuthVerifications } from "./auth-verification-reaper.js";

// Same guard as apps/web's suite: never run this against a database that is not a test database.
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (process.env.DATABASE_URL && !dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const TAG = `p678-reaper-${randomUUID()}`;
const HOUR = 1000 * 60 * 60;
const row = (label: string, expiresAt: Date) => ({
  id: `${TAG}-${label}`,
  identifier: `${TAG}-${label}-token`,
  value: JSON.stringify({ email: `${TAG}@fikirtive.test`, label }),
  expiresAt,
});

const survivors = () =>
  prisma.betterAuthVerification
    .findMany({ where: { id: { startsWith: TAG } }, select: { id: true }, orderBy: { id: "asc" } })
    .then((rows) => rows.map((r) => r.id.replace(`${TAG}-`, "")));

beforeAll(async () => {
  const now = Date.now();
  await prisma.betterAuthVerification.createMany({
    data: [
      // Long gone — the ones that used to sit there forever.
      row("expired-a-week-ago", new Date(now - 7 * 24 * HOUR)),
      row("expired-two-days-ago", new Date(now - 48 * HOUR)),
      // Expired, but still inside the day of grace an operator might want to look at.
      row("expired-23-hours-ago", new Date(now - 23 * HOUR)),
      // Still live — a merchant may be walking to their inbox right now.
      row("valid-for-another-ten-minutes", new Date(now + 10 * 60 * 1000)),
      row("valid-for-another-day", new Date(now + 24 * HOUR)),
    ],
  });
});

describe("reapExpiredAuthVerifications", () => {
  it("deletes rows past the grace period and leaves live and recently-expired ones alone", async () => {
    const before = await survivors();
    expect(before).toHaveLength(5);

    const reaped = await reapExpiredAuthVerifications();
    expect(reaped).toBeGreaterThanOrEqual(2);

    expect(await survivors()).toEqual([
      "expired-23-hours-ago",
      "valid-for-another-day",
      "valid-for-another-ten-minutes",
    ]);
  });

  it("is a no-op on a second pass — nothing left to sweep is not an error", async () => {
    const remaining = await survivors();
    await reapExpiredAuthVerifications();
    expect(await survivors()).toEqual(remaining);
  });

  it("sweeps a row once its grace period has passed too", async () => {
    // The same table, asked two hours later: the row that was inside the grace window is not any
    // more, and the two live tokens are still untouched.
    const reaped = await reapExpiredAuthVerifications(new Date(Date.now() + 2 * HOUR));
    expect(reaped).toBeGreaterThanOrEqual(1);
    expect(await survivors()).toEqual([
      "valid-for-another-day",
      "valid-for-another-ten-minutes",
    ]);
  });
});

afterAll(async () => {
  await prisma.betterAuthVerification.deleteMany({ where: { id: { startsWith: TAG } } });
});

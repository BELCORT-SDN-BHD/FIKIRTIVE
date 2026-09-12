/**
 * #678 r3 — the expired-verification sweep, against the REAL table.
 *
 * A review found that nothing in the repository ever deleted `ba_verification` rows: Better Auth
 * consumes a token on a successful redemption, so what accumulates is precisely the tokens nobody
 * redeemed. Every other reaper in this folder is unit-tested against a mocked Prisma, which is
 * fine when the claim is about control flow. Here the claim is about a WHERE clause — "deletes
 * what has expired, keeps what has not" — and a mocked `deleteMany` can only prove that the mock
 * was called, so this one uses the real database.
 *
 * #1350 — TWO independent isolation layers, because `reapExpiredAuthVerifications`'s own
 * `deleteMany` (its whole job) is a full-table sweep with no per-caller scoping, and this suite
 * flaked in CI (#1345 r10, #1349 r2, #1364 r1 — reproduced with zero code changes, so some OTHER
 * concurrent writer, never pinned down, was sweeping this file's fixtures before its assertions
 * ran):
 *   1. TAG-prefixed ids + `survivors()` scoped to `id: { startsWith: TAG }` — every assertion in
 *      this file counts only rows THIS run created, never a table-wide count.
 *   2. ANCHOR: every fixture's `expiresAt` sits near this fixed year-2099 instant instead of real
 *      wall-clock time, and every call this file makes to `reapExpiredAuthVerifications` passes
 *      that same instant explicitly. The production cutoff is `now - 24h`; any OTHER caller uses
 *      the real `now` default (apps/worker's own reaper tick, or whatever the still-unidentified
 *      second caller turns out to be), whose cutoff sits in 2026 — decades before ANCHOR — so it
 *      can never match these rows' `expiresAt` and sweep them early. Only this file's own
 *      ANCHOR-relative calls ever touch them.
 * Layer 2 makes this file's fixtures immune to layer 1 even mattering; layer 1 stays as the
 * belt-and-suspenders the issue asked for, and is what keeps `survivors()` correct regardless.
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
// Fixed, far-future instant — see the #1350 paragraph above. Not derived from Date.now(): the
// whole point is that it shares no epoch with whatever "real now" a concurrent caller might use.
const ANCHOR = new Date("2099-01-01T00:00:00.000Z");
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
  const anchor = ANCHOR.getTime();
  await prisma.betterAuthVerification.createMany({
    data: [
      // Long gone — the ones that used to sit there forever.
      row("expired-a-week-ago", new Date(anchor - 7 * 24 * HOUR)),
      row("expired-two-days-ago", new Date(anchor - 48 * HOUR)),
      // Expired, but still inside the day of grace an operator might want to look at.
      row("expired-23-hours-ago", new Date(anchor - 23 * HOUR)),
      // Still live — a merchant may be walking to their inbox right now.
      row("valid-for-another-ten-minutes", new Date(anchor + 10 * 60 * 1000)),
      row("valid-for-another-day", new Date(anchor + 24 * HOUR)),
    ],
  });
});

describe("reapExpiredAuthVerifications", () => {
  it("deletes rows past the grace period and leaves live and recently-expired ones alone", async () => {
    const before = await survivors();
    expect(before).toHaveLength(5);

    const reaped = await reapExpiredAuthVerifications(ANCHOR);
    expect(reaped).toBeGreaterThanOrEqual(2);

    expect(await survivors()).toEqual([
      "expired-23-hours-ago",
      "valid-for-another-day",
      "valid-for-another-ten-minutes",
    ]);
  });

  it("is a no-op on a second pass — nothing left to sweep is not an error", async () => {
    const remaining = await survivors();
    await reapExpiredAuthVerifications(ANCHOR);
    expect(await survivors()).toEqual(remaining);
  });

  it("sweeps a row once its grace period has passed too", async () => {
    // The same table, asked two hours later: the row that was inside the grace window is not any
    // more, and the two live tokens are still untouched.
    const reaped = await reapExpiredAuthVerifications(new Date(ANCHOR.getTime() + 2 * HOUR));
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

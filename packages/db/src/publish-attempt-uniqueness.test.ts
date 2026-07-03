/**
 * Integration tests for PublishAttempt_one_applying_per_post — the partial unique
 * index (migration 20260703030000_schedule_data_model) that closes the schedule
 * double-publish race (spec §六): before publishing, the worker inserts
 * PublishAttempt(state='APPLYING'); two workers racing the same post both try to
 * claim, but the partial UNIQUE index (scheduledPostId) WHERE state='APPLYING'
 * lets at most one insert win — the second fails P2002 and skips, mirroring the
 * gen worker's fail-closed claim.
 *
 * Runs against a real *_test Postgres (enforced by test/setup.ts) with migrations
 * deployed, so these tests exercise the REAL partial index — including its WHERE
 * state='APPLYING' predicate (APPLIED / FAILED rows are outside the index and stay
 * distinct, and a different post is a distinct index key).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./index.js";

const ORG = "pa-uniq-org";
const POST_A = "pa-uniq-post-a";
const POST_B = "pa-uniq-post-b";

async function seedFixtures(): Promise<void> {
  await prisma.organization.create({ data: { id: ORG } });
  await prisma.scheduledPost.create({
    data: {
      id: POST_A,
      ownerId: ORG,
      projectId: ORG,
      channel: "instagram",
      caption: "post a",
      scheduledAt: new Date(),
      scheduledTz: "Asia/Kuala_Lumpur",
      source: "owner",
    },
  });
  await prisma.scheduledPost.create({
    data: {
      id: POST_B,
      ownerId: ORG,
      projectId: ORG,
      channel: "instagram",
      caption: "post b",
      scheduledAt: new Date(),
      scheduledTz: "Asia/Kuala_Lumpur",
      source: "owner",
    },
  });
}

function createAttempt(id: string, scheduledPostId: string, state: string) {
  return prisma.publishAttempt.create({ data: { id, scheduledPostId, state } });
}

beforeEach(async () => {
  await seedFixtures();
});

describe("PublishAttempt one-APPLYING-per-post index", () => {
  it("rejects a second APPLYING claim on the same post with P2002 (anti-double-publish)", async () => {
    // Two workers race to claim the same due post. The first insert wins; the
    // partial UNIQUE index makes the second fail so exactly one worker publishes.
    await createAttempt("pa1", POST_A, "APPLYING");
    await expect(createAttempt("pa2", POST_A, "APPLYING")).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows an APPLYING claim on a different post (distinct index key)", async () => {
    await createAttempt("pa1", POST_A, "APPLYING");
    await expect(createAttempt("pa2", POST_B, "APPLYING")).resolves.toMatchObject({ id: "pa2" });
  });

  it("does NOT block a new APPLYING after the prior attempt left APPLYING (partial WHERE)", async () => {
    // The predicate is WHERE state='APPLYING': a settled (APPLIED / FAILED) attempt
    // falls out of the index, so a fresh retry can claim the post again.
    await createAttempt("pa1", POST_A, "FAILED");
    await expect(createAttempt("pa2", POST_A, "APPLYING")).resolves.toMatchObject({ id: "pa2" });
  });

  it("allows multiple non-APPLYING attempts for the same post (outside the partial index)", async () => {
    await createAttempt("pa1", POST_A, "APPLIED");
    await createAttempt("pa2", POST_A, "FAILED");
    await expect(createAttempt("pa3", POST_A, "FAILED")).resolves.toMatchObject({ id: "pa3" });
  });
});

/**
 * AR2 处方1 — the PRECISE TOCTOU interleaving, welded shut:
 *
 *   t1  ottoApprove verifies the card's content hash against post content A
 *       (updatedAt = T1) and captures T1 as the consent snapshot.
 *   t2  BEFORE the resume's re-read, a material edit lands → post content B
 *       (updatedAt = T2 ≠ T1).
 *   t3  the resumed skill calls approveScheduledPost with the THREADED
 *       expectedUpdatedAt = T1. The action re-reads (sees B) and validates B,
 *       but its CAS WHERE pins T1 — zero rows match → HARD refuse.
 *
 * The old card can never approve content B. The human UI path (no opts) keeps
 * the existing fresh-read CAS byte-for-byte (regression pin below).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRequireOwner,
  mockScheduledPostFindFirst,
  mockScheduledPostUpdateMany,
  mockPublishAttemptFindFirst,
  mockGenerationFindMany,
  mockListTargets,
} = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockScheduledPostFindFirst: vi.fn(),
  mockScheduledPostUpdateMany: vi.fn(),
  mockPublishAttemptFindFirst: vi.fn(),
  mockGenerationFindMany: vi.fn(),
  mockListTargets: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: () => Promise.resolve(false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/channels/registry", () => ({
  channelRegistry: { instagram: { id: "instagram", listTargets: mockListTargets } },
}));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    scheduledPost: { findFirst: mockScheduledPostFindFirst, updateMany: mockScheduledPostUpdateMany },
    publishAttempt: { findFirst: mockPublishAttemptFindFirst },
    generation: { findMany: mockGenerationFindMany },
  },
}));

const { approveScheduledPost } = await import("@/lib/schedule-actions");

const OWNER_ID = "owner_toctou";
const POST_ID = "post_toctou_1";
const T1 = new Date("2026-07-12T10:00:00.000Z"); // hash-verification snapshot (content A)
const T2 = new Date("2026-07-12T10:00:05.000Z"); // after the material edit (content B)

/** What the action's own re-read sees at t3 — content B, already edited. */
function postB() {
  return {
    id: POST_ID,
    status: "DRAFT",
    channel: "instagram",
    metaTargetId: "tgt_1",
    updatedAt: T2,
    media: [{ generationId: "g1" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER_ID });
  mockPublishAttemptFindFirst.mockResolvedValue(null);
  mockGenerationFindMany.mockResolvedValue([{ id: "g1", asset: { mime: "image/jpeg" } }]);
  mockListTargets.mockResolvedValue({ targets: [{ id: "tgt_1", name: "My IG" }] });
  mockScheduledPostFindFirst.mockResolvedValue(postB());
  // The DB truth: WHERE updatedAt=T1 matches NOTHING because the row is at T2.
  mockScheduledPostUpdateMany.mockImplementation((args: { where: { updatedAt?: Date } }) =>
    Promise.resolve({ count: args.where.updatedAt?.getTime() === T2.getTime() ? 1 : 0 }),
  );
});

describe("approveScheduledPost — AR2 处方1 TOCTOU weld (expectedUpdatedAt pass-through)", () => {
  it("the exact interleave: hash verified on A (T1) → material edit → resume re-reads B — the old card CANNOT approve B", async () => {
    const res = await approveScheduledPost(POST_ID, { expectedUpdatedAt: T1.toISOString() });

    // The CAS WHERE pinned the THREADED hash-time snapshot (T1), not the fresh re-read (T2).
    expect(mockScheduledPostUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ updatedAt: T1 }) }),
    );
    // Zero rows matched → hard refuse; nothing was approved.
    expect(res).toEqual({ error: "This post changed since Otto asked — review it and ask Otto to request approval again." });
  });

  it("no interleave (post untouched since hash check): the threaded snapshot equals the row → approve succeeds", async () => {
    mockScheduledPostFindFirst.mockResolvedValue({ ...postB(), updatedAt: T1 });
    mockScheduledPostUpdateMany.mockImplementation((args: { where: { updatedAt?: Date } }) =>
      Promise.resolve({ count: args.where.updatedAt?.getTime() === T1.getTime() ? 1 : 0 }),
    );

    const res = await approveScheduledPost(POST_ID, { expectedUpdatedAt: T1.toISOString() });

    expect(res).toEqual({ ok: true });
    expect(mockScheduledPostUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ updatedAt: T1 }),
        data: expect.objectContaining({ status: "SCHEDULED", approvedAt: expect.any(Date) }),
      }),
    );
  });

  it("human UI regression pin: with NO opts the CAS pins this call's own fresh read (existing behavior, untouched)", async () => {
    const res = await approveScheduledPost(POST_ID);

    expect(mockScheduledPostUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ updatedAt: T2 }) }),
    );
    expect(res).toEqual({ ok: true });
  });

  it("a malformed expectedUpdatedAt is refused before any read or write", async () => {
    const res = await approveScheduledPost(POST_ID, { expectedUpdatedAt: "not-a-date" });
    expect(res).toEqual({ error: "Invalid request." });
    expect(mockScheduledPostFindFirst).not.toHaveBeenCalled();
    expect(mockScheduledPostUpdateMany).not.toHaveBeenCalled();
  });
});

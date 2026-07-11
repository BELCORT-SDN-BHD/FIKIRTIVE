import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — mirror brand-record-actions.test.ts style (vi.hoisted + vi.mock).
// requireOwner resolves the SESSION owner; the db mock exposes only the
// scheduledPost methods the actions use; fetchOwnerPages is the owner-scoped
// source of valid publish targets (reads the owner's own MetaConnection), so
// approve's metaTargetId ownership check is asserted against it.
// ---------------------------------------------------------------------------
const {
  mockRequireOwner,
  mockIsImpersonating,
  mockTransaction,
  mockFindMany,
  mockFindFirst,
  mockCreate,
  mockUpdateMany,
  mockMediaDeleteMany,
  mockMediaCreateMany,
  mockGenFindMany,
  mockFetchOwnerPages,
  mockIgListTargets,
  mockFbListTargets,
} = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockIsImpersonating: vi.fn(),
  mockTransaction: vi.fn(),
  mockFindMany: vi.fn(),
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockMediaDeleteMany: vi.fn(),
  mockMediaCreateMany: vi.fn(),
  mockGenFindMany: vi.fn(),
  mockFetchOwnerPages: vi.fn(),
  mockIgListTargets: vi.fn(),
  mockFbListTargets: vi.fn(),
}));

// createScheduledPost now delegates to schedule-service.ts, which is `import "server-only"`.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    $transaction: mockTransaction,
    scheduledPost: {
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      create: mockCreate,
      updateMany: mockUpdateMany,
    },
    scheduledPostMedia: {
      deleteMany: mockMediaDeleteMany,
      createMany: mockMediaCreateMany,
    },
    generation: { findMany: mockGenFindMany },
  },
}));
vi.mock("../meta-pages", () => ({ fetchOwnerPages: mockFetchOwnerPages }));
// listOwnerTargets walks the channel registry — mock its two adapters' listTargets.
vi.mock("../channels/registry", () => ({
  channelRegistry: {
    instagram: { id: "instagram", listTargets: mockIgListTargets },
    facebook: { id: "facebook", listTargets: mockFbListTargets },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// newId: deterministic so created ids are predictable in assertions.
let idCounter = 0;
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: () => `new-${++idCounter}`,
}));

import {
  createScheduledPost,
  updateScheduledPost,
  approveScheduledPost,
  cancelScheduledPost,
  listScheduledPosts,
  listOwnerTargets,
} from "../schedule-actions";
import { IG_IMAGE_ONLY_ERROR } from "../schedule-service";

const OWNER = "o1";
const AT = "2026-07-10T09:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER, email: "a@b.co" });
  mockIsImpersonating.mockResolvedValue(false); // default: a real owner session, not staff-impersonating
  mockFetchOwnerPages.mockResolvedValue({ pages: [{ id: "page-1", name: "My Page" }] });
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      scheduledPost: { updateMany: mockUpdateMany },
      scheduledPostMedia: { deleteMany: mockMediaDeleteMany, createMany: mockMediaCreateMany },
    }),
  );
  // Default: every requested media id is owned and is an image (echo the queried ids back).
  // Cross-tenant tests override this to return only the owned subset; IG media-contract tests
  // override the asset mime to a non-image type.
  mockGenFindMany.mockImplementation(async (args: { where: { id: { in: string[] } } }) =>
    args.where.id.in.map((id) => ({ id, asset: { mime: "image/png" } })),
  );
  mockIgListTargets.mockResolvedValue([{ id: "page-1", name: "My Page" }]);
  mockFbListTargets.mockResolvedValue([{ id: "page-1", name: "My Page" }]);
});

// --- createScheduledPost ----------------------------------------------------

describe("createScheduledPost", () => {
  it("creates an owner-scoped DRAFT with source owner, approvedAt null, ordered media", async () => {
    mockCreate.mockResolvedValue({});
    const res = await createScheduledPost({
      channel: "instagram",
      caption: "Hello world",
      scheduledAt: AT,
      scheduledTz: "Asia/Kuala_Lumpur",
      media: ["gen-a", "gen-b"],
      firstComment: "first!",
      metaTargetId: "page-1",
    });
    expect(res).toEqual({ ok: true, id: "new-1" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      id: "new-1",
      ownerId: OWNER, // from SESSION, never the client
      channel: "instagram",
      caption: "Hello world",
      firstComment: "first!",
      scheduledTz: "Asia/Kuala_Lumpur",
      status: "DRAFT",
      source: "owner",
      approvedAt: null,
      metaTargetId: "page-1",
    });
    expect(data.scheduledAt).toEqual(new Date(AT));
    // media rows carousel-ordered by position
    expect(data.media.create).toEqual([
      { id: "new-2", generationId: "gen-a", position: 0 },
      { id: "new-3", generationId: "gen-b", position: 1 },
    ]);
  });

  it("ignores any client-supplied ownerId — always uses the session owner", async () => {
    mockCreate.mockResolvedValue({});
    await createScheduledPost({
      channel: "facebook",
      caption: "x",
      scheduledAt: AT,
      scheduledTz: "UTC",
      ownerId: "attacker-org",
    } as unknown as Parameters<typeof createScheduledPost>[0]);
    expect(mockCreate.mock.calls[0][0].data.ownerId).toBe(OWNER);
  });

  it("defaults metaTargetId to null and media to none when omitted", async () => {
    mockCreate.mockResolvedValue({});
    await createScheduledPost({ channel: "facebook", caption: "x", scheduledAt: AT, scheduledTz: "UTC" });
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.metaTargetId).toBeNull();
    expect(data.firstComment).toBeNull();
    expect(data.media).toBeUndefined();
  });

  it("rejects an unknown channel, writes nothing", async () => {
    const res = await createScheduledPost({ channel: "tiktok", caption: "x", scheduledAt: AT, scheduledTz: "UTC" } as never);
    expect(res).toHaveProperty("error");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an empty caption, writes nothing", async () => {
    const res = await createScheduledPost({ channel: "instagram", caption: "   ", scheduledAt: AT, scheduledTz: "UTC" });
    expect(res).toHaveProperty("error");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an invalid scheduledAt, writes nothing", async () => {
    const res = await createScheduledPost({ channel: "instagram", caption: "x", scheduledAt: "not-a-date", scheduledTz: "UTC" });
    expect(res).toHaveProperty("error");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects more than 10 media (carousel cap), writes nothing", async () => {
    const res = await createScheduledPost({
      channel: "instagram", caption: "x", scheduledAt: AT, scheduledTz: "UTC",
      media: Array.from({ length: 11 }, (_, i) => `g${i}`),
    });
    expect(res).toHaveProperty("error");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("unauthenticated → error, no DB write", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await createScheduledPost({ channel: "instagram", caption: "x", scheduledAt: AT, scheduledTz: "UTC" });
    expect(res).toEqual({ error: "Not authorized." });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("validates media ids belong to the session owner (owner-scoped, live rows)", async () => {
    mockCreate.mockResolvedValue({});
    await createScheduledPost({
      channel: "instagram", caption: "x", scheduledAt: AT, scheduledTz: "UTC",
      media: ["gen-a", "gen-b"],
    });
    expect(mockGenFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["gen-a", "gen-b"] }, ownerId: OWNER, deletedAt: null },
      select: { id: true, asset: { select: { mime: true } } },
    });
  });

  it("rejects the create when ANY media id isn't the owner's, writes nothing", async () => {
    // Only gen-a is owned; gen-foreign belongs to another org → whole create rejected.
    mockGenFindMany.mockResolvedValue([{ id: "gen-a" }]);
    const res = await createScheduledPost({
      channel: "instagram", caption: "x", scheduledAt: AT, scheduledTz: "UTC",
      media: ["gen-a", "gen-foreign"],
    });
    expect(res).toHaveProperty("error");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("does not query generations when no media is attached", async () => {
    mockCreate.mockResolvedValue({});
    await createScheduledPost({ channel: "facebook", caption: "x", scheduledAt: AT, scheduledTz: "UTC" });
    expect(mockGenFindMany).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects an Instagram draft whose media isn't an image (mime contract), writes nothing", async () => {
    mockGenFindMany.mockResolvedValue([{ id: "gen-a", asset: { mime: "video/mp4" } }]);
    const res = await createScheduledPost({
      channel: "instagram", caption: "x", scheduledAt: AT, scheduledTz: "UTC",
      media: ["gen-a"],
    });
    expect(res).toEqual({ error: IG_IMAGE_ONLY_ERROR });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("allows an Instagram draft whose media is an image", async () => {
    mockCreate.mockResolvedValue({});
    mockGenFindMany.mockResolvedValue([{ id: "gen-a", asset: { mime: "image/png" } }]);
    const res = await createScheduledPost({
      channel: "instagram", caption: "x", scheduledAt: AT, scheduledTz: "UTC",
      media: ["gen-a"],
    });
    expect(res).toEqual({ ok: true, id: "new-1" });
  });

  it("does not apply the Instagram image-only contract to Facebook drafts", async () => {
    mockCreate.mockResolvedValue({});
    mockGenFindMany.mockResolvedValue([{ id: "gen-a", asset: { mime: "video/mp4" } }]);
    const res = await createScheduledPost({
      channel: "facebook", caption: "x", scheduledAt: AT, scheduledTz: "UTC",
      media: ["gen-a"],
    });
    expect(res).toEqual({ ok: true, id: "new-1" });
  });
});

// --- updateScheduledPost ----------------------------------------------------

describe("updateScheduledPost", () => {
  it("patches caption/scheduledAt on a DRAFT — atomic WHERE pins the read status", async () => {
    mockFindFirst.mockResolvedValue({ status: "DRAFT", channel: "instagram", firstComment: null });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const res = await updateScheduledPost("p1", { caption: "new", scheduledAt: AT });
    expect(res).toEqual({ ok: true });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "p1", ownerId: OWNER, deletedAt: null, status: "DRAFT" },
      data: { caption: "new", scheduledAt: new Date(AT) },
    });
  });

  it("replaces media rows in order when editing a DRAFT, after owner-scoped media validation", async () => {
    mockFindFirst.mockResolvedValue({ status: "DRAFT", channel: "instagram", firstComment: null });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const res = await updateScheduledPost("p1", { media: ["gen-b", "gen-a"] });
    expect(res).toEqual({ ok: true });
    expect(mockGenFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["gen-b", "gen-a"] }, ownerId: OWNER, deletedAt: null },
      select: { id: true },
    });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "p1", ownerId: OWNER, deletedAt: null, status: "DRAFT" },
      data: { updatedAt: expect.any(Date) },
    });
    expect(mockMediaDeleteMany).toHaveBeenCalledWith({ where: { scheduledPostId: "p1" } });
    expect(mockMediaCreateMany).toHaveBeenCalledWith({
      data: [
        { id: "new-1", scheduledPostId: "p1", generationId: "gen-b", position: 0 },
        { id: "new-2", scheduledPostId: "p1", generationId: "gen-a", position: 1 },
      ],
    });
  });

  it("rejects media replacement when any selected media is foreign, writes nothing", async () => {
    mockFindFirst.mockResolvedValue({ status: "DRAFT", channel: "instagram", firstComment: null });
    mockGenFindMany.mockResolvedValue([{ id: "gen-a" }]);
    const res = await updateScheduledPost("p1", { media: ["gen-a", "foreign"] });
    expect(res).toHaveProperty("error");
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockMediaDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects a media replacement over the selected channel cap, writes nothing", async () => {
    mockFindFirst.mockResolvedValue({ status: "DRAFT", channel: "facebook", firstComment: null });
    const res = await updateScheduledPost("p1", { media: ["gen-a", "gen-b"] });
    expect(res).toHaveProperty("error");
    expect(mockGenFindMany).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("lets a channel edit enforce the new channel cap before saving media", async () => {
    mockFindFirst.mockResolvedValue({ status: "DRAFT", channel: "instagram", firstComment: "tags" });
    const res = await updateScheduledPost("p1", { channel: "facebook", media: ["gen-a", "gen-b"] });
    expect(res).toHaveProperty("error");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects a channel edit when existing media exceeds the new channel cap", async () => {
    mockFindFirst.mockResolvedValue({
      status: "DRAFT",
      channel: "instagram",
      firstComment: null,
      media: [{ generationId: "gen-a" }, { generationId: "gen-b" }],
    });
    const res = await updateScheduledPost("p1", { channel: "facebook" });
    expect(res).toHaveProperty("error");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("cannot touch another owner's post — status load misses → not found, no write", async () => {
    mockFindFirst.mockResolvedValue(null); // owner-scoped status load misses the foreign row
    const res = await updateScheduledPost("someone-elses", { caption: "hijack" });
    expect(res).toHaveProperty("error");
    // the status load is always owner-scoped (isolation enforced at the query)
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "someone-elses", ownerId: OWNER, deletedAt: null } }),
    );
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("re-consent gate: a MATERIAL edit to a SCHEDULED post resets it to DRAFT + clears approvedAt", async () => {
    mockFindFirst.mockResolvedValue({ status: "SCHEDULED", channel: "instagram", firstComment: null });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const res = await updateScheduledPost("p1", { caption: "changed my mind" });
    expect(res).toEqual({ ok: true });
    const call = mockUpdateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "p1", ownerId: OWNER, deletedAt: null, status: "SCHEDULED" });
    expect(call.data).toMatchObject({ caption: "changed my mind", status: "DRAFT", approvedAt: null });
  });

  it("a NON-material edit (scheduledTz only) to a SCHEDULED post keeps it SCHEDULED", async () => {
    mockFindFirst.mockResolvedValue({ status: "SCHEDULED", channel: "instagram", firstComment: null });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const res = await updateScheduledPost("p1", { scheduledTz: "UTC" });
    expect(res).toEqual({ ok: true });
    const call = mockUpdateMany.mock.calls[0][0];
    expect(call.data).toEqual({ scheduledTz: "UTC" });
    expect(call.data.status).toBeUndefined();
    expect(call.data.approvedAt).toBeUndefined();
  });

  it("refuses to edit a terminal / publishing / failed post server-side (status, not just the UI)", async () => {
    for (const status of ["PUBLISHED", "PUBLISHING", "CANCELLED", "FAILED", "NEEDS_ATTENTION"]) {
      vi.clearAllMocks();
      mockRequireOwner.mockResolvedValue({ ownerId: OWNER, email: "a@b.co" });
      mockFindFirst.mockResolvedValue({ status, channel: "instagram" });
      const res = await updateScheduledPost("p1", { caption: "too late" });
      expect(res, `status=${status}`).toHaveProperty("error");
      expect(mockUpdateMany, `status=${status}`).not.toHaveBeenCalled();
    }
  });

  it("treats a lost CAS (count===0) as a stale conflict, not success", async () => {
    mockFindFirst.mockResolvedValue({ status: "DRAFT", channel: "instagram" });
    mockUpdateMany.mockResolvedValue({ count: 0 }); // a concurrent approve/cancel moved the row
    const res = await updateScheduledPost("p1", { caption: "race" });
    expect(res).toHaveProperty("error");
  });

  it("rejects a first comment on a channel that doesn't support it (Facebook), no write", async () => {
    mockFindFirst.mockResolvedValue({ status: "DRAFT", channel: "facebook", firstComment: null });
    const res = await updateScheduledPost("p1", { firstComment: "nope on FB" });
    expect(res).toHaveProperty("error");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an empty patch on an editable post, writes nothing", async () => {
    mockFindFirst.mockResolvedValue({ status: "DRAFT", channel: "instagram", firstComment: null });
    const res = await updateScheduledPost("p1", {});
    expect(res).toHaveProperty("error");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a caption that is only whitespace, writes nothing", async () => {
    mockFindFirst.mockResolvedValue({ status: "DRAFT", channel: "instagram", firstComment: null });
    const res = await updateScheduledPost("p1", { caption: "   " });
    expect(res).toHaveProperty("error");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a naive scheduledAt edit with no timezone designator, writes nothing", async () => {
    mockFindFirst.mockResolvedValue({ status: "DRAFT", channel: "instagram", firstComment: null });
    const res = await updateScheduledPost("p1", { scheduledAt: "2026-07-10T09:00:00" });
    expect(res).toHaveProperty("error");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid scheduledTz edit, writes nothing", async () => {
    mockFindFirst.mockResolvedValue({ status: "DRAFT", channel: "instagram", firstComment: null });
    const res = await updateScheduledPost("p1", { scheduledTz: "Mars/Phobos" });
    expect(res).toHaveProperty("error");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("unauthenticated → error, no DB read/write", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await updateScheduledPost("p1", { caption: "x" });
    expect(res).toEqual({ error: "Not authorized." });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

// --- approveScheduledPost ---------------------------------------------------

/** A DRAFT owned by OWNER with a valid target + one media row (approve-ready). */
function draftReady(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p1",
    ownerId: OWNER,
    status: "DRAFT",
    channel: "instagram",
    metaTargetId: "page-1",
    media: [{ id: "m1", generationId: "gen-a" }],
    ...over,
  };
}

describe("approveScheduledPost", () => {
  it("approves a ready DRAFT: status SCHEDULED + approvedAt, atomic WHERE pins the read status", async () => {
    mockFindFirst.mockResolvedValue(draftReady());
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const res = await approveScheduledPost("p1");
    expect(res).toEqual({ ok: true });
    // load is owner-scoped + excludes soft-deleted
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1", ownerId: OWNER, deletedAt: null } }),
    );
    // validated the target against the owner's own connected targets for this post's channel
    expect(mockIgListTargets).toHaveBeenCalledWith(OWNER);
    // write sets both fields, owner-scoped, and CAS-pins the status we validated
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const call = mockUpdateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "p1", ownerId: OWNER, deletedAt: null, status: "DRAFT" });
    expect(call.data.status).toBe("SCHEDULED");
    expect(call.data.approvedAt).toBeInstanceOf(Date);
  });

  it("treats a lost CAS (count===0) as a stale conflict — never resurrects a cancelled post", async () => {
    mockFindFirst.mockResolvedValue(draftReady()); // read as DRAFT...
    mockUpdateMany.mockResolvedValue({ count: 0 }); // ...but a concurrent cancel already moved it
    const res = await approveScheduledPost("p1");
    expect(res).toHaveProperty("error");
  });

  it("cannot approve another owner's post — not found under owner scope → error, no write", async () => {
    mockFindFirst.mockResolvedValue(null); // owner-scoped load misses the foreign row
    const res = await approveScheduledPost("someone-elses");
    expect(res).toHaveProperty("error");
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "someone-elses", ownerId: OWNER, deletedAt: null } }),
    );
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects when metaTargetId is null (no resolved target), no write", async () => {
    mockFindFirst.mockResolvedValue(draftReady({ metaTargetId: null }));
    const res = await approveScheduledPost("p1");
    expect(res).toHaveProperty("error");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects when metaTargetId does NOT belong to the owner's connected pages, no write", async () => {
    mockFindFirst.mockResolvedValue(draftReady({ metaTargetId: "not-mine" }));
    const res = await approveScheduledPost("p1");
    expect(res).toHaveProperty("error");
    expect(mockIgListTargets).toHaveBeenCalledWith(OWNER);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects when the owner has no connected channel (fetchOwnerPages notConnected), no write", async () => {
    mockFindFirst.mockResolvedValue(draftReady());
    mockIgListTargets.mockResolvedValue([]);
    const res = await approveScheduledPost("p1");
    expect(res).toHaveProperty("error");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("validates approval against the post channel's own target adapter", async () => {
    mockFindFirst.mockResolvedValue(draftReady({ channel: "facebook" }));
    mockIgListTargets.mockResolvedValue([{ id: "page-1", name: "IG Page" }]);
    mockFbListTargets.mockResolvedValue([{ id: "page-1", name: "FB Page" }]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    expect(await approveScheduledPost("p1")).toEqual({ ok: true });
    expect(mockFbListTargets).toHaveBeenCalledWith(OWNER);
    expect(mockIgListTargets).not.toHaveBeenCalled();
  });

  it("rejects when an Instagram post has no media rows, with the image-only message, no write", async () => {
    mockFindFirst.mockResolvedValue(draftReady({ media: [] }));
    const res = await approveScheduledPost("p1");
    expect(res).toEqual({ error: "Add at least one image before approving." });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects when a Facebook post has no media rows, with the image-or-video message, no write", async () => {
    mockFindFirst.mockResolvedValue(draftReady({ channel: "facebook", media: [] }));
    const res = await approveScheduledPost("p1");
    expect(res).toEqual({ error: "Add at least one image or video before approving." });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects when a queued media row no longer belongs to the owner, no write", async () => {
    mockFindFirst.mockResolvedValue(draftReady({ media: [{ id: "m1", generationId: "gen-a" }] }));
    mockGenFindMany.mockResolvedValue([]);
    const res = await approveScheduledPost("p1");
    expect(res).toHaveProperty("error");
    expect(mockGenFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["gen-a"] }, ownerId: OWNER, deletedAt: null },
      select: { id: true, asset: { select: { mime: true } } },
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects approving an Instagram post whose media isn't an image (mime contract), no write", async () => {
    mockFindFirst.mockResolvedValue(draftReady());
    mockGenFindMany.mockResolvedValue([{ id: "gen-a", asset: { mime: "video/mp4" } }]);
    const res = await approveScheduledPost("p1");
    expect(res).toEqual({ error: IG_IMAGE_ONLY_ERROR });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("approves an Instagram post whose media is an image", async () => {
    mockFindFirst.mockResolvedValue(draftReady());
    mockGenFindMany.mockResolvedValue([{ id: "gen-a", asset: { mime: "image/jpeg" } }]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const res = await approveScheduledPost("p1");
    expect(res).toEqual({ ok: true });
  });

  it("does not apply the Instagram image-only contract to Facebook approvals", async () => {
    mockFindFirst.mockResolvedValue(draftReady({ channel: "facebook" }));
    mockGenFindMany.mockResolvedValue([{ id: "gen-a", asset: { mime: "video/mp4" } }]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const res = await approveScheduledPost("p1");
    expect(res).toEqual({ ok: true });
  });

  it("rejects approval when existing media exceeds the channel cap, no write", async () => {
    mockFindFirst.mockResolvedValue(draftReady({
      channel: "facebook",
      media: [{ generationId: "gen-a" }, { generationId: "gen-b" }],
    }));
    const res = await approveScheduledPost("p1");
    expect(res).toHaveProperty("error");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an illegal state transition (already PUBLISHED — terminal), no write", async () => {
    mockFindFirst.mockResolvedValue(draftReady({ status: "PUBLISHED" }));
    const res = await approveScheduledPost("p1");
    expect(res).toHaveProperty("error");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("unauthenticated → error, no DB read/write", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await approveScheduledPost("p1");
    expect(res).toEqual({ error: "Not authorized." });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

// --- cancelScheduledPost ----------------------------------------------------

describe("cancelScheduledPost", () => {
  it("cancels a DRAFT: status CANCELLED, owner-scoped, atomic WHERE pins the read status", async () => {
    mockFindFirst.mockResolvedValue({ id: "p1", ownerId: OWNER, status: "DRAFT" });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const res = await cancelScheduledPost("p1");
    expect(res).toEqual({ ok: true });
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1", ownerId: OWNER, deletedAt: null } }),
    );
    const call = mockUpdateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "p1", ownerId: OWNER, deletedAt: null, status: "DRAFT" });
    expect(call.data).toEqual({ status: "CANCELLED" });
  });

  it("cancels a SCHEDULED post too (legal transition)", async () => {
    mockFindFirst.mockResolvedValue({ id: "p1", ownerId: OWNER, status: "SCHEDULED" });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    expect(await cancelScheduledPost("p1")).toEqual({ ok: true });
  });

  it("treats a lost CAS (count===0) as a stale conflict, not success", async () => {
    mockFindFirst.mockResolvedValue({ id: "p1", ownerId: OWNER, status: "DRAFT" });
    mockUpdateMany.mockResolvedValue({ count: 0 }); // a concurrent publish/approve moved the row
    const res = await cancelScheduledPost("p1");
    expect(res).toHaveProperty("error");
  });

  it("cannot cancel another owner's post — not found under owner scope → error, no write", async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await cancelScheduledPost("someone-elses");
    expect(res).toHaveProperty("error");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects cancelling a terminal post (PUBLISHED), no write", async () => {
    mockFindFirst.mockResolvedValue({ id: "p1", ownerId: OWNER, status: "PUBLISHED" });
    const res = await cancelScheduledPost("p1");
    expect(res).toHaveProperty("error");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("unauthenticated → error, no DB read/write", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await cancelScheduledPost("p1");
    expect(res).toEqual({ error: "Not authorized." });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

// --- impersonation block (H3) ----------------------------------------------
// Staff impersonating a customer must never MUTATE the customer's schedule. approve in particular
// would forge the tenant's consent to a real, irreversible external publish (spec §五). Every
// mutation refuses BEFORE any DB write; approve refuses BEFORE any Meta target lookup (zero Meta).

describe("schedule mutations refuse while impersonating a customer", () => {
  beforeEach(() => {
    mockIsImpersonating.mockResolvedValue(true); // staff is impersonating for these cases
  });

  it("approve → refuses with ZERO Meta calls and no DB read/write", async () => {
    // Even a fully approve-ready post must not go out under an impersonation session.
    mockFindFirst.mockResolvedValue(draftReady());
    const res = await approveScheduledPost("p1");
    expect(res).toEqual({ error: "Paused while impersonating a customer — exit impersonation to do this." });
    // zero Meta: neither channel adapter's listTargets was consulted
    expect(mockIgListTargets).not.toHaveBeenCalled();
    expect(mockFbListTargets).not.toHaveBeenCalled();
    // guard is BEFORE the owner-scoped read + the CAS write
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("create → refuses, writes nothing", async () => {
    const res = await createScheduledPost({ channel: "instagram", caption: "x", scheduledAt: AT, scheduledTz: "UTC" });
    expect(res).toHaveProperty("error");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("update → refuses, no read or write", async () => {
    const res = await updateScheduledPost("p1", { caption: "x" });
    expect(res).toHaveProperty("error");
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("cancel → refuses, no read or write", async () => {
    const res = await cancelScheduledPost("p1");
    expect(res).toHaveProperty("error");
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

// --- listScheduledPosts -----------------------------------------------------

describe("listScheduledPosts", () => {
  it("lists owner-scoped, excludes deletedAt, ordered by scheduledAt asc", async () => {
    mockFindMany.mockResolvedValue([]);
    await listScheduledPosts();
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: OWNER, deletedAt: null },
        orderBy: { scheduledAt: "asc" },
      }),
    );
  });

  it("applies a scheduledAt range when given (owner scope preserved)", async () => {
    mockFindMany.mockResolvedValue([]);
    await listScheduledPosts({ from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T00:00:00.000Z" });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId: OWNER,
          deletedAt: null,
          scheduledAt: { gte: new Date("2026-07-01T00:00:00.000Z"), lte: new Date("2026-07-31T00:00:00.000Z") },
        },
      }),
    );
  });

  it("returns [] when not signed in, no query", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await listScheduledPosts()).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

// --- listOwnerTargets -------------------------------------------------------

describe("listOwnerTargets", () => {
  it("returns the owner's connectable targets per channel, owner-scoped", async () => {
    mockIgListTargets.mockResolvedValue([{ id: "page-1", name: "My Page" }]);
    mockFbListTargets.mockResolvedValue([{ id: "page-1", name: "My Page" }]);
    const res = await listOwnerTargets();
    // each adapter is asked for the SESSION owner's targets, never a client id
    expect(mockIgListTargets).toHaveBeenCalledWith(OWNER);
    expect(mockFbListTargets).toHaveBeenCalledWith(OWNER);
    expect(res).toEqual([
      { id: "page-1", name: "My Page", channel: "instagram" },
      { id: "page-1", name: "My Page", channel: "facebook" },
    ]);
  });

  it("returns [] when the owner has no connected targets (Connect prompt case)", async () => {
    // adapters return [] on notConnected/needsReconnect/needsPageScope (see fetchOwnerPages mapping)
    mockIgListTargets.mockResolvedValue([]);
    mockFbListTargets.mockResolvedValue([]);
    expect(await listOwnerTargets()).toEqual([]);
  });

  it("returns [] when not signed in, queries no channel", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await listOwnerTargets()).toEqual([]);
    expect(mockIgListTargets).not.toHaveBeenCalled();
    expect(mockFbListTargets).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from "vitest";
import { executeSchedulePosts, schedulePostsSkill } from "./schedule-posts.js";
import type { OttoContext } from "../context.js";

// #123: the skill no longer touches Prisma or validates itself — it routes every post through the
// injected ctx.schedule.draft port (the SAME shared authority the human createScheduledPost action
// uses). So the test mocks the port and asserts the skill's orchestration: one call per post, the
// clean per-post input, id collection, per-post failure handling, and graceful degradation.

/** A ctx carrying a mock schedule port. */
function makeCtx(draft: ReturnType<typeof vi.fn>): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    sourceGenerationId: null,
    schedule: { draft },
  } as unknown as OttoContext;
}

/** A draft port that hands back sequential ids. */
function okDraft() {
  let n = 0;
  return vi.fn(async (_input: Record<string, unknown>) => ({ ok: true as const, id: `id-${++n}` }));
}

describe("schedulePosts gate", () => {
  it("free/write/internal → needsApproval false (internal $0 write, never gated)", () => {
    expect(schedulePostsSkill.cost).toBe("free");
    expect(schedulePostsSkill.effect).toBe("write");
    expect(schedulePostsSkill.reach).toBe("internal");
    expect(schedulePostsSkill.needsApproval).toBe(false);
  });
});

describe("executeSchedulePosts — routes every post through the shared ctx.schedule port", () => {
  it("drafts one post via the port and returns its id (firstComment defaults to null)", async () => {
    const draft = okDraft();
    const res = await executeSchedulePosts(
      { posts: [{ channel: "instagram", caption: "Hello", scheduledAt: "2026-07-10T09:00:00Z", scheduledTz: "Asia/Kuala_Lumpur" }] },
      { context: makeCtx(draft) },
    );
    expect(res).toEqual({ ok: true, draftedIds: ["id-1"], failures: [] });
    expect(draft).toHaveBeenCalledTimes(1);
    expect(draft).toHaveBeenCalledWith({
      channel: "instagram",
      caption: "Hello",
      scheduledAt: "2026-07-10T09:00:00Z",
      scheduledTz: "Asia/Kuala_Lumpur",
      media: undefined,
      firstComment: null,
    });
  });

  it("forwards mediaGenerationIds to the port (the owner-scoped media check lives in the service)", async () => {
    const draft = okDraft();
    await executeSchedulePosts(
      { posts: [{ channel: "instagram", caption: "Carousel", scheduledAt: "2026-07-10T09:00:00Z", scheduledTz: "Asia/Kuala_Lumpur", mediaGenerationIds: ["gen-a", "gen-b"] }] },
      { context: makeCtx(draft) },
    );
    expect(draft).toHaveBeenCalledWith(expect.objectContaining({ media: ["gen-a", "gen-b"] }));
  });

  it("drafts several posts in order; each is exactly one port call", async () => {
    const draft = okDraft();
    const res = await executeSchedulePosts(
      { posts: [
        { channel: "instagram", caption: "Mon", scheduledAt: "2026-07-13T01:00:00Z", scheduledTz: "Asia/Kuala_Lumpur" },
        { channel: "facebook", caption: "Wed", scheduledAt: "2026-07-15T01:00:00Z", scheduledTz: "Asia/Kuala_Lumpur" },
      ] },
      { context: makeCtx(draft) },
    );
    expect(res).toMatchObject({ ok: true, draftedIds: ["id-1", "id-2"], failures: [] });
    expect(draft).toHaveBeenCalledTimes(2);
  });

  it("collects a per-post rejection in `failures` and still drafts the valid posts (no batch hard-fail)", async () => {
    const draft = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, id: "id-1" })
      .mockResolvedValueOnce({ error: "Some selected media isn't yours." });
    const res = await executeSchedulePosts(
      { posts: [
        { channel: "instagram", caption: "good", scheduledAt: "2026-07-10T09:00:00Z", scheduledTz: "Asia/Kuala_Lumpur" },
        { channel: "instagram", caption: "bad media", scheduledAt: "2026-07-11T09:00:00Z", scheduledTz: "Asia/Kuala_Lumpur", mediaGenerationIds: ["foreign"] },
      ] },
      { context: makeCtx(draft) },
    );
    expect(res).toEqual({
      ok: true,
      draftedIds: ["id-1"],
      failures: [{ index: 1, error: "Some selected media isn't yours." }],
    });
  });

  it("never passes an owner/project id to the port — identity is the ctx/service's, not the model's", async () => {
    const draft = okDraft();
    await executeSchedulePosts(
      { posts: [{
        channel: "instagram", caption: "Scoped", scheduledAt: "2026-07-10T09:00:00Z", scheduledTz: "Asia/Kuala_Lumpur",
        // a hallucinated owner in the payload must never reach the port
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ ownerId: "org-EVIL", projectId: "proj-EVIL" } as any),
      }] },
      { context: makeCtx(draft) },
    );
    const arg = draft.mock.calls[0]![0];
    expect(arg).not.toHaveProperty("ownerId");
    expect(arg).not.toHaveProperty("projectId");
  });

  it("degrades gracefully when the schedule port is absent (minimal worker verdict ctx)", async () => {
    const ctx = { orgId: "o", projectId: "p", threadId: "t" } as unknown as OttoContext;
    const res = await executeSchedulePosts(
      { posts: [{ channel: "instagram", caption: "x", scheduledAt: "2026-07-10T09:00:00Z", scheduledTz: "Asia/Kuala_Lumpur" }] },
      { context: ctx },
    );
    expect(res).toEqual({ ok: false, error: expect.any(String) });
  });
});

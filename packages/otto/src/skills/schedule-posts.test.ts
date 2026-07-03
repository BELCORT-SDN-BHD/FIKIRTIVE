import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeSchedulePosts, schedulePostsSkill } from "./schedule-posts.js";
import type { OttoContext } from "../context.js";

vi.mock("@fikirtive/db", () => ({
  prisma: {
    scheduledPost: { create: vi.fn() },
    genJob: { create: vi.fn() }, // must never be called — this is a $0 skill
    publishAttempt: { create: vi.fn() }, // must never be called — this NEVER publishes
  },
}));

// Deterministic ids: post-id-1, post-id-2, ... in call order.
let idCounter = 0;
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: vi.fn(() => `id-${++idCounter}`),
}));

function makeCtx(): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    sourceGenerationId: null,
  } as unknown as OttoContext;
}

let db: {
  prisma: {
    scheduledPost: { create: ReturnType<typeof vi.fn> };
    genJob: { create: ReturnType<typeof vi.fn> };
    publishAttempt: { create: ReturnType<typeof vi.fn> };
  };
};
beforeEach(async () => {
  vi.clearAllMocks();
  idCounter = 0;
  db = (await import("@fikirtive/db")) as unknown as typeof db;
  db.prisma.scheduledPost.create.mockResolvedValue({});
});

describe("schedulePosts gate", () => {
  it("free/write/internal → needsApproval false (internal $0 write, never gated)", () => {
    expect(schedulePostsSkill.cost).toBe("free");
    expect(schedulePostsSkill.effect).toBe("write");
    expect(schedulePostsSkill.reach).toBe("internal");
    expect(schedulePostsSkill.needsApproval).toBe(false);
  });
});

describe("executeSchedulePosts — drafts only", () => {
  it("creates a DRAFT: status DRAFT, source otto, approvedAt null, metaTargetId null; never publishes/spends", async () => {
    const res = await executeSchedulePosts(
      {
        posts: [
          { channel: "instagram", caption: "Hello", scheduledAt: "2026-07-10T09:00:00Z", scheduledTz: "Asia/Kuala_Lumpur" },
        ],
      },
      { context: makeCtx() },
    );

    expect(res).toEqual({ ok: true, draftedIds: ["id-1"] });
    expect(db.prisma.scheduledPost.create).toHaveBeenCalledTimes(1);
    const arg = db.prisma.scheduledPost.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data).toMatchObject({
      id: "id-1",
      channel: "instagram",
      caption: "Hello",
      scheduledTz: "Asia/Kuala_Lumpur",
      status: "DRAFT",
      source: "otto",
      approvedAt: null,
      metaTargetId: null,
      publishMode: "AUTO",
    });
    expect(arg.data.scheduledAt).toEqual(new Date("2026-07-10T09:00:00Z"));
    // never sets a published/publishing status, never a metaPostId
    expect(arg.data.metaPostId).toBeUndefined();
    // never publishes, never spends
    expect(db.prisma.publishAttempt.create).not.toHaveBeenCalled();
    expect(db.prisma.genJob.create).not.toHaveBeenCalled();
  });

  it("drafts several posts in one call and returns their ids in order", async () => {
    const res = await executeSchedulePosts(
      {
        posts: [
          { channel: "instagram", caption: "Mon", scheduledAt: "2026-07-13T01:00:00Z", scheduledTz: "Asia/Kuala_Lumpur" },
          { channel: "facebook", caption: "Wed", scheduledAt: "2026-07-15T01:00:00Z", scheduledTz: "Asia/Kuala_Lumpur" },
        ],
      },
      { context: makeCtx() },
    );
    expect(res.draftedIds).toHaveLength(2);
    expect(db.prisma.scheduledPost.create).toHaveBeenCalledTimes(2);
  });
});

describe("executeSchedulePosts — media ordering", () => {
  it("writes ScheduledPostMedia rows at position 0..n in the given order", async () => {
    await executeSchedulePosts(
      {
        posts: [
          {
            channel: "instagram",
            caption: "Carousel",
            scheduledAt: "2026-07-10T09:00:00Z",
            scheduledTz: "Asia/Kuala_Lumpur",
            mediaGenerationIds: ["gen-a", "gen-b", "gen-c"],
          },
        ],
      },
      { context: makeCtx() },
    );
    const arg = db.prisma.scheduledPost.create.mock.calls[0]![0] as {
      data: { media?: { create: { generationId: string; position: number }[] } };
    };
    expect(arg.data.media!.create).toEqual([
      expect.objectContaining({ generationId: "gen-a", position: 0 }),
      expect.objectContaining({ generationId: "gen-b", position: 1 }),
      expect.objectContaining({ generationId: "gen-c", position: 2 }),
    ]);
  });

  it("omits media entirely when no mediaGenerationIds are given", async () => {
    await executeSchedulePosts(
      {
        posts: [
          { channel: "facebook", caption: "Text only", scheduledAt: "2026-07-10T09:00:00Z", scheduledTz: "Asia/Kuala_Lumpur" },
        ],
      },
      { context: makeCtx() },
    );
    const arg = db.prisma.scheduledPost.create.mock.calls[0]![0] as { data: { media?: unknown } };
    expect(arg.data.media).toBeUndefined();
  });
});

describe("executeSchedulePosts — tenant scoping", () => {
  it("scopes writes to ctx.orgId / ctx.projectId and IGNORES any owner smuggled in args", async () => {
    await executeSchedulePosts(
      {
        // A malicious/hallucinated ownerId in the payload must be ignored — identity is from ctx.
        posts: [
          {
            channel: "instagram",
            caption: "Scoped",
            scheduledAt: "2026-07-10T09:00:00Z",
            scheduledTz: "Asia/Kuala_Lumpur",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({ ownerId: "org-EVIL", projectId: "proj-EVIL" } as any),
          },
        ],
      },
      { context: makeCtx() },
    );
    const arg = db.prisma.scheduledPost.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.ownerId).toBe("org-test");
    expect(arg.data.projectId).toBe("proj-test");
  });
});

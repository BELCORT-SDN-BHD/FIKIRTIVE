import { describe, it, expect, vi, beforeEach } from "vitest";
import { storyboardCardInput, buildStoryboardPayload, MAX_STORYBOARD_SHOTS } from "./propose-storyboard.helpers.js";
import { executeProposeStoryboard, proposeStoryboardSkill } from "./propose-storyboard.js";
import type { OttoContext } from "../context.js";

vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatMessage: { findFirst: vi.fn(), create: vi.fn() },
    genJob: { create: vi.fn() }, // must NEVER be called
  },
}));

function makeCtx(over?: Partial<OttoContext>): OttoContext {
  return { orgId: "org-test", userId: "u", projectId: "p", threadId: "t-1", disabledModels: [], sourceGenerationId: null, ...over } as OttoContext;
}

describe("storyboardCardInput schema", () => {
  const okShot = { firstFramePrompt: "a cat on a sofa", videoPrompt: "the cat stretches" };
  it("accepts a minimal valid storyboard", () => {
    const r = storyboardCardInput.safeParse({ storyboardTitle: "Cat ad", shots: [okShot] });
    expect(r.success).toBe(true);
  });
  it("requires at least one shot", () => {
    expect(storyboardCardInput.safeParse({ storyboardTitle: "x", shots: [] }).success).toBe(false);
  });
  it("caps shots at MAX_STORYBOARD_SHOTS", () => {
    const many = Array.from({ length: MAX_STORYBOARD_SHOTS + 1 }, () => okShot);
    expect(storyboardCardInput.safeParse({ storyboardTitle: "x", shots: many }).success).toBe(false);
  });
  it("goal is optional", () => {
    expect(storyboardCardInput.safeParse({ storyboardTitle: "x", shots: [okShot], goal: "drive signups" }).success).toBe(true);
  });
});

describe("buildStoryboardPayload", () => {
  it("stamps a 0-based index on each shot in order", () => {
    const p = buildStoryboardPayload(storyboardCardInput.parse({
      storyboardTitle: "Launch",
      shots: [
        { firstFramePrompt: "wide shot of the product", videoPrompt: "slow dolly in" },
        { firstFramePrompt: "close-up on the label", videoPrompt: "rack focus", title: "Detail" },
      ],
    }));
    expect(p.storyboardTitle).toBe("Launch");
    expect(p.shots.map((s) => s.index)).toEqual([0, 1]);
    expect(p.shots[1]!.title).toBe("Detail");
    expect(p.shots[0]!.firstFrameGenerationId).toBeUndefined();
  });
  it("carries goal onto the payload when present", () => {
    const p = buildStoryboardPayload(storyboardCardInput.parse({
      storyboardTitle: "x", goal: "launch teaser", shots: [{ firstFramePrompt: "a", videoPrompt: "b" }],
    }));
    expect(p.goal).toBe("launch teaser");
  });
});

describe("executeProposeStoryboard — mock DB", () => {
  let m: { chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }; genJob: { create: ReturnType<typeof vi.fn> } };
  beforeEach(async () => {
    vi.clearAllMocks();
    m = (await import("@fikirtive/db")).prisma as unknown as typeof m;
    m.chatMessage.findFirst.mockResolvedValue({ seq: 4 });
    m.chatMessage.create.mockResolvedValue({});
  });

  it("persists a STORYBOARD_CARD with ordered shots, ownerId+threadId from ctx, seq=last+1", async () => {
    const ctx = makeCtx({ orgId: "org-A", threadId: "thr-A" });
    const res = await executeProposeStoryboard(
      { storyboardTitle: "Raya ad", goal: "festive launch", shots: [
        { firstFramePrompt: "family at the door", videoPrompt: "they smile and wave" },
        { firstFramePrompt: "close-up of the cookies", videoPrompt: "steam rises" },
      ] },
      { context: ctx },
    );
    expect(m.chatMessage.create).toHaveBeenCalledTimes(1);
    const data = (m.chatMessage.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.kind).toBe("STORYBOARD_CARD");
    expect(data.ownerId).toBe("org-A");
    expect(data.threadId).toBe("thr-A");
    expect(data.role).toBe("AGENT");
    expect(data.seq).toBe(5);
    const payload = data.payload as { storyboardTitle: string; goal?: string; shots: { index: number }[] };
    expect(payload.storyboardTitle).toBe("Raya ad");
    expect(payload.goal).toBe("festive launch");
    expect(payload.shots.map((s) => s.index)).toEqual([0, 1]);
    expect(res.cardId).toEqual(expect.any(String));
  });

  it("never creates a GenJob ($0)", async () => {
    await executeProposeStoryboard({ storyboardTitle: "x", shots: [{ firstFramePrompt: "a", videoPrompt: "b" }] }, { context: makeCtx() });
    expect(m.genJob.create).not.toHaveBeenCalled();
  });
});

describe("proposeStoryboardSkill gate", () => {
  it("free/write/internal → not gated; declares a goal requirement", () => {
    expect(proposeStoryboardSkill.cost).toBe("free");
    expect(proposeStoryboardSkill.effect).toBe("write");
    expect(proposeStoryboardSkill.needsApproval).toBe(false);
    expect(proposeStoryboardSkill.requires.map((r) => r.field)).toContain("goal");
  });
});

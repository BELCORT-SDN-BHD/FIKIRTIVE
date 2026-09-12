import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  storyboardCardInput,
  buildStoryboardPayload,
  MAX_STORYBOARD_SHOTS,
} from "./propose-storyboard.helpers.js";
import { executeProposeStoryboard, proposeStoryboardSkill } from "./propose-storyboard.js";
import type { OttoContext } from "../context.js";

vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatMessage: { findFirst: vi.fn(), create: vi.fn() },
    entity: { findMany: vi.fn() },
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
  it("accepts optional per-shot entityIds and caps them at MAX_STORYBOARD_SHOTS", () => {
    expect(storyboardCardInput.safeParse({ storyboardTitle: "x", shots: [{ ...okShot, entityIds: ["a", "b"] }] }).success).toBe(true);
    const tooMany = { ...okShot, entityIds: Array.from({ length: MAX_STORYBOARD_SHOTS + 1 }, (_, i) => `e${i}`) };
    expect(storyboardCardInput.safeParse({ storyboardTitle: "x", shots: [tooMany] }).success).toBe(false);
  });
  it("accepts optional per-shot durationSeconds (int 1..60), rejects out-of-range / non-int (G-block)", () => {
    expect(storyboardCardInput.safeParse({ storyboardTitle: "x", shots: [{ ...okShot, durationSeconds: 5 }] }).success).toBe(true);
    expect(storyboardCardInput.safeParse({ storyboardTitle: "x", shots: [{ ...okShot, durationSeconds: 0 }] }).success).toBe(false);
    expect(storyboardCardInput.safeParse({ storyboardTitle: "x", shots: [{ ...okShot, durationSeconds: 61 }] }).success).toBe(false);
    expect(storyboardCardInput.safeParse({ storyboardTitle: "x", shots: [{ ...okShot, durationSeconds: 5.5 }] }).success).toBe(false);
  });
  it("does NOT accept server-written video pointer fields in the input schema (server-written only)", () => {
    const r = storyboardCardInput.parse({ storyboardTitle: "x", shots: [{ ...okShot, videoCardId: "c", videoGenerationId: "g" }] });
    // zod strips unknown keys by default → the pointer fields never enter the parsed shot.
    expect("videoCardId" in r.shots[0]!).toBe(false);
    expect("videoGenerationId" in r.shots[0]!).toBe(false);
  });
});

describe("buildStoryboardPayload", () => {
  // 注入计数器 id 工厂,让 shotId 确定可断言(默认工厂是 newId=ULID,非确定)。
  const counter = () => { let n = 0; return () => `shot-${n++}`; };
  it("stamps a 0-based index + stable shotId on each shot in order", () => {
    const p = buildStoryboardPayload(storyboardCardInput.parse({
      storyboardTitle: "Launch",
      shots: [
        { firstFramePrompt: "wide shot of the product", videoPrompt: "slow dolly in" },
        { firstFramePrompt: "close-up on the label", videoPrompt: "rack focus", title: "Detail" },
      ],
    }), counter());
    expect(p.storyboardTitle).toBe("Launch");
    expect(p.shots.map((s) => s.index)).toEqual([0, 1]);
    expect(p.shots.map((s) => s.shotId)).toEqual(["shot-0", "shot-1"]);
    expect(p.shots[1]!.title).toBe("Detail");
    expect(p.shots[0]!.firstFrameGenerationId).toBeUndefined();
  });
  it("mints a shotId per shot by default (no injected factory)", () => {
    const p = buildStoryboardPayload(storyboardCardInput.parse({
      storyboardTitle: "x", shots: [{ firstFramePrompt: "a", videoPrompt: "b" }],
    }));
    expect(typeof p.shots[0]!.shotId).toBe("string");
    expect(p.shots[0]!.shotId.length).toBeGreaterThan(0);
  });
  it("passes through per-shot entityIds when present, omits otherwise", () => {
    const p = buildStoryboardPayload(storyboardCardInput.parse({
      storyboardTitle: "x",
      shots: [
        { firstFramePrompt: "a", videoPrompt: "b", entityIds: ["ent_1", "ent_2"] },
        { firstFramePrompt: "c", videoPrompt: "d" },
      ],
    }), counter());
    expect(p.shots[0]!.entityIds).toEqual(["ent_1", "ent_2"]);
    expect(p.shots[1]!.entityIds).toBeUndefined();
    expect("entityIds" in p.shots[1]!).toBe(false);
  });
  it("carries goal onto the payload when present", () => {
    const p = buildStoryboardPayload(storyboardCardInput.parse({
      storyboardTitle: "x", goal: "launch teaser", shots: [{ firstFramePrompt: "a", videoPrompt: "b" }],
    }), counter());
    expect(p.goal).toBe("launch teaser");
  });
  it("passes through per-shot durationSeconds when present, omits otherwise (G-block)", () => {
    const p = buildStoryboardPayload(storyboardCardInput.parse({
      storyboardTitle: "x",
      shots: [
        { firstFramePrompt: "a", videoPrompt: "b", durationSeconds: 10 },
        { firstFramePrompt: "c", videoPrompt: "d" },
      ],
    }), counter());
    expect(p.shots[0]!.durationSeconds).toBe(10);
    expect(p.shots[1]!.durationSeconds).toBeUndefined();
    expect("durationSeconds" in p.shots[1]!).toBe(false);
  });
});

type PrismaStub = {
  chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  entity: { findMany: ReturnType<typeof vi.fn> };
  genJob: { create: ReturnType<typeof vi.fn> };
};

describe("executeProposeStoryboard — mock DB", () => {
  let m: PrismaStub;
  beforeEach(async () => {
    vi.clearAllMocks();
    m = (await import("@fikirtive/db")).prisma as unknown as PrismaStub;
    m.chatMessage.findFirst.mockResolvedValue({ seq: 4 });
    m.chatMessage.create.mockResolvedValue({});
    m.entity.findMany.mockResolvedValue([]);
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
    const payload = data.payload as { storyboardTitle: string; goal?: string; shots: { index: number; shotId: string }[] };
    expect(payload.storyboardTitle).toBe("Raya ad");
    expect(payload.goal).toBe("festive launch");
    expect(payload.shots.map((s) => s.index)).toEqual([0, 1]);
    // 服务端为每镜头铸了稳定 shotId(F4 付费写回按它定位)。
    expect(payload.shots.every((s) => typeof s.shotId === "string" && s.shotId.length > 0)).toBe(true);
    expect("cardId" in res && res.cardId).toEqual(expect.any(String));
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

// ---------------------------------------------------------------------------
// #782 接续:Otto 起草时就能定「这条片子是不是一镜接一镜」
// ---------------------------------------------------------------------------

describe("#782 continuity", () => {
  const okShot = { firstFramePrompt: "a cat on a sofa", videoPrompt: "the cat stretches" };

  it("是可选入参,缺省 = 不落键(老卡与新卡逐字节同形)", () => {
    expect(storyboardCardInput.safeParse({ storyboardTitle: "x", shots: [okShot], continuity: true }).success).toBe(true);
    const p = buildStoryboardPayload(storyboardCardInput.parse({ storyboardTitle: "x", shots: [okShot] }));
    expect("continuity" in p).toBe(false);
  });

  it("true → 落 continuity:true;false 同样不落键(与「没说」是同一件事)", () => {
    const on = buildStoryboardPayload(storyboardCardInput.parse({ storyboardTitle: "x", shots: [okShot], continuity: true }));
    expect(on.continuity).toBe(true);
    const off = buildStoryboardPayload(storyboardCardInput.parse({ storyboardTitle: "x", shots: [okShot], continuity: false }));
    expect("continuity" in off).toBe(false);
  });

  // FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 「skill 说明里讲清什么时候该开」
  // 删除:continuity 的**消费者**(闸③ 的免费传帧,见 storyboard-gate1-actions.ts)现在
  // structurally 不可达 —— `directToVideoShotIds` 恒为全集,那条写入永远进不去。继续在 skill
  // 说明里教 Otto 打开它、并告诉商家「只用出第一镜的首帧,后面几镜会接上」,就是让 Otto 对
  // 商家说一句不再成立的话。schema 字段与人工面开关本身未删(见 PR 描述残留缺口),但 Otto
  // 不该再被教着去承诺一件系统做不到的事,所以这里把这段说明拿掉,不留替代覆盖。
});

// FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 「creation §5 :172⑤ —— firstFramePrompt
// 只对没有演员的镜头必填」与「creation §5 :172⑤ —— 落库前那一道($0)」两个 describe(原
// 196-322 行,连同 `refuseShotsMissingFirstFramePrompt` 举证与它专用的 `castShotInput` 夹具)
// 随闸①整段报废一并删除 —— 它们测的整条判据(「有没有演员 ⇒ 首帧文字必填/免写」)与那道
// 落库前拒绝闸,连同首帧文字这个概念本身,一起从系统里退场:没有「必须带首帧文字」这一档,
// 没有替代覆盖(报废,不是迁移)。firstFramePrompt 字段本身仍是合法可选输入(见上方
// storyboardCardInput schema 测试),只是没有人再读它。

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  storyboardCardInput,
  buildStoryboardPayload,
  shotsMissingFirstFramePrompt,
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

  it("skill 说明里讲清什么时候该开(Otto 是靠这段话判断的)", () => {
    expect(proposeStoryboardSkill.description).toContain("continuity:true");
  });
});

// ---------------------------------------------------------------------------
// creation §5 :172⑤ —— firstFramePrompt 按镜头类型条件可选
// ---------------------------------------------------------------------------
//
// 免写的**只有 @ 到演员的镜头**(它走「两张参考直接出片」,首帧那一步不存在)。判据必须与
// 卡面/铸卡侧的「直接出片」逐字同一条(有没有 CHARACTER)—— 一旦放宽成「有没有 @元素」,
// 只 @ 了商品的特写镜就会既不直接出片、又没有首帧文字地落库,然后在闸① 把**整张卡**的
// 首帧一起拒掉。演员这件事只有服务端读得到,所以这道闸住在 execute($0、落库之前)。
describe("creation §5 :172⑤ —— firstFramePrompt 只对没有演员的镜头必填", () => {
  const castShot = { videoPrompt: "she lifts the mug", entityIds: ["ent-actor"] };

  it("creation §5 :172⑤ / CREATE-A2: 没写就不落这一格,写了照旧原样落库", () => {
    const bare = buildStoryboardPayload(storyboardCardInput.parse({ storyboardTitle: "x", shots: [castShot] }));
    expect("firstFramePrompt" in bare.shots[0]!).toBe(false);
    const withFrame = buildStoryboardPayload(
      storyboardCardInput.parse({ storyboardTitle: "x", shots: [{ ...castShot, firstFramePrompt: "a cat on a sofa" }] }),
    );
    expect(withFrame.shots[0]!.firstFramePrompt).toBe("a cat on a sofa");
  });

  it("creation §5 :172⑤ / CREATE-A2: 判据是纯函数,与「直接出片」同一句 —— 只 @ 商品的镜头照旧必填", () => {
    const shots = [
      { videoPrompt: "a", entityIds: ["actor-1"] },            // 有演员 ⇒ 免写
      { videoPrompt: "b", entityIds: ["prod-mug"] },           // 只有商品 ⇒ 必填
      { videoPrompt: "c" },                                     // 没有 @元素 ⇒ 必填
      { videoPrompt: "d", firstFramePrompt: "写了" },           // 写了就无所谓
    ];
    expect(shotsMissingFirstFramePrompt(shots, new Set(["actor-1"]))).toEqual([1, 2]);
    // 跨租户/已删的演员 id 进不了这个集合 ⇒ 那一镜照旧算「要首帧文字」。
    expect(shotsMissingFirstFramePrompt(shots, new Set())).toEqual([0, 1, 2]);
  });

  it("creation §5 :172⑤ / CREATE-A2: skill 说明照实说这条规矩(Otto 只读得到这段话)", () => {
    expect(proposeStoryboardSkill.description).toContain("@mentions a CAST MEMBER");
    expect(proposeStoryboardSkill.description).toContain("needs no firstFramePrompt");
    expect(proposeStoryboardSkill.description).toContain("@mentions only products");
    expect(proposeStoryboardSkill.description).toContain("must carry a firstFramePrompt");
  });
});

describe("creation §5 :172⑤ —— 落库前那一道($0)", () => {
  let m: PrismaStub;
  beforeEach(async () => {
    vi.clearAllMocks();
    m = (await import("@fikirtive/db")).prisma as unknown as PrismaStub;
    m.chatMessage.findFirst.mockResolvedValue({ seq: 4 });
    m.chatMessage.create.mockResolvedValue({});
    m.entity.findMany.mockResolvedValue([]);
  });

  it("creation §5 :172⑤ / CREATE-A10: 只 @ 了商品、没有首帧文字的镜头 ⇒ 点名拒绝,零写入", async () => {
    m.entity.findMany.mockResolvedValue([{ id: "prod-mug", type: "PRODUCT" }]);

    const res = await executeProposeStoryboard(
      {
        storyboardTitle: "Mug ad",
        shots: [
          { title: "Opening", videoPrompt: "the mug steams on a table", entityIds: ["prod-mug"] },
          { videoPrompt: "hands lift it", firstFramePrompt: "hands near the mug" },
        ],
      },
      { context: makeCtx() },
    );

    expect(res).toEqual({
      error:
        'Shot 1 "Opening": no cast member in there, so that shot is still made in two steps (opening still, then '
        + "the clip) — write the opening still with seedreamPrompt, put it in each of those shots' firstFramePrompt, "
        + "and lay the storyboard out again. Nothing was made and nothing was charged.",
    });
    expect(m.chatMessage.create).not.toHaveBeenCalled();
    expect(m.genJob.create).not.toHaveBeenCalled();
  });

  it("creation §5 :172⑤ / CREATE-A10: 一个 @元素都没有、也没有首帧文字 ⇒ 同样拒(两步那一档逐字不变)", async () => {
    const res = await executeProposeStoryboard(
      { storyboardTitle: "x", shots: [{ videoPrompt: "the cat stretches" }] },
      { context: makeCtx() },
    );
    expect("error" in res).toBe(true);
    expect(m.chatMessage.create).not.toHaveBeenCalled();
    // @元素一个都没有 ⇒ 连那一趟元素读都不发。
    expect(m.entity.findMany).not.toHaveBeenCalled();
  });

  it("creation §5 :172⑤ / CREATE-A2: @ 到演员的镜头没有首帧文字照样落库", async () => {
    m.entity.findMany.mockResolvedValue([{ id: "ent-actor", type: "CHARACTER" }]);

    const res = await executeProposeStoryboard(
      { storyboardTitle: "Raya ad", shots: [castShotInput()] },
      { context: makeCtx() },
    );

    expect("cardId" in res).toBe(true);
    expect(m.chatMessage.create).toHaveBeenCalledTimes(1);
  });

  it("creation §5 :172⑤ / CREATE-A10: 双租户 —— 演员 id 属于别家店 ⇒ 读不出来 ⇒ 照旧要首帧文字,拒", async () => {
    // 真库里那一行属于 org-other;这一趟查的是 ctx.orgId 的 scope,所以读回空表。
    m.entity.findMany.mockImplementation(async (args: { where: { ownerId: string } }) =>
      args.where.ownerId === "org-other" ? [{ id: "ent-actor", type: "CHARACTER" }] : [],
    );

    const res = await executeProposeStoryboard(
      { storyboardTitle: "x", shots: [castShotInput()] },
      { context: makeCtx({ orgId: "org-mine" }) },
    );

    expect("error" in res).toBe(true);
    expect(m.entity.findMany.mock.calls[0]![0].where.ownerId).toBe("org-mine");
    expect(m.entity.findMany.mock.calls[0]![0].where.deletedAt).toBeNull();
    expect(m.chatMessage.create).not.toHaveBeenCalled();
  });

  it("creation §5 :172⑤ / CREATE-A2: 每一镜都写了首帧文字 ⇒ 一次多余的元素读都不发", async () => {
    const res = await executeProposeStoryboard(
      { storyboardTitle: "x", shots: [{ videoPrompt: "b", firstFramePrompt: "a", entityIds: ["prod-mug"] }] },
      { context: makeCtx() },
    );
    expect("cardId" in res).toBe(true);
    expect(m.entity.findMany).not.toHaveBeenCalled();
  });
});

/** @ 到一位演员、没有首帧文字的那一镜(上面几例共用)。 */
function castShotInput(): { videoPrompt: string; entityIds: string[] } {
  return { videoPrompt: "she lifts the mug", entityIds: ["ent-actor"] };
}

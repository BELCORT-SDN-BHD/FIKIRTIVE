/**
 * video-step-handoff.test —— 两步任务的接力(Codex 只读 E2E E2E-CRE-PAV-004)。
 *
 * 钉三件事:
 *   ① 冻结计划读得出来 —— 读不出来一律 null(「不接力」永远是安全降级,猜一份规格不是);
 *   ② 第二张卡长什么样 —— i2v 首帧指着 Step 1 的产出、回执在、血缘在、报价来自服务端单源;
 *   ③ 什么时候**不该**有第二张卡 —— 没出产出、不是两步卡、不是图片作业。
 *
 * 真库那一半(DONE ⇒ 恰一张卡 / FAILED ⇒ 零卡 / 账本零新行)在
 * `apps/worker/src/jobs/gen-video-step-handoff-db.test.ts`。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { displayCredits, pricedGenCredits } from "@fikirtive/core";

const m = vi.hoisted(() => ({
  genJobFindFirst: vi.fn(),
  chatMessageFindFirst: vi.fn(),
  generationFindFirst: vi.fn(),
  projectFindFirst: vi.fn(),
}));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    genJob: { findFirst: m.genJobFindFirst },
    chatMessage: { findFirst: m.chatMessageFindFirst },
    generation: { findFirst: m.generationFindFirst },
    project: { findFirst: m.projectFindFirst },
  },
}));

import {
  buildVideoStepCardPayload,
  planVideoStepHandoff,
  videoStepPlanOf,
} from "./video-step-handoff.js";
import type { VideoStepPlan } from "./skills/propose.helpers.js";

const PLAN: VideoStepPlan = {
  structuredPrompt: "Xinyi raises the tumbler, takes a sip, then smiles at the camera",
  desiredAspect: "9:16",
  desiredDuration: 5,
  desiredAudio: false,
};

const RECEIPT = {
  generationId: "gen_step1",
  kind: "image" as const,
  label: "Xinyi holding the tumbler in a warm-toned cafe",
  sourceProjectId: "proj-1",
  sourceProjectName: "Untitled canvas",
  sameCanvas: true,
  previewUrl: "/files/step1.png",
};

const SCOPE = { orgId: "org-1", projectId: "proj-1", threadId: "thread-1", disabledModels: [] };

describe("CREATE-A1 videoStepPlanOf —— 冻结计划读得出来,读不出来就是「不接力」", () => {
  it("CREATE-A1 完整的一份计划原样读出来", () => {
    expect(videoStepPlanOf({ videoStep: { estimatedCredits: 12, next: PLAN } })).toEqual(PLAN);
  });

  it("CREATE-A1 只带片段预估的老卡 ⇒ null(接力在这些卡上从来没存在过,不许凭空发明)", () => {
    expect(videoStepPlanOf({ videoStep: { estimatedCredits: 12 } })).toBeNull();
  });

  it("CREATE-A2 计划里少了那段字 ⇒ null,绝不用别处的字凑一份规格出来", () => {
    expect(videoStepPlanOf({ videoStep: { estimatedCredits: 12, next: { desiredDuration: 5 } } })).toBeNull();
    expect(videoStepPlanOf({ videoStep: { estimatedCredits: 12, next: { structuredPrompt: "" } } })).toBeNull();
  });

  it("CREATE-A2 完全不是两步卡的 payload ⇒ null", () => {
    for (const raw of [null, undefined, "x", [], {}, { videoStep: null }, { videoStep: [] }]) {
      expect(videoStepPlanOf(raw)).toBeNull();
    }
  });

  it("CREATE-A2 计划里类型不对的那几格被丢掉,剩下的照旧读得出来(少一格好过错一格)", () => {
    expect(
      videoStepPlanOf({
        videoStep: { estimatedCredits: 12, next: { structuredPrompt: "a slow push-in", desiredDuration: "five", desiredAudio: "off" } },
      }),
    ).toEqual({ structuredPrompt: "a slow push-in" });
  });
});

describe("CREATE-A1 buildVideoStepCardPayload —— 第二步的确认卡", () => {
  const built = () =>
    buildVideoStepCardPayload({
      plan: PLAN,
      step1CardId: "card-step1",
      sourceGenerationId: RECEIPT.generationId,
      receipt: [RECEIPT],
      scope: SCOPE,
    });

  it("CREATE-A1 卡指着 Step 1 的产出当首帧,规格就是冻结计划里那一份", () => {
    const p = built();
    expect(p.kind).toBe("video");
    expect(p.sourceGenerationId).toBe(RECEIPT.generationId);
    expect(p.params.durationSeconds).toBe(5);
    expect(p.params.audio).toBe(false);
    expect(p.structuredPrompt).toBe(PLAN.structuredPrompt);
  });

  it("CREATE-A2 首帧那一件的回执在卡上 —— 少了它这张卡在前端根本按不下去", () => {
    // Codex staging CRE-STG-P1-003 起,卡上那一份回执比服务端解析出来的那一份多一格
    // `role` —— 它是「这一件在**这张卡**里坐哪一格」的答案,由铸卡侧冻上去。第二步这张卡
    // 的那一件是 i2v 首帧,所以角色恒为 `startFrame`(商家读到的是 "Starting frame")。
    expect(built().mediaReferences).toEqual([{ ...RECEIPT, role: "startFrame" }]);
  });

  it("CREATE-A1 血缘可查:卡上写着它是从哪一张 Step 1 卡接力出来的", () => {
    expect(built().videoStepOf).toBe("card-step1");
  });

  it("CREATE-A1 报价来自服务端单源(pricedGenCredits),不是从第一张卡上搬来的数字", () => {
    const p = built();
    expect(p.estimatedCredits).toBe(
      displayCredits(
        pricedGenCredits({
          kind: "VIDEO",
          model: p.model,
          count: 1,
          videoOptions: {
            seconds: p.params.durationSeconds,
            resolution: p.params.resolution,
            audio: p.params.audio,
          },
        }),
      ),
    );
    expect(p.estimatedCredits).toBeGreaterThan(0);
  });
});

describe("CREATE-A2 planVideoStepHandoff —— 什么时候不该有第二张卡", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.genJobFindFirst.mockResolvedValue({
      idempotencyKey: "cowork:card-step1",
      projectId: "proj-1",
      kind: "IMAGE",
    });
    m.chatMessageFindFirst.mockResolvedValue({
      id: "card-step1",
      payload: { videoStep: { estimatedCredits: 12, next: PLAN } },
    });
    m.generationFindFirst.mockResolvedValue({
      id: "gen_step1",
      projectId: "proj-1",
      promptText: "Xinyi holding the tumbler in a warm-toned cafe",
      asset: { ownerId: "org-1", contentHash: "a".repeat(64), ext: "png" },
    });
    m.projectFindFirst.mockResolvedValue({ name: "Cafe launch" });
  });

  const call = (over?: Record<string, unknown>) =>
    planVideoStepHandoff({
      jobId: "job-1",
      ownerId: "org-1",
      threadId: "thread-1",
      generationIds: ["gen_step1"],
      disabledModels: [],
      ...over,
    });

  it("CREATE-A1 正常那一路:接力准备好了,卡指着刚出的那张图", async () => {
    const out = await call();
    expect(out?.step1CardId).toBe("card-step1");
    expect(out?.payload.sourceGenerationId).toBe("gen_step1");
    expect(out?.payload.kind).toBe("video");
    // 回执的名字来自那张图自己的提示词,画布名来自它自己的画布 —— 不是编出来的。
    expect(out?.payload.mediaReferences?.[0]?.sourceProjectName).toBe("Cafe launch");
  });

  it("CREATE-A2 这一单什么都没交付 ⇒ 不接力(失败/取消的那一路走的就是这里)", async () => {
    expect(await call({ generationIds: [] })).toBeNull();
  });

  it("CREATE-A2 Step 1 的卡上没有冻结计划 ⇒ 不接力(普通图片卡一格不动)", async () => {
    m.chatMessageFindFirst.mockResolvedValue({ id: "card-step1", payload: { videoStep: { estimatedCredits: 12 } } });
    expect(await call()).toBeNull();
  });

  it("CREATE-A2 这一单不是图片作业 ⇒ 不接力(片子出完不会再接一条片子)", async () => {
    m.genJobFindFirst.mockResolvedValue({ idempotencyKey: "cowork:card-step1", projectId: "proj-1", kind: "VIDEO" });
    expect(await call()).toBeNull();
  });

  it("CREATE-A2 刚出的那张图读不回来 ⇒ 不接力(读不到就不许铸一张指着虚空的卡)", async () => {
    m.generationFindFirst.mockResolvedValue(null);
    expect(await call()).toBeNull();
  });

  it("CREATE-A2 准备过程炸了 ⇒ 返回 null,绝不把异常抛回交付路径", async () => {
    m.genJobFindFirst.mockRejectedValue(new Error("boom"));
    await expect(call()).resolves.toBeNull();
  });
});

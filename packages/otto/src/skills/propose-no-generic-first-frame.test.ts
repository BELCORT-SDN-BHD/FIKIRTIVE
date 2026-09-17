/**
 * propose-no-generic-first-frame.test.ts —— FC-3:普通对话不再先卖一张首帧图。
 *
 * 现场(Founder 自己的画布,staging 14bcd038,2026-09-14 05:41 UTC):商家手上已经有一张
 * cat+mug 的图、@ 了演员 Xinyi,seq27 他只说了一句 `ok i want the video to be 15 seconds`;
 * seq28 回来的却是一张 `kind:image`、`estimatedCredits:1` 的**额外首帧图**卡,上面冻着
 * `videoStep.next.desiredDuration:15`(视频预估 33 credits),Otto 说 starting picture comes
 * first。取证:docs/audits/founder-canvas-2026-09-14/{report.md §3, firstframe-status.md 「关键补核」}。
 *
 * 裁决:docs/specs/creation-engine.md:186(S5 批量裁决 2026-09-12 #1358)—— 2026-09-08
 * 「first frame 的 idea 可以移除」适用于**所有镜头**。PR #1417 只把分镜那条路收了口,普通
 * propose 的 `forVideo` / `videoStep` / 接力实现原样留着(同份规格 :137 记着它的来历)。
 * 本文件把「普通对话这条路也收口」钉成机器规则。
 *
 * **把裁决从分镜推广到普通对话是本 PR 的假设**,待 Founder 追认(见 PR 正文)。
 *
 * 正面样本是同一场里真正成功的那一单(job 01M2F736BR2VBJEJ8H1SV73F5X):
 * sourceGenerationId=null、entityIds=[Xinyi]、referenceGenerationIds=[原 cat+mug]、15s。
 */
import { describe, it, expect } from "vitest";
import { buildProposeCard, proposeInput } from "./propose.helpers.js";
import { proposeSkill } from "./propose.js";
import type { OttoContext } from "../context.js";

/** 那张一直在聊的 cat+mug 原图。 */
const CAT_AND_MUG = "01M2F6XFRQ0YVS45ZJ8C8YFATH";
/** 官方演员库那位。 */
const XINYI = { id: "01M265PRD50HWEKX2VFGBCF31Y", type: "CHARACTER" as const, name: "Xinyi" };

function turnCtx(overrides?: Partial<OttoContext>): OttoContext {
  return {
    orgId: "org-fc3",
    userId: "user-fc3",
    projectId: "proj-fc3",
    threadId: "thread-fc3",
    disabledModels: [],
    sourceGenerationId: CAT_AND_MUG,
    sourceGenerationIds: [CAT_AND_MUG],
    mediaReferences: [
      {
        generationId: CAT_AND_MUG,
        kind: "image" as const,
        label: "A fluffy cat drinking from the orange mug",
        sourceProjectId: "proj-fc3",
        sourceProjectName: "Hi!",
        sameCanvas: true,
        previewUrl: "/files/cat-and-mug.png",
      },
    ],
    ...overrides,
  };
}

describe("FC-3 普通对话:要一条 15 秒的片子,不许先卖一张首帧图", () => {
  it("现场那一句(15 秒)⇒ 直接一张视频卡,原图作参考、演员在名单上,没有第二步计划", () => {
    const { cardPayload } = buildProposeCard(
      {
        kind: "video",
        structuredPrompt: "Xinyi holds the cat while it drinks from the orange mug, warm afternoon light",
        entityIds: [XINYI.id],
        variantSel: {},
        desiredDuration: 15,
      },
      turnCtx(),
      [XINYI],
    );

    expect(cardPayload.kind).toBe("video");
    // 成功那一单的形状:没有首帧,原图作参考随行,演员在名单上。
    expect(cardPayload.sourceGenerationId).toBeUndefined();
    expect(cardPayload.referenceGenerationIds).toEqual([CAT_AND_MUG]);
    expect(cardPayload.entityIds).toEqual([XINYI.id]);
    expect(cardPayload.params.durationSeconds).toBe(15);
    // 两步计划这一格必须不存在 —— 视频卡本来就没有它,这一条是防回潮。
    expect(cardPayload.videoStep).toBeUndefined();
  });

  it("两步计划在入参层面已经不存在:forVideo / videoPrompt 不再是 propose 的字段", () => {
    const parsed = proposeInput.parse({
      kind: "image",
      structuredPrompt: "Xinyi holding the cat, vertical frame",
      entityIds: [XINYI.id],
      variantSel: {},
      forVideo: true,
      videoPrompt: "Xinyi raises the mug and smiles at the camera",
    } as Record<string, unknown>);

    expect(parsed).not.toHaveProperty("forVideo");
    expect(parsed).not.toHaveProperty("videoPrompt");
  });

  it("就算有人硬塞 forVideo,图片卡上也不再冻结第二步(实现分支已报废)", () => {
    const { cardPayload } = buildProposeCard(
      {
        kind: "image",
        structuredPrompt: "Xinyi holding the cat, vertical frame",
        entityIds: [XINYI.id],
        variantSel: {},
        desiredAspect: "9:16",
        desiredDuration: 15,
        ...({ forVideo: true, videoPrompt: "Xinyi raises the mug and smiles" } as Record<string, unknown>),
      } as Parameters<typeof buildProposeCard>[0],
      turnCtx(),
      [XINYI],
    );

    expect(cardPayload.kind).toBe("image");
    expect(cardPayload.videoStep).toBeUndefined();
  });

  it("工具说明不再教模型「先出图再出片」", () => {
    const description = proposeSkill.description;
    expect(description).not.toMatch(/forVideo/);
    expect(description).not.toMatch(/videoPrompt/);
    expect(description).not.toMatch(/starting picture/i);
  });
});

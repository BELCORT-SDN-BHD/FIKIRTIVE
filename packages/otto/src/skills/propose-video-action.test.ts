/**
 * #775 —— 剪辑/续写这两个动作在**铸卡**那一侧的唯一硬后果:形状必须跟着商家那条片子走。
 *
 * 官方陷阱:改片子/接片子的任务上再指定一个比例,任务会**先被收下、事后才异步失败** ——
 * 商家看到的是一次批准之后石沉大海。所以判据必须落在批准**之前**的卡上,而不是指望
 * 引擎替我们把关。
 */
import { describe, it, expect } from "vitest";
import { VIDEO_ASPECT_ADAPTIVE } from "@fikirtive/core";
import { buildProposeCard, proposeInput } from "./propose.helpers.js";
import type { OttoContext } from "../context.js";

function makeCtx(overrides?: Partial<OttoContext>): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    sourceGenerationId: null,
    ...overrides,
  };
}

const clipCtx = () => makeCtx({ referenceVideoGenerationId: "gen_vid" });
const base = { kind: "video" as const, structuredPrompt: "…", entityIds: [], variantSel: {} };

describe("剪辑/续写:比例强制跟着商家那条片子", () => {
  for (const videoAction of ["editClip", "extendClip"] as const) {
    it(`${videoAction}:商家点了 16:9 也不送 16:9,卡上落 adaptive`, () => {
      const { cardPayload } = buildProposeCard(
        { ...base, desiredAspect: "16:9", videoAction },
        clipCtx(),
        [],
      );
      expect(cardPayload.params.aspectRatio).toBe(VIDEO_ASPECT_ADAPTIVE);
    });

    it(`${videoAction}:换掉的形状必须**说出来**,不许静默降级`, () => {
      const { cardPayload } = buildProposeCard(
        { ...base, desiredAspect: "16:9", videoAction },
        clipCtx(),
        [],
      );
      expect(cardPayload.downgraded).toBe(true);
      expect(cardPayload.downgradeNote).toContain("16:9");
    });

    it(`${videoAction}:商家没点形状 → 照样 adaptive,而且不算降级(他没被换掉任何东西)`, () => {
      const { cardPayload } = buildProposeCard({ ...base, videoAction }, clipCtx(), []);
      expect(cardPayload.params.aspectRatio).toBe(VIDEO_ASPECT_ADAPTIVE);
      expect(cardPayload.downgraded).toBe(false);
    });

    it(`${videoAction}:商家在批准之前就在卡上读到形状跟着他的片子走(双面里的商家面)`, () => {
      const { cardPayload } = buildProposeCard({ ...base, videoAction }, clipCtx(), []);
      expect(cardPayload.specChips).toContain("Same shape as your reference");
      // 卡面永远不许带出引擎名(既有纪律,这条新路上同样成立)。
      for (const chip of cardPayload.specChips) expect(chip.toLowerCase()).not.toContain("seedance");
    });

    it(`${videoAction}:钱一格没动 —— 仍是整段参考片那一档的固定价与固定 5 秒`, () => {
      const { cardPayload, shownPriceDisplay } = buildProposeCard({ ...base, videoAction }, clipCtx(), []);
      expect(cardPayload.estimatedCredits).toBe(16);
      expect(shownPriceDisplay).toBe(16);
      expect(cardPayload.params.durationSeconds).toBe(5);
      expect((cardPayload as Record<string, unknown>)["referenceVideoGenerationId"]).toBe("gen_vid");
    });
  }

  it("照着做一条新的(guideFromClip):今日行为一个字不变 —— 商家选的形状照旧送出去", () => {
    const { cardPayload } = buildProposeCard(
      { ...base, desiredAspect: "16:9", videoAction: "guideFromClip" },
      clipCtx(),
      [],
    );
    expect(cardPayload.params.aspectRatio).toBe("16:9");
  });

  it("没有传 videoAction:今日行为一个字不变", () => {
    const { cardPayload } = buildProposeCard({ ...base, desiredAspect: "16:9" }, clipCtx(), []);
    expect(cardPayload.params.aspectRatio).toBe("16:9");
  });

  it("手上没有片子却报了 editClip:不许把一条普通视频卡悄悄当成剪辑 —— 形状照旧", () => {
    const { cardPayload } = buildProposeCard(
      { ...base, desiredAspect: "16:9", videoAction: "editClip" },
      makeCtx(),
      [],
    );
    expect(cardPayload.params.aspectRatio).toBe("16:9");
    expect((cardPayload as Record<string, unknown>)["referenceVideoGenerationId"]).toBeUndefined();
  });
});

describe("proposeInput 契约", () => {
  it("videoAction 是可选的,老调用一个字不用改", () => {
    expect(proposeInput.safeParse({ kind: "video", structuredPrompt: "x" }).success).toBe(true);
  });

  it("只收能力表里真有的动作", () => {
    expect(proposeInput.safeParse({ kind: "video", structuredPrompt: "x", videoAction: "editClip" }).success).toBe(true);
    expect(proposeInput.safeParse({ kind: "video", structuredPrompt: "x", videoAction: "trimClip" }).success).toBe(false);
  });
});

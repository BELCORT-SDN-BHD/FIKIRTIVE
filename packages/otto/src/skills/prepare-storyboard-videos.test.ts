/**
 * prepare-storyboard-videos.test.ts —— FC-1:对话里那句「直接做」现在有路可走。
 *
 * 现场(Founder 自己的画布,2026-09-14 05:53 UTC):两镜分镜出来之后商家说
 * `can, just do it stragiht away, no need starting image`,而对话这一侧当时**没有任何入口**
 * 通向人工那条链(`StoryboardCard` 的 `Make all videos` → `prepareStoryboardVideos` → 每镜一张
 * 子卡 → 商家确认),模型于是把分镜卡的编号塞进了只认 GEN_CARD 的 `generate`。
 * 取证:docs/audits/founder-canvas-2026-09-14/{report.md,pending-generate-diagnosis.md}。
 *
 * 这个文件钉住这把新工具**自己**的三件事:它转调的是共享动作层(不自建第二套)、它只复述
 * 服务端交回来的那个价、以及它一分钱都不花(`ctx.startGen` 零调用)。端口那一侧(真的接到
 * `storyboard-gate1-actions.prepareStoryboardVideos`)在 apps/web 那边的用例里钉。
 */
import { describe, it, expect, vi } from "vitest";
import { executePrepareStoryboardVideos, prepareStoryboardVideosSkill } from "./prepare-storyboard-videos.js";
import { generateSkill } from "./generate.js";
import type { OttoContext } from "../context.js";

const STORYBOARD_CARD_ID = "01M2F7DPAH7VZQYX722SCWK9JX"; // 现场那张两镜分镜卡

function makeCtx(
  storyboard?: OttoContext["storyboard"],
): { ctx: OttoContext; startGen: ReturnType<typeof vi.fn> } {
  const startGen = vi.fn();
  const ctx = {
    orgId: "org-fc1",
    userId: "user-fc1",
    projectId: "proj-fc1",
    threadId: "thread-fc1",
    disabledModels: [],
    sourceGenerationId: null,
    startGen,
    ...(storyboard ? { storyboard } : {}),
  } as unknown as OttoContext;
  return { ctx, startGen };
}

describe("FC-1 prepareStoryboardVideos —— 对话接上人工那条分镜链", () => {
  it("转调共享动作层,并只复述服务端算出来的那个价(两镜:一镜已付、一镜待确认)", async () => {
    const prepareVideos = vi.fn().mockResolvedValue({
      shots: [
        { shotId: "s0", childCardId: "child-0", estimatedCredits: 22, spent: true },
        { shotId: "s1", childCardId: "child-1", estimatedCredits: 11, spent: false },
      ],
      totalCredits: 11,
    });
    const { ctx, startGen } = makeCtx({ prepareVideos });

    const out = await executePrepareStoryboardVideos({ cardId: STORYBOARD_CARD_ID }, { context: ctx });

    // 转调的是**那一个**动作,拿的是商家给的那张分镜卡编号 —— 没有第二套实现。
    expect(prepareVideos).toHaveBeenCalledTimes(1);
    expect(prepareVideos).toHaveBeenCalledWith(STORYBOARD_CARD_ID);
    expect(out).toEqual({
      ok: true,
      shotsToConfirm: 1,
      alreadyPaidFor: 1,
      // 服务端交回来的那个数,逐字 —— 这里一个价格字面量都不算。
      totalCredits: 11,
      shots: [
        { shotId: "s0", estimatedCredits: 22, spent: true },
        { shotId: "s1", estimatedCredits: 11, spent: false },
      ],
    });
    // $0:铸卡不是花钱。
    expect(startGen).not.toHaveBeenCalled();
  });

  it("共享动作层拒绝时原样端回那句话 —— 不自造第二套说法,零花费", async () => {
    const prepareVideos = vi.fn().mockResolvedValue({ error: "Card not found." });
    const { ctx, startGen } = makeCtx({ prepareVideos });

    const out = await executePrepareStoryboardVideos({ cardId: STORYBOARD_CARD_ID }, { context: ctx });

    expect(out).toEqual({ error: "Card not found." });
    expect(startGen).not.toHaveBeenCalled();
  });

  it("端口没注进来(最小 ctx)⇒ 一句人话,不炸也不假装做过", async () => {
    const { ctx, startGen } = makeCtx(undefined);

    const out = await executePrepareStoryboardVideos({ cardId: STORYBOARD_CARD_ID }, { context: ctx });

    expect(out).toEqual({ error: "Preparing storyboard videos isn't available right now." });
    expect(startGen).not.toHaveBeenCalled();
  });

  it("两把工具的说明书互指:这把点名收分镜卡,generate 点名拒绝分镜卡", () => {
    // 模型手里只有说明书。现场那一轮它选错工具,正是因为没有任何一句话把分镜卡指向别处。
    expect(prepareStoryboardVideosSkill.description).toContain("STORYBOARD_CARD id");
    expect(prepareStoryboardVideosSkill.description).toContain("just do it");
    expect(generateSkill.description).toContain("NEVER pass a storyboard card's id");
    expect(generateSkill.description).toContain("prepareStoryboardVideos");
    // 铸卡不是花钱:这把工具是 free,花费批准仍然只挂在真正付费的那一步上。
    expect(prepareStoryboardVideosSkill.cost).toBe("free");
    expect(prepareStoryboardVideosSkill.needsApproval).toBe(false);
    expect(generateSkill.needsApproval).toBe(true);
  });
});

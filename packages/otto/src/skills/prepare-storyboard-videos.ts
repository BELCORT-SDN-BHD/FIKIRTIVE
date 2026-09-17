/**
 * prepareStoryboardVideos —— $0 skill(FC-1):把分镜变成**每一镜一张可确认的生成卡**。
 *
 * ── 为什么要有这把工具(现场:Founder 自己的画布,2026-09-14)────────────────────────
 *
 * 两镜分镜出来之后商家说 `can, just do it stragiht away, no need starting image`。Otto 答
 * 「这就生成」,然后把 **STORYBOARD_CARD 的编号**交给了只认 GEN_CARD 的 `generate` —— 那把
 * 工具停在花费批准项,没有卡、没有作业,商家读到的只剩一句承诺。
 * 取证:docs/audits/founder-canvas-2026-09-14/{report.md,pending-generate-diagnosis.md}。
 *
 * 病根不在措辞:人工那条链本来就正确 —— `StoryboardCard.tsx` 的 `Make all videos` 先调
 * `prepareStoryboardVideos`($0,读分镜卡、给每一镜铸一张视频子 GEN_CARD、按服务端单源
 * 报价),商家在卡上确认之后才逐张走付费动作。对话这一侧却没有任何入口通向那条链,模型
 * 于是只能把手边唯一的编号塞进 `generate`。这把工具补的就是那个入口。
 *
 * ── 边界 ────────────────────────────────────────────────────────────────────────
 *
 *  · $0:铸卡不是花钱。这里不碰 startGen / reserveCredits / provider,一行账本都不写。
 *  · 花费批准守卫一格不动:子卡仍然要商家在分镜卡上自己确认才会扣费。
 *  · 单一动作层(宪法 7 / Seam 9):owner 闸、卡锁、复用判据、报价、拒绝措辞全在被封装的
 *    那个动作里,这里只经 `ctx.storyboard` 转调,绝不自建第二套实现。
 *  · 报价只报服务端交回来的那个数;这里一个价格字面量都没有。
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import type { OttoContext } from "../context.js";

export const prepareStoryboardVideosInput = z.object({
  cardId: z
    .string()
    .min(1)
    .describe("The STORYBOARD_CARD id from the storyboard card in this conversation."),
});

type PrepareStoryboardVideosInput = z.infer<typeof prepareStoryboardVideosInput>;

export async function executePrepareStoryboardVideos(
  input: PrepareStoryboardVideosInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;
  const port = ctx.storyboard;
  if (!port) return { error: "Preparing storyboard videos isn't available right now." };

  const res = await port.prepareVideos(input.cardId);
  if ("error" in res) return { error: res.error };

  const toConfirm = res.shots.filter((s) => !s.spent);
  return {
    ok: true,
    // 商家还要确认的那几镜,以及服务端算出来的总价 —— 这两个数字是 Otto 唯一该复述的。
    shotsToConfirm: toConfirm.length,
    alreadyPaidFor: res.shots.length - toConfirm.length,
    totalCredits: res.totalCredits,
    shots: res.shots.map((s) => ({ shotId: s.shotId, estimatedCredits: s.estimatedCredits, spent: s.spent })),
  };
}

export const prepareStoryboardVideosSkill = defineOttoSkill({
  name: "prepareStoryboardVideos",
  // 这一次调用不花钱:它只铸卡。真正的扣费在商家自己按下分镜卡上的确认之后发生,
  // 走的是那条一直以来的付费动作 —— 所以这里是 free,不是 spend。
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Turn a storyboard into one confirmable video card per shot. " +
    "Call this whenever the user wants to go ahead with a storyboard they can see in this conversation — " +
    "'make them', 'just do it', 'generate both shots', 'skip the starting image'. " +
    "Pass the STORYBOARD_CARD id, NOT a generation card id: this is the only way a storyboard becomes " +
    "generatable, and `generate` refuses a storyboard id. " +
    "It spends nothing and starts nothing: it prices every shot that still needs a clip and puts " +
    "the quote on the storyboard card. Afterwards tell the user the number of clips and the total credits " +
    "it returned, and that they confirm with Make all videos on the storyboard card — never say the clips " +
    "are being generated, because nothing is generated until they confirm.",
  parameters: prepareStoryboardVideosInput,
  execute: executePrepareStoryboardVideos,
});

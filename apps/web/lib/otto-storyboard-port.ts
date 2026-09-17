/**
 * makeOttoStoryboardPort — the ctx.storyboard port factory (FC-1, $0).
 *
 * 商家在对话里说「就这样直接做」时,Otto 走的必须是**人工那条链**:
 *
 *   StoryboardCard.tsx:651 → prepareStoryboardVideos(闸②,$0 铸每一镜的视频子 GEN_CARD)
 *   → 商家在卡上确认 → StoryboardCard.tsx:679 对子卡调共享付费动作
 *
 * 这个端口只封装那条链的**第一段**(铸卡 + 报价)。它是一层薄封装:owner 闸、锁、复用判据、
 * 报价、拒绝措辞全都留在 `storyboard-gate1-actions.prepareStoryboardVideos` 里 —— 人工 UI
 * 与 Otto 共用同一个动作层(.claude/CLAUDE.md「Shared actions」),第二套实现不存在。
 *
 * $0 by construction:这里不碰 startGen / reserveCredits / provider。铸出来的子卡仍然要商家
 * 自己确认才会花钱 —— 花费批准守卫一格不动。
 *
 * NOT an action surface:没有 "use server",不叫 *-actions —— parity 扫描器不该发现它
 * (它的能力就是被封装那个动作自己的清单条目),与 otto-canvas-port.ts 同一条规矩。
 */
import { prepareStoryboardVideos } from "./storyboard-gate1-actions";

/** 交给技能看的那一份:只有「哪一镜、哪张子卡、多少 credits、是不是已经付过」。
 *  子卡的完整 payload(含型号)从不跨这道边界 —— 与浏览器那一侧同一条口径。 */
export type OttoStoryboardShotQuote = {
  shotId: string;
  childCardId: string;
  estimatedCredits: number;
  spent: boolean;
};

export function makeOttoStoryboardPort() {
  return {
    prepareVideos: async (
      cardId: string,
    ): Promise<{ shots: OttoStoryboardShotQuote[]; totalCredits: number } | { error: string }> => {
      const res = await prepareStoryboardVideos({ cardId });
      if ("error" in res) return { error: res.error };
      return {
        shots: res.children.map((c) => ({
          shotId: c.shotId,
          childCardId: c.childCardId,
          estimatedCredits: c.estimatedCredits,
          spent: c.spent,
        })),
        totalCredits: res.totalCredits,
      };
    },
  };
}

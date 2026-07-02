import { z } from "zod";
import { newId } from "@fikirtive/core";

/** 深度档:一处集中声明,UI/校验/预估全读这里(能力表哲学)。
 *  每档的行为上限(maxSearches/maxPages/maxSteps)与显示预估 credits。
 *  数值单调递增(quick < standard < deep 各轴),此处为 S2 的合理占位;
 *  真实 reserve 走 S3 的 meter 计量(withLlmBudget × margin,≤上限)—— estimatedCredits
 *  仅为卡面 DISPLAY 预估,不是扣费依据。 */
export const RESEARCH_TIERS = {
  quick: { label: "Quick", maxSearches: 5, maxPages: 8, maxSteps: 6, estimatedCredits: 10 },
  standard: { label: "Standard", maxSearches: 12, maxPages: 20, maxSteps: 12, estimatedCredits: 25 },
  deep: { label: "Deep", maxSearches: 25, maxPages: 40, maxSteps: 24, estimatedCredits: 60 },
} as const;

export type ResearchTier = keyof typeof RESEARCH_TIERS;

/** Otto 调 proposeResearch 的输入。goal 是刨根问底资讯门(同 proposeStoryboard)。
 *  questions = 可选子问题(Otto 规划出的研究切入点);tier 默认 standard。 */
export const researchCardInput = z.object({
  topic: z.string().trim().min(3).max(200),
  goal: z.string().optional(),
  tier: z.enum(["quick", "standard", "deep"]).default("standard"),
  questions: z.array(z.string().trim().min(1).max(200)).max(8).optional(),
});
export type ResearchCardInput = z.infer<typeof researchCardInput>;

/** 持久化进 RESEARCH_CARD 的 payload —— 研究计划快照。
 *  researchId = 服务端铸的稳定研究 id(S3 的 job/report 按它定位);
 *  estimatedCredits 从 RESEARCH_TIERS[tier] 取(卡面显示预估);
 *  status 生命周期 planned→running→done/failed 由 S3 推进,S2 只落 "planned"。 */
export type ResearchCardPayload = {
  researchId: string;
  topic: string;
  goal?: string;
  tier: ResearchTier;
  questions: string[];
  estimatedCredits: number;
  status: "planned";
};

/** 纯:输入 → payload(盖 researchId + 从档位取 estimatedCredits)。无 DB、无 SDK。
 *  mintId = 可注入的 id 工厂(默认 newId,otto 已依赖 @fikirtive/core)——测试可传计数器求确定性。 */
export function buildResearchCardPayload(
  input: ResearchCardInput,
  mintId: () => string = newId,
): ResearchCardPayload {
  return {
    researchId: mintId(),
    topic: input.topic,
    ...(input.goal ? { goal: input.goal } : {}),
    tier: input.tier,
    questions: input.questions ?? [],
    estimatedCredits: RESEARCH_TIERS[input.tier].estimatedCredits,
    status: "planned",
  };
}

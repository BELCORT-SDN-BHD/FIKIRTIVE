import { z } from "zod";
import {
  newId,
  turnBudgetInternal,
  llmPricesFor,
  ottoLlmMargin,
  displayCredits,
} from "@fikirtive/core";

/** The model whose prices the worker meters research against. Mirrors OTTO_DEFAULT_MODEL
 *  (packages/otto/src/model.ts). Inlined as a bare string — NOT imported from ../model.ts —
 *  so this pure, client-adjacent helpers module never drags the Agents/AI-SDK value graph
 *  (aisdk(...)) into a bundle. llmPricesFor resolves any "sonnet…" id to the sonnet table. */
const RESEARCH_METER_MODEL = "claude-sonnet-4-6";

/** 每档 maxSteps → 卡面 DISPLAY 预估 credits,DERIVED(不再拍脑袋占位)。
 *
 *  worker(apps/worker/src/jobs/research.ts)对整段 research 循环用一个
 *  `withLlmBudget({ model: OTTO_DEFAULT_MODEL, maxSteps: tier.maxSteps })` 计量;它 reserve 的正是
 *  `turnBudgetInternal(llmPricesFor(OTTO_DEFAULT_MODEL), ottoLlmMargin(), maxSteps)`(INTERNAL credits)。
 *  卡面显示走 DISPLAYED 单位(全 UI 惯例:estimatedCredits = displayCredits(internal),见
 *  propose.helpers.ts 的 gen 卡),故这里 = displayCredits(那个 reserve),Math.ceil 到整数显示 credit。
 *  → 卡面估值 ≈ worker 真 reserve(同一档、同一模型、同一 margin),不是另拍的数。 */
export function researchTierEstimate(maxSteps: number): number {
  const internal = turnBudgetInternal(llmPricesFor(RESEARCH_METER_MODEL), ottoLlmMargin(), maxSteps);
  return Math.ceil(displayCredits(internal));
}

/** 深度档:一处集中声明,UI/校验/预估全读这里(能力表哲学)。
 *  每档的行为上限(maxSearches/maxPages/maxSteps)与显示预估 credits。
 *  数值单调递增(quick < standard < deep 各轴);estimatedCredits 由 researchTierEstimate 从
 *  worker 的 withLlmBudget reserve 推导 —— 仍是卡面 DISPLAY 预估,真扣在 worker(settle 实际 token 数)。 */
export const RESEARCH_TIERS = {
  quick: { label: "Quick", maxSearches: 5, maxPages: 8, maxSteps: 6, estimatedCredits: researchTierEstimate(6) },
  standard: { label: "Standard", maxSearches: 12, maxPages: 20, maxSteps: 12, estimatedCredits: researchTierEstimate(12) },
  deep: { label: "Deep", maxSearches: 25, maxPages: 40, maxSteps: 24, estimatedCredits: researchTierEstimate(24) },
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

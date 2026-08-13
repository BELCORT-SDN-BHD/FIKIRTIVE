/**
 * research-card — PURE 渲染侧解析:把 DB 存的 RESEARCH_CARD payload(unknown)
 * 防御式映射成视图模型。无 React / 无 I/O,可在 node 测试跑(对齐 storyboard-card)。
 * 单一真相源 = @fikirtive/otto 的 ResearchCardPayload;此处只做 defensive typeof 兜底,
 * 好让遗留/半成 payload 也能渲染出一张卡而不抛。
 */
import type { ResearchCardPayload } from "@fikirtive/otto";

/** 深度档标签(client-safe 常量副本)。权威值在 @fikirtive/otto 的 RESEARCH_TIERS.label;
 *  此处保留一份纯值副本,好让 "use client" 的 ResearchCard 引用它而不必把 otto barrel
 *  (→ skills → prisma → pg)拖进浏览器 bundle。KNOWN_TIERS 定死已知档,未知档兜底 standard。 */
export const RESEARCH_TIER_LABELS = {
  quick: "Quick",
  standard: "Standard",
  deep: "Deep",
} as const;

export type ResearchTierView = keyof typeof RESEARCH_TIER_LABELS;

/** 卡状态:S2 只落 "planned";running/done/failed 由 S3/S4 推进。视图侧认这四态,
 *  未知/缺失 → "planned"(最保守:显示可审批的计划态)。 */
export type ResearchStatusView = "planned" | "running" | "done" | "failed";

export interface ResearchCardView {
  topic: string;
  goal?: string;
  tier: ResearchTierView;
  questions: string[];
  /** null ⇒ 这张卡没有一个担保得住的报价。缺价的卡不许显示价、不许批准(#896 r2 P0-b)。 */
  estimatedCredits: number | null;
  status: ResearchStatusView;
}

const KNOWN_STATUS: ReadonlySet<string> = new Set<ResearchStatusView>(["planned", "running", "done", "failed"]);

export function parseResearchCardPayload(payload: unknown): ResearchCardView {
  const p = (payload ?? {}) as Partial<ResearchCardPayload> & { status?: unknown };
  const topic = typeof p.topic === "string" ? p.topic : "";
  const rawTier = typeof p.tier === "string" ? p.tier : "";
  // 未知档(遗留/半成 payload)→ standard(默认档,与 zod default 一致)。
  const tier: ResearchTierView = rawTier in RESEARCH_TIER_LABELS ? (rawTier as ResearchTierView) : "standard";
  const questions = Array.isArray(p.questions)
    ? p.questions.filter((q): q is string => typeof q === "string")
    : [];
  // #896 r2 P0-b:报价只认**正的安全整数**;缺失 / 非数字 / 0 / 负数 / 小数 → null。
  // 之前这里兜底成 0,而 0 一路装成一个真报价:canAffordPack(0, 任何余额) 恒真,按钮
  // 因此是启用的、写着「Run research · 0 credits」,商家按下去,服务端却按 tier 的正数
  // 预算真跑起来 —— 屏幕上的价和实际扣的钱是两个数。与 GEN_CARD 的 guaranteedCredits 同一条口径。
  const rawCredits: unknown = p.estimatedCredits;
  const estimatedCredits =
    typeof rawCredits === "number" && Number.isSafeInteger(rawCredits) && rawCredits > 0
      ? rawCredits
      : null;
  const rawStatus = typeof p.status === "string" ? p.status : "";
  const status: ResearchStatusView = KNOWN_STATUS.has(rawStatus) ? (rawStatus as ResearchStatusView) : "planned";
  return {
    topic,
    ...(typeof p.goal === "string" && p.goal ? { goal: p.goal } : {}),
    tier,
    questions,
    estimatedCredits,
    status,
  };
}

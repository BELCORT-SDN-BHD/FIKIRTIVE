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

/** 卡状态:S2 只落 "planned";running/done 由 S3/S4 推进。视图侧提前认这三态,
 *  未知/缺失 → "planned"(最保守:显示可审批的计划态)。 */
export type ResearchStatusView = "planned" | "running" | "done";

export interface ResearchCardView {
  topic: string;
  goal?: string;
  tier: ResearchTierView;
  questions: string[];
  estimatedCredits: number;
  status: ResearchStatusView;
}

const KNOWN_STATUS: ReadonlySet<string> = new Set<ResearchStatusView>(["planned", "running", "done"]);

export function parseResearchCardPayload(payload: unknown): ResearchCardView {
  const p = (payload ?? {}) as Partial<ResearchCardPayload> & { status?: unknown };
  const topic = typeof p.topic === "string" ? p.topic : "";
  const rawTier = typeof p.tier === "string" ? p.tier : "";
  // 未知档(遗留/半成 payload)→ standard(默认档,与 zod default 一致)。
  const tier: ResearchTierView = rawTier in RESEARCH_TIER_LABELS ? (rawTier as ResearchTierView) : "standard";
  const questions = Array.isArray(p.questions)
    ? p.questions.filter((q): q is string => typeof q === "string")
    : [];
  const estimatedCredits = typeof p.estimatedCredits === "number" ? p.estimatedCredits : 0;
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

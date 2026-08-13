/**
 * recallStoreKnowledge — $0 read skill:Otto 取回后台已经读懂的素材(#784)。
 *
 * 这是三件套在对话侧的**唯一**出口,也是「Otto 好像认识我的店」那句体感在代码里的落点:
 * 理解在后台自动跑完(apps/worker 的 understand 队列),商家从来没点过「分析」,
 * 然后 Otto 在需要的时候把「我看过你传的东西,这些是我看到的」讲出来。
 *
 * 刻意**没有**「开始分析」这个动作:票面把它写成设计铁律。这个 skill 是 read/free/internal,
 * 所以 defineOttoSkill 推导出来的 needsApproval 是 false —— 读自己已经存下的东西不需要谁点头。
 *
 * 身份只从 ctx.orgId 来。参数里连一个 ownerId 形状的字段都没有(工厂会拒),
 * 每一次查询都带租户 —— 越租户读一行,就是把 A 家的菜单讲给 B 家听。
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { prisma } from "@fikirtive/db";
import { UNDERSTANDING_KINDS, redactProviderNames } from "@fikirtive/core";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

/** 一次最多取回几条。上下文是有限的,而这张表会随商家的素材库一直长。 */
const MAX_RESULTS = 12;

export const recallStoreKnowledgeParams = z.object({
  /** 自由文本筛选(商家自己的词汇:"menu"、"mug"、"shopfront")。留空 = 最近读懂的。 */
  query: z.string().max(80).optional(),
  /** 只要某一类。留空 = 全部三类。 */
  kind: z.enum(UNDERSTANDING_KINDS).optional(),
  limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
});

type RecallInput = z.infer<typeof recallStoreKnowledgeParams>;

export interface RecalledUnderstanding {
  /** My Stuff 里那件素材的 id —— Otto 要指名某一件时用它,不要自己编。 */
  assetId: string;
  kind: string;
  /** 商家读得到的那一句。 */
  summary: string;
  /** 该类的结构化产物(品类/颜色/场景;产品行;门店事实)。 */
  details: unknown;
  readAt: string;
}

/**
 * 一件**没能读成**的素材,带上商家读得懂的原因。
 *
 * 为什么它必须在返回值里:上一版只查 `status: "DONE"`,于是一件落了终态(SKIPPED/FAILED)
 * 的素材在 Otto 眼里和「还没轮到」长得一模一样 —— 商家会听到「稍后会自动读」,而那件素材
 * 已经永远不会再被读了。那是一句**说谎**,而且是商家没有办法自己发现的那一种。
 * 现在原因如实带出来:措辞在 @fikirtive/core 那一侧就是白标 + 商家可懂的英文。
 */
export interface UnreadFile {
  assetId: string;
  kind: string;
  /** 白标、商家读得懂的一句(UNDERSTANDING_* 那几条)。 */
  reason: string;
}

/** 终态里「读不成」的那两个。它们不会自己重来 —— 所以不许对商家说「稍后会自动读」。 */
const NOT_READ_STATUSES = ["SKIPPED", "FAILED"] as const;

export async function executeRecallStoreKnowledge(
  input: RecallInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ understood: RecalledUnderstanding[]; notRead?: UnreadFile[]; note?: string }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;
  const limit = input.limit ?? 6;

  const rows = await prisma.assetUnderstanding.findMany({
    where: {
      ownerId: ctx.orgId,
      status: { in: ["DONE", ...NOT_READ_STATUSES] },
      ...(input.kind ? { kind: input.kind } : {}),
    },
    orderBy: { createdAt: "desc" },
    // 先多取一些再在应用层做子串匹配 —— 和 lookupProducts 同一条既有做法(catalog 设计边界)。
    take: input.query ? 200 : limit,
    select: { assetId: true, kind: true, status: true, summary: true, data: true, error: true, createdAt: true },
  });

  const q = input.query?.trim().toLowerCase();
  const matched = q
    ? rows.filter((r) => `${r.summary} ${JSON.stringify(r.data ?? {})}`.toLowerCase().includes(q))
    : rows;

  const understood = matched
    .filter((r) => r.status === "DONE")
    .slice(0, limit)
    .map((r) => ({
      assetId: r.assetId,
      kind: r.kind,
      // 白标兜底:落盘那一侧已经不放供应商名,这里再过一次 —— 这段文字会直接进 Otto 的嘴。
      summary: redactProviderNames(r.summary),
      details: r.data ?? null,
      readAt: r.createdAt.toISOString(),
    }));

  // 读不成的那些也带上 —— 哪怕同时有读成的(混着的时候把失败藏起来是同一句谎话的弱化版)。
  const notRead = matched
    .filter((r) => (NOT_READ_STATUSES as readonly string[]).includes(r.status))
    .slice(0, limit)
    .map((r) => ({
      assetId: r.assetId,
      kind: r.kind,
      reason: redactProviderNames(r.error ?? "That file couldn't be read."),
    }));

  if (understood.length === 0) {
    return {
      understood: [],
      ...(notRead.length > 0 ? { notRead } : {}),
      note:
        notRead.length > 0
          ? "Nothing has been read successfully from this account's files. The files under `notRead` were " +
            "each tried and could not be used — the reason on each one is safe to tell the user in their own " +
            "words. Those will NOT be retried on their own, so do not promise the user they will be read " +
            "later. There is no analyse button anywhere, so never offer to start an analysis either; if the " +
            "user wants one of those files used, the honest suggestion is to upload a clearer or smaller " +
            "version of it."
          : "Nothing has been read from this account's files yet. New photos and clips are read automatically " +
            "in the background shortly after they arrive — there is no button for the user to press, so never " +
            "offer to start one or tell the user to run an analysis.",
    };
  }
  return {
    understood,
    ...(notRead.length > 0 ? { notRead } : {}),
    ...(notRead.length > 0
      ? {
          note:
            "The files under `notRead` were tried and could not be used. They will NOT be retried on their " +
            "own — never tell the user those are still being read or will be read later.",
        }
      : {}),
  };
}

export const recallStoreKnowledgeSkill = defineOttoSkill({
  name: "recallStoreKnowledge",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Recall what has already been read from the user's own photos and clips — the product photos, menus and " +
    "premises videos they uploaded. $0 read-only. Returns the plain-language read of each file plus its " +
    "structured details (category, colours, setting; menu items; durable facts about the place) and its assetId. " +
    "Use it BEFORE writing copy, naming a product or describing the business, so what you say matches what the " +
    "user actually sells and how their place actually looks. " +
    "Pass `query` to filter by the user's own words (e.g. 'menu', 'mug', 'shopfront'); `kind` narrows to one type. " +
    "It also returns `notRead`: files that were tried and could not be used, each with a plain-language reason. " +
    "Those are finished — they will NOT be retried on their own, so never say one is still being read or will be " +
    "read later; say what went wrong if the user asks about that file. " +
    "IMPORTANT: this reading happens automatically in the background — there is no analyse button anywhere. " +
    "Never offer to analyse a file, never ask the user to start one, and never say a file is 'being analysed'. " +
    "If nothing is here yet, simply work from what the user tells you.",
  parameters: recallStoreKnowledgeParams,
  execute: executeRecallStoreKnowledge,
});

export const recallStoreKnowledge = recallStoreKnowledgeSkill.tool;

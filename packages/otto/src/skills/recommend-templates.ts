/**
 * recommendTemplates — $0 模板库查询 skill(free/read/internal ⇒ 不审批)。#783 的 Otto 面。
 *
 * 票的双面验收:商家自己在 Workspace › Templates 点得到的那 43 个马来西亚场景,Otto 也要
 * 按行业/节庆推得到,而且推的必须是**同一份**目录 —— 所以数据在 `@fikirtive/core/templates`,
 * 这里只是读它。抄一份模板给 Otto 用,就是又一次「说的与做的失同步」。
 *
 * 这个 skill **不生成、不落盘、不花钱**:它返回场景 + 那一段已经写好的英文 prompt,
 * 由 Otto 把 prompt 交给 `propose`(付费闸在那里,照旧先问后花)。
 *
 * 两种用法(同一个 skill):
 *   ① 不给 templateId → 按 industry / occasion / query 推荐一小把;
 *   ② 给 templateId(需要作答的模板再带 answer)→ 拿那一条可直接用的 prompt。
 */
import { z } from "zod";
import {
  RECOMMEND_LIMIT_MAX,
  buildTemplatePrompt,
  recommendTemplates as pickTemplates,
  templateById,
  type Template,
} from "@fikirtive/core/templates";
import type { RunContext } from "@openai/agents";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const params = z.object({
  industry: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe("How the merchant describes their business, in their own words (e.g. 'nasi lemak stall', 'hijab boutique', 'bengkel kereta')."),
  occasion: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe("The festival, season or sale the merchant is preparing for (e.g. 'Hari Raya', 'Deepavali', '11.11'). Leave empty when they did not name one."),
  query: z
    .string()
    .trim()
    .max(240)
    .optional()
    .describe("Anything else the merchant said about what they want to make (e.g. 'main image for my Shopee listing')."),
  templateId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .describe("Ask for ONE template by id to get its ready-to-use prompt. Ids come from a previous call."),
  answer: z
    .string()
    .trim()
    .max(240)
    .optional()
    .describe("The merchant's answer to that template's question. Only meaningful together with templateId."),
  limit: z.number().int().min(1).max(RECOMMEND_LIMIT_MAX).optional(),
});

type RecommendTemplatesInput = z.infer<typeof params>;

// Founder 2026-09-03 裁决 —— **这里曾经有一句话,现在没有了。**
//
// 那句话是 `TEMPLATES_SELF_SERVE`:「商家也可以自己来:Create(/create#templates)有一个
// Templates 区段」。W2-11 的新壳把 Templates 收编进 Create 之后,那个区段根本不再渲染
// (`/create` 今天只挂 Otto 入口与画布历史),所以这句话是**当着商家的面说的一句假话** ——
// 他照着走过去,那里什么都没有。缺陷登记在 docs/specs/frontend-baseline.md 的差异表。
//
// 为什么是删掉而不是换个地址:换成不带锚点的 `/create` 也不成立 —— 那个页面就是 Otto 自己,
// 「你也可以自己去 Create 做」等于把正在跟他说话的这条路指回给他。今天这条路上没有第二个
// 自助入口可指,那就一个都不指;哪天 Templates 区段真的接回来,再把它写回这里。
//
// 围栏:下面那条 nextStep 的测试反着钉这一条(不许再出现 "Templates section" 与
// "#templates"),把这句话贴回来就红。

const NEXT_STEP =
  "Nothing has been made or charged. To make one: take the template's `prompt` (that is the finished English prompt — do not rewrite it), " +
  "pass it to propose as structuredPrompt with the merchant's product photo as the referenced entity, and pass the template's `aspect` as desiredAspect when it has one. " +
  "propose asks the merchant before anything is charged. " +
  "Each template also carries ready social captions by language — offer them, do not invent your own translations.";

/** 一条模板给模型看的样子。有问题且还没答案时给 `question` 而不是半成品 prompt。 */
export function templateForModel(t: Template, answer?: string): Record<string, unknown> {
  const answered = !t.question || (answer ?? "").trim().length > 0;
  return {
    id: t.id,
    name: t.name,
    whatItMakes: t.description,
    category: t.category,
    needsProductPhoto: t.needsImage,
    ...(t.aspectRatio ? { aspect: t.aspectRatio } : {}),
    ...(t.question ? { askFirst: t.question.label, example: t.question.placeholder } : {}),
    ...(answered ? { prompt: buildTemplatePrompt(t, answer) } : {}),
    ...(t.rendersHeadline ? { drawsTheirWordsOnTheImage: true } : {}),
    captions: t.captions.map((c) => ({ language: c.language, text: c.text })),
  };
}

export async function executeRecommendTemplates(
  input: RecommendTemplatesInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  if (!runContext) throw new Error("OttoContext required");

  if (input.templateId) {
    const t = templateById(input.templateId);
    if (!t) {
      return {
        ok: false,
        error: `There is no template called "${input.templateId}". Call this skill without templateId to see what exists.`,
      };
    }
    if (t.question && !(input.answer ?? "").trim()) {
      return { ok: true, count: 1, templates: [templateForModel(t)], askUserFirst: t.question.label, nextStep: NEXT_STEP };
    }
    return { ok: true, count: 1, templates: [templateForModel(t, input.answer)], nextStep: NEXT_STEP };
  }

  const picked = pickTemplates({
    industry: input.industry,
    occasion: input.occasion,
    query: input.query,
    limit: input.limit,
  });
  return {
    ok: true,
    count: picked.length,
    templates: picked.map((t) => templateForModel(t)),
    nextStep: NEXT_STEP,
  };
}

export const recommendTemplatesSkill = defineOttoSkill({
  name: "recommendTemplates",
  // 只读一份内建目录:不落盘、不出网、不花钱 ⇒ needsApproval=false。
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Look up the built-in template library — ready-made one-tap scenarios written for Malaysian small businesses " +
    "(Hari Raya, Chinese New Year, Deepavali, Merdeka, Ramadan bazaar, marketplace listing images, food and drink shots, " +
    "grand openings, service before-and-afters, social posts). " +
    "Call this whenever the merchant asks what to post, mentions a festival or a sale date, says they are stuck, " +
    "or wants something for a marketplace listing — and call it before writing a prompt yourself, because these are " +
    "already written and tuned. Pass `industry` in the merchant's own words, `occasion` when they named one, and " +
    "`query` for anything else they said. Then call again with `templateId` (plus `answer` if the template asks a " +
    "question) to get that template's finished prompt. $0 — this only reads the library; it makes nothing and charges nothing.",
  parameters: params,
  execute: executeRecommendTemplates,
});

/**
 * researchWeb — external-read skill (G3a)
 *
 * Grounds Otto on the real web: fetches a brand's website (or any public URL) and
 * returns the extracted text so Otto can cite it in proposals, briefs, or brand facts.
 *
 * ── What it costs (MONEY-A10, spec docs/specs/money-engine.md §7.4) ─────────────────────────
 * READING a page (`url` mode) is genuinely free: our own fetch + extract, no provider bill.
 * SEARCHING (`query` mode) is not, and never was — it hits the same paid search API deep research
 * hits. Until 2026-09-02 this file said "$0", which is what "nobody priced it" looks like from the
 * inside; every chat search was bought by the platform and billed to nobody. It is now on the SAME
 * 3× rate as deep research (Founder 2026-07-03's ruling, `searchUnitChargeInternal`), settled by
 * the turn's own `withLlmBudget` leg — see runtime.ts `ottoBudgetArgsFor`.
 *
 * `cost: "free"` STAYS, and that is not the old lie coming back. In this codebase that field is
 * the approval router (`needsApproval = cost === "spend" || …`), and the spec's control for A10 is
 * a per-turn cap plus an honest refusal, not a confirm dialog — flipping it to "spend" would put an
 * approval card in front of every passing fact-check, and demand an `idempotencyKey` this call has
 * no charge of its own to key (the charge is the turn's, keyed by the turn's refId). Same reading
 * import-media.ts carries for MONEY-A9. What the field cannot say, the description does: the price
 * is quoted there, derived, never hand-copied.
 *
 * Gate: cost:"free" + effect:"read" + reach:"external" → needsApproval = false.
 * External reads are NOT gated by the 3-field rule (only external WRITES are).
 *
 * The skill reaches the web ONLY through ctx.research (the injected port). It never
 * calls fetch() directly — the ctx-port rule is enforced.
 *
 * Two modes:
 *   url   → ctx.research.readPage?(url, page) when wired (cached, page-by-page — Nous-style);
 *           else falls back to ctx.research.fetchUrl(url) (backward compatible).
 *   query → ctx.research.search?(query) — thin results when a search transport is configured,
 *           under the per-turn slot protocol below; else a graceful "not configured" message.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { OTTO_CHAT_MAX_SEARCHES_PER_TURN, displayCredits, searchUnitChargeInternal } from "@fikirtive/core";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const MAX_TEXT = 6000; // chars — same cap brand-research uses before the LLM

export const researchWebInput = z.object({
  url: z.string().url().optional().describe("A public URL to fetch and read (e.g. the brand's homepage)."),
  query: z.string().min(1).optional().describe("A search query to find web pages about a topic."),
  page: z.number().int().min(1).optional().describe("With url: which page of a long page's text to read (1-based). Read page-by-page; don't dump the whole page."),
}).superRefine((val, ctx) => {
  if (!val.url && !val.query) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either url or query — at least one is required.",
    });
  }
});

type ResearchWebInput = z.infer<typeof researchWebInput>;

// ---------------------------------------------------------------------------
// Execute function — exported for direct unit-testing (same pattern as describe-refs)
// ---------------------------------------------------------------------------

export async function executeResearchWeb(
  input: ResearchWebInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const context = runContext.context as OttoContext;

  if (!context.research) {
    return {
      error: "Web research isn't available in this environment — ask the user to provide the information directly.",
    };
  }

  // URL mode — always wired. Prefer cached paging (readPage) when the port has it,
  // so a long research loop reads page-by-page; else fall back to the old fetchUrl shape.
  if (input.url) {
    try {
      if (context.research.readPage) {
        const result = await context.research.readPage(input.url, input.page);
        return {
          url: result.url,
          title: result.title ?? null,
          page: result.page,
          totalPages: result.totalPages,
          text: result.text.slice(0, MAX_TEXT),
        };
      }
      const result = await context.research.fetchUrl(input.url);
      return {
        url: result.url,
        title: result.title ?? null,
        text: result.text.slice(0, MAX_TEXT),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Failed to fetch that URL." };
    }
  }

  // Search mode — only wired when a search transport is configured. CHARGED (MONEY-A10).
  if (input.query) {
    const search = context.research.search;
    if (!search) {
      return {
        message:
          "Web search isn't configured yet — give me the brand's website URL and I'll read it.",
      };
    }
    const slots = context.research.searchSlots;
    if (!slots) {
      // FAIL CLOSED. A wired search with no slot counter is a search nobody can bill: the turn's
      // settle leg reads `slots.succeeded`, so without it the merchant would get provider calls
      // the platform silently pays for — the exact hole MONEY-A10 closes. Refuse instead.
      return {
        message:
          "Web search isn't available in this environment — give me the brand's website URL and I'll read it.",
      };
    }
    // 占槽:检查与递增之间**没有 await**,所以单步 fan-out 的 6 次并发调用会依次通过这一段,
    // 只有前 5 次拿得到槽(OttoSearchSlots 的文件注释是这个协议的完整说明)。
    if (slots.taken >= OTTO_CHAT_MAX_SEARCHES_PER_TURN) {
      return {
        refused: true,
        reason:
          `Search limit reached for this turn (${OTTO_CHAT_MAX_SEARCHES_PER_TURN} searches). ` +
          "Work with what you already found, read a specific page with url, or offer the merchant " +
          "deep research (proposeResearch) — it is built for multi-source digging and they approve the cost first.",
      };
    }
    slots.taken += 1;
    try {
      const { results } = await search(input.query);
      slots.succeeded += 1; // 只有真的拿到 provider 结果才计费
      return { results };
    } catch (e) {
      slots.taken -= 1; // 失败释放槽,不计费(重试仍受上限约束,因为成功的槽不会被释放)
      return { error: e instanceof Error ? e.message : "Failed to search the web." };
    }
  }

  // Unreachable (superRefine guards this), but satisfies the type checker
  return { error: "Provide either url or query." };
}

// ---------------------------------------------------------------------------
// SDK tool definition
// ---------------------------------------------------------------------------

/** 价现算,不手抄(同 research-agent.ts 的 searchSources、import-media.ts):工具描述是**说给模型
 *  听的**价目表,抄一份在这里,涨价当天模型就会拿着旧数字决定该不该搜。 */
const SEARCH_COST_PER_QUERY_DISPLAY = displayCredits(searchUnitChargeInternal("basic"));

export const researchWebSkill = defineOttoSkill({
  name: "researchWeb",
  // 见文件头:这个字段是审批路由(needsApproval),不是价目表。query 腿是收费的,价钱写在
  // description 里,由 searchUnitChargeInternal 现算。
  cost: "free",
  effect: "read",
  reach: "external",
  description:
    "Fetch a public web page or search the web to ground your response in real information. " +
    "Use this BEFORE producing work that depends on a brand's website, a competitor's page, " +
    "or any current information you don't already have in context. " +
    "Pass url to read a specific page (e.g. a brand homepage); pass query to search the web. " +
    `Reading a page with url is free. Each query search COSTS THE MERCHANT CREDITS (about ${SEARCH_COST_PER_QUERY_DISPLAY} credits), ` +
    `and this turn allows at most ${OTTO_CHAT_MAX_SEARCHES_PER_TURN} searches — past that the tool refuses and you should offer deep research instead. ` +
    "So search only when the answer actually needs the live web, and read the pages you already found before searching again. " +
    "Neither mode requires approval.",
  parameters: researchWebInput,
  execute: executeResearchWeb,
});

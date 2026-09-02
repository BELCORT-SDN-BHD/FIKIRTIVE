/**
 * researchAgent — the bounded research agent (Otto research S3, Task 2 · Part A).
 *
 * A SMALL agent that researches ONE topic: it uses `searchSources` to find sources and
 * `readSource` to read the useful ones page-by-page, then writes a thorough, well-organized
 * report grounded ONLY in what it read. Its FINAL message text IS the report synthesis.
 *
 * MONEY-SAFETY: this file makes NO credit calls — it only walks the injected `ctx.search` /
 * `ctx.readPage` ports and bumps in-context counters. But "no credit call here" is NOT the same
 * as "free", and conflating the two is exactly how the search fee went unpriced for months:
 *
 *   readSource     genuinely FREE — reading a public page costs us nothing.
 *   searchSources  **CHARGED** (钱路 M1-c, Founder 2026-07-03's 3× ruling). The charge is not
 *                  made here; `ctx.searchesUsed` is what the worker wrapper settles against
 *                  (apps/worker/src/jobs/research.ts passes it as withLlmBudget's
 *                  `extraSettleInternal`). So every increment of that counter is real money.
 *
 * The other cost is the LLM tokens the agent consumes, metered by `withLlmBudget` at the same
 * worker wrapper — NEVER here.
 *
 * The caps (maxSearches / maxPages) are enforced INSIDE the tools: past the cap the tool returns
 * a refusal string (not a throw), so the agent gracefully synthesizes from what it has. maxSteps
 * (the LLM turn budget) is the withLlmBudget reserve cap, enforced by run()'s maxTurns.
 */
import { Agent, tool } from "@openai/agents";
import { z } from "zod";
import { OTTO_OUTPUT_CAP_TOKENS, displayCredits, searchUnitChargeInternal } from "@fikirtive/core";
import { ottoModel } from "./model.js";

/**
 * ResearchContext — the small, mutable per-run context injected by the worker.
 *
 * `search`(计费,见上) / `readPage`(免费)are the outside-world ports (worker wires them from env keys +
 * core adapters). `sourcesRead` accumulates the {url,title} of every page actually read (deduped)
 * so the report can cite them. The counters cap tool use; the tools read them + the caps.
 */
export type ResearchContext = {
  /** Thin web search — returns {title,url,snippet}[] (worker wires tavily/brave via env).
   *  **Optional**(MONEY-A10 收敛):没有配置任何搜索 key 时,worker 注入 `undefined` ——
   *  搜索源不可用就诚实说不可用($0),而不是给一个永远返回空数组的假端口,让 agent 以为
   *  它搜过了、还替商家付了一次钱。 */
  search?: (q: string) => Promise<{ title: string; url: string; snippet: string }[]>;
  /** Read ONE page of a public URL's clean text (worker wires fetchAndExtract + page-slice). */
  readPage: (
    url: string,
    page?: number,
  ) => Promise<{ url: string; title: string; page: number; totalPages: number; text: string }>;
  /** Sources actually read this run (deduped by url) — becomes the report's citation list. */
  sourcesRead: { url: string; title: string }[];
  /** Cap: how many searchSources calls are allowed. */
  maxSearches: number;
  /** Cap: how many readSource calls are allowed. */
  maxPages: number;
  /** MONEY-A10 in-flight 槽 —— **上限判的是这个数**,不是 searchesUsed。调用前占一槽,失败
   *  释放,成功保留。纯「成功后计数」会被单步并发 fan-out 绕过上限(6 次并发全部先通过检查),
   *  占槽把这条路堵死。与聊天侧 `OttoSearchSlots.taken` 同一个协议。 */
  searchesTaken: number;
  /** 计费计数器 —— 真正**成功**返回结果的 searchSources 次数(starts at 0)。worker 的
   *  `extraSettleInternal` 按它结算,所以失败的调用一分钱都不收(#1046-P2)。 */
  searchesUsed: number;
  /** Internal counter — readSource calls made so far (starts at 0). */
  pagesUsed: number;
};

const searchInput = z.object({
  query: z.string().trim().min(1).describe("A focused web-search query for one sub-question."),
});

const readInput = z.object({
  url: z.string().url().describe("A source URL from a prior searchSources result."),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Which page of a long page's text to read (1-based). Read page-by-page; don't try to read it all at once."),
});

/**
 * executeSearchSources — the searchSources tool body. Exported for direct unit-testing (same
 * pattern as executeResearchWeb). Makes no credit call itself — but every `ctx.searchesUsed`
 * increment below is what the worker settles against, so this counter IS the bill.
 */
export async function executeSearchSources(
  input: z.infer<typeof searchInput>,
  runContext: { context: ResearchContext },
): Promise<unknown> {
  const ctx = runContext.context;
  const search = ctx.search;
  if (!search) {
    // 没有配置任何搜索 key。诚实说不可用($0),不假装搜过 —— 从前这里拿到的是一个恒返回 []
    // 的 stub,agent 以为自己搜了一次、商家也真的被收了一次钱(#1046-P2 的一半)。
    return {
      unavailable: true,
      reason:
        "Web search isn't available in this environment. Write the report from the sources you can read with readSource, and say plainly what you could not verify.",
    };
  }
  // 上限判**已占槽数**;检查与占槽之间没有 await(单步并发 fan-out 因此只能占满上限,不能越过)。
  if (ctx.searchesTaken >= ctx.maxSearches) {
    return {
      refused: true,
      reason: `Search budget reached (${ctx.maxSearches} searches). Read the sources you have and write the report now.`,
    };
  }
  ctx.searchesTaken += 1;
  try {
    const results = await search(input.query);
    ctx.searchesUsed += 1; // 计费只认成功返回的那一次(#1046-P2)
    return { results };
  } catch (e) {
    ctx.searchesTaken -= 1; // 失败释放槽,不计费
    return { error: e instanceof Error ? e.message : "Search failed." };
  }
}

/**
 * searchSources — **CHARGED** thin web search. Refuses past ctx.maxSearches (counter cap) so a
 * runaway agent can't burn the whole search budget. Returns thin {title,url,snippet}[]; the agent
 * picks which URLs to actually read.
 *
 * 钱路 M1-c:描述里那句价格是**算出来的**,不是写死的。这是同一条 Pricing truth 铁律 ——
 * 提示词里抄一个价,就是把价目表复制到了一个没人会想起要更新的地方,而这一份还是**说给
 * 模型听的**:它一旦过期,过期的那句话会直接改变 agent 的搜索行为。
 */
const SEARCH_COST_PER_CALL_DISPLAY = displayCredits(searchUnitChargeInternal("basic"));

export const searchSources = tool<typeof searchInput, ResearchContext>({
  name: "searchSources",
  description:
    "Search the web for sources about your topic. Returns thin results (title, url, snippet) — " +
    "pick the most promising URLs and read them with readSource. " +
    `COSTS CREDITS: each search is billed to the merchant (about ${SEARCH_COST_PER_CALL_DISPLAY} credits per search), ` +
    "and they are charged for the searches you actually run — not for your budget. " +
    "So spend only what the question needs: a few well-chosen searches beat many redundant ones, " +
    "and stopping early genuinely saves the merchant money.",
  parameters: searchInput,
  execute: async (input, runContext) => {
    if (!runContext) throw new Error("ResearchContext required");
    return executeSearchSources(input, runContext);
  },
});

/**
 * executeReadSource — the readSource tool body. Exported for direct unit-testing. FREE: no credit
 * calls, only ctx.readPage + the counter cap + dedup-recording into ctx.sourcesRead.
 */
export async function executeReadSource(
  input: z.infer<typeof readInput>,
  runContext: { context: ResearchContext },
): Promise<unknown> {
  const ctx = runContext.context;
  if (ctx.pagesUsed >= ctx.maxPages) {
    return {
      refused: true,
      reason: `Reading budget reached (${ctx.maxPages} page reads). Write the report from what you've read.`,
    };
  }
  ctx.pagesUsed += 1;
  try {
    const r = await ctx.readPage(input.url, input.page);
    // Record the source (deduped by url) for citation.
    if (!ctx.sourcesRead.some((s) => s.url === r.url)) {
      ctx.sourcesRead.push({ url: r.url, title: r.title });
    }
    return { url: r.url, title: r.title, page: r.page, totalPages: r.totalPages, text: r.text };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to read that page." };
  }
}

/**
 * readSource — FREE page read (cached, page-by-page). Refuses past ctx.maxPages (counter cap).
 * On a successful read it records {url,title} in ctx.sourcesRead (deduped by url) so the final
 * report can cite exactly what was read.
 */
export const readSource = tool<typeof readInput, ResearchContext>({
  name: "readSource",
  description:
    "Read one page of a source URL's text (from a searchSources result). Long pages are split into " +
    "pages; the result tells you totalPages so you can read further with page:2, page:3, … Read only the " +
    "sources that look useful, and only as far as you need. This is FREE and does not spend credits.",
  parameters: readInput,
  execute: async (input, runContext) => {
    if (!runContext) throw new Error("ResearchContext required");
    return executeReadSource(input, runContext);
  },
});

const RESEARCH_INSTRUCTIONS = `You are a thorough research analyst. You are given ONE topic (and optionally a goal and sub-questions) to research.

Your process:
1. Use searchSources to find relevant sources for the topic and each sub-question. A few well-chosen queries beat many redundant ones.
2. From the thin search results, pick the most promising URLs and read them with readSource. Long pages come in pages — read page-by-page (page:2, page:3, …) only as far as you need. Do NOT read every result; be selective and efficient.
3. As you read, keep track of the key findings and which source each came from.
4. When you have enough grounding, STOP researching and write the report.

Your final message IS the report. Write it well-organized (clear sections/headings) and thorough, but ground EVERY claim ONLY in what you actually read — never invent facts or cite sources you didn't read. Note where the evidence is thin or sources disagree. Cite sources inline where it helps.

You have a limited search and reading budget; if a tool tells you the budget is reached, write the report from what you have.`;

/**
 * researchAgent — the bounded research agent. Same construction shape as `otto` (otto.ts):
 * Agent<Ctx>({ name, instructions, model: ottoModel, modelSettings:{maxTokens}, tools }).
 * The worker runs it inside withLlmBudget with maxTurns = tier.maxSteps.
 */
export const researchAgent = new Agent<ResearchContext>({
  name: "Researcher",
  instructions: RESEARCH_INSTRUCTIONS,
  model: ottoModel,
  modelSettings: { maxTokens: OTTO_OUTPUT_CAP_TOKENS },
  tools: [searchSources, readSource],
});

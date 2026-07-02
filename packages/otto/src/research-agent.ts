/**
 * researchAgent — the bounded research agent (Otto research S3, Task 2 · Part A).
 *
 * A SMALL agent that researches ONE topic: it uses `searchSources` to find sources and
 * `readSource` to read the useful ones page-by-page, then writes a thorough, well-organized
 * report grounded ONLY in what it read. Its FINAL message text IS the report synthesis.
 *
 * MONEY-SAFETY: this file spends NOTHING. searchSources/readSource are FREE reads (no credit
 * calls) — they only walk the injected `ctx.search` / `ctx.readPage` ports and bump in-context
 * counters. The ONLY cost is the LLM tokens the agent consumes, and that is metered by
 * `withLlmBudget` at the worker wrapper (apps/worker/src/jobs/research.ts) — NEVER here.
 *
 * The caps (maxSearches / maxPages) are enforced INSIDE the tools: past the cap the tool returns
 * a refusal string (not a throw), so the agent gracefully synthesizes from what it has. maxSteps
 * (the LLM turn budget) is the withLlmBudget reserve cap, enforced by run()'s maxTurns.
 */
import { Agent, tool } from "@openai/agents";
import { z } from "zod";
import { OTTO_OUTPUT_CAP_TOKENS } from "@fikirtive/core";
import { ottoModel } from "./model.js";

/**
 * ResearchContext — the small, mutable per-run context injected by the worker.
 *
 * `search` / `readPage` are the FREE outside-world ports (worker wires them from env keys +
 * core adapters). `sourcesRead` accumulates the {url,title} of every page actually read (deduped)
 * so the report can cite them. The counters cap tool use; the tools read them + the caps.
 */
export type ResearchContext = {
  /** Thin web search — returns {title,url,snippet}[] (worker wires tavily/brave via env). */
  search: (q: string) => Promise<{ title: string; url: string; snippet: string }[]>;
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
  /** Internal counter — searchSources calls made so far (starts at 0). */
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
 * pattern as executeResearchWeb). FREE: no credit calls, only ctx.search + the counter cap.
 */
export async function executeSearchSources(
  input: z.infer<typeof searchInput>,
  runContext: { context: ResearchContext },
): Promise<unknown> {
  const ctx = runContext.context;
  if (ctx.searchesUsed >= ctx.maxSearches) {
    return {
      refused: true,
      reason: `Search budget reached (${ctx.maxSearches} searches). Read the sources you have and write the report now.`,
    };
  }
  ctx.searchesUsed += 1;
  try {
    const results = await ctx.search(input.query);
    return { results };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Search failed." };
  }
}

/**
 * searchSources — FREE thin web search. Refuses past ctx.maxSearches (counter cap) so a runaway
 * agent can't burn the free search quota. Returns thin {title,url,snippet}[]; the agent picks
 * which URLs to actually read.
 */
export const searchSources = tool<typeof searchInput, ResearchContext>({
  name: "searchSources",
  description:
    "Search the web for sources about your topic. Returns thin results (title, url, snippet) — " +
    "pick the most promising URLs and read them with readSource. This is FREE and does not spend credits. " +
    "Be efficient: a few well-chosen searches beat many redundant ones.",
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

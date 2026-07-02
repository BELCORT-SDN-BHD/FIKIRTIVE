/**
 * researchWeb — $0 external-read skill (G3a)
 *
 * Grounds Otto on the real web: fetches a brand's website (or any public URL) and
 * returns the extracted text so Otto can cite it in proposals, briefs, or brand facts.
 *
 * Gate: cost:"free" + effect:"read" + reach:"external" → needsApproval = false.
 * External reads are NOT gated by the 3-field rule (only external WRITES are).
 *
 * The skill reaches the web ONLY through ctx.research (the injected port). It never
 * imports brand-research.ts or calls fetch() directly — ctx-port rule enforced.
 *
 * Two modes:
 *   url   → ctx.research.readPage?(url, page) when wired (cached, page-by-page — Nous-style);
 *           else falls back to ctx.research.fetchUrl(url) (backward compatible).
 *   query → ctx.research.search?(query) — thin results when a search transport is configured;
 *           else returns a graceful "not configured" message.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
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

  // Search mode — only wired when a search transport is configured
  if (input.query) {
    if (!context.research.search) {
      return {
        message:
          "Web search isn't configured yet — give me the brand's website URL and I'll read it.",
      };
    }
    try {
      const { results } = await context.research.search(input.query);
      return { results };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Failed to search the web." };
    }
  }

  // Unreachable (superRefine guards this), but satisfies the type checker
  return { error: "Provide either url or query." };
}

// ---------------------------------------------------------------------------
// SDK tool definition
// ---------------------------------------------------------------------------

export const researchWebSkill = defineOttoSkill({
  name: "researchWeb",
  cost: "free",
  effect: "read",
  reach: "external",
  description:
    "Fetch a public web page or search the web to ground your response in real information. " +
    "Use this BEFORE producing work that depends on a brand's website, a competitor's page, " +
    "or any current information you don't already have in context. " +
    "Pass url to read a specific page (e.g. a brand homepage); pass query to search the web. " +
    "This is $0 and does not require approval.",
  parameters: researchWebInput,
  execute: executeResearchWeb,
});

export const researchWeb = researchWebSkill.tool;

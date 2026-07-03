"use server";

/**
 * ingestProductFromUrl — P1-01 human-facing path ("add product from a link").
 *
 * Two layers (founder decision 2026-07-03):
 *   Layer 1 — deterministic, $0: fetch the raw page (SSRF-hardened) and read machine-readable
 *             markup (JSON-LD Product → OG → title). Rich pages stop here — no LLM, no spend.
 *   Layer 2 — ONLY when the deterministic draft is thin: one LLM call to fill name/price/
 *             description from the page text. This mirrors researchBrandFromUrl exactly:
 *             getTransport() (mock in dev → $0), withLlmBudget with paid = name!=="mock",
 *             and the impersonation spend-block (never spend a tenant's credits while
 *             impersonating). Deterministic fields always win; the LLM only fills gaps.
 *
 * Returns a DRAFT — it never writes to the DB. The user reviews/edits, then saves via the
 * existing product upsert. No genRequest/startGen/fal → the generation spend-path is untouched.
 * (Otto's own `ingestProduct` skill uses the deterministic layer and lets Otto itself reason
 *  over the page text — so that path needs no separate LLM call; see the skill.)
 */

import { withLlmBudget, OTTO_DEFAULT_MODEL } from "@fikirtive/otto";
import { newId, extractProductDraft, type ProductDraft, type ChatMessage } from "@fikirtive/core";
import { getTransport } from "./runtime-config";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import { fetchRawHtml } from "./fetch-extract";

export type ProductDraftResult = { ok: true; draft: ProductDraft; usedLlm: boolean } | { error: string };

/** Thin = no name at all, OR a name but neither a price nor a description. */
function isThin(d: ProductDraft): boolean {
  if (!d.name) return true;
  return !d.price && !d.description;
}

const SYSTEM = `You extract ONE product's details from an e-commerce page's text.
Return ONLY a JSON object: {"name":"","price":"","description":""}.
- name: the product's name, concise.
- price: the price AS DISPLAYED TEXT exactly as shown (e.g. "RM 49", "$19.90"), or "" if none is stated.
- description: a concise 1-2 sentence product description, or "".
NEVER invent a price or details not present in the text. If a field is unknown, use "".
No prose, no markdown fences, ONLY the JSON object.`;

function mockReply(): string {
  // Dev/offline path — deterministic, $0. Realistic enough to exercise the merge.
  return JSON.stringify({ name: "", price: "", description: "A product (mock — no LLM in dev)." });
}

function stripToText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
}

type LlmFields = { name?: string; price?: string; description?: string };

/** One LLM call to fill name/price/description. Returns null on any failure/garbage (caller keeps the deterministic draft). */
async function llmFill(ownerId: string, text: string): Promise<LlmFields | null> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Product page text:\n\n${text}` },
  ];

  let raw: string;
  try {
    const transport = await getTransport();
    const paid = transport.name !== "mock";
    const refId = `product-ingest:${newId()}`;
    raw = await withLlmBudget(
      { orgId: ownerId, refId, model: OTTO_DEFAULT_MODEL, paid, maxSteps: 1 },
      async () => {
        const r = await transport.chat("productIngest", messages, { mockReply });
        return { result: r.text, usage: r.usage };
      },
    );
  } catch {
    return null;
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const pick = (k: string): string | undefined => {
    const v = parsed[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const fields: LlmFields = { name: pick("name"), price: pick("price"), description: pick("description") };
  return fields.name || fields.price || fields.description ? fields : null;
}

/** Merge LLM fields into the gaps of a deterministic draft (deterministic wins), recomputing `filled`. */
function mergeGaps(draft: ProductDraft, llm: LlmFields): ProductDraft {
  const merged: ProductDraft = {
    ...draft,
    name: draft.name ?? llm.name,
    price: draft.price ?? llm.price,
    description: draft.description ?? llm.description,
    filled: [],
  };
  merged.filled = (["name", "price", "description", "imageUrl"] as const).filter(
    (k) => merged[k] != null && merged[k] !== "",
  );
  return merged;
}

function friendlyFetchError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  if (msg.includes("timed out") || msg.toLowerCase().includes("timeout")) {
    return "That site took too long to respond — please try again.";
  }
  if (msg.toLowerCase().includes("redirect")) {
    return "That URL redirected — please use the final destination URL.";
  }
  if (/returned \d/.test(msg)) return "That page couldn't be read — please check the URL.";
  return "Couldn't reach that URL — please check it and try again.";
}

export async function ingestProductFromUrl(raw: unknown): Promise<ProductDraftResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  if (typeof raw !== "string" || !raw.trim()) return { error: "Please enter a URL." };

  // Layer 0 + 1 — fetch (SSRF-hardened) + deterministic extraction. Always free.
  let html: string;
  let sourceUrl: string;
  try {
    const fetched = await fetchRawHtml(raw);
    html = fetched.html;
    sourceUrl = fetched.url;
  } catch (e) {
    return { error: friendlyFetchError(e) };
  }

  let draft = extractProductDraft(html, sourceUrl);
  let usedLlm = false;

  // Layer 2 — only when thin, and never while impersonating (would spend the tenant's credits).
  if (isThin(draft) && !(await isImpersonating())) {
    const llm = await llmFill(ownerId, stripToText(html));
    if (llm) {
      const merged = mergeGaps(draft, llm);
      if (merged.filled.length > draft.filled.length) {
        draft = merged;
        usedLlm = true;
      }
    }
  }

  return { ok: true, draft, usedLlm };
}

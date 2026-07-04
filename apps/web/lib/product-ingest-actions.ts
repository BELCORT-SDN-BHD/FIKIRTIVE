"use server";

/**
 * ingestProductFromUrl — P1-01 human-facing path ("add product from a link").
 *
 * DETERMINISTIC & FREE ($0, no spend). Fetches the raw page (SSRF-hardened) and reads
 * machine-readable markup only (JSON-LD Product → Open Graph → <title>/first <img>). Returns a
 * DRAFT — it never writes to the DB. The user reviews/edits, then saves via the existing product
 * upsert.
 *
 * Money honesty (#124): this path makes NO paid LLM call, so the "read only · free" UI is true.
 * The earlier design escalated a thin (metadata-poor) page to a paid Otto LLM fill, but the UI
 * advertised $0 and the per-call refId was not URL-idempotent — dishonest money UX. Rather than
 * bolt a paid/credit boundary onto a "paste a link" affordance, the human path is deterministic-only:
 * real e-commerce pages (Shopee/Lazada/Shopify/WooCommerce) all emit JSON-LD/OG, so the draft is
 * rich; a sparse page simply pre-fills fewer fields and the user completes them in the review form.
 *
 * The Otto side (`ingestProduct` skill → ctx.productIngest port) is unchanged and also free: it
 * returns the same deterministic draft plus the page text, and Otto fills any gaps with its own
 * (already-metered) turn reasoning — no separate LLM call. Both entrypoints are honest $0 reads.
 *
 * No genRequest/startGen/fal and no withLlmBudget → the spend paths are untouched.
 */

import { extractProductDraft, type ProductDraft } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { fetchRawHtml } from "./fetch-extract";

export type ProductDraftResult = { ok: true; draft: ProductDraft } | { error: string };

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

  if (typeof raw !== "string" || !raw.trim()) return { error: "Please enter a URL." };

  // Fetch (SSRF-hardened) + deterministic extraction. Always free — no LLM, no spend.
  let html: string;
  let sourceUrl: string;
  try {
    const fetched = await fetchRawHtml(raw);
    html = fetched.html;
    sourceUrl = fetched.url;
  } catch (e) {
    return { error: friendlyFetchError(e) };
  }

  return { ok: true, draft: extractProductDraft(html, sourceUrl) };
}

"use server";

import { withLlmBudget, OTTO_DEFAULT_MODEL } from "@fikirtive/otto";
import { newId, type ChatMessage } from "@fikirtive/core";
import { getTransport } from "./runtime-config";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import { assertPublicHttpUrlResolved } from "./url-safety";

export type ProposedFact = { category: string; content: string };
export type ResearchResult = { ok: true; facts: ProposedFact[] } | { error: string };

/**
 * fetchAndExtract — SSRF-hardened page fetch + HTML-strip.
 * Reusable by the researchWeb skill port (G3a) without auth or LLM overhead.
 * Throws on any fetch/SSRF/network error (caller wraps in try/catch).
 */
export async function fetchAndExtract(raw: string): Promise<{ url: string; title?: string; text: string }> {
  // SSRF guard — same as researchBrandFromUrl
  const url = await assertPublicHttpUrlResolved(raw);

  const response = await fetch(url.href, {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: { "user-agent": "FikirtiveBot/1.0" },
  });

  if (!response.ok) {
    throw new Error(`Site returned ${response.status}`);
  }

  const buf = await response.arrayBuffer();
  const capped = buf.byteLength > MAX_BODY ? buf.slice(0, MAX_BODY) : buf;
  const rawText = new TextDecoder().decode(capped);

  // Extract <title> tag for a human-readable label
  const titleMatch = rawText.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const title = titleMatch ? titleMatch[1]!.trim() : undefined;

  const text = rawText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);

  return { url: url.href, title, text };
}

function mockReply(): string {
  return JSON.stringify({
    facts: [
      { category: "Brand", content: "A creative brand (mock research — no LLM in dev)." },
      { category: "Products", content: "Products and services (mock data)." },
      { category: "Audience", content: "Target audience (mock data)." },
    ],
  });
}

const MAX_BODY = 512 * 1024; // 512KB

const SYSTEM = `You extract brand facts from a website's text.
Return ONLY a JSON object: {"facts":[{"category":"string","content":"string"}]}
Extract 3-6 facts covering: brand name, what they sell/make, brand voice/tone, target audience, and any other distinctive brand characteristics.
Each "category" is one of: Brand, Products, Voice, Audience, Rules.
Each "content" is a concise 1-2 sentence fact.
If the text is too sparse or unrelated to a brand, return {"facts":[]}.
No prose, no markdown fences, ONLY the JSON object.`;

export async function researchBrandFromUrl(raw: unknown): Promise<ResearchResult> {
  // 1. Auth gate
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  // Impersonation spend-block (operator console #14): researchBrandFromUrl is a metered LLM
  // spend path, so a founder impersonating a tenant must not spend the tenant's credits here.
  if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };

  // 2. Validate raw is a non-empty string
  if (typeof raw !== "string" || !raw.trim()) {
    return { error: "Please enter a URL." };
  }

  // 3. SSRF guard — lexical checks PLUS DNS resolution (every resolved IP must be public),
  //    closing the DNS-rebinding hole where a public hostname's A-record points at a private IP.
  let url: URL;
  try {
    url = await assertPublicHttpUrlResolved(raw);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid URL." };
  }

  // 4. Fetch the page
  let response: Response;
  try {
    response = await fetch(url.href, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "FikirtiveBot/1.0" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("timed out") || msg.includes("timeout") || e instanceof DOMException && (e as DOMException).name === "TimeoutError") {
      return { error: "That site took too long to respond — please try again." };
    }
    if (msg.includes("redirect") || msg.includes("ECONNRESET") && msg.includes("redirect")) {
      return { error: "That URL redirected — please use the final destination URL." };
    }
    // fetch throws a TypeError with "redirect" in the message when redirect:"error" trips
    if (msg.toLowerCase().includes("redirect")) {
      return { error: "That URL redirected — please use the final destination URL." };
    }
    return { error: "Couldn't reach that URL — please check it and try again." };
  }

  // 5. Check response.ok
  if (!response.ok) {
    return { error: `Site returned ${response.status} — please check the URL.` };
  }

  // 6. Read body capped at 512KB
  let pageText: string;
  try {
    const buf = await response.arrayBuffer();
    const capped = buf.byteLength > MAX_BODY ? buf.slice(0, MAX_BODY) : buf;
    const rawText = new TextDecoder().decode(capped);
    // 7. Strip HTML tags and slice for LLM
    pageText = rawText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
  } catch {
    return { error: "Couldn't read that page — please try again." };
  }

  // 8. Build messages
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Website text:\n\n${pageText}` },
  ];

  // 9. LLM call
  let result: string;
  try {
    const transport = await getTransport();
    const paid = transport.name !== "mock";
    const refId = `brand-research:${newId()}`;

    result = await withLlmBudget(
      { orgId: ownerId, refId, model: OTTO_DEFAULT_MODEL, paid, maxSteps: 1 },
      async () => {
        const r = await transport.chat("brandResearch", messages, { mockReply: () => mockReply() });
        return { result: r.text, usage: r.usage };
      },
    );
  } catch {
    return { error: "Otto couldn't extract brand facts — try a different URL." };
  }

  // 10. Parse JSON result
  const start = result.indexOf("{");
  const end = result.lastIndexOf("}");
  if (start < 0 || end < start) {
    return { error: "Otto couldn't extract brand facts — try a different URL." };
  }
  let parsed: { facts?: unknown[] };
  try {
    parsed = JSON.parse(result.slice(start, end + 1)) as { facts?: unknown[] };
  } catch {
    return { error: "Otto couldn't extract brand facts — try a different URL." };
  }

  // 11. Validate and map to ProposedFact[]
  const facts: ProposedFact[] = (Array.isArray(parsed.facts) ? parsed.facts : [])
    .filter((item): item is { category: string; content: string } =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).category === "string" &&
      (item as Record<string, unknown>).category !== "" &&
      typeof (item as Record<string, unknown>).content === "string" &&
      (item as Record<string, unknown>).content !== ""
    );

  if (!facts.length) {
    return { error: "Otto couldn't find brand information on that page — try the homepage." };
  }

  // 12. Return facts — NOT saved to DB
  return { ok: true, facts };
}

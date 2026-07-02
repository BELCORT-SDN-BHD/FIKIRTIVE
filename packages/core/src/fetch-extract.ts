import { assertPublicHttpUrlResolved } from "./url-safety.js";

// F16: this lives in a `server-only` module (NOT `"use server"`). It is a server-side
// capability injected as the Otto researchWeb ctx port — it must NOT be a public Server
// Action endpoint. It has no auth guard by design (the caller — a metered, owner-scoped
// skill — is the authority); exporting it from a `"use server"` module made it a bare
// POSTable action any authenticated user could invoke cross-tenant. `server-only` throws
// if it is ever imported into a client bundle, so it can never be exposed by mistake.

export const MAX_BODY = 512 * 1024; // 512KB

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

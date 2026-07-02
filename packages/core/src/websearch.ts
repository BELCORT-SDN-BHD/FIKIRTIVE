/**
 * Web-search adapters (research Block S1 Task 1).
 *
 * The swappable-provider seam that Otto's `ctx.research.search` and the future
 * research worker both consume. Each adapter returns THIN results
 * (`{title, url, snippet}[]`) — Otto reads the full pages on demand elsewhere.
 *
 * Money-safety: pure adapters. No DB, no spend, no @fikirtive/generation. A
 * provider key is NEVER placed in a log line or an error message.
 */

export type WebSearchResult = { title: string; url: string; snippet: string };
export type WebSearchFn = (query: string) => Promise<WebSearchResult[]>;

/** Snippet cap — thin results only; Otto reads full pages on demand. */
const SNIPPET_MAX = 400;
/** Per-request network timeout. */
const TIMEOUT_MS = 8000;
/** Results per query. */
const MAX_RESULTS = 8;

function truncate(s: unknown): string {
  const str = typeof s === "string" ? s : "";
  return str.length > SNIPPET_MAX ? str.slice(0, SNIPPET_MAX) : str;
}

/**
 * Tavily adapter. POST https://api.tavily.com/search with Bearer auth.
 * Maps `results[]` → thin results. Non-200 throws with the status code but
 * NEVER the apiKey.
 */
export function tavilySearch(apiKey: string, fetchImpl: typeof fetch = globalThis.fetch): WebSearchFn {
  return async (query: string): Promise<WebSearchResult[]> => {
    const res = await fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, max_results: MAX_RESULTS }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // Status only — never the key.
      throw new Error(`Tavily search failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map((r) => ({
      title: r?.title ?? "",
      url: r?.url ?? "",
      snippet: truncate(r?.content),
    }));
  };
}

/**
 * Brave adapter. GET https://api.search.brave.com/res/v1/web/search with an
 * X-Subscription-Token header. Maps `web.results[]` → thin results. Non-200
 * throws with the status code but NEVER the apiKey.
 */
export function braveSearch(apiKey: string, fetchImpl: typeof fetch = globalThis.fetch): WebSearchFn {
  return async (query: string): Promise<WebSearchResult[]> => {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`;
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        "X-Subscription-Token": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // Status only — never the key.
      throw new Error(`Brave search failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
    const results = Array.isArray(data?.web?.results) ? data.web!.results! : [];
    return results.map((r) => ({
      title: r?.title ?? "",
      url: r?.url ?? "",
      snippet: truncate(r?.description),
    }));
  };
}

/**
 * Compose two search fns with failover. Calls `primary`; if it THROWS and a
 * `fallback` is provided, calls `fallback`. If both throw, throws an aggregate
 * Error whose message contains NEITHER provider's error text verbatim-safely —
 * only fixed strings are combined so no key can leak.
 *
 * An empty-array result is a SUCCESS, not a failure — it returns `[]` and never
 * falls back.
 */
export function searchWithFallback(primary: WebSearchFn, fallback?: WebSearchFn): WebSearchFn {
  return async (query: string): Promise<WebSearchResult[]> => {
    try {
      return await primary(query);
    } catch (primaryErr) {
      if (!fallback) throw primaryErr;
      try {
        return await fallback(query);
      } catch {
        // Aggregate with a FIXED message — the underlying errors already scrub
        // keys, but we deliberately do not interpolate them here so there is no
        // path by which a key-bearing message could reach a caller's log.
        throw new Error("Web search failed: both primary and fallback providers errored.");
      }
    }
  };
}

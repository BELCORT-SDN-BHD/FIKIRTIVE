import { describe, it, expect } from "vitest";
import {
  tavilySearch,
  braveSearch,
  searchWithFallback,
  type WebSearchResult,
  type WebSearchFn,
} from "./websearch.js";

// A fake key we assert never leaks into any error/throw string.
const FAKE_KEY = "sk-secret-key-DO-NOT-LEAK-1234567890";

/** Build a fetch stub returning a fixed JSON body + status. Records the call. */
function fetchOk(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("tavilySearch", () => {
  it("POSTs to the tavily endpoint with Bearer auth + {query, max_results:8}", async () => {
    const { impl, calls } = fetchOk({ results: [] });
    await tavilySearch(FAKE_KEY, impl)("cats");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.tavily.com/search");
    const init = calls[0]!.init;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${FAKE_KEY}`);
    expect(JSON.parse(init.body as string)).toEqual({ query: "cats", max_results: 8 });
    // 8s timeout wired via AbortSignal
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps results[].{title,url,content→snippet}", async () => {
    const { impl } = fetchOk({
      results: [
        { title: "T1", url: "https://a.example", content: "body one" },
        { title: "T2", url: "https://b.example", content: "body two" },
      ],
    });
    const out = await tavilySearch(FAKE_KEY, impl)("q");
    expect(out).toEqual<WebSearchResult[]>([
      { title: "T1", url: "https://a.example", snippet: "body one" },
      { title: "T2", url: "https://b.example", snippet: "body two" },
    ]);
  });

  it("truncates snippet to <=400 chars", async () => {
    const long = "x".repeat(1000);
    const { impl } = fetchOk({ results: [{ title: "T", url: "https://a", content: long }] });
    const out = await tavilySearch(FAKE_KEY, impl)("q");
    expect(out[0]!.snippet).toHaveLength(400);
  });

  it("defends against missing fields (optional-chaining + '' fallback)", async () => {
    const { impl } = fetchOk({ results: [{}] });
    const out = await tavilySearch(FAKE_KEY, impl)("q");
    expect(out).toEqual([{ title: "", url: "", snippet: "" }]);
  });

  it("empty results → [] (not an error)", async () => {
    const { impl } = fetchOk({ results: [] });
    expect(await tavilySearch(FAKE_KEY, impl)("q")).toEqual([]);
  });

  it("non-200 → throws with status code, NEVER the apiKey", async () => {
    const { impl } = fetchOk({}, 429);
    let err: Error | undefined;
    try {
      await tavilySearch(FAKE_KEY, impl)("q");
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain("429");
    expect(err!.message).not.toContain(FAKE_KEY);
  });

  it("timeout / network rejection propagates as a throw with no apiKey", async () => {
    const impl = (async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as unknown as typeof fetch;
    let err: Error | undefined;
    try {
      await tavilySearch(FAKE_KEY, impl)("q");
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).not.toContain(FAKE_KEY);
  });
});

describe("braveSearch", () => {
  it("GETs the brave endpoint with q+count=8, X-Subscription-Token + Accept header", async () => {
    const { impl, calls } = fetchOk({ web: { results: [] } });
    await braveSearch(FAKE_KEY, impl)("cats and dogs");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://api.search.brave.com/res/v1/web/search?q=cats%20and%20dogs&count=8",
    );
    const init = calls[0]!.init;
    // GET has no method or method "GET"
    expect(init.method === undefined || init.method === "GET").toBe(true);
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Subscription-Token"]).toBe(FAKE_KEY);
    expect(headers["Accept"]).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps web.results[].{title,url,description→snippet}", async () => {
    const { impl } = fetchOk({
      web: {
        results: [
          { title: "B1", url: "https://x.example", description: "desc one" },
          { title: "B2", url: "https://y.example", description: "desc two" },
        ],
      },
    });
    const out = await braveSearch(FAKE_KEY, impl)("q");
    expect(out).toEqual<WebSearchResult[]>([
      { title: "B1", url: "https://x.example", snippet: "desc one" },
      { title: "B2", url: "https://y.example", snippet: "desc two" },
    ]);
  });

  it("truncates snippet to <=400 chars", async () => {
    const long = "y".repeat(900);
    const { impl } = fetchOk({ web: { results: [{ title: "B", url: "https://z", description: long }] } });
    const out = await braveSearch(FAKE_KEY, impl)("q");
    expect(out[0]!.snippet).toHaveLength(400);
  });

  it("defends against missing web/results/fields", async () => {
    const { impl } = fetchOk({});
    expect(await braveSearch(FAKE_KEY, impl)("q")).toEqual([]);
    const { impl: impl2 } = fetchOk({ web: { results: [{}] } });
    expect(await braveSearch(FAKE_KEY, impl2)("q")).toEqual([{ title: "", url: "", snippet: "" }]);
  });

  it("non-200 → throws with status code, NEVER the apiKey", async () => {
    const { impl } = fetchOk({}, 401);
    let err: Error | undefined;
    try {
      await braveSearch(FAKE_KEY, impl)("q");
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain("401");
    expect(err!.message).not.toContain(FAKE_KEY);
  });

  it("timeout / network rejection propagates with no apiKey", async () => {
    const impl = (async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as unknown as typeof fetch;
    let err: Error | undefined;
    try {
      await braveSearch(FAKE_KEY, impl)("q");
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).not.toContain(FAKE_KEY);
  });
});

describe("searchWithFallback", () => {
  const okResults: WebSearchResult[] = [{ title: "P", url: "https://p", snippet: "primary" }];
  const fbResults: WebSearchResult[] = [{ title: "F", url: "https://f", snippet: "fallback" }];

  it("primary succeeds → fallback is NEVER called", async () => {
    let fbCalled = false;
    const primary: WebSearchFn = async () => okResults;
    const fallback: WebSearchFn = async () => {
      fbCalled = true;
      return fbResults;
    };
    const out = await searchWithFallback(primary, fallback)("q");
    expect(out).toEqual(okResults);
    expect(fbCalled).toBe(false);
  });

  it("primary throws → fallback is used", async () => {
    const primary: WebSearchFn = async () => {
      throw new Error("primary down 503");
    };
    const fallback: WebSearchFn = async () => fbResults;
    const out = await searchWithFallback(primary, fallback)("q");
    expect(out).toEqual(fbResults);
  });

  it("primary returns [] → NOT a failure, returns [] without calling fallback", async () => {
    let fbCalled = false;
    const primary: WebSearchFn = async () => [];
    const fallback: WebSearchFn = async () => {
      fbCalled = true;
      return fbResults;
    };
    const out = await searchWithFallback(primary, fallback)("q");
    expect(out).toEqual([]);
    expect(fbCalled).toBe(false);
  });

  it("primary throws + no fallback → rethrows", async () => {
    const primary: WebSearchFn = async () => {
      throw new Error("only primary 500");
    };
    await expect(searchWithFallback(primary)("q")).rejects.toThrow();
  });

  it("both throw → aggregate Error, containing NEITHER key", async () => {
    // Wrap real adapters so both failure paths run through provider throws.
    const { impl: fail429 } = fetchOk({}, 429);
    const { impl: fail500 } = fetchOk({}, 500);
    const primary = tavilySearch(FAKE_KEY, fail429);
    const otherKey = "brave-key-SECRET-abcdef";
    const fallback = braveSearch(otherKey, fail500);
    let err: Error | undefined;
    try {
      await searchWithFallback(primary, fallback)("q");
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).not.toContain(FAKE_KEY);
    expect(err!.message).not.toContain(otherKey);
  });
});

describe("no secret ever leaks (regex sweep across every throw path)", () => {
  it("every provider error message fails a /apiKey/ regex", async () => {
    const keyRe = new RegExp(FAKE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const throwers: Array<() => Promise<unknown>> = [
      () => tavilySearch(FAKE_KEY, fetchOk({}, 500).impl)("q"),
      () => braveSearch(FAKE_KEY, fetchOk({}, 500).impl)("q"),
    ];
    for (const t of throwers) {
      let msg = "";
      try {
        await t();
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).not.toMatch(keyRe);
    }
  });
});

/**
 * research-agent.test.ts — TDD for the bounded research agent's tools (S3 Task 2 · Part A).
 *
 * The tools are FREE reads: no credit calls, only ctx.search / ctx.readPage + counters.
 * We test them directly via `.execute(input, { context })`.
 *
 * Coverage:
 *  - searchSources: calls ctx.search, returns thin results, bumps counter, refuses past maxSearches
 *  - readSource: calls ctx.readPage, records {url,title} in sourcesRead (deduped), refuses past maxPages
 *  - error handling: a throwing port yields { error } (never crashes the run)
 *  - $ assertion: neither tool touches credits (there is no credit port on ResearchContext)
 */
import { describe, it, expect, vi } from "vitest";
import {
  executeSearchSources,
  executeReadSource,
  researchAgent,
  type ResearchContext,
} from "./research-agent.js";

function makeCtx(overrides?: Partial<ResearchContext>): ResearchContext {
  return {
    search: vi.fn(async () => [{ title: "T", url: "https://a.com", snippet: "s" }]),
    readPage: vi.fn(async (url: string, page = 1) => ({
      url,
      title: "Title of " + url,
      page,
      totalPages: 3,
      text: "page text",
    })),
    sourcesRead: [],
    maxSearches: 5,
    maxPages: 8,
    searchesUsed: 0,
    pagesUsed: 0,
    ...overrides,
  };
}

describe("researchAgent construction", () => {
  it("is named Researcher and has exactly the two research tools", () => {
    expect(researchAgent.name).toBe("Researcher");
    const toolNames = researchAgent.tools.map((t) => (t as { name: string }).name).sort();
    expect(toolNames).toEqual(["readSource", "searchSources"]);
  });
});

describe("searchSources", () => {
  it("calls ctx.search and returns thin results", async () => {
    const ctx = makeCtx();
    const out = (await executeSearchSources({ query: "EV market" }, { context: ctx })) as {
      results: { title: string; url: string; snippet: string }[];
    };
    expect(ctx.search).toHaveBeenCalledWith("EV market");
    expect(out.results).toEqual([{ title: "T", url: "https://a.com", snippet: "s" }]);
    expect(ctx.searchesUsed).toBe(1);
  });

  it("refuses past maxSearches WITHOUT calling ctx.search", async () => {
    const ctx = makeCtx({ maxSearches: 2, searchesUsed: 2 });
    const out = (await executeSearchSources({ query: "again" }, { context: ctx })) as { refused?: boolean };
    expect(out.refused).toBe(true);
    expect(ctx.search).not.toHaveBeenCalled();
    // counter NOT bumped past the cap
    expect(ctx.searchesUsed).toBe(2);
  });

  it("returns { error } (no throw) when the search port throws", async () => {
    const ctx = makeCtx({ search: vi.fn(async () => { throw new Error("provider down"); }) });
    const out = (await executeSearchSources({ query: "x" }, { context: ctx })) as { error?: string };
    expect(out.error).toBe("provider down");
    // counter still consumed (an attempted search counts against budget)
    expect(ctx.searchesUsed).toBe(1);
  });
});

describe("readSource", () => {
  it("calls ctx.readPage and records the source (url+title) in sourcesRead", async () => {
    const ctx = makeCtx();
    const out = (await executeReadSource({ url: "https://a.com", page: 1 }, { context: ctx })) as { text: string };
    expect(ctx.readPage).toHaveBeenCalledWith("https://a.com", 1);
    expect(out.text).toBe("page text");
    expect(ctx.sourcesRead).toEqual([{ url: "https://a.com", title: "Title of https://a.com" }]);
    expect(ctx.pagesUsed).toBe(1);
  });

  it("dedups sourcesRead by url across multiple reads (e.g. paging the same page)", async () => {
    const ctx = makeCtx();
    await executeReadSource({ url: "https://a.com", page: 1 }, { context: ctx });
    await executeReadSource({ url: "https://a.com", page: 2 }, { context: ctx });
    await executeReadSource({ url: "https://b.com" }, { context: ctx });
    expect(ctx.sourcesRead).toEqual([
      { url: "https://a.com", title: "Title of https://a.com" },
      { url: "https://b.com", title: "Title of https://b.com" },
    ]);
    expect(ctx.pagesUsed).toBe(3);
  });

  it("refuses past maxPages WITHOUT calling ctx.readPage", async () => {
    const ctx = makeCtx({ maxPages: 1, pagesUsed: 1 });
    const out = (await executeReadSource({ url: "https://a.com" }, { context: ctx })) as { refused?: boolean };
    expect(out.refused).toBe(true);
    expect(ctx.readPage).not.toHaveBeenCalled();
    expect(ctx.sourcesRead).toEqual([]);
    expect(ctx.pagesUsed).toBe(1);
  });

  it("returns { error } (no throw) when the read port throws, and does NOT record a source", async () => {
    const ctx = makeCtx({ readPage: vi.fn(async () => { throw new Error("404"); }) });
    const out = (await executeReadSource({ url: "https://a.com" }, { context: ctx })) as { error?: string };
    expect(out.error).toBe("404");
    expect(ctx.sourcesRead).toEqual([]);
  });
});

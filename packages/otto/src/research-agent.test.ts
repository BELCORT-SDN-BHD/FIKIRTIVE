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
  searchSources,
  readSource,
  type ResearchContext,
} from "./research-agent.js";
import { displayCredits, searchUnitChargeInternal } from "@fikirtive/core";

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

// ── 钱路 M1-c(判官 P2-1):工具描述是**说给模型听的**,所以它说的必须是真话 ──────────
// 这段描述进 LLM 提示词。原来它说 "This is FREE and does not spend credits.",而搜索早已
// (在本票里)按 3× 计费 —— 一句过期的话直接改变 agent 的行为:它会毫无顾虑地搜到档位
// 上限,把「settle 按实际、多退少不补」这套机制架空。所以这里钉住的不是文案风格,是
// **提示词与账本是否说同一件事**。
describe("searchSources 的工具描述必须对模型说真话(P2-1)", () => {
  const description = (searchSources as unknown as { description: string }).description;

  it("不再声称免费", () => {
    expect(description).not.toMatch(/FREE/i);
    expect(description).not.toMatch(/does not spend credits/i);
  });

  it("明说会计费,并说清是按**实际用量**结算", () => {
    expect(description).toMatch(/COSTS CREDITS/);
    expect(description).toMatch(/billed to the merchant/);
    // 「按实际搜了几次收,不是按预算收」——这一句是省钱行为的直接动机。
    expect(description).toMatch(/actually run/);
  });

  it("描述里的价格是**算出来的**,不是写死的(改费率,这句话跟着改)", () => {
    const expected = displayCredits(searchUnitChargeInternal("basic"));
    expect(description).toContain(`${expected} credits per search`);
    // 现役费率:3 internal = 0.3 显示 credits。写死一个数就会在改价那天变成谎话。
    expect(expected).toBe(0.3);
  });

  it("readSource 的免费声明**仍然正确**,不许被一起改掉", () => {
    // 读一个公开网页确实不花我们钱 —— 把它也标成计费,就是反过来对模型说谎。
    const readDescription = (readSource as unknown as { description: string }).description;
    expect(readDescription).toMatch(/FREE and does not spend credits/);
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

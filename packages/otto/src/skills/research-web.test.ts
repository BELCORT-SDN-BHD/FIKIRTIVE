import { describe, it, expect, vi } from "vitest";
import { OTTO_CHAT_MAX_SEARCHES_PER_TURN, displayCredits, searchUnitChargeInternal } from "@fikirtive/core";
import { researchWebSkill, executeResearchWeb, researchWebInput } from "./research-web.js";
import type { OttoContext, OttoSearchSlots } from "../context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<OttoContext>): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    ...overrides,
  };
}

function makeRunCtx(ctx: OttoContext) {
  return { context: ctx };
}

/** MONEY-A10:一轮的搜索槽,每个测试自己新建一份(生产里由 buildOttoContext 每轮新建)。
 *  `granted` 默认给满 —— 那是「余额买得起满额搜索」的商家;低余额的路各自传自己的格数。 */
function makeSlots(granted: number = OTTO_CHAT_MAX_SEARCHES_PER_TURN): OttoSearchSlots {
  return { granted, taken: 0, succeeded: 0 };
}

// ---------------------------------------------------------------------------
// Gate assertions (cost/effect/reach/needsApproval)
// ---------------------------------------------------------------------------

describe("researchWebSkill — gate fields", () => {
  it("cost is free", () => {
    expect(researchWebSkill.cost).toBe("free");
  });

  it("effect is read", () => {
    expect(researchWebSkill.effect).toBe("read");
  });

  it("reach is external", () => {
    expect(researchWebSkill.reach).toBe("external");
  });

  it("needsApproval is false (free + read + external → not gated)", () => {
    expect(researchWebSkill.needsApproval).toBe(false);
  });

  it("name is researchWeb", () => {
    expect(researchWebSkill.name).toBe("researchWeb");
  });
});

// ---------------------------------------------------------------------------
// executeResearchWeb — url mode
// ---------------------------------------------------------------------------

describe("executeResearchWeb — url mode", () => {
  it("calls context.research.fetchUrl and returns url + title + truncated text", async () => {
    const fetchUrl = vi.fn().mockResolvedValue({
      url: "https://example.com/",
      title: "Example Brand",
      text: "A".repeat(8000), // longer than MAX_TEXT=6000
    });

    const ctx = makeCtx({ research: { fetchUrl } });
    const result = await executeResearchWeb(
      { url: "https://example.com/" },
      makeRunCtx(ctx),
    );

    expect(fetchUrl).toHaveBeenCalledOnce();
    expect(fetchUrl).toHaveBeenCalledWith("https://example.com/");
    expect(result).toMatchObject({
      url: "https://example.com/",
      title: "Example Brand",
    });
    // text is capped at 6000 chars
    expect((result as any).text.length).toBe(6000);
  });

  it("returns title: null when title is undefined", async () => {
    const fetchUrl = vi.fn().mockResolvedValue({
      url: "https://example.com/",
      title: undefined,
      text: "short text",
    });

    const ctx = makeCtx({ research: { fetchUrl } });
    const result = await executeResearchWeb(
      { url: "https://example.com/" },
      makeRunCtx(ctx),
    );

    expect(result).toMatchObject({ url: "https://example.com/", title: null, text: "short text" });
  });

  it("returns structured error when fetchUrl throws", async () => {
    const fetchUrl = vi.fn().mockRejectedValue(new Error("SSRF blocked"));

    const ctx = makeCtx({ research: { fetchUrl } });
    const result = await executeResearchWeb(
      { url: "https://example.com/" },
      makeRunCtx(ctx),
    );

    expect(result).toEqual({ error: "SSRF blocked" });
  });

  it("returns fallback error message when fetchUrl throws non-Error", async () => {
    const fetchUrl = vi.fn().mockRejectedValue("unknown error");

    const ctx = makeCtx({ research: { fetchUrl } });
    const result = await executeResearchWeb(
      { url: "https://example.com/" },
      makeRunCtx(ctx),
    );

    expect(result).toEqual({ error: "Failed to fetch that URL." });
  });
});

// ---------------------------------------------------------------------------
// executeResearchWeb — url mode WITH readPage (cached paging)
// ---------------------------------------------------------------------------

describe("executeResearchWeb — url mode, readPage wired (paging)", () => {
  it("calls context.research.readPage and returns page/totalPages/text", async () => {
    const readPage = vi.fn().mockResolvedValue({
      url: "https://example.com/",
      title: "Example Brand",
      page: 1,
      totalPages: 3,
      text: "page one text",
      stale: false,
    });
    const fetchUrl = vi.fn();
    const ctx = makeCtx({ research: { fetchUrl, readPage } });

    const result = await executeResearchWeb(
      { url: "https://example.com/" },
      makeRunCtx(ctx),
    );

    expect(readPage).toHaveBeenCalledWith("https://example.com/", undefined);
    expect(fetchUrl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      url: "https://example.com/",
      title: "Example Brand",
      page: 1,
      totalPages: 3,
      text: "page one text",
    });
  });

  it("passes the requested page through to readPage", async () => {
    const readPage = vi.fn().mockResolvedValue({
      url: "https://example.com/",
      title: "Example Brand",
      page: 2,
      totalPages: 3,
      text: "page two text",
      stale: false,
    });
    const fetchUrl = vi.fn();
    const ctx = makeCtx({ research: { fetchUrl, readPage } });

    const result = await executeResearchWeb(
      { url: "https://example.com/", page: 2 },
      makeRunCtx(ctx),
    );

    expect(readPage).toHaveBeenCalledWith("https://example.com/", 2);
    expect(result).toMatchObject({ page: 2, totalPages: 3, text: "page two text" });
  });

  it("caps page text at MAX_TEXT", async () => {
    const readPage = vi.fn().mockResolvedValue({
      url: "https://example.com/",
      title: "Example Brand",
      page: 1,
      totalPages: 1,
      text: "B".repeat(8000), // longer than MAX_TEXT=6000
      stale: false,
    });
    const ctx = makeCtx({ research: { fetchUrl: vi.fn(), readPage } });

    const result = await executeResearchWeb(
      { url: "https://example.com/" },
      makeRunCtx(ctx),
    );

    expect((result as any).text.length).toBe(6000);
  });

  it("returns structured error when readPage throws", async () => {
    const readPage = vi.fn().mockRejectedValue(new Error("SSRF blocked"));
    const ctx = makeCtx({ research: { fetchUrl: vi.fn(), readPage } });

    const result = await executeResearchWeb(
      { url: "https://example.com/" },
      makeRunCtx(ctx),
    );

    expect(result).toEqual({ error: "SSRF blocked" });
  });

  it("falls back to fetchUrl (old shape, no page field) when readPage is absent", async () => {
    const fetchUrl = vi.fn().mockResolvedValue({
      url: "https://example.com/",
      title: "Example Brand",
      text: "legacy body",
    });
    const ctx = makeCtx({ research: { fetchUrl } }); // no readPage

    const result = await executeResearchWeb(
      { url: "https://example.com/" },
      makeRunCtx(ctx),
    );

    expect(fetchUrl).toHaveBeenCalledWith("https://example.com/");
    expect(result).toMatchObject({ url: "https://example.com/", title: "Example Brand", text: "legacy body" });
    // old shape — no paging fields leak in
    expect((result as any).totalPages).toBeUndefined();
    expect((result as any).page).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// executeResearchWeb — query mode without search configured
// ---------------------------------------------------------------------------

describe("executeResearchWeb — query mode, no search transport", () => {
  it("returns the graceful not-configured message when search is absent", async () => {
    const fetchUrl = vi.fn();
    const ctx = makeCtx({ research: { fetchUrl } }); // no .search

    const result = await executeResearchWeb(
      { query: "nike brand identity" },
      makeRunCtx(ctx),
    );

    expect(fetchUrl).not.toHaveBeenCalled();
    expect((result as any).message).toMatch(/Web search isn't configured yet/);
  });
});

// ---------------------------------------------------------------------------
// executeResearchWeb — query mode WITH search configured
// ---------------------------------------------------------------------------

describe("executeResearchWeb — query mode, search wired", () => {
  it("calls context.research.search and returns results", async () => {
    const searchResults = {
      results: [
        { url: "https://example.com", title: "Example", snippet: "A great brand." },
      ],
    };
    const search = vi.fn().mockResolvedValue(searchResults);
    const fetchUrl = vi.fn();
    const ctx = makeCtx({ research: { fetchUrl, search, searchSlots: makeSlots() } });

    const result = await executeResearchWeb(
      { query: "example brand" },
      makeRunCtx(ctx),
    );

    expect(search).toHaveBeenCalledWith("example brand");
    expect(fetchUrl).not.toHaveBeenCalled();
    expect(result).toEqual(searchResults);
  });

  it("returns structured error when search throws", async () => {
    const search = vi.fn().mockRejectedValue(new Error("Search service unavailable"));
    const fetchUrl = vi.fn();
    const ctx = makeCtx({ research: { fetchUrl, search, searchSlots: makeSlots() } });

    const result = await executeResearchWeb(
      { query: "example brand" },
      makeRunCtx(ctx),
    );

    expect(result).toEqual({ error: "Search service unavailable" });
  });
});

// ---------------------------------------------------------------------------
// executeResearchWeb — no research port at all
// ---------------------------------------------------------------------------

describe("executeResearchWeb — research port absent", () => {
  it("returns a graceful error when context.research is not injected", async () => {
    const ctx = makeCtx(); // no research port

    const result = await executeResearchWeb(
      { url: "https://example.com/" },
      makeRunCtx(ctx),
    );

    expect((result as any).error).toMatch(/Web research isn't available/);
  });
});

// ---------------------------------------------------------------------------
// MONEY-A10 — 聊天搜索计费(规格 docs/specs/money-engine.md §7.4)
// ---------------------------------------------------------------------------
//
// 这一组钉的是钱:每一次到达 provider 的搜索都要么被计入 succeeded(会被结算),要么根本
// 没打出去。上限判**已占槽数**而不是已成功数,因为纯「成功后计数」会被单步并发 fan-out
// 绕过 —— 6 次并发全部在任何一次返回之前通过检查,6 次全打到供应商。

describe("executeResearchWeb — MONEY-A10 搜索槽与单轮上限", () => {
  it("MONEY-A10:成功的搜索占一槽并计一次费", async () => {
    const slots = makeSlots();
    const search = vi.fn().mockResolvedValue({ results: [] });
    const ctx = makeCtx({ research: { fetchUrl: vi.fn(), search, searchSlots: slots } });

    await executeResearchWeb({ query: "nike" }, makeRunCtx(ctx));

    expect(search).toHaveBeenCalledTimes(1);
    expect(slots).toEqual({ granted: OTTO_CHAT_MAX_SEARCHES_PER_TURN, taken: 1, succeeded: 1 });
  });

  it("MONEY-A10:搜索失败释放槽且不计费 —— 商家不为一次没拿到结果的搜索付钱", async () => {
    const slots = makeSlots();
    const search = vi.fn().mockRejectedValue(new Error("provider down"));
    const ctx = makeCtx({ research: { fetchUrl: vi.fn(), search, searchSlots: slots } });

    const result = await executeResearchWeb({ query: "nike" }, makeRunCtx(ctx));

    expect((result as any).error).toBe("provider down");
    expect(slots).toEqual({ granted: OTTO_CHAT_MAX_SEARCHES_PER_TURN, taken: 0, succeeded: 0 });
  });

  it("MONEY-A10:单轮并发发起 6 次搜索 —— 只有 5 次到达 provider,第 6 次被拒", async () => {
    // 规格 §7.4 逐字点名的行为测试。gate 让 5 次调用同时挂在飞行中,第 6 次因此面对的是
    // 「5 个槽全被占着、一个都还没返回」的最坏时刻。
    const slots = makeSlots();
    let release!: () => void;
    const inFlight = new Promise<void>((r) => { release = r; });
    const search = vi.fn(async () => {
      await inFlight;
      return { results: [{ url: "https://a.com", title: "A", snippet: "s" }] };
    });
    const ctx = makeCtx({ research: { fetchUrl: vi.fn(), search, searchSlots: slots } });

    const calls = Array.from({ length: 6 }, (_, i) =>
      executeResearchWeb({ query: `q${i}` }, makeRunCtx(ctx)),
    );

    // 供应商只被打了上限那么多次 —— 第 6 次连网络都没碰。
    expect(search).toHaveBeenCalledTimes(OTTO_CHAT_MAX_SEARCHES_PER_TURN);
    expect(OTTO_CHAT_MAX_SEARCHES_PER_TURN).toBe(5);

    release();
    const outs = (await Promise.all(calls)) as any[];
    const refused = outs.filter((o) => o.refused === true);
    expect(refused).toHaveLength(1);
    // 拒绝要诚实,并把商家引到深度研究那条路上(A10 判词)。
    expect(refused[0].reason).toMatch(/Search limit reached for this turn \(5 searches\)/);
    expect(refused[0].reason).toMatch(/proposeResearch/);

    // 结算口径:5 次成功 ⇒ 5 × 单次费率。
    expect(slots.succeeded).toBe(OTTO_CHAT_MAX_SEARCHES_PER_TURN);
  });

  it("MONEY-A10:占满槽之后的第 7、8 次同样被拒,且不再打供应商", async () => {
    const slots = {
      granted: OTTO_CHAT_MAX_SEARCHES_PER_TURN,
      taken: OTTO_CHAT_MAX_SEARCHES_PER_TURN,
      succeeded: OTTO_CHAT_MAX_SEARCHES_PER_TURN,
    };
    const search = vi.fn().mockResolvedValue({ results: [] });
    const ctx = makeCtx({ research: { fetchUrl: vi.fn(), search, searchSlots: slots } });

    const a = (await executeResearchWeb({ query: "x" }, makeRunCtx(ctx))) as any;
    const b = (await executeResearchWeb({ query: "y" }, makeRunCtx(ctx))) as any;

    expect(a.refused).toBe(true);
    expect(b.refused).toBe(true);
    expect(search).not.toHaveBeenCalled();
    expect(slots.succeeded).toBe(OTTO_CHAT_MAX_SEARCHES_PER_TURN); // 拒绝不产生收费
  });

  it("MONEY-A10:接了 search 却没有槽计数器 ⇒ fail closed,不打供应商", async () => {
    // 一次没人计数的搜索就是一次没人收费的搜索(结算腿读的正是 slots.succeeded)。
    const search = vi.fn().mockResolvedValue({ results: [] });
    const ctx = makeCtx({ research: { fetchUrl: vi.fn(), search } }); // 无 searchSlots

    const result = (await executeResearchWeb({ query: "nike" }, makeRunCtx(ctx))) as any;

    expect(search).not.toHaveBeenCalled();
    expect(result.message).toMatch(/isn't available/i);
  });

  it("MONEY-A10:url 腿仍然免费 —— 读页面不占槽、不计费", async () => {
    const slots = makeSlots();
    const fetchUrl = vi.fn().mockResolvedValue({ url: "https://a.com", title: "A", text: "hi" });
    const ctx = makeCtx({ research: { fetchUrl, search: vi.fn(), searchSlots: slots } });

    await executeResearchWeb({ url: "https://a.com" }, makeRunCtx(ctx));

    expect(fetchUrl).toHaveBeenCalledTimes(1);
    expect(slots).toEqual({ granted: OTTO_CHAT_MAX_SEARCHES_PER_TURN, taken: 0, succeeded: 0 });
  });

  // ── 判官 P1:槽由**账本**发,不是全局常量 ────────────────────────────────────────────
  //
  // 低余额下预扣会被压缩,账本因此只发得起更少的格。工具若仍按常量 5 放行,搜完了 settle 会
  // 被 clamp,平台吃差额 —— 这一组钉的就是「工具只放行账本买得起的次数」。
  it("MONEY-A10:granted=0(余额只够开聊)⇒ 一次都不许搜,不打供应商", async () => {
    const slots = makeSlots(0);
    const search = vi.fn().mockResolvedValue({ results: [] });
    const ctx = makeCtx({ research: { fetchUrl: vi.fn(), search, searchSlots: slots } });

    const out = (await executeResearchWeb({ query: "nike" }, makeRunCtx(ctx))) as any;

    expect(search).not.toHaveBeenCalled();
    expect(out.refused).toBe(true);
    expect(slots.succeeded).toBe(0);
    // 余额话,不是上限话 —— 说错了商家会去做没用的动作。
    expect(out.reason).toMatch(/more credits/i);
    expect(out.reason).not.toMatch(/proposeResearch/);
    // 0 格有它自己的说法:「covers 0 searches, and they are used up」是句废话,模型会照着它编。
    expect(out.reason).toMatch(/does not cover a web search this turn/);
    expect(out.reason).not.toMatch(/used up/);
  });

  it("MONEY-A10:granted=2 ⇒ 第 3 次被拒,供应商只被打 2 次,结算按 2 格", async () => {
    const slots = makeSlots(2);
    const search = vi.fn().mockResolvedValue({ results: [] });
    const ctx = makeCtx({ research: { fetchUrl: vi.fn(), search, searchSlots: slots } });

    await executeResearchWeb({ query: "a" }, makeRunCtx(ctx));
    await executeResearchWeb({ query: "b" }, makeRunCtx(ctx));
    const third = (await executeResearchWeb({ query: "c" }, makeRunCtx(ctx))) as any;

    expect(search).toHaveBeenCalledTimes(2);
    expect(third.refused).toBe(true);
    expect(third.reason).toMatch(/covers 2 searches/);
    expect(slots.succeeded).toBe(2);            // settle = 2 × 单价,被那 2 格坚实预扣罩住
  });

  it("MONEY-A10:granted=1 时拒绝文案用单数(数字是算出来的,不是拼出来的)", async () => {
    const slots = { granted: 1, taken: 1, succeeded: 1 };
    const ctx = makeCtx({ research: { fetchUrl: vi.fn(), search: vi.fn(), searchSlots: slots } });
    const out = (await executeResearchWeb({ query: "x" }, makeRunCtx(ctx))) as any;
    expect(out.reason).toMatch(/covers 1 search,/);
  });

  it("MONEY-A10:granted 达到上限才说「转深度研究」—— 两句话不许说反", async () => {
    const atCap = { granted: OTTO_CHAT_MAX_SEARCHES_PER_TURN, taken: OTTO_CHAT_MAX_SEARCHES_PER_TURN, succeeded: 5 };
    const ctx = makeCtx({ research: { fetchUrl: vi.fn(), search: vi.fn(), searchSlots: atCap } });
    const out = (await executeResearchWeb({ query: "x" }, makeRunCtx(ctx))) as any;
    expect(out.reason).toMatch(/proposeResearch/);
    expect(out.reason).not.toMatch(/more credits/i);
  });

  it("MONEY-A10:工具描述对模型说真话 —— 价现算、不再声称 $0", () => {
    const d = researchWebSkill.description;
    expect(d).not.toMatch(/This is \$0/);
    expect(d).toContain("COSTS THE MERCHANT CREDITS");
    // 价是算出来的:改费率这句话当场跟着改,而不是留一个手抄的旧数字骗模型。
    expect(d).toContain(`about ${displayCredits(searchUnitChargeInternal("basic"))} credits`);
    expect(d).toContain(`at most ${OTTO_CHAT_MAX_SEARCHES_PER_TURN} searches`);
    // 读页面确实免费,这句真话不许被一起改掉。
    expect(d).toContain("Reading a page with url is free");
  });
});

// ---------------------------------------------------------------------------
// Parameter schema validation (tested on the raw zod schema)
// ---------------------------------------------------------------------------

describe("researchWebInput schema validation", () => {
  it("rejects input when neither url nor query is given", () => {
    const result = researchWebInput.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts input with url only", () => {
    const result = researchWebInput.safeParse({ url: "https://example.com" });
    expect(result.success).toBe(true);
  });

  it("accepts input with query only", () => {
    const result = researchWebInput.safeParse({ query: "some query" });
    expect(result.success).toBe(true);
  });

  it("accepts input with both url and query", () => {
    const result = researchWebInput.safeParse({ url: "https://example.com", query: "brand" });
    expect(result.success).toBe(true);
  });

  it("rejects non-URL strings in url field", () => {
    const result = researchWebInput.safeParse({ url: "not-a-url" });
    expect(result.success).toBe(false);
  });
});

import { describe, it, expect, vi } from "vitest";
import { researchWebSkill, executeResearchWeb, researchWebInput } from "./research-web.js";
import type { OttoContext } from "../context.js";

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
    const ctx = makeCtx({ research: { fetchUrl, search } });

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
    const ctx = makeCtx({ research: { fetchUrl, search } });

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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readPageCached, normalizeUrl, PAGE_CHARS } from "@/lib/web-page-cache";

// readPageCached takes its prisma + fetcher as injected deps, so these tests need no
// vi.mock — we hand it plain vi.fn() mocks and assert on how it drives them.

function makeDeps(overrides: {
  cacheRow?: { title: string; text: string; fetchedAt: Date } | null;
  fetch?: ReturnType<typeof vi.fn>;
} = {}) {
  const findUnique = vi.fn().mockResolvedValue(
    overrides.cacheRow === undefined ? null : overrides.cacheRow,
  );
  const upsert = vi.fn().mockResolvedValue({});
  const fetch =
    overrides.fetch ??
    vi.fn().mockResolvedValue({ url: "https://example.com/p", title: "Fetched", text: "fetched body" });
  const prisma = { webPageCache: { findUnique, upsert } };
  // deps.prisma is typed as the real PrismaClient in the helper; the test mock is a
  // structural subset, so cast through unknown.
  return { findUnique, upsert, fetch, deps: { prisma: prisma as never, fetch } };
}

const DAY = 24 * 60 * 60 * 1000;

describe("normalizeUrl — conservative: lowercase host + strip #fragment only", () => {
  it("lowercases the host but preserves path + query + trailing slash", () => {
    expect(normalizeUrl("https://Example.COM/Path/?B=2&a=1")).toBe(
      "https://example.com/Path/?B=2&a=1",
    );
  });

  it("strips the #fragment", () => {
    expect(normalizeUrl("https://example.com/x#section")).toBe("https://example.com/x");
  });

  it("host-case variants normalize identically (same hash)", () => {
    expect(normalizeUrl("https://EXAMPLE.com/a")).toBe(normalizeUrl("https://example.com/a"));
  });

  it("different paths do NOT collapse", () => {
    expect(normalizeUrl("https://example.com/a")).not.toBe(normalizeUrl("https://example.com/b"));
  });
});

describe("readPageCached — cache freshness", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fresh cache hit does NOT call fetch and does NOT upsert", async () => {
    const { fetch, upsert, deps } = makeDeps({
      cacheRow: { title: "Cached", text: "cached body", fetchedAt: new Date(Date.now() - DAY) },
    });
    const res = await readPageCached("https://example.com/p", 1, deps);
    expect(fetch).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(res.title).toBe("Cached");
    expect(res.text).toBe("cached body");
    expect(res.stale).toBe(false);
  });

  it("expired cache (>7 days) refetches and upserts the fresh row", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ url: "https://example.com/p", title: "Fresh", text: "fresh body" });
    const { upsert, deps } = makeDeps({
      cacheRow: { title: "Stale", text: "stale body", fetchedAt: new Date(Date.now() - 8 * DAY) },
      fetch,
    });
    const res = await readPageCached("https://example.com/p", 1, deps);
    expect(fetch).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledOnce();
    expect(res.title).toBe("Fresh");
    expect(res.text).toBe("fresh body");
    expect(res.stale).toBe(false);
  });

  it("no cache row → fetch + upsert", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ url: "https://example.com/p", title: "New", text: "new body" });
    const { upsert, deps } = makeDeps({ cacheRow: null, fetch });
    const res = await readPageCached("https://example.com/p", 1, deps);
    expect(fetch).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledOnce();
    expect(res.title).toBe("New");
    expect(res.stale).toBe(false);
  });
});

describe("readPageCached — paging (PAGE_CHARS = 4000)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exposes PAGE_CHARS = 4000", () => {
    expect(PAGE_CHARS).toBe(4000);
  });

  it("splits a 9000-char body into 3 pages; page 2 = chars 4000..7999", async () => {
    const body =
      "a".repeat(4000) + "b".repeat(4000) + "c".repeat(1000); // 9000 chars
    const { deps } = makeDeps({
      cacheRow: { title: "T", text: body, fetchedAt: new Date() },
    });

    const p1 = await readPageCached("https://example.com/p", 1, deps);
    expect(p1.totalPages).toBe(3);
    expect(p1.page).toBe(1);
    expect(p1.text).toBe(body.slice(0, 4000));

    const p2 = await readPageCached("https://example.com/p", 2, deps);
    expect(p2.text).toBe(body.slice(4000, 8000));
    expect(p2.text.length).toBe(4000);

    const p3 = await readPageCached("https://example.com/p", 3, deps);
    expect(p3.text).toBe(body.slice(8000, 12000));
    expect(p3.text.length).toBe(1000);
  });

  it("page out of range → empty text, correct totalPages, no throw, no clamp", async () => {
    const body = "a".repeat(4000) + "b".repeat(4000) + "c".repeat(1000); // 9000 -> 3 pages
    const { deps } = makeDeps({ cacheRow: { title: "T", text: body, fetchedAt: new Date() } });
    const p4 = await readPageCached("https://example.com/p", 4, deps);
    expect(p4.page).toBe(4);
    expect(p4.totalPages).toBe(3);
    expect(p4.text).toBe("");
  });

  it("empty body still reports totalPages = 1", async () => {
    const { deps } = makeDeps({ cacheRow: { title: "T", text: "", fetchedAt: new Date() } });
    const res = await readPageCached("https://example.com/p", 1, deps);
    expect(res.totalPages).toBe(1);
    expect(res.text).toBe("");
  });
});

describe("readPageCached — degradation on fetch error", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetch throws AND an (expired) cache row exists → serve stale row with stale: true", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const { upsert, deps } = makeDeps({
      cacheRow: { title: "Old", text: "old body", fetchedAt: new Date(Date.now() - 30 * DAY) },
      fetch,
    });
    const res = await readPageCached("https://example.com/p", 1, deps);
    expect(res.stale).toBe(true);
    expect(res.title).toBe("Old");
    expect(res.text).toBe("old body");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("fetch throws AND no cache row → rethrows", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("boom"));
    const { deps } = makeDeps({ cacheRow: null, fetch });
    await expect(readPageCached("https://example.com/p", 1, deps)).rejects.toThrow(/boom/);
  });
});

describe("readPageCached — cache key uses normalized urlHash", () => {
  beforeEach(() => vi.clearAllMocks());

  it("looks up by the sha256 of the normalized url (host-case-insensitive)", async () => {
    const { findUnique, deps } = makeDeps({ cacheRow: { title: "C", text: "c", fetchedAt: new Date() } });
    await readPageCached("https://EXAMPLE.com/a#frag", 1, deps);
    const arg = findUnique.mock.calls[0][0];
    // same as lowercased-host, fragment-stripped variant
    const { findUnique: f2, deps: d2 } = makeDeps({ cacheRow: { title: "C", text: "c", fetchedAt: new Date() } });
    await readPageCached("https://example.com/a", 1, d2);
    expect(arg.where.urlHash).toBe(f2.mock.calls[0][0].where.urlHash);
  });
});

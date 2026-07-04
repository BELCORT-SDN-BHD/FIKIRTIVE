import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// #124 money honesty: the human paste-link path is DETERMINISTIC & FREE — no LLM, no spend.
// @fikirtive/core (extractProductDraft) is kept REAL so this end-to-end tests the action's
// orchestration: fetch → deterministic Layer 1. fetchRawHtml is mocked to feed fixtures without
// touching the network. There is no transport / withLlmBudget / reserve / settle to mock anymore —
// their absence is itself the proof that no page can spend.
// ---------------------------------------------------------------------------
const { mockOwner, mockFetchRawHtml } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockFetchRawHtml: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("../fetch-extract", () => ({ fetchRawHtml: mockFetchRawHtml, MAX_BODY: 512 * 1024 }));

import { ingestProductFromUrl } from "../product-ingest-actions";

const OWNER = "owner-1";
const BASE = "https://shop.example.com/p/latte";

const FULL_HTML = `<html><head><script type="application/ld+json">${JSON.stringify({
  "@type": "Product",
  name: "Latte Blend",
  description: "Smooth coffee.",
  image: "https://cdn.example.com/l.jpg",
  offers: { price: "49.00", priceCurrency: "MYR" },
})}</script></head></html>`;

const THIN_HTML = `<html><head><title>Bare Product</title></head><body><img src="/hero.png"></body></html>`;

function expectOk(res: unknown): asserts res is { ok: true; draft: { name?: string; price?: string; description?: string; imageUrl?: string } } {
  if (!res || typeof res !== "object" || !("ok" in res)) throw new Error(`expected ok result, got ${JSON.stringify(res)}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: OWNER });
});

describe("ingestProductFromUrl — auth + input", () => {
  it("requireOwner fail → error, never fetches", async () => {
    mockOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await ingestProductFromUrl(BASE);
    expect(res).toEqual({ error: "Not authorized." });
    expect(mockFetchRawHtml).not.toHaveBeenCalled();
  });

  it("empty / non-string url → error, never fetches", async () => {
    expect(await ingestProductFromUrl("")).toHaveProperty("error");
    expect(await ingestProductFromUrl(123 as unknown)).toHaveProperty("error");
    expect(mockFetchRawHtml).not.toHaveBeenCalled();
  });
});

describe("ingestProductFromUrl — rich page → deterministic draft", () => {
  it("rich JSON-LD page → full deterministic draft", async () => {
    mockFetchRawHtml.mockResolvedValue({ url: BASE, html: FULL_HTML });
    const res = await ingestProductFromUrl(BASE);
    expectOk(res);
    expect(res.draft.name).toBe("Latte Blend");
    expect(res.draft.price).toContain("49.00");
    expect(res.draft.description).toBe("Smooth coffee.");
  });
});

describe("ingestProductFromUrl — thin page stays free (never spends)", () => {
  it("thin page → deterministic <title> draft, no gap-filling, no spend", async () => {
    mockFetchRawHtml.mockResolvedValue({ url: BASE, html: THIN_HTML });
    const res = await ingestProductFromUrl(BASE);
    expectOk(res);
    // Only the deterministic <title> is filled; price/description stay empty (user completes them).
    expect(res.draft.name).toBe("Bare Product");
    expect(res.draft.price).toBeUndefined();
    expect(res.draft.description).toBeUndefined();
  });
});

describe("ingestProductFromUrl — fetch failure", () => {
  it("fetch throws → friendly error, no draft", async () => {
    mockFetchRawHtml.mockRejectedValue(new Error("Site returned 404"));
    const res = await ingestProductFromUrl(BASE);
    expect(res).toHaveProperty("error");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks. @fikirtive/core (extractProductDraft) and @fikirtive/otto (withLlmBudget)
// are kept REAL so this is an end-to-end test of the action's orchestration:
// fetch → deterministic Layer 1 → (thin?) Layer 2 LLM. @fikirtive/db is mocked so
// the real withLlmBudget import resolves AND we can prove reserve/settle are never
// called on the dev mock path (paid=false). fetchRawHtml is mocked to feed fixtures
// without touching the network.
// ---------------------------------------------------------------------------
const { mockOwner, mockImpersonating, mockFetchRawHtml, mockGetTransport, mockChat, mockReserve, mockSettle, mockRefund } =
  vi.hoisted(() => ({
    mockOwner: vi.fn(),
    mockImpersonating: vi.fn(),
    mockFetchRawHtml: vi.fn(),
    mockGetTransport: vi.fn(),
    mockChat: vi.fn(),
    mockReserve: vi.fn(),
    mockSettle: vi.fn(),
    mockRefund: vi.fn(),
  }));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockImpersonating }));
vi.mock("../fetch-extract", () => ({ fetchRawHtml: mockFetchRawHtml, MAX_BODY: 512 * 1024 }));
vi.mock("../runtime-config", () => ({ getTransport: mockGetTransport }));
vi.mock("@fikirtive/db", () => ({
  prisma: {},
  Prisma: {},
  reserveCredits: mockReserve,
  settleCredits: mockSettle,
  refundReservation: mockRefund,
}));

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

function expectOk(res: unknown): asserts res is { ok: true; draft: { name?: string; price?: string; description?: string; imageUrl?: string }; usedLlm: boolean } {
  if (!res || typeof res !== "object" || !("ok" in res)) throw new Error(`expected ok result, got ${JSON.stringify(res)}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: OWNER });
  mockImpersonating.mockResolvedValue(false);
  mockGetTransport.mockResolvedValue({ name: "mock", chat: mockChat });
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

describe("ingestProductFromUrl — rich page uses Layer 1 only (不花冤枉钱)", () => {
  it("rich JSON-LD page → deterministic draft; transport.chat NEVER called; no reserve", async () => {
    mockFetchRawHtml.mockResolvedValue({ url: BASE, html: FULL_HTML });
    const res = await ingestProductFromUrl(BASE);
    expectOk(res);
    expect(res.draft.name).toBe("Latte Blend");
    expect(res.draft.price).toContain("49.00");
    expect(res.draft.description).toBe("Smooth coffee.");
    expect(res.usedLlm).toBe(false);
    expect(mockChat).not.toHaveBeenCalled(); // the money proof: rich page spends nothing
    expect(mockReserve).not.toHaveBeenCalled();
  });
});

describe("ingestProductFromUrl — thin page escalates to Layer 2", () => {
  it("thin page → LLM fills gaps; deterministic <title> name wins; dev mock = $0 (paid=false)", async () => {
    mockFetchRawHtml.mockResolvedValue({ url: BASE, html: THIN_HTML });
    mockChat.mockResolvedValue({
      text: JSON.stringify({ name: "Real Product Name", price: "RM 30", description: "A nice product." }),
    });
    const res = await ingestProductFromUrl(BASE);
    expectOk(res);
    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(res.usedLlm).toBe(true);
    expect(res.draft.name).toBe("Bare Product"); // deterministic wins over LLM
    expect(res.draft.price).toBe("RM 30"); // LLM filled the gap
    expect(res.draft.description).toBe("A nice product.");
    // dev mock transport → paid=false → withLlmBudget never reserves/settles
    expect(mockReserve).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("thin page while impersonating → LLM blocked, returns deterministic draft (no tenant spend)", async () => {
    mockFetchRawHtml.mockResolvedValue({ url: BASE, html: THIN_HTML });
    mockImpersonating.mockResolvedValue(true);
    const res = await ingestProductFromUrl(BASE);
    expectOk(res);
    expect(mockChat).not.toHaveBeenCalled();
    expect(res.usedLlm).toBe(false);
    expect(res.draft.name).toBe("Bare Product");
  });

  it("LLM returns garbage → keep deterministic draft, don't throw, usedLlm=false", async () => {
    mockFetchRawHtml.mockResolvedValue({ url: BASE, html: THIN_HTML });
    mockChat.mockResolvedValue({ text: "not json at all" });
    const res = await ingestProductFromUrl(BASE);
    expectOk(res);
    expect(res.draft.name).toBe("Bare Product");
    expect(res.draft.price).toBeUndefined();
    expect(res.usedLlm).toBe(false);
  });
});

describe("ingestProductFromUrl — fetch failure", () => {
  it("fetch throws → friendly error, no draft", async () => {
    mockFetchRawHtml.mockRejectedValue(new Error("Site returned 404"));
    const res = await ingestProductFromUrl(BASE);
    expect(res).toHaveProperty("error");
  });
});

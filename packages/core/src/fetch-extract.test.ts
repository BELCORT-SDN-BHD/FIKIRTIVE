import { describe, it, expect, vi, beforeEach } from "vitest";

// Bypass the real SSRF/DNS guard — its own behavior is covered by url-safety tests.
// Here we only exercise the fetch + cap + (non-)strip layering.
vi.mock("./url-safety.js", () => ({
  assertPublicHttpUrlResolved: vi.fn(async (raw: string) => new URL(raw)),
}));

import { fetchRawHtml, fetchAndExtract, MAX_BODY } from "./fetch-extract.js";

function mockFetchOnce(body: string, ok = true, status = 200) {
  const buf = new TextEncoder().encode(body);
  global.fetch = vi.fn(async () => ({
    ok,
    status,
    arrayBuffer: async () => buf.buffer.slice(0, buf.byteLength),
  })) as unknown as typeof fetch;
}

beforeEach(() => vi.clearAllMocks());

describe("fetchRawHtml — Layer 0 raw HTML (SSRF-safe)", () => {
  it("returns the raw HTML with tags intact (NOT stripped)", async () => {
    mockFetchOnce("<html><head><title>T</title><script>var x=1</script></head></html>");
    const r = await fetchRawHtml("https://ok.example.com/p");
    expect(r.url).toBe("https://ok.example.com/p");
    expect(r.html).toContain("<title>T</title>");
    expect(r.html).toContain("<script>"); // the JSON-LD lives in <script> — must survive
  });

  it("caps the body at MAX_BODY", async () => {
    mockFetchOnce("x".repeat(MAX_BODY + 5000));
    const r = await fetchRawHtml("https://ok.example.com/big");
    expect(r.html.length).toBeLessThanOrEqual(MAX_BODY);
  });

  it("throws when the site returns non-ok", async () => {
    mockFetchOnce("nope", false, 503);
    await expect(fetchRawHtml("https://ok.example.com/err")).rejects.toThrow(/503/);
  });
});

describe("fetchAndExtract — behavior unchanged after the refactor", () => {
  it("still strips tags and returns title + cleaned text", async () => {
    mockFetchOnce("<html><head><title>Hello</title></head><body><p>World</p></body></html>");
    const r = await fetchAndExtract("https://ok.example.com/p");
    expect(r.title).toBe("Hello");
    expect(r.text).toContain("World");
    expect(r.text).not.toContain("<p>");
  });
});

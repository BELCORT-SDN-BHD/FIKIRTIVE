/**
 * SHARE-A5 / SHARE-A6(docs/specs/share-preview.md 已冻结 · v1)—— the page that actually renders
 * for a share-preview link, exercised the way `login-paused-banner.test.tsx` exercises `/login`:
 * render the REAL server component, mock only what it cannot run without (a session-less request
 * has no `cookies()`/`headers()` runtime, and `redirect()` throws in real Next). Everything else —
 * the banner copy, the redirect target, which module supplies the token — is the real page.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SharePreviewView } from "@/lib/share-preview-view";
import { SHARE_PREVIEW_COOKIE_NAME } from "@/lib/share-preview-cookie";

const mockLoadSharePreview = vi.fn<(token: string, headers: Headers) => Promise<SharePreviewView>>();
vi.mock("@/lib/share-preview-view", () => ({ loadSharePreview: mockLoadSharePreview }));

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === SHARE_PREVIEW_COOKIE_NAME && cookieValue ? { value: cookieValue } : undefined),
  }),
  headers: async () => new Headers(),
}));

const { default: SharePreviewPage } = await import("../page");

const POST_VIEW: SharePreviewView = {
  state: "post",
  channelLabel: "Instagram",
  caption: "Two-for-one on iced coffee this Saturday.",
  firstComment: null,
  scheduledAtMs: new Date("2026-09-05T02:00:00.000Z").getTime(),
  scheduledTz: "Asia/Kuala_Lumpur",
  linkExpiresAtMs: Date.now() + 3_600_000,
  media: [],
  mediaWithheld: false,
};

function searchParams(t?: string | string[]) {
  return Promise.resolve(t === undefined ? {} : { t });
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieValue = undefined;
  mockLoadSharePreview.mockResolvedValue(POST_VIEW);
});

describe("SHARE-A5 —— 页面如实说明内容是实时的，不是快照", () => {
  it("SHARE-A5 —— a live post renders the exact disclosure line", async () => {
    cookieValue = "tok.sig";
    const html = renderToStaticMarkup(await SharePreviewPage({ searchParams: searchParams() }));
    expect(html).toContain("Content may have changed since this link was shared.");
  });

  it("SHARE-A5 —— the disclosure appears together with whatever the post's CURRENT caption is (no caching layer between them)", async () => {
    cookieValue = "tok.sig";
    mockLoadSharePreview.mockResolvedValueOnce({ ...POST_VIEW, caption: "Edited after the link was shared." });
    const html = renderToStaticMarkup(await SharePreviewPage({ searchParams: searchParams() }));
    expect(html).toContain("Edited after the link was shared.");
    expect(html).toContain("Content may have changed since this link was shared.");
  });

  it("the disclosure does not appear on the unavailable state — nothing to disclose about a post never shown", async () => {
    const html = renderToStaticMarkup(await SharePreviewPage({ searchParams: searchParams() }));
    expect(html).not.toContain("Content may have changed");
  });
});

describe("SHARE-A6 —— token 出网址：cookie 是读的入口，`?t=` 只转发", () => {
  it("SHARE-A6 —— a legacy `?t=` link redirects to `/s/<token>` instead of being read directly", async () => {
    await expect(SharePreviewPage({ searchParams: searchParams("legacy-token.sig") })).rejects.toThrow(
      "NEXT_REDIRECT:/s/legacy-token.sig",
    );
    // It never even asks loadSharePreview about the query token — the cookie door is the ONE path.
    expect(mockLoadSharePreview).not.toHaveBeenCalled();
  });

  it("SHARE-A6 —— the `?t=` value is URL-encoded on the way to `/s/<token>`", async () => {
    await expect(SharePreviewPage({ searchParams: searchParams("a/b c") })).rejects.toThrow(
      `NEXT_REDIRECT:/s/${encodeURIComponent("a/b c")}`,
    );
  });

  it("a repeated `?t=` arrives as an array — never redirected, never read as a token (falls through to the cookie, same as no `?t=` at all)", async () => {
    const html = renderToStaticMarkup(await SharePreviewPage({ searchParams: searchParams(["a", "b"]) }));
    // No cookie in this case either, so the outcome is identical to a plain clean-address miss —
    // the array is simply never a legal `?t=` value, not a second thing to fail closed on.
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockLoadSharePreview).not.toHaveBeenCalled();
    expect(html).toContain("This preview isn&#x27;t available");
  });

  it("a repeated `?t=` still lets a LIVE cookie read normally — the array only means the legacy query itself is never used", async () => {
    cookieValue = "cookie-token.sig";
    const html = renderToStaticMarkup(await SharePreviewPage({ searchParams: searchParams(["a", "b"]) }));
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockLoadSharePreview).toHaveBeenCalledWith("cookie-token.sig", expect.any(Headers));
    expect(html).toContain("Content may have changed since this link was shared.");
  });

  it("a clean address (no `?t=`) reads the token from the cookie, not from any query", async () => {
    cookieValue = "cookie-token.sig";
    await SharePreviewPage({ searchParams: searchParams() });
    expect(mockLoadSharePreview).toHaveBeenCalledWith("cookie-token.sig", expect.any(Headers));
  });

  it("a clean address with NO cookie shows the same unavailable state, without ever calling loadSharePreview", async () => {
    const html = renderToStaticMarkup(await SharePreviewPage({ searchParams: searchParams() }));
    expect(mockLoadSharePreview).not.toHaveBeenCalled();
    expect(html).toContain("This preview isn&#x27;t available");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Exercise the AUTHORIZED path end to end: the real shared orchestration (@fikirtive/core/server)
// over a mocked Graph client, with the DB + token decryption mocked. Proves the adapter resolves
// the page token + IG business account and drives create → poll → publish. The page token is used
// only inside the mocked graph — it never appears in the { externalId } result.
const { mockFindUnique } = vi.hoisted(() => ({ mockFindUnique: vi.fn() }));
vi.mock("@fikirtive/db", () => ({ prisma: { metaConnection: { findUnique: mockFindUnique } } }));
// mock paths resolve relative to THIS test file → ../../ reaches apps/web/lib/*
vi.mock("../../token-encryption", () => ({ decryptToken: () => "USER_TOKEN" }));

const { mockGraphGet, mockGraphPost } = vi.hoisted(() => ({ mockGraphGet: vi.fn(), mockGraphPost: vi.fn() }));
vi.mock("../../meta-graph", () => ({ metaGraphGet: mockGraphGet, metaGraphPost: mockGraphPost }));

import { publishViaMeta } from "../meta-publish-adapter";

const ACTIVE = {
  accessTokenEnc: "enc", canPublish: true, organicPublishPaused: false, status: "active",
  tokenExpiresAt: new Date(Date.now() + 3_600_000),
};
const TARGET = { id: "page_1", name: "Kaia Cafe" };

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue(ACTIVE);
  // me/accounts resolution + container status poll both go through metaGraphGet.
  mockGraphGet.mockImplementation(async (_token: string, path: string) => {
    if (path === "me/accounts") {
      return { data: [{ id: "page_1", name: "Kaia Cafe", access_token: "PAGE_TOKEN", instagram_business_account: { id: "ig_100" } }] };
    }
    return { status_code: "FINISHED" }; // container poll
  });
  mockGraphPost.mockImplementation(async (_token: string, path: string) => {
    if (path.endsWith("/media_publish")) return { id: "media_777" };
    if (path.endsWith("/media")) return { id: "container_1" };
    if (path.endsWith("/photos")) return { id: "photo_1", post_id: "page_post_55" };
    if (path.endsWith("/feed")) return { id: "feed_1" };
    return {};
  });
});

describe("publishViaMeta — authorized path", () => {
  it("IG single image: resolves page + IG id → create → publish → externalId (token never leaks)", async () => {
    const res = await publishViaMeta("owner-1", TARGET, { caption: "hello", mediaUrls: ["https://x/pub/a.jpg"], postType: "feed-image" }, "instagram");
    expect(res).toEqual({ externalId: "media_777" });
    // publish used the PAGE token (resolved from me/accounts), not the user token
    const publishCall = mockGraphPost.mock.calls.find((c) => String(c[1]).endsWith("/media_publish"));
    expect(publishCall?.[0]).toBe("PAGE_TOKEN");
    expect(JSON.stringify(res)).not.toContain("PAGE_TOKEN");
    expect(JSON.stringify(res)).not.toContain("USER_TOKEN");
  });

  it("IG refuses when the page has no connected Instagram business account", async () => {
    mockGraphGet.mockImplementation(async (_t: string, path: string) =>
      path === "me/accounts" ? { data: [{ id: "page_1", access_token: "PAGE_TOKEN" }] } : { status_code: "FINISHED" });
    const res = await publishViaMeta("owner-1", TARGET, { caption: "hi", mediaUrls: ["https://x/a.jpg"], postType: "feed-image" }, "instagram");
    expect(res).toMatchObject({ error: expect.stringMatching(/instagram business account/i) });
  });

  it("IG refuses a reel/story postType (published as reminders, not auto)", async () => {
    const res = await publishViaMeta("owner-1", TARGET, { caption: "hi", mediaUrls: ["https://x/a.jpg"], postType: "reel" }, "instagram");
    expect(res).toMatchObject({ error: expect.stringMatching(/reminder/i) });
  });

  it("FB single image → /photos with the page token → returns the feed post id", async () => {
    const res = await publishViaMeta("owner-1", TARGET, { caption: "hi", mediaUrls: ["https://x/a.jpg"], postType: "feed-image" }, "facebook");
    expect(res).toEqual({ externalId: "page_post_55" });
    const photoCall = mockGraphPost.mock.calls.find((c) => String(c[1]).endsWith("/photos"));
    expect(photoCall?.[0]).toBe("PAGE_TOKEN");
  });

  it("refuses when the target page isn't among the owner's connected pages", async () => {
    const res = await publishViaMeta("owner-1", { id: "not_my_page", name: "X" }, { caption: "hi", mediaUrls: ["https://x/a.jpg"], postType: "feed-image" }, "facebook");
    expect(res).toMatchObject({ error: expect.stringMatching(/connected pages/i) });
  });
});

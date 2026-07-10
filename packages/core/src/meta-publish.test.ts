import { describe, it, expect, vi } from "vitest";
import { publishInstagram, publishFacebook, type MetaGraphPort } from "./meta-publish.js";

const noSleep = () => Promise.resolve();

/** A scriptable mock Graph port: `post` returns queued replies (or throws a queued error),
 *  `get` returns a fixed status_code. */
function mockPort(opts: {
  postReplies?: Array<{ id?: string; post_id?: string } | Error>;
  status?: string;
}): { port: MetaGraphPort; posts: Array<{ path: string; body: Record<string, string> }> } {
  const posts: Array<{ path: string; body: Record<string, string> }> = [];
  const replies = [...(opts.postReplies ?? [])];
  const port: MetaGraphPort = {
    async post(path, body) {
      posts.push({ path, body });
      const r = replies.shift();
      if (r instanceof Error) throw r;
      return r ?? { id: "auto" };
    },
    async get() {
      return { status_code: opts.status ?? "FINISHED" };
    },
  };
  return { port, posts };
}

function metaError(code: number, message = "meta says no") {
  const e = new Error(message) as Error & { metaError?: { code: number; message: string } };
  e.metaError = { code, message };
  return e;
}

describe("publishInstagram", () => {
  it("single image: create → poll FINISHED → media_publish → externalId", async () => {
    const { port, posts } = mockPort({ postReplies: [{ id: "container_1" }, { id: "media_9" }], status: "FINISHED" });
    const res = await publishInstagram(port, { igUserId: "ig1", mediaUrls: ["https://x/pub/a.jpg"], caption: "hi", sleep: noSleep });
    expect(res).toEqual({ externalId: "media_9" });
    expect(posts[0]!.path).toBe("ig1/media");
    expect(posts[0]!.body.image_url).toBe("https://x/pub/a.jpg");
    expect(posts[1]!.path).toBe("ig1/media_publish");
    expect(posts[1]!.body.creation_id).toBe("container_1");
  });

  it("persists creationId BEFORE media_publish (idempotency anchor)", async () => {
    const onCreationId = vi.fn().mockResolvedValue(undefined);
    const { port } = mockPort({ postReplies: [{ id: "container_1" }, { id: "media_9" }] });
    await publishInstagram(port, { igUserId: "ig1", mediaUrls: ["https://x/a.jpg"], caption: "hi", onCreationId, sleep: noSleep });
    expect(onCreationId).toHaveBeenCalledWith("container_1");
  });

  it("carousel: builds each child, then a CAROUSEL parent, then publishes", async () => {
    const { port, posts } = mockPort({
      postReplies: [{ id: "child_1" }, { id: "child_2" }, { id: "parent_1" }, { id: "media_9" }],
    });
    const res = await publishInstagram(port, {
      igUserId: "ig1", mediaUrls: ["https://x/a.jpg", "https://x/b.jpg"], caption: "carousel", sleep: noSleep,
    });
    expect(res).toEqual({ externalId: "media_9" });
    expect(posts[0]!.body.is_carousel_item).toBe("true");
    expect(posts[2]!.body.media_type).toBe("CAROUSEL");
    expect(posts[2]!.body.children).toBe("child_1,child_2");
  });

  it("carousel abort (⑤a): a child failure returns BEFORE any media_publish (nothing posted)", async () => {
    const { port, posts } = mockPort({ postReplies: [{ id: "child_1" }, metaError(100, "bad media")] });
    const res = await publishInstagram(port, {
      igUserId: "ig1", mediaUrls: ["https://x/a.jpg", "https://x/bad.jpg"], caption: "c", sleep: noSleep,
    });
    expect(res).toMatchObject({ retryable: false });
    // no media_publish was ever called → Meta has nothing published
    expect(posts.some((p) => p.path.endsWith("/media_publish"))).toBe(false);
  });

  it("poll timeout (④): container stuck IN_PROGRESS → retryable error, no publish", async () => {
    const { port, posts } = mockPort({ postReplies: [{ id: "container_1" }], status: "IN_PROGRESS" });
    const res = await publishInstagram(port, {
      igUserId: "ig1", mediaUrls: ["https://x/a.jpg"], caption: "hi", maxPollTries: 3, sleep: noSleep,
    });
    expect(res).toMatchObject({ retryable: true });
    expect(posts.some((p) => p.path.endsWith("/media_publish"))).toBe(false);
  });

  it("container ERROR status → hard fail (③, not retryable)", async () => {
    const { port } = mockPort({ postReplies: [{ id: "container_1" }], status: "ERROR" });
    const res = await publishInstagram(port, { igUserId: "ig1", mediaUrls: ["https://x/a.jpg"], caption: "hi", sleep: noSleep });
    expect(res).toMatchObject({ retryable: false });
  });

  it("transient Meta code (4 = rate limit) → retryable", async () => {
    const { port } = mockPort({ postReplies: [metaError(4, "rate limited")] });
    const res = await publishInstagram(port, { igUserId: "ig1", mediaUrls: ["https://x/a.jpg"], caption: "hi", sleep: noSleep });
    expect(res).toMatchObject({ retryable: true });
  });

  it("first comment is best-effort — a comment failure does NOT fail the (already live) post", async () => {
    const { port } = mockPort({ postReplies: [{ id: "container_1" }, { id: "media_9" }, metaError(100, "comment blocked")] });
    const res = await publishInstagram(port, {
      igUserId: "ig1", mediaUrls: ["https://x/a.jpg"], caption: "hi", firstComment: "first!", sleep: noSleep,
    });
    expect(res).toEqual({ externalId: "media_9" });
  });

  it("no media → error", async () => {
    const { port } = mockPort({});
    expect(await publishInstagram(port, { igUserId: "ig1", mediaUrls: [], caption: "hi" })).toMatchObject({ retryable: false });
  });
});

describe("publishFacebook", () => {
  it("single image → /photos with the caption, returns the feed post_id", async () => {
    const { port, posts } = mockPort({ postReplies: [{ id: "photo_1", post_id: "page_post_1" }] });
    const res = await publishFacebook(port, { pageId: "pg1", message: "hi", mediaUrls: ["https://x/a.jpg"] });
    expect(res).toEqual({ externalId: "page_post_1" });
    expect(posts[0]!.path).toBe("pg1/photos");
    expect(posts[0]!.body.url).toBe("https://x/a.jpg");
    expect(posts[0]!.body.caption).toBe("hi");
  });

  it("no media → /feed with message + link", async () => {
    const { port, posts } = mockPort({ postReplies: [{ id: "feed_1" }] });
    const res = await publishFacebook(port, { pageId: "pg1", message: "hi", mediaUrls: [], link: "https://x/y" });
    expect(res).toEqual({ externalId: "feed_1" });
    expect(posts[0]!.path).toBe("pg1/feed");
    expect(posts[0]!.body.link).toBe("https://x/y");
  });

  it("Meta hard reject → not retryable", async () => {
    const { port } = mockPort({ postReplies: [metaError(200, "no CREATE_CONTENT permission")] });
    const res = await publishFacebook(port, { pageId: "pg1", message: "hi", mediaUrls: ["https://x/a.jpg"] });
    expect(res).toMatchObject({ retryable: false });
  });
});

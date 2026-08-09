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

/** A structured Meta 4xx rejection (Meta received + refused the request → nothing was published). */
function metaReject(code: number, status = 400, message = "rejected") {
  const e = new Error(message) as Error & { metaError?: { code: number; message: string }; status?: number };
  e.metaError = { code, message };
  e.status = status;
  return e;
}
/** A bare HTTP error with a status but no structured Meta body (e.g. a 5xx / gateway error). */
function httpError(status: number, message = "server error") {
  const e = new Error(message) as Error & { status?: number };
  e.status = status;
  return e;
}
/** A timed-out / aborted fetch (AbortSignal.timeout → DOMException name "TimeoutError"). */
function timeoutError() {
  const e = new Error("request timed out") as Error & { name: string };
  e.name = "TimeoutError";
  return e;
}

describe("publishInstagram", () => {
  it("single image: create → poll FINISHED → media_publish → externalId", async () => {
    const { port, posts } = mockPort({ postReplies: [{ id: "container_1" }, { id: "media_9" }], status: "FINISHED" });
    const res = await publishInstagram(port, { igUserId: "ig1", mediaUrls: ["https://x/pub/a.jpg"], caption: "hi", sleep: noSleep });
    expect(res).toEqual({ externalId: "media_9" });
    expect(posts[0]!.path).toBe("ig1/media");
    expect(posts[0]!.body.image_url).toBe("https://x/pub/a.jpg");
    // G1 anchor: a single-image container carries the caption (caption lives on the container).
    expect(posts[0]!.body.caption).toBe("hi");
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
    // G1 anchor: carousel CHILD sub-containers carry NO caption; the caption lives on the parent.
    expect(posts[0]!.body.caption).toBeUndefined();
    expect(posts[2]!.body.media_type).toBe("CAROUSEL");
    expect(posts[2]!.body.children).toBe("child_1,child_2");
    expect(posts[2]!.body.caption).toBe("carousel");
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

  // ── H5: media_publish MAY have crossed the side-effect point → AMBIGUOUS, never a blind retry ──
  it("H5: media_publish 5xx → AMBIGUOUS (not retryable) — the caller must reconcile, never re-send", async () => {
    const { port } = mockPort({ postReplies: [{ id: "container_1" }, httpError(500)] });
    const res = await publishInstagram(port, { igUserId: "ig1", mediaUrls: ["https://x/a.jpg"], caption: "hi", sleep: noSleep });
    expect(res).toMatchObject({ ambiguous: true });
    // crucially NOT a retryable fail — a retryable result would drive a blind re-send = double-post
    expect("retryable" in res).toBe(false);
  });

  it("H5: media_publish timeout/abort → AMBIGUOUS (post may be live) — no blind retry", async () => {
    const { port } = mockPort({ postReplies: [{ id: "container_1" }, timeoutError()] });
    const res = await publishInstagram(port, { igUserId: "ig1", mediaUrls: ["https://x/a.jpg"], caption: "hi", sleep: noSleep });
    expect(res).toMatchObject({ ambiguous: true });
    expect("retryable" in res).toBe(false);
  });

  it("H5: media_publish 2xx but NO id → AMBIGUOUS (may have taken) — no blind retry", async () => {
    const { port } = mockPort({ postReplies: [{ id: "container_1" }, {}] });
    const res = await publishInstagram(port, { igUserId: "ig1", mediaUrls: ["https://x/a.jpg"], caption: "hi", sleep: noSleep });
    expect(res).toMatchObject({ ambiguous: true });
    expect("retryable" in res).toBe(false);
  });

  it("H5: a DEFINITIVE Meta 4xx at media_publish is NOT ambiguous (Meta refused → nothing posted)", async () => {
    const { port } = mockPort({ postReplies: [{ id: "container_1" }, metaReject(100, 400, "invalid creation_id")] });
    const res = await publishInstagram(port, { igUserId: "ig1", mediaUrls: ["https://x/a.jpg"], caption: "hi", sleep: noSleep });
    expect("ambiguous" in res).toBe(false);
    expect(res).toMatchObject({ retryable: false });
  });

  // ── H6: persisting the creationId anchor is a HARD precondition — a failure stops BEFORE publish ──
  it("H6: onCreationId failure aborts BEFORE media_publish (nothing goes live), retryable", async () => {
    const onCreationId = vi.fn().mockRejectedValue(new Error("attempt is no longer APPLYING"));
    const { port, posts } = mockPort({ postReplies: [{ id: "container_1" }, { id: "media_9" }] });
    const res = await publishInstagram(port, {
      igUserId: "ig1", mediaUrls: ["https://x/a.jpg"], caption: "hi", onCreationId, sleep: noSleep,
    });
    // no media_publish (or any post past the container) ever happened → Meta has nothing published
    expect(posts.some((p) => p.path.endsWith("/media_publish"))).toBe(false);
    expect(posts).toHaveLength(1); // only the container create
    // pre-side-effect → safe to retry (a retry rebuilds a fresh container)
    expect(res).toMatchObject({ retryable: true });
    expect("ambiguous" in res).toBe(false);
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

  it("G4 anchor: /photos 2xx but no id → AMBIGUOUS — never a blind /photos re-post", async () => {
    const { port } = mockPort({ postReplies: [{}] });
    const res = await publishFacebook(port, { pageId: "pg1", message: "hi", mediaUrls: ["https://x/a.jpg"] });
    expect(res).toMatchObject({ ambiguous: true });
    expect("retryable" in res).toBe(false);
  });

  it("no media → /feed with message + link", async () => {
    const { port, posts } = mockPort({ postReplies: [{ id: "feed_1" }] });
    const res = await publishFacebook(port, { pageId: "pg1", message: "hi", mediaUrls: [], link: "https://x/y" });
    expect(res).toEqual({ externalId: "feed_1" });
    expect(posts[0]!.path).toBe("pg1/feed");
    expect(posts[0]!.body.link).toBe("https://x/y");
  });

  it("Meta hard reject (structured 4xx) → not retryable, not ambiguous", async () => {
    // Our graph client always stamps the HTTP status on a Meta error; a 4xx with a code is a
    // DEFINITIVE rejection (Meta refused before acting → nothing posted), so it's safe to hard-fail.
    const { port } = mockPort({ postReplies: [metaReject(200, 403, "no CREATE_CONTENT permission")] });
    const res = await publishFacebook(port, { pageId: "pg1", message: "hi", mediaUrls: ["https://x/a.jpg"] });
    expect(res).toMatchObject({ retryable: false });
    expect("ambiguous" in res).toBe(false);
  });

  // ── H5 (FB): a lost/5xx receipt at /photos or /feed is AMBIGUOUS, never a blind re-post ──
  it("H5: /photos 5xx → AMBIGUOUS (post may be live) — never a blind /photos re-post", async () => {
    const { port } = mockPort({ postReplies: [httpError(502)] });
    const res = await publishFacebook(port, { pageId: "pg1", message: "hi", mediaUrls: ["https://x/a.jpg"] });
    expect(res).toMatchObject({ ambiguous: true });
    expect("retryable" in res).toBe(false);
  });

  it("H5: /feed 2xx but no id → AMBIGUOUS — never a blind /feed re-post", async () => {
    const { port } = mockPort({ postReplies: [{}] });
    const res = await publishFacebook(port, { pageId: "pg1", message: "hi", mediaUrls: [] });
    expect(res).toMatchObject({ ambiguous: true });
    expect("retryable" in res).toBe(false);
  });

  it("H5: a DEFINITIVE Meta 4xx at /feed is NOT ambiguous (Meta refused → nothing posted)", async () => {
    const { port } = mockPort({ postReplies: [metaReject(200, 403, "no permission")] });
    const res = await publishFacebook(port, { pageId: "pg1", message: "hi", mediaUrls: [] });
    expect("ambiguous" in res).toBe(false);
    expect(res).toMatchObject({ retryable: false });
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * #810 r4 P1-a —— 「最后一刻」必须是**最后一刻**,不是 send() 的入口
 *
 * r3 把开关复核放在 worker 调用 send() 之前,以为那就是发送前的最后一步。判官指出 IG 的
 * send() 里面还藏着慢工序:建容器 → 最多 15 次轮询(默认 ≥14×2 秒)→ 这之后才 media_publish。
 * 复核放在 send() 入口,等于把 240 秒的窗口换成了 ~30 秒的窗口,并没有关上。
 *
 * 这里用纯函数复现判官的时序:轮询进行到一半商家关掉开关。容器已经建好没关系(容器不是商家
 * 可见的发布,过期即废),但 media_publish 一次都不许发生 —— 那才是不可逆的那一下。
 * ──────────────────────────────────────────────────────────────────────────────────────────── */
describe("#810 r4 P1-a 复核紧贴最终不可逆动作", () => {
  /** 一个会分阶段回答的 IG 端口:前几次轮询 IN_PROGRESS,之后 FINISHED;每次轮询回调 onPoll。 */
  function pollingPort(opts: { finishOnPoll: number; onPoll?: (n: number) => void }) {
    const posts: string[] = [];
    let polls = 0;
    const port: MetaGraphPort = {
      async post(path) {
        posts.push(path);
        return { id: "container-1" };
      },
      async get() {
        polls += 1;
        opts.onPoll?.(polls);
        return { status_code: polls >= opts.finishOnPoll ? "FINISHED" : "IN_PROGRESS" };
      },
    };
    return { port, posts, polls: () => polls };
  }

  it("IG:轮询期间关掉开关 —— 容器可以已经建好,但 media_publish 零次", async () => {
    let switchOn = true;
    // 判官的时序:第 2 次轮询时商家关掉开关,容器第 4 次轮询才 FINISHED。
    const { port, posts } = pollingPort({
      finishOnPoll: 4,
      onPoll: (n) => {
        if (n === 2) switchOn = false;
      },
    });

    const res = await publishInstagram(port, {
      igUserId: "ig1",
      mediaUrls: ["https://cdn.test/1.jpg"],
      caption: "hi",
      sleep: noSleep,
      pollDelayMs: 0,
      confirmStillAuthorized: async () => switchOn,
    });

    expect(posts).toEqual(["ig1/media"]); // 备料发生了
    expect(posts.some((p) => p.endsWith("/media_publish"))).toBe(false); // 不可逆的那一下没发生
    expect(res).toMatchObject({ withdrawn: true, retryable: false });
  });

  it("IG:开关全程开着 —— 轮询完照常 media_publish(这道闸不误伤正常发布)", async () => {
    const { port, posts } = pollingPort({ finishOnPoll: 3 });
    const res = await publishInstagram(port, {
      igUserId: "ig1",
      mediaUrls: ["https://cdn.test/1.jpg"],
      caption: "hi",
      sleep: noSleep,
      pollDelayMs: 0,
      confirmStillAuthorized: async () => true,
    });
    expect(posts).toEqual(["ig1/media", "ig1/media_publish"]);
    expect(res).toMatchObject({ externalId: "container-1" });
  });

  it("IG:复核在**轮询之后**才问 —— 问得太早等于没问", async () => {
    const asked: number[] = [];
    let polls = 0;
    const { port } = pollingPort({
      finishOnPoll: 3,
      onPoll: (n) => {
        polls = n;
      },
    });
    await publishInstagram(port, {
      igUserId: "ig1",
      mediaUrls: ["https://cdn.test/1.jpg"],
      caption: "hi",
      sleep: noSleep,
      pollDelayMs: 0,
      confirmStillAuthorized: async () => {
        asked.push(polls); // 被问到时已经轮询了几次
        return true;
      },
    });
    expect(asked).toEqual([3]); // 只问一次,且是在容器 FINISHED 之后
  });

  it("IG:不传回调时行为一个字不变(web 侧的人工发布路径不受影响)", async () => {
    const { port, posts } = pollingPort({ finishOnPoll: 1 });
    const res = await publishInstagram(port, {
      igUserId: "ig1",
      mediaUrls: ["https://cdn.test/1.jpg"],
      caption: "hi",
      sleep: noSleep,
      pollDelayMs: 0,
    });
    expect(posts).toEqual(["ig1/media", "ig1/media_publish"]);
    expect(res).toMatchObject({ externalId: "container-1" });
  });

  it("FB:最终动作之前关掉开关 —— 一个 POST 都不发", async () => {
    const { port, posts } = mockPort({ postReplies: [{ id: "fb1" }] });
    const res = await publishFacebook(port, {
      pageId: "pg1",
      message: "hi",
      mediaUrls: [],
      confirmStillAuthorized: async () => false,
    });
    expect(posts).toEqual([]);
    expect(res).toMatchObject({ withdrawn: true, retryable: false });
  });

  it("FB:开关开着 —— 照常发", async () => {
    const { port, posts } = mockPort({ postReplies: [{ id: "fb1" }] });
    const res = await publishFacebook(port, {
      pageId: "pg1",
      message: "hi",
      mediaUrls: [],
      confirmStillAuthorized: async () => true,
    });
    expect(posts.map((p) => p.path)).toEqual(["pg1/feed"]);
    expect(res).toMatchObject({ externalId: "fb1" });
  });
});

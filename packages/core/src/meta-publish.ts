/**
 * Meta organic-publish orchestration (L1 spec §四B) — THE single publish implementation
 * (spec §五 单一动作层). Both the web channel adapter (apps/web/lib/channels) and the publish
 * worker drive THIS, so "human path" and "worker path" can never diverge into two publish logics.
 *
 * Pure + injectable: it takes a token-bound `MetaGraphPort` (post/get) so it has NO prisma, NO
 * node builtins, NO knowledge of who called it — fully unit-testable with a mock port. Web binds
 * the port to metaGraphPost/metaGraphGet(pageToken); the worker binds its own graph client.
 *
 * Never throws: returns { externalId } on success or { error, retryable } on failure. `retryable`
 * drives the caller's six-state decision (spec §三):
 *   retryable=false → hard reject (③ FAILED — re-posting yields the same error; don't retry)
 *   retryable=true  → transient/timeout (④ — bounded retry, then NEEDS_ATTENTION; never silent)
 */

export interface MetaGraphPort {
  /** Graph POST (token bound inside the impl). Throws on a Meta error body (carries metaError). */
  post(path: string, body: Record<string, string>): Promise<{ id?: unknown; post_id?: unknown; [k: string]: unknown }>;
  /** Graph GET (token bound inside the impl). Throws on a Meta error body. */
  get(path: string, params: Record<string, string>): Promise<{ status_code?: unknown; [k: string]: unknown }>;
}

export type PublishOk = { externalId: string };
export type PublishFail = { error: string; retryable: boolean };
export type PublishResult = PublishOk | PublishFail;

/** Transient Meta error codes → retry (six-state ④). Everything else is a hard reject (③).
 *  1/2 = transient API, 4/17/32/613 = rate limits, 341 = app-level throttling, 368 temporary block. */
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613]);

function classify(e: unknown): PublishFail {
  const err = e as { message?: string; metaError?: { code?: number; message?: string }; status?: number };
  const code = err?.metaError?.code;
  const status = err?.status;
  const retryable =
    (typeof status === "number" && (status === 429 || status >= 500)) ||
    (typeof code === "number" && TRANSIENT_CODES.has(code));
  const error = err?.metaError?.message || err?.message || "Meta publish failed";
  return { error, retryable };
}

function idOf(r: { id?: unknown; post_id?: unknown }): string | null {
  const v = r.post_id ?? r.id;
  return typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null;
}

/** Poll an IG media container until FINISHED. Images finish ~immediately; video/Reels transcode
 *  (not auto-published in L1). ERROR/EXPIRED → hard fail; still IN_PROGRESS past the budget →
 *  retryable timeout (④). `sleep` is injected so tests run instantly. */
async function pollContainer(
  graph: MetaGraphPort,
  creationId: string,
  maxTries: number,
  sleep: (ms: number) => Promise<void>,
  delayMs: number,
): Promise<PublishResult> {
  for (let i = 0; i < maxTries; i++) {
    let status: string;
    try {
      const r = await graph.get(creationId, { fields: "status_code" });
      status = typeof r.status_code === "string" ? r.status_code : "IN_PROGRESS";
    } catch (e) {
      return classify(e);
    }
    if (status === "FINISHED") return { externalId: creationId }; // ready to publish
    if (status === "ERROR" || status === "EXPIRED") {
      return { error: `media container ${status.toLowerCase()}`, retryable: false };
    }
    if (i < maxTries - 1) await sleep(delayMs);
  }
  return { error: "media still processing — Meta didn't finish in time", retryable: true };
}

export type InstagramPublishArgs = {
  igUserId: string;
  /** PUBLIC media URLs Meta can fetch (already JPEG — the caller transcodes). 1 = single, >1 = carousel. */
  mediaUrls: string[];
  caption: string;
  firstComment?: string | null;
  /** Persist the container id BEFORE media_publish (idempotency/reconcile anchor, spec §四D/§四F). */
  onCreationId?: (creationId: string) => Promise<void>;
  maxPollTries?: number;
  sleep?: (ms: number) => Promise<void>;
  pollDelayMs?: number;
};

/** IG publish: create container(s) → poll FINISHED → media_publish → (best-effort) first comment.
 *  Carousel abort is fail-closed (⑤a): a sub-container failure returns before media_publish, so
 *  Meta has NOTHING published — never a "half carousel" (that's physically impossible on IG; see
 *  the worker recovery notes). */
export async function publishInstagram(graph: MetaGraphPort, args: InstagramPublishArgs): Promise<PublishResult> {
  const { igUserId, mediaUrls, caption } = args;
  if (mediaUrls.length === 0) return { error: "no media to publish", retryable: false };
  const sleep = args.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxTries = args.maxPollTries ?? 15;
  const delay = args.pollDelayMs ?? 2000;

  let creationId: string;
  try {
    if (mediaUrls.length > 1) {
      // Carousel: each child first (⑤a — any child failure aborts BEFORE anything is published).
      const childIds: string[] = [];
      for (const url of mediaUrls) {
        const child = await graph.post(`${igUserId}/media`, { image_url: url, is_carousel_item: "true" });
        const cid = idOf(child);
        if (!cid) return { error: "couldn't create a carousel item", retryable: false };
        childIds.push(cid);
      }
      const parent = await graph.post(`${igUserId}/media`, {
        media_type: "CAROUSEL",
        children: childIds.join(","),
        caption,
      });
      const pid = idOf(parent);
      if (!pid) return { error: "couldn't create the carousel container", retryable: false };
      creationId = pid;
    } else {
      const container = await graph.post(`${igUserId}/media`, { image_url: mediaUrls[0]!, caption });
      const cid = idOf(container);
      if (!cid) return { error: "couldn't create the media container", retryable: false };
      creationId = cid;
    }
  } catch (e) {
    return classify(e);
  }

  // Persist the container id BEFORE publishing — recovery re-checks THIS exact container.
  if (args.onCreationId) await args.onCreationId(creationId);

  const polled = await pollContainer(graph, creationId, maxTries, sleep, delay);
  if ("error" in polled) return polled;

  let mediaId: string;
  try {
    const published = await graph.post(`${igUserId}/media_publish`, { creation_id: creationId });
    const mid = idOf(published);
    if (!mid) return { error: "publish returned no post id", retryable: true };
    mediaId = mid;
  } catch (e) {
    return classify(e);
  }

  // First comment is best-effort — the post is already live, so a comment failure never fails it.
  if (args.firstComment) {
    try {
      await graph.post(`${mediaId}/comments`, { message: args.firstComment });
    } catch {
      // swallow — post succeeded; a missing first comment is not a publish failure.
    }
  }
  return { externalId: mediaId };
}

export type FacebookPublishArgs = {
  pageId: string;
  message: string;
  /** 0 media = text/link post; 1 media = photo post (FB maxMediaCount is 1, no carousel). */
  mediaUrls: string[];
  link?: string | null;
};

/** FB page publish: a single image → /photos (published, with caption); otherwise → /feed
 *  (message + optional link). Returns the feed post id. */
export async function publishFacebook(graph: MetaGraphPort, args: FacebookPublishArgs): Promise<PublishResult> {
  try {
    if (args.mediaUrls.length >= 1) {
      const r = await graph.post(`${args.pageId}/photos`, { url: args.mediaUrls[0]!, caption: args.message });
      const id = idOf(r);
      if (!id) return { error: "photo post returned no id", retryable: true };
      return { externalId: id };
    }
    const body: Record<string, string> = { message: args.message };
    if (args.link) body.link = args.link;
    const r = await graph.post(`${args.pageId}/feed`, body);
    const id = idOf(r);
    if (!id) return { error: "feed post returned no id", retryable: true };
    return { externalId: id };
  } catch (e) {
    return classify(e);
  }
}

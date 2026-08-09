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
export type PublishFail = {
  error: string;
  retryable: boolean;
  /**
   * Set ONLY when the caller's `confirmStillAuthorized` said no at the last moment: the merchant
   * withdrew and NOTHING was sent. This is not a failure and must not be retried or surfaced as one.
   *
   * It rides on the failure shape on purpose. A caller that knows about withdrawal (the publish
   * worker) branches on it and puts the post back to waiting; a caller that doesn't (the web
   * adapters, which never pass the callback, so they can never see it) reads a plain non-retryable
   * failure — which is the safe reading in every direction: never retried, never double-posted.
   */
  withdrawn?: true;
};

/** The last-moment authorization gate, asked immediately before a channel's FINAL irreversible
 *  action and nowhere else (#810 r4 P1-a). `false` = the merchant withdrew; nothing may be sent.
 *
 *  It lives in the shared publish contract rather than in each channel's own code so that the
 *  question is asked at the right instant on EVERY channel: IG's send does container creation and
 *  up to ~30 seconds of polling before media_publish, and a per-channel convention would let the
 *  next slow step quietly reopen the window this closes. */
export type ConfirmStillAuthorized = () => Promise<boolean>;

/** The one withdrawal result, so worker and channels can't drift into two spellings. */
export function publishWithdrawn(): PublishFail {
  return {
    withdrawn: true,
    error: "auto-publish was switched off before this post was sent — nothing was published",
    retryable: false,
  };
}
/**
 * The request MAY have crossed Meta's external side-effect point (a publish POST that timed out /
 * dropped its connection / returned 5xx / succeeded but gave us no id). The post might already be
 * live and we CANNOT tell from here. This is NEVER a `retryable` fail: blindly re-sending it would
 * risk a second live post (double-post). The caller must keep its APPLYING claim and reconcile
 * Meta's TRUTH (IG: the stored creationId anchor; FB: recent posts) before deciding — or fail
 * closed to NEEDS_ATTENTION. See the worker handler's `"ambiguous" in result` branch.
 */
export type PublishAmbiguous = { ambiguous: true; error: string };
export type PublishResult = PublishOk | PublishFail | PublishAmbiguous;

/** Transient Meta error codes → retry (six-state ④). Everything else is a hard reject (③).
 *  1/2 = transient API, 4/17/32/613 = rate limits, 341 = app-level throttling, 368 temporary block. */
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613]);

/** An aborted/timed-out fetch (AbortSignal.timeout → "TimeoutError"; manual abort → "AbortError"). */
function isAbort(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Did this failure leave the publish outcome UNKNOWN — i.e. the request may have already crossed
 * Meta's side-effect point? A well-formed Meta error body (a numeric `metaError.code`) at ANY 4xx
 * (including 429 throttling) is a definitive rejection: Meta received the request and refused it
 * before acting, so nothing was published (safe to hard-fail / retry per the code). Everything else
 * — a network drop, a timeout/abort, a 5xx server error, or no structured 4xx body — means we never
 * got a definitive answer, so the outcome is ambiguous and MUST NOT be blindly retried.
 */
function crossedSideEffectPoint(e: unknown): boolean {
  if (isAbort(e)) return true;
  const err = e as { metaError?: { code?: number }; status?: number };
  const status = err?.status;
  const hasMetaCode = typeof err?.metaError?.code === "number";
  if (hasMetaCode && typeof status === "number" && status >= 400 && status < 500) {
    return false; // definitive 4xx rejection — the publish did NOT happen
  }
  return true; // 5xx / network / timeout / no structured 4xx body → unknown
}

function classify(e: unknown): PublishFail {
  const err = e as { message?: string; metaError?: { code?: number; message?: string }; status?: number };
  const code = err?.metaError?.code;
  const status = err?.status;
  const retryable =
    isAbort(e) ||
    (typeof status === "number" && (status === 429 || status >= 500)) ||
    (typeof code === "number" && TRANSIENT_CODES.has(code));
  const error = err?.metaError?.message || (isAbort(e) ? "Meta request timed out" : err?.message) || "Meta publish failed";
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
  /** Asked once, immediately before media_publish — see ConfirmStillAuthorized. */
  confirmStillAuthorized?: ConfirmStillAuthorized;
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

  // Persist the container id BEFORE publishing — recovery re-checks THIS exact container. This is a
  // HARD precondition (spec §四D lock 3 / §四F): if we can't durably store the recovery anchor we
  // MUST NOT publish, because a lost receipt afterwards would be unrecoverable (reconcile would
  // have no container to check → a blind retry would double-post). We're still BEFORE media_publish,
  // so nothing is live yet — aborting here is safe and retryable (a retry rebuilds a fresh container).
  if (args.onCreationId) {
    try {
      await args.onCreationId(creationId);
    } catch (e) {
      return { error: `couldn't persist the publish anchor before going live: ${(e as Error)?.message ?? "store failed"}`, retryable: true };
    }
  }

  const polled = await pollContainer(graph, creationId, maxTries, sleep, delay);
  if ("error" in polled) return polled;

  // THE last moment (#810 r4 P1-a). Everything above — container creation, the anchor write, and up
  // to maxPollTries × pollDelayMs (default ~30 s) of polling — is preparation: a container the
  // merchant cannot see, which simply expires if we walk away. media_publish below is the one
  // irreversible, merchant-visible step, so the switch is read HERE and not one line earlier.
  // Asking at the top of this function (or at the caller's send() boundary) would leave the whole
  // polling window open, which is exactly the hole this closes.
  if (args.confirmStillAuthorized && !(await args.confirmStillAuthorized())) return publishWithdrawn();

  let mediaId: string;
  try {
    const published = await graph.post(`${igUserId}/media_publish`, { creation_id: creationId });
    const mid = idOf(published);
    // We got a 2xx but no id: the publish may or may not have taken. Ambiguous, never blind-retry.
    if (!mid) return { ambiguous: true, error: "media_publish returned no post id — the post may already be live" };
    mediaId = mid;
  } catch (e) {
    // We are PAST the point of no return: media_publish left our process. A timeout / dropped
    // connection / 5xx means the post MAY already be live → ambiguous (reconcile via creationId),
    // NEVER a blind retry. Only a definitive Meta rejection (4xx with a code) means it did NOT
    // publish and is safe to classify normally.
    return crossedSideEffectPoint(e) ? { ambiguous: true, error: classify(e).error } : classify(e);
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
  /** Asked once, immediately before the /photos or /feed POST — see ConfirmStillAuthorized. */
  confirmStillAuthorized?: ConfirmStillAuthorized;
};

/** FB page publish: a single image → /photos (published, with caption); otherwise → /feed
 *  (message + optional link). Returns the feed post id. */
export async function publishFacebook(graph: MetaGraphPort, args: FacebookPublishArgs): Promise<PublishResult> {
  // FB's final action IS its first external call — there is no preparation to sit through — but the
  // gate is asked through the same contract as IG's rather than left to each channel's habit, so a
  // slow step added here later can't reopen the window (#810 r4 P1-a).
  if (args.confirmStillAuthorized && !(await args.confirmStillAuthorized())) return publishWithdrawn();
  try {
    if (args.mediaUrls.length >= 1) {
      const r = await graph.post(`${args.pageId}/photos`, { url: args.mediaUrls[0]!, caption: args.message });
      const id = idOf(r);
      // 2xx but no id → the post may already be live. Ambiguous, never blind-retry (double-post).
      if (!id) return { ambiguous: true, error: "photo post returned no id — the post may already be live" };
      return { externalId: id };
    }
    const body: Record<string, string> = { message: args.message };
    if (args.link) body.link = args.link;
    const r = await graph.post(`${args.pageId}/feed`, body);
    const id = idOf(r);
    if (!id) return { ambiguous: true, error: "feed post returned no id — the post may already be live" };
    return { externalId: id };
  } catch (e) {
    // Past the side-effect point on a lost/5xx receipt → ambiguous (the worker reconciles, never
    // blind-reposts /feed). A definitive 4xx rejection means nothing posted → classify normally.
    return crossedSideEffectPoint(e) ? { ambiguous: true, error: classify(e).error } : classify(e);
  }
}

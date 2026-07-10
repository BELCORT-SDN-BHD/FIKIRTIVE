/**
 * Publish worker (L1 spec §四A/§四D/§四F). Drives one due, approved ScheduledPost to IG/FB via the
 * SHARED orchestration in @fikirtive/core/server (spec §五 — the same code the web adapter runs).
 *
 * ── Six-state, fail-closed (spec §三) ──────────────────────────────────────────────────────────
 *   ① success        → ScheduledPost.metaPostId + PUBLISHED; PublishAttempt APPLIED.
 *   ② no permission  → NEEDS_ATTENTION (never blindly retried — retrying still has no permission).
 *   ③ platform reject→ FAILED (retryable=false; re-posting yields the same error, so no retry).
 *   ④ transient/timeout → bounded pg-boss retry; over the limit → NEEDS_ATTENTION (never silent FAILED).
 *   ⑤ partial (carousel) → IG carousel media_publish is a SINGLE atomic call. There is NO physical
 *      "half a carousel": a sub-container failure aborts BEFORE media_publish (⑤a — nothing posted),
 *      and a lost receipt AFTER media_publish is the ⑥ ambiguity, resolved by reconcile. So the worker
 *      MUST NEVER "re-send the remaining half" — that path does not exist and would double-post.
 *   ⑥ recovery       → a crashed/redelivered publish leaves a dangling APPLYING; the reaper's reconcile
 *      queries Meta's TRUTH first (the stored creationId for IG / recent posts for FB) and only then
 *      decides PUBLISHED vs NEEDS_ATTENTION. It NEVER blindly re-publishes.
 *
 * ── Triple idempotency (spec §四D) ─────────────────────────────────────────────────────────────
 *   1. ScheduledPost.metaPostId set ⇒ short-circuit (already published).
 *   2. PublishAttempt(state='APPLYING') partial-unique index ⇒ at most one worker in flight per post.
 *   3. IG creationId stored on the attempt BEFORE media_publish ⇒ reconcile re-checks THAT container
 *      (Meta-idempotent) rather than rebuilding + re-posting.
 */
import { prisma } from "@fikirtive/db";
import { decryptToken, signMediaToken } from "@fikirtive/token-crypto";
import {
  publishInstagram,
  publishFacebook,
  type MetaGraphPort,
  type PublishResult,
} from "@fikirtive/core/server";
import {
  storageKey,
  newId,
  PUBLISH_RETRY_LIMIT,
  META_REQUEST_TIMEOUT_MS,
  PUBLISH_EXECUTION_DEADLINE_MS,
  type PublishJobData,
} from "@fikirtive/core";
import { execa } from "execa";
import { storage } from "../storage.js";
import { sanitizeError } from "../redact.js";

// Keep in sync with apps/web/lib/meta-oauth.ts (META_GRAPH_VERSION). The worker can't import
// apps/web/lib (boundary), so it holds its own copy of the version + a minimal Graph client.
const META_GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

// A signed media URL must outlive Meta's ASYNC media pull (spec A5 — reconfirm with a real number
// before go-live). 2h is a generous default well above container-processing time.
const MEDIA_TTL_MS = 2 * 60 * 60 * 1000;

// The reaper's stale cutoff for a dangling APPLYING attempt. MUST exceed the queue expire
// (PUBLISH_QUEUE_POLICY.expireInSeconds = 300s) so a still-running publish that pg-boss still
// owns is never reconciled out from under itself.
const PUBLISH_STALE_MS = 10 * 60 * 1000;

/** Public base URL of the web app (the media proxy lives there). Prod already sets BETTER_AUTH_URL. */
function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || process.env.BETTER_AUTH_URL || "").replace(/\/$/, "");
}
function mediaProxySecret(): string {
  return process.env.MEDIA_PROXY_SECRET || "";
}

/* ── minimal worker-side Meta Graph client (throws with metaError+status like the web one) ── */

// Every Meta request carries an AbortSignal so a hung socket can never pin the worker past the
// queue's expire window (H7). Each request gets its own per-request timeout, AND — when an overall
// execution deadline is supplied — is also bound to it, so once the whole-publish deadline fires
// every in-flight and subsequent request aborts. A fetch that aborts throws a TimeoutError, which
// the core classify() treats as retryable/ambiguous depending on where it happened.
function metaSignal(overall?: AbortSignal): AbortSignal {
  const perRequest = AbortSignal.timeout(META_REQUEST_TIMEOUT_MS);
  return overall ? AbortSignal.any([overall, perRequest]) : perRequest;
}

async function graphPost(
  token: string,
  path: string,
  body: Record<string, string>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const r = await fetch(`${GRAPH_BASE}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: metaSignal(signal),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } };
  if (!r.ok || j?.error) {
    const e = new Error(j?.error?.message || "graph error") as Error & { metaError?: unknown; status?: number };
    e.metaError = j?.error;
    e.status = r.status;
    throw e;
  }
  return j;
}

async function graphGet(
  token: string,
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const u = new URL(`${GRAPH_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  // A reconcile GET (reaper) passes no overall signal → it still gets the per-request timeout, so a
  // hung read can never hang the reaper itself (H7).
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` }, signal: metaSignal(signal) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } };
  if (!r.ok || j?.error) {
    const e = new Error(j?.error?.message || "graph error") as Error & { metaError?: unknown; status?: number };
    e.metaError = j?.error;
    e.status = r.status;
    throw e;
  }
  return j;
}

function portFor(token: string, signal?: AbortSignal): MetaGraphPort {
  return { post: (p, b) => graphPost(token, p, b, signal), get: (p, pa) => graphGet(token, p, pa, signal) };
}

/* ── connection + target resolution (server-only; the page token never leaves the worker) ── */

type ResolvedConn = { userToken: string };

/** Owner-scoped fail-closed gate → the decrypted USER token, or a human refusal (→ NEEDS_ATTENTION). */
async function authorize(ownerId: string): Promise<ResolvedConn | { refuse: string }> {
  const conn = await prisma.metaConnection.findUnique({
    where: { ownerId },
    select: { accessTokenEnc: true, canPublish: true, organicPublishPaused: true, status: true, tokenExpiresAt: true },
  });
  if (!conn) return { refuse: "Connect the account before publishing." };
  if (!conn.canPublish) return { refuse: "Publishing isn't enabled yet — waiting on Meta's review." };
  if (conn.organicPublishPaused) return { refuse: "Publishing is paused for this connection." };
  if (conn.status === "expired") return { refuse: "This connection needs to be reconnected to publish." };
  if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() <= Date.now()) return { refuse: "This connection expired — reconnect to publish." };
  try {
    return { userToken: decryptToken(conn.accessTokenEnc) };
  } catch {
    return { refuse: "This connection needs to be reconnected to publish." };
  }
}

/** me/accounts → the page access token + connected IG business account id for a target page. */
async function resolvePage(
  userToken: string,
  targetId: string,
  signal?: AbortSignal,
): Promise<{ pageToken: string; igUserId: string | null } | { error: string; retryable: boolean }> {
  let pages: Record<string, unknown>[];
  try {
    const r = await graphGet(userToken, "me/accounts", { fields: "id,name,access_token,instagram_business_account{id}" }, signal);
    pages = (r.data as Record<string, unknown>[]) ?? [];
  } catch (e) {
    const status = (e as { status?: number }).status;
    // A timeout/abort here is pre-side-effect (no publish yet) → retryable, not a hard FAILED.
    const aborted = (e as { name?: string }).name === "TimeoutError" || (e as { name?: string }).name === "AbortError";
    return { error: "Couldn't resolve the page from Meta.", retryable: aborted || (!!status && (status === 429 || status >= 500)) };
  }
  const page = pages.find((p) => String(p.id ?? "") === targetId);
  const pageToken = page && typeof page.access_token === "string" ? page.access_token : "";
  if (!page || !pageToken) return { error: "That account isn't one of the owner's connected pages.", retryable: false };
  const iba = page.instagram_business_account as { id?: unknown } | undefined;
  const igUserId = iba && (typeof iba.id === "string" || typeof iba.id === "number") ? String(iba.id) : null;
  return { pageToken, igUserId };
}

/* ── media: resolve owned Generation → storage key → (IG: JPEG transcode) → signed proxy URL ── */

const IMG_JPEG = new Set(["jpg", "jpeg"]);

/** Transcode a stored image to JPEG (IG only eats JPEG). Uses the worker's ffmpeg (Debian trixie),
 *  reads the object via a presigned/local input, writes JPEG bytes back content-addressed. */
async function transcodeToJpeg(ownerId: string, key: string): Promise<string> {
  const input = await storage.ffmpegInput(key); // presigned URL (r2) or local path
  const { stdout } = await execa(
    "ffmpeg",
    ["-i", input, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "3", "pipe:1"],
    { encoding: "buffer", timeout: 60_000 },
  );
  const { key: jpgKey } = await storage.put(ownerId, new Uint8Array(stdout as Buffer), "jpg");
  return jpgKey;
}

/** Build public, signed proxy URLs Meta can fetch for a post's media, in carousel order.
 *  IG needs JPEG → non-JPEG images are transcoded first. Returns { urls } or a refusal. */
export async function buildMediaUrls(
  ownerId: string,
  scheduledPostId: string,
  channel: string,
): Promise<{ urls: string[] } | { error: string }> {
  const base = publicBaseUrl();
  const secret = mediaProxySecret();
  if (!base || !secret) return { error: "Media proxy isn't configured (base URL / secret)." };

  const rows = await prisma.scheduledPostMedia.findMany({
    where: { scheduledPostId },
    orderBy: { position: "asc" },
    select: { generationId: true },
  });
  if (rows.length === 0) return { error: "This post has no media to publish." };

  const gens = await prisma.generation.findMany({
    where: { id: { in: rows.map((r) => r.generationId) }, ownerId, deletedAt: null },
    select: { id: true, asset: { select: { ownerId: true, contentHash: true, ext: true } } },
  });
  const byId = new Map(gens.map((g) => [g.id, g.asset]));

  const urls: string[] = [];
  for (const r of rows) {
    const asset = byId.get(r.generationId);
    if (!asset) return { error: "Some of this post's media is missing." };
    let key = storageKey(asset.ownerId, asset.contentHash, asset.ext);
    if (channel === "instagram" && !IMG_JPEG.has(asset.ext.toLowerCase())) {
      key = await transcodeToJpeg(ownerId, key);
    }
    const token = signMediaToken(ownerId, key, Date.now() + MEDIA_TTL_MS, secret);
    urls.push(`${base}/api/media/pub/${token}`);
  }
  return { urls };
}

/* ── the publish EXECUTOR: resolve → build media → drive the shared orchestration ── */

/**
 * A DETERMINISTIC authorization/config refusal (no connection / publishing not enabled / paused /
 * expired / no target account). Re-posting can NEVER fix it, so the handler must NOT record it as
 * FAILED (③, which means "platform rejected the content"); it is six-state ② → NEEDS_ATTENTION.
 * It is produced BEFORE any Meta port is built, so it guarantees ZERO external calls (M1).
 */
export type PublishAuthRefused = { authFailed: true; error: string };

export type PublishExecutor = (
  post: DuePost,
  attemptId: string,
) => Promise<PublishResult | PublishAuthRefused>;

type DuePost = {
  id: string;
  ownerId: string;
  channel: string;
  metaTargetId: string | null;
  caption: string;
  firstComment: string | null;
};

/** The real executor. Persists the IG creationId onto the attempt BEFORE media_publish (lock 3). */
async function realExecute(post: DuePost, attemptId: string): Promise<PublishResult | PublishAuthRefused> {
  // Config/authorization refusals → NEEDS_ATTENTION (M1), and they short-circuit BEFORE any Meta
  // port exists, so no external call is ever made on this path.
  if (!post.metaTargetId) return { authFailed: true, error: "This post has no target account — pick a connected channel before publishing." };
  const auth = await authorize(post.ownerId);
  if ("refuse" in auth) return { authFailed: true, error: auth.refuse };

  // Arm the whole-execution deadline (H7): every Meta request below is bound to it, so a hung
  // publish is aborted well before pg-boss can expire + redeliver the job.
  const deadline = AbortSignal.timeout(PUBLISH_EXECUTION_DEADLINE_MS);

  const page = await resolvePage(auth.userToken, post.metaTargetId, deadline);
  if ("error" in page) return page;

  const media = await buildMediaUrls(post.ownerId, post.id, post.channel);
  if ("error" in media) return { error: media.error, retryable: false };

  const port = portFor(page.pageToken, deadline);
  // The creationId anchor is a HARD precondition for going live (H6): store it with an attempt CAS
  // (only while WE still hold the APPLYING claim). If the row moved (reaped) or the write fails, we
  // THROW — publishInstagram catches this BEFORE media_publish and aborts, so nothing is published.
  const onCreationId = async (creationId: string) => {
    const r = await prisma.publishAttempt.updateMany({
      where: { id: attemptId, state: "APPLYING" },
      data: { creationId },
    });
    if (r.count !== 1) throw new Error("attempt is no longer APPLYING — aborting before publish");
  };

  if (post.channel === "instagram") {
    if (!page.igUserId) return { error: "This page has no connected Instagram business account.", retryable: false };
    return publishInstagram(port, {
      igUserId: page.igUserId,
      mediaUrls: media.urls,
      caption: post.caption,
      firstComment: post.firstComment,
      onCreationId,
    });
  }
  return publishFacebook(port, { pageId: post.metaTargetId, message: post.caption, mediaUrls: media.urls });
}

/* ── the handler: triple idempotency + six-state ── */

const DUE_SELECT = { id: true, ownerId: true, channel: true, metaTargetId: true, caption: true, firstComment: true } as const;

/** The reconcile step, injectable so the handler stays hermetic under test (default: query Meta). */
type ReconcileFn = (
  attempt: { id: string; scheduledPostId: string; creationId: string | null },
  post: { ownerId: string; channel: string; metaTargetId: string | null; metaPostId: string | null },
) => Promise<"published" | "needs_attention">;

export async function handlePublish(
  data: PublishJobData,
  retryCount: number,
  execute: PublishExecutor = realExecute,
  reconcile: ReconcileFn = reconcileAttempt,
): Promise<void> {
  const post = await prisma.scheduledPost.findUnique({
    where: { id: data.scheduledPostId },
    select: { ...DUE_SELECT, status: true, metaPostId: true, deletedAt: true },
  });
  if (!post || post.deletedAt) {
    console.warn(`[publish] ${data.scheduledPostId} missing/deleted — dropping`);
    return;
  }

  // Lock 1: already published ⇒ short-circuit (idempotent; never re-post).
  if (post.metaPostId) {
    if (post.status !== "PUBLISHED") {
      await prisma.scheduledPost.updateMany({ where: { id: post.id, status: "PUBLISHING" }, data: { status: "PUBLISHED" } });
    }
    return;
  }
  // Only a due SCHEDULED post (or a PUBLISHING one being redelivered) is publishable.
  if (post.status !== "SCHEDULED" && post.status !== "PUBLISHING") {
    console.log(`[publish] ${post.id}: status ${post.status} — nothing to do`);
    return;
  }

  // Lock 2: atomic claim = insert PublishAttempt(APPLYING). The partial-unique index
  // (one APPLYING per post) makes a second racing worker's insert P2002 → it skips.
  const attemptId = newId();
  try {
    await prisma.publishAttempt.create({ data: { id: attemptId, scheduledPostId: post.id, state: "APPLYING" } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      console.log(`[publish] ${post.id}: another worker holds the APPLYING claim — skipping`);
      return;
    }
    throw e;
  }

  // H4 — the fail-closed status CAS, the sole gate on reaching Meta. Our `post` snapshot is STALE:
  // between the read and now the post may have been cancelled, edited back to DRAFT, deleted, or
  // published by another path. This single atomic UPDATE both (a) transitions SCHEDULED→PUBLISHING
  // on the fresh row and (b) proves the row is STILL publishable (SCHEDULED, or PUBLISHING on a
  // legit redelivery) with no metaPostId and not soft-deleted. Only count === 1 authorizes ANY Meta
  // call — otherwise we'd fire a publish the DB no longer wants (a ghost post). On a miss we release
  // the APPLYING claim and stop, never calling Meta.
  const claimed = await prisma.scheduledPost.updateMany({
    where: { id: post.id, status: { in: ["SCHEDULED", "PUBLISHING"] }, metaPostId: null, deletedAt: null },
    data: { status: "PUBLISHING" },
  });
  if (claimed.count !== 1) {
    await prisma.publishAttempt.update({
      where: { id: attemptId },
      data: { state: "FAILED", error: "post no longer publishable at claim time (cancelled/edited/published/deleted)", finishedAt: new Date() },
    });
    console.warn(`[publish] ${post.id}: not publishable at claim (count=${claimed.count}) — releasing lock, NO Meta call`);
    return;
  }

  let result: PublishResult | PublishAuthRefused;
  try {
    result = await execute(post, attemptId);
  } catch (err) {
    // An unexpected throw inside the executor (network/store) — treat as transient.
    result = { error: sanitizeError(err), retryable: true };
  }

  if ("authFailed" in result) {
    // M1 — deterministic authorization/config refusal. ZERO Meta calls happened (the executor
    // refused before building the port). Re-posting can't fix it → six-state ② NEEDS_ATTENTION,
    // never FAILED. CAS-scoped so a concurrently-resolved row is never clobbered.
    const reason = sanitizeError(result.error);
    await prisma.$transaction([
      prisma.scheduledPost.updateMany({
        where: { id: post.id, status: "PUBLISHING", metaPostId: null },
        data: { status: "NEEDS_ATTENTION", lastError: reason },
      }),
      prisma.publishAttempt.updateMany({
        where: { id: attemptId, state: "APPLYING" },
        data: { state: "FAILED", error: reason, finishedAt: new Date() },
      }),
    ]);
    console.warn(`[publish] ${post.id}: NEEDS_ATTENTION (authorization) — ${reason}`);
    return;
  }

  if ("externalId" in result) {
    // ① success. Stamp the metaPostId ANCHOR durably (lock 1 for any future delivery) + APPLIED.
    // The CAS keys on metaPostId=null (the anchor), NOT status: even if a racing reaper/cancel moved
    // the row out of PUBLISHING, we must still record the id — losing it would risk a future
    // double-post. count !== 1 means the anchor was already set (another path won) → surface it.
    const [stamped] = await prisma.$transaction([
      prisma.scheduledPost.updateMany({
        where: { id: post.id, metaPostId: null },
        data: { status: "PUBLISHED", metaPostId: result.externalId, lastError: null },
      }),
      prisma.publishAttempt.update({
        where: { id: attemptId },
        data: { state: "APPLIED", metaPostId: result.externalId, finishedAt: new Date() },
      }),
    ]);
    if (stamped.count !== 1) {
      console.warn(`[publish] ${post.id}: published ${result.externalId} but the post row had already moved (count=${stamped.count}); the attempt records the anchor`);
    }
    console.log(`[publish] ${post.id}: PUBLISHED → ${result.externalId}`);
    return;
  }

  if ("ambiguous" in result) {
    // H5 — the publish request MAY have already crossed Meta's side-effect point (timeout / dropped
    // connection / 5xx / success-without-id). NEVER free the lock and retry — that risks a second
    // live post. Reconcile Meta's TRUTH first (IG: the creationId anchor; FB: NEEDS_ATTENTION for
    // now). Only a confirmed post becomes PUBLISHED; otherwise a human decides. The reconcile uses
    // GETs only (idempotent — they can't double-post). Status stays PUBLISHING until we know.
    const reason = sanitizeError(result.error);
    const attempt = await prisma.publishAttempt.findUnique({
      where: { id: attemptId },
      select: { id: true, scheduledPostId: true, creationId: true },
    });
    const verdict = attempt
      ? await reconcile(attempt, { ownerId: post.ownerId, channel: post.channel, metaTargetId: post.metaTargetId, metaPostId: null })
      : "needs_attention";
    if (verdict === "published") {
      console.log(`[publish] ${post.id}: ambiguous publish reconciled → confirmed live`);
      return;
    }
    await prisma.$transaction([
      prisma.scheduledPost.updateMany({
        where: { id: post.id, status: "PUBLISHING", metaPostId: null },
        data: { status: "NEEDS_ATTENTION", lastError: reason },
      }),
      prisma.publishAttempt.updateMany({
        where: { id: attemptId, state: "APPLYING" },
        data: { state: "FAILED", error: reason, finishedAt: new Date() },
      }),
    ]);
    console.warn(`[publish] ${post.id}: NEEDS_ATTENTION — publish outcome unconfirmed, NOT retried: ${reason}`);
    return;
  }

  const reason = sanitizeError(result.error);
  const givingUp = retryCount >= PUBLISH_RETRY_LIMIT;

  if (result.retryable && !givingUp) {
    // ④ transient, retries remain — free the APPLYING lock (mark this attempt FAILED so the
    // partial-unique frees) and THROW so pg-boss redelivers → a fresh APPLYING claim. Status
    // stays PUBLISHING during retries (six-state ④).
    await prisma.publishAttempt.update({ where: { id: attemptId }, data: { state: "FAILED", error: reason, finishedAt: new Date() } });
    console.warn(`[publish] ${post.id}: transient (try ${retryCount + 1}) — retrying: ${reason}`);
    throw new Error(reason);
  }

  // ③ hard reject → FAILED; ② no-permission / ④ over the retry budget → NEEDS_ATTENTION.
  const nextStatus = result.retryable ? "NEEDS_ATTENTION" : "FAILED";
  await prisma.$transaction([
    prisma.scheduledPost.updateMany({
      where: { id: post.id, status: "PUBLISHING" },
      data: { status: nextStatus, lastError: reason },
    }),
    prisma.publishAttempt.update({ where: { id: attemptId }, data: { state: "FAILED", error: reason, finishedAt: new Date() } }),
  ]);
  console.warn(`[publish] ${post.id}: ${nextStatus} — ${reason}`);
}

/* ── reconcile + reaper (spec §四F, six-state ⑥) ── */

/** Query Meta's TRUTH for a dangling attempt, then decide — NEVER blindly re-publish.
 *  IG: the stored creationId lets us CONFIRM the container went live, but the container id is NOT
 *  the post's media id (distinct objects). We cannot recover the real media id from the container
 *  alone (that needs a correlated /media lookup — deferred), and stamping the container id as the
 *  metaPostId would record a wrong reference (M2). So even a confirmed-live container fails closed
 *  to NEEDS_ATTENTION — a human confirms + links the real post — rather than an incorrect PUBLISHED.
 *  FB has no creationId → recent-posts match is future work; a dangling FB attempt is likewise
 *  always NEEDS_ATTENTION (never a blind /feed re-post = double-post risk). */
export async function reconcileAttempt(
  attempt: { id: string; scheduledPostId: string; creationId: string | null },
  post: { ownerId: string; channel: string; metaTargetId: string | null; metaPostId: string | null },
  graphGetImpl: (token: string, path: string, params: Record<string, string>) => Promise<Record<string, unknown>> = graphGet,
): Promise<"published" | "needs_attention"> {
  if (post.metaPostId) {
    // Already resolved elsewhere (e.g. the success path stamped the anchor). CONVERGE this dangling
    // attempt so it doesn't leak an APPLYING claim forever (M3). CAS: only touch it while APPLYING.
    await prisma.publishAttempt.updateMany({
      where: { id: attempt.id, state: "APPLYING" },
      data: { state: "APPLIED", metaPostId: post.metaPostId, finishedAt: new Date() },
    });
    return "published";
  }

  if (post.channel === "instagram" && attempt.creationId && post.metaTargetId) {
    const auth = await authorize(post.ownerId);
    if ("refuse" in auth) return "needs_attention";
    const page = await resolvePage(auth.userToken, post.metaTargetId);
    if ("error" in page) return "needs_attention";
    try {
      // Truth query: is the stored container actually PUBLISHED? We log the answer for the human,
      // but the verdict is NEEDS_ATTENTION either way — we will NOT stamp the container id as the
      // media id (M2), and we have no other id to record here.
      const r = await graphGetImpl(page.pageToken, attempt.creationId, { fields: "status_code" });
      if (String(r.status_code ?? "") === "PUBLISHED") {
        console.warn(
          `[publish] ${attempt.scheduledPostId}: IG container ${attempt.creationId} is PUBLISHED, but its media id can't be recovered from the container — surfacing NEEDS_ATTENTION for a human to confirm/link (never stamping the container id).`,
        );
      }
    } catch {
      // fall through to fail-closed
    }
  }
  return "needs_attention";
}

/** Sweep dangling APPLYING attempts (worker crashed mid-publish). Reconcile TRUTH first, then set
 *  PUBLISHED or NEEDS_ATTENTION. Never blind re-publishes. Returns how many it swept. */
export async function reapStalePublishAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - PUBLISH_STALE_MS);
  const stale = await prisma.publishAttempt.findMany({
    where: { state: "APPLYING", startedAt: { lt: cutoff } },
    select: { id: true, scheduledPostId: true, creationId: true },
  });
  let reaped = 0;
  for (const attempt of stale) {
    const post = await prisma.scheduledPost.findUnique({
      where: { id: attempt.scheduledPostId },
      select: { ownerId: true, channel: true, metaTargetId: true, metaPostId: true, status: true },
    });
    if (!post) continue;
    const verdict = await reconcileAttempt(attempt, post);
    if (verdict === "needs_attention") {
      // Release the lock + surface it, ATOMICALLY (M3): a mid-way DB failure between the two writes
      // would otherwise strand the post PUBLISHING forever or the attempt APPLYING forever. Both
      // writes are CAS-scoped so a PUBLISHED the reconcile just set is never clobbered; a zero row
      // count means the state moved underneath us (safe no-op) and is logged, not forced.
      const [attemptWrite, postWrite] = await prisma.$transaction([
        prisma.publishAttempt.updateMany({
          where: { id: attempt.id, state: "APPLYING" },
          data: { state: "FAILED", error: "publish interrupted — reconcile couldn't confirm it went out", finishedAt: new Date() },
        }),
        prisma.scheduledPost.updateMany({
          where: { id: attempt.scheduledPostId, status: "PUBLISHING", metaPostId: null },
          data: { status: "NEEDS_ATTENTION", lastError: "Publishing was interrupted — please review before retrying." },
        }),
      ]);
      if (attemptWrite.count !== 1 || postWrite.count !== 1) {
        console.warn(`[publish] ${attempt.scheduledPostId}: reaper CAS partial (attempt=${attemptWrite.count}, post=${postWrite.count}) — state moved concurrently`);
      }
    }
    reaped++;
  }
  return reaped;
}

/* ── scheduler: which approved posts are due AND currently authorized to publish ── */

/** Due, approved posts whose connection can publish RIGHT NOW (canPublish + !paused). The
 *  canPublish pre-filter is the steady-state fail-closed: before App Review no connection is
 *  authorized → this returns [] → nothing is enqueued → SCHEDULED posts sit untouched (zero
 *  behavior change). Returns the ids for the scheduler to enqueue. */
export async function scanDuePublishPosts(now: Date = new Date(), limit = 50): Promise<string[]> {
  const authorizedOwners = await prisma.metaConnection.findMany({
    where: { canPublish: true, organicPublishPaused: false, status: "active" },
    select: { ownerId: true },
  });
  if (authorizedOwners.length === 0) return [];
  const owners = authorizedOwners.map((c) => c.ownerId);
  const due = await prisma.scheduledPost.findMany({
    where: {
      ownerId: { in: owners },
      status: "SCHEDULED",
      approvedAt: { not: null },
      scheduledAt: { lte: now },
      deletedAt: null,
      metaPostId: null,
    },
    orderBy: { scheduledAt: "asc" },
    take: limit,
    select: { id: true },
  });
  return due.map((p) => p.id);
}

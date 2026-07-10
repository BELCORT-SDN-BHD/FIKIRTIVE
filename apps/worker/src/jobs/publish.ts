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
import { storageKey, newId, PUBLISH_RETRY_LIMIT, type PublishJobData } from "@fikirtive/core";
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

async function graphPost(token: string, path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await fetch(`${GRAPH_BASE}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
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

async function graphGet(token: string, path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const u = new URL(`${GRAPH_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } };
  if (!r.ok || j?.error) {
    const e = new Error(j?.error?.message || "graph error") as Error & { metaError?: unknown; status?: number };
    e.metaError = j?.error;
    e.status = r.status;
    throw e;
  }
  return j;
}

function portFor(token: string): MetaGraphPort {
  return { post: (p, b) => graphPost(token, p, b), get: (p, pa) => graphGet(token, p, pa) };
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
): Promise<{ pageToken: string; igUserId: string | null } | { error: string; retryable: boolean }> {
  let pages: Record<string, unknown>[];
  try {
    const r = await graphGet(userToken, "me/accounts", { fields: "id,name,access_token,instagram_business_account{id}" });
    pages = (r.data as Record<string, unknown>[]) ?? [];
  } catch (e) {
    const status = (e as { status?: number }).status;
    return { error: "Couldn't resolve the page from Meta.", retryable: !!status && (status === 429 || status >= 500) };
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

export type PublishExecutor = (
  post: DuePost,
  attemptId: string,
) => Promise<PublishResult>;

type DuePost = {
  id: string;
  ownerId: string;
  channel: string;
  metaTargetId: string | null;
  caption: string;
  firstComment: string | null;
};

/** The real executor. Persists the IG creationId onto the attempt BEFORE media_publish (lock 3). */
async function realExecute(post: DuePost, attemptId: string): Promise<PublishResult> {
  if (!post.metaTargetId) return { error: "This post has no target account.", retryable: false };
  const auth = await authorize(post.ownerId);
  if ("refuse" in auth) return { error: auth.refuse, retryable: false };

  const page = await resolvePage(auth.userToken, post.metaTargetId);
  if ("error" in page) return page;

  const media = await buildMediaUrls(post.ownerId, post.id, post.channel);
  if ("error" in media) return { error: media.error, retryable: false };

  const port = portFor(page.pageToken);
  const onCreationId = async (creationId: string) => {
    await prisma.publishAttempt.update({ where: { id: attemptId }, data: { creationId } }).catch(() => {});
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

export async function handlePublish(
  data: PublishJobData,
  retryCount: number,
  execute: PublishExecutor = realExecute,
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

  // Move SCHEDULED → PUBLISHING (idempotent if already PUBLISHING on a redelivery).
  await prisma.scheduledPost.updateMany({ where: { id: post.id, status: "SCHEDULED" }, data: { status: "PUBLISHING" } });

  let result: PublishResult;
  try {
    result = await execute(post, attemptId);
  } catch (err) {
    // An unexpected throw inside the executor (network/store) — treat as transient.
    result = { error: sanitizeError(err), retryable: true };
  }

  if ("externalId" in result) {
    // ① success — set metaPostId (lock 1 for the future) + PUBLISHED + APPLIED, together.
    await prisma.$transaction([
      prisma.scheduledPost.updateMany({
        where: { id: post.id, status: "PUBLISHING" },
        data: { status: "PUBLISHED", metaPostId: result.externalId, lastError: null },
      }),
      prisma.publishAttempt.update({
        where: { id: attemptId },
        data: { state: "APPLIED", metaPostId: result.externalId, finishedAt: new Date() },
      }),
    ]);
    console.log(`[publish] ${post.id}: PUBLISHED → ${result.externalId}`);
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
 *  IG: the stored creationId lets us confirm the container was published (its media exists). If we
 *  can't confirm, NEEDS_ATTENTION. FB has no creationId → recent-posts match is future work; for now
 *  a dangling FB attempt is always NEEDS_ATTENTION (never a blind /feed re-post = double-post risk). */
export async function reconcileAttempt(
  attempt: { id: string; scheduledPostId: string; creationId: string | null },
  post: { ownerId: string; channel: string; metaTargetId: string | null; metaPostId: string | null },
  graphGetImpl: (token: string, path: string, params: Record<string, string>) => Promise<Record<string, unknown>> = graphGet,
): Promise<"published" | "needs_attention"> {
  if (post.metaPostId) return "published"; // already resolved elsewhere

  if (post.channel === "instagram" && attempt.creationId && post.metaTargetId) {
    const auth = await authorize(post.ownerId);
    if ("refuse" in auth) return "needs_attention";
    const page = await resolvePage(auth.userToken, post.metaTargetId);
    if ("error" in page) return "needs_attention";
    try {
      // A published container reports status_code=PUBLISHED (and/or exposes its media id). If we
      // can read it and it's PUBLISHED, the post went out despite the lost receipt.
      const r = await graphGetImpl(page.pageToken, attempt.creationId, { fields: "status_code" });
      if (String(r.status_code ?? "") === "PUBLISHED") {
        await prisma.scheduledPost.updateMany({
          where: { id: attempt.scheduledPostId, metaPostId: null },
          data: { status: "PUBLISHED", metaPostId: attempt.creationId },
        });
        await prisma.publishAttempt.update({ where: { id: attempt.id }, data: { state: "APPLIED", metaPostId: attempt.creationId, finishedAt: new Date() } });
        return "published";
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
      // Release the lock + surface it. Don't clobber a PUBLISHED the reconcile just set.
      await prisma.publishAttempt.updateMany({
        where: { id: attempt.id, state: "APPLYING" },
        data: { state: "FAILED", error: "publish interrupted — reconcile couldn't confirm it went out", finishedAt: new Date() },
      });
      await prisma.scheduledPost.updateMany({
        where: { id: attempt.scheduledPostId, status: "PUBLISHING", metaPostId: null },
        data: { status: "NEEDS_ATTENTION", lastError: "Publishing was interrupted — please review before retrying." },
      });
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

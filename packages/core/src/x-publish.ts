/**
 * X (Twitter) organic-publish orchestration (E4-14) — THE single X publish implementation
 * (契约6 单一动作层): both the web channel adapter (apps/web/lib/channels/x.ts) and the publish
 * worker drive THIS, so the two paths can never diverge into two publish logics. Mirrors the shape
 * of meta-publish.ts.
 *
 * Pure + injectable: it takes a token-bound XApiPort so it has NO prisma, NO node builtins, NO
 * knowledge of who called it — fully unit-testable with a mock port and ZERO real X API calls
 * (spec §六.1). Real posting to X = external-test phase (§六.2), founder-authorized, with real
 * credentials that do NOT exist in-block; until then the caller's fail-closed gate refuses first.
 *
 * Never throws: returns the SAME result contract as meta-publish (imported as a TYPE ONLY — this
 * module never modifies meta-publish, so contract 6's "core orchestration zero semantic change"
 * holds): { externalId } | { error, retryable } | { ambiguous, error }.
 */
import type { PublishResult, PublishFail } from "./meta-publish.js";

/** The X OAuth 2.0 scope that grants tweet creation. canPublish is TRUE only when actually granted. */
export const X_PUBLISH_SCOPE = "tweet.write";

/** canPublish-equivalent for an X ChannelConnection: derived from the ACTUALLY-granted scope
 *  (实授 scope 派生), DEFAULT false. An unconnected / read-only X account can never publish. */
export function xScopeCanPublish(scope: string | null | undefined): boolean {
  if (typeof scope !== "string" || !scope) return false;
  return scope.split(/[,\s]+/).filter(Boolean).includes(X_PUBLISH_SCOPE);
}

export interface XApiPort {
  /** X API v2 POST (bearer token bound inside the impl). Returns X's { data: { id, text } } body;
   *  throws on a non-2xx (the thrown error carries a numeric `status`). */
  post(path: string, body: Record<string, unknown>): Promise<{ data?: { id?: unknown; [k: string]: unknown }; [k: string]: unknown }>;
}

/** An aborted/timed-out fetch (AbortSignal.timeout → "TimeoutError"; manual abort → "AbortError"). */
function isAbort(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Transient → retryable (six-state ④): timeout/abort, 429, 5xx. A definitive 4xx is a hard reject
 *  (③) — X received and refused the request before acting, so nothing was posted. */
function classify(e: unknown): PublishFail {
  const err = e as { message?: string; status?: number };
  const status = err?.status;
  const retryable = isAbort(e) || (typeof status === "number" && (status === 429 || status >= 500));
  const error = isAbort(e) ? "X request timed out" : err?.message || "X publish failed";
  return { error, retryable };
}

/** Did this failure leave the outcome UNKNOWN — the create-tweet POST may have crossed X's external
 *  side-effect point (timeout / dropped connection / 5xx / no structured 4xx)? Ambiguous → NEVER a
 *  blind retry (契约7): a re-send could double-post. Only a definitive 4xx means nothing posted. */
function crossedSideEffectPoint(e: unknown): boolean {
  if (isAbort(e)) return true;
  const status = (e as { status?: number })?.status;
  if (typeof status === "number" && status >= 400 && status < 500) return false;
  return true;
}

function idOf(r: { data?: { id?: unknown } }): string | null {
  const v = r?.data?.id;
  return typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null;
}

export type XPublishArgs = {
  /** Tweet text (the scheduled-post caption). */
  text: string;
  /** Ids of media ALREADY uploaded to X (v1.1 media/upload). Empty = text-only tweet. NOTE: uploading
   *  our Generation assets to X is external-test-phase work (§六.2); the worker currently drives
   *  text-only and refuses media deterministically before reaching here (see executeX). */
  mediaIds?: string[];
};

/** X publish: POST /2/tweets { text, media?: { media_ids } } → the tweet id. A 2xx with no id is
 *  ambiguous (the post may already be live), never a blind retry (契约7). */
export async function publishX(port: XApiPort, args: XPublishArgs): Promise<PublishResult> {
  const text = typeof args.text === "string" ? args.text : "";
  const mediaIds = Array.isArray(args.mediaIds) ? args.mediaIds.filter(Boolean) : [];
  if (!text.trim() && mediaIds.length === 0) return { error: "an X post needs text or media", retryable: false };

  const body: Record<string, unknown> = { text };
  if (mediaIds.length > 0) body.media = { media_ids: mediaIds };
  try {
    const r = await port.post("2/tweets", body);
    const id = idOf(r);
    if (!id) return { ambiguous: true, error: "X returned no tweet id — the post may already be live" };
    return { externalId: id };
  } catch (e) {
    return crossedSideEffectPoint(e) ? { ambiguous: true, error: classify(e).error } : classify(e);
  }
}

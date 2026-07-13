/**
 * approval-content-hash — the consent-object binding for APPROVAL_CARDs (B4 debt-70,
 * AR1 处方2; spec §五 5.1·附 touchpoint ② hash 要求本轮落地).
 *
 * At mint time the card stores a SHA-256 over the post's MATERIAL fields (the same set
 * updateScheduledPost treats as material: channel / scheduledAt / caption / firstComment /
 * metaTargetId / ordered media ids). At approve time the server re-reads the post and
 * recomputes; ANY drift = hard refuse ("content changed — re-approve"). This closes the
 * DRAFT-edit gap the SCHEDULED-only re-consent gate cannot see: a card minted for content A
 * can never consent content B. The B0-29 ApprovalRequest row will carry this same hash when
 * it lands; the semantics live now on the card payload.
 */
import { createHash } from "node:crypto";

/** The material consent fields, normalized. Dates as ISO instants; media as ordered ids. */
export type ApprovalContentMaterial = {
  channel: string;
  scheduledAt: string; // ISO instant
  caption: string;
  firstComment: string | null;
  metaTargetId: string | null;
  mediaGenerationIds: string[]; // carousel order
};

/** Deterministic hash of the consent object. Canonical field order, JSON-encoded. */
export function computeApprovalContentHash(m: ApprovalContentMaterial): string {
  const canonical = JSON.stringify([
    m.channel,
    m.scheduledAt,
    m.caption,
    m.firstComment ?? null,
    m.metaTargetId ?? null,
    m.mediaGenerationIds,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** The material consent fields for a generateReferences (refgen spend) approval — the EXACT parked
 *  args a human is consenting to. Unlike a scheduled post, refgen has no mutable DB row: the consent
 *  object IS the parked tool-call arguments (immutable in the RunState), so the hash is computed from
 *  them at mint and re-computed from the matched interruption's args at approve. A same-entity flip
 *  (e.g. the prompt swapped) yields a different hash ⇒ hard refuse (anti-flip, debt-68). */
export type RefgenApprovalMaterial = {
  entityId: string;
  prompt: string;
  count: number | null;
  mode: string | null;
};

/** Deterministic hash of the refgen consent object. Domain-tagged so it can never collide with a
 *  scheduled-post hash; canonical field order, JSON-encoded (mirrors computeApprovalContentHash). */
export function computeRefgenApprovalContentHash(m: RefgenApprovalMaterial): string {
  const canonical = JSON.stringify([
    "generateReferences",
    m.entityId,
    m.prompt,
    m.count ?? null,
    m.mode ?? null,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Normalize RAW parked generateReferences tool-call args into the refgen consent hash, or null when
 *  the args carry no bindable consent (missing/blank entityId or prompt ⇒ fail-closed, hashless).
 *  The SINGLE normalization used by every site that hashes parked refgen args — card mint
 *  (readApprovalConsent), mint-side dedup, and the approve/reject interruption matchers — so the
 *  same parked call always produces the same hash (P2 ref-collision fix relies on this). */
export function refgenApprovalHashFromArgs(args: Record<string, unknown> | undefined | null): string | null {
  if (
    !args ||
    typeof args.entityId !== "string" || args.entityId.length === 0 ||
    typeof args.prompt !== "string" || args.prompt.length === 0
  ) {
    return null;
  }
  return computeRefgenApprovalContentHash({
    entityId: args.entityId,
    prompt: args.prompt,
    count: typeof args.count === "number" ? args.count : null,
    mode: typeof args.mode === "string" ? args.mode : null,
  });
}

/** How long a minted approval ask stays confirmable. Frozen default: 24h — an ask older than
 *  a day must be re-requested (the POST may be scheduled further out; the ASK must be fresh).
 *  Founder ack 可调 (one-place constant). */
export const APPROVAL_CARD_TTL_MS = 24 * 60 * 60 * 1000;

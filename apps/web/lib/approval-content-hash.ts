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

/** The material consent fields for a runFactoryBatch (factory batch spend) approval — the EXACT
 *  parked args a human is consenting to. Like generateReferences (and unlike a scheduled post),
 *  there is no mutable DB row: the consent object IS the parked tool-call arguments (immutable in
 *  the RunState). EVERY field that changes the number of cells or any cell's content is bound —
 *  mode / batchId / name / base / variants / cells — so ANY post-mint flip (a variant added, a
 *  prompt swapped, grid cells replaced, the mode switched) yields a different hash ⇒ hard refuse
 *  at approve (anti-flip, W-B3-F-P). */
export type FactoryBatchApprovalMaterial = {
  mode: string;
  batchId: string;
  name: string | null;
  base: unknown;
  variants: unknown;
  cells: unknown;
};

/** Canonical JSON: recursively key-sorted objects, so two semantically identical nested args
 *  payloads (base/variants/cells) always serialize — and therefore hash — identically regardless
 *  of key order. undefined members are dropped (JSON semantics). */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, val]) => `${JSON.stringify(k)}:${canonicalJson(val)}`);
    return `{${entries.join(",")}}`;
  }
  const s = JSON.stringify(v);
  return s === undefined ? "null" : s;
}

/** Deterministic hash of the factory-batch consent object. Domain-tagged so it can never collide
 *  with a scheduled-post or refgen hash; canonical (key-sorted) serialization for the nested
 *  base/variants/cells payloads (mirrors computeRefgenApprovalContentHash's shape). */
export function computeFactoryBatchApprovalContentHash(m: FactoryBatchApprovalMaterial): string {
  const canonical = canonicalJson([
    "runFactoryBatch",
    m.mode,
    m.batchId,
    m.name ?? null,
    m.base ?? null,
    m.variants ?? null,
    m.cells ?? null,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Normalize RAW parked runFactoryBatch tool-call args into the factory-batch consent hash, or
 *  null when the args carry no bindable spend consent (missing/blank batchId, an unknown mode, or
 *  no batch content for the mode — variant needs base + non-empty variants, grid needs non-empty
 *  cells; mirrors executeRunFactoryBatch's own refusals) ⇒ fail-closed, hashless, unapprovable.
 *  The SINGLE normalization used by every site that hashes parked factory-batch args — card mint
 *  (readApprovalConsent), mint-side dedup, and the approve/reject interruption matchers — so the
 *  same parked call always produces the same hash (P2 ref-collision discipline, same as refgen). */
export function factoryBatchApprovalHashFromArgs(args: Record<string, unknown> | undefined | null): string | null {
  if (
    !args ||
    typeof args.batchId !== "string" || args.batchId.length === 0 ||
    (args.mode !== "variant" && args.mode !== "grid")
  ) {
    return null;
  }
  const base = args.base !== null && typeof args.base === "object" && !Array.isArray(args.base) ? args.base : null;
  const variants = Array.isArray(args.variants) && args.variants.length > 0 ? args.variants : null;
  const cells = Array.isArray(args.cells) && args.cells.length > 0 ? args.cells : null;
  if (args.mode === "variant" && (!base || !variants)) return null;
  if (args.mode === "grid" && !cells) return null;
  return computeFactoryBatchApprovalContentHash({
    mode: args.mode,
    batchId: args.batchId,
    name: typeof args.name === "string" ? args.name : null,
    base,
    variants,
    cells,
  });
}

/** How long a minted approval ask stays confirmable. Frozen default: 24h — an ask older than
 *  a day must be re-requested (the POST may be scheduled further out; the ASK must be fresh).
 *  Founder ack 可调 (one-place constant). */
export const APPROVAL_CARD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Pure spend-snapshot helpers (OPT-6 P3a). RECORD-ONLY: the worker calls these at
 * the commit point to freeze GenJob.spentUsd / RefGenJob.spentUsd, exactly when
 * money is committed (like Generation.entitySnapshot). NO prisma, NO LLM — pure
 * functions over the price truth in gen.ts/refgen.ts so the money-critical worker
 * write is one byte-stable call. The USD snapshots never gate or influence spend.
 * EXCEPTION (2026-07-04 宪法 5 margin floor): isFlatPricedVideoModel below IS
 * consulted by the spend gate (model-config.assertSpendableModel) — only video
 * models with a flat, margin-floored price are sellable.
 */
import {
  GEN_PRICE_USD_PER_IMAGE,
  REFERENCE_VIDEO_COGS_USD,
  videoPriceUsd,
  videoDefaults,
  type GenVideoModel,
} from "./gen.js";
import { REFGEN_PRICE_USD_PER_IMAGE } from "./refgen.js";

/** Exactly the GenJob fields the price needs (a subset of the row). */
export interface GenSpendInput {
  kind: "IMAGE" | "VIDEO";
  model: string;
  count: number;
  referenceVideoGenerationId?: string | null;
  /** GenJob.videoOptions Json: { seconds, resolution, aspectRatio, fps, audio }. */
  videoOptions: { seconds?: number; resolution?: string; audio?: boolean } | null;
}

/** Frozen USD for a committed GenJob. Video: videoPriceUsd over the job's resolved
 *  options (fall back to the model's defaults exactly as the worker does at the
 *  provider call — never NaN). Image: flat per-image × count. */
export function genSpentUsd(job: GenSpendInput): number {
  if (job.kind === "VIDEO") {
    // #644 记账真相:整段参考视频的 COGS 基准搬去 gen.ts 与其它成本基准同住,并按官方
    // token 公式重算($0.85 → $0.78408)。这是**记账**,不是收费 —— 收费仍是下面
    // pricedGenCredits 里的 REFERENCE_VIDEO_CREDITS(16cr),本次一格没动。
    if (job.model === "seedance-2-fast" && job.referenceVideoGenerationId) return REFERENCE_VIDEO_COGS_USD;
    const d = videoDefaults(job.model as GenVideoModel);
    return videoPriceUsd(job.model as GenVideoModel, {
      seconds: job.videoOptions?.seconds ?? d.seconds,
      resolution: job.videoOptions?.resolution ?? d.resolution,
      audio: job.videoOptions?.audio ?? d.audio,
      count: job.count,
    });
  }
  return GEN_PRICE_USD_PER_IMAGE * job.count;
}

/** Exactly the RefGenJob fields the price needs. */
export interface RefGenSpendInput {
  model: string;
  count: number;
}

/** Frozen USD for a committed RefGenJob. Uses refgen's OWN per-image constant
 *  (REFGEN_PRICE_USD_PER_IMAGE — same value as GEN_PRICE today but independent). */
export function refgenSpentUsd(job: RefGenSpendInput): number {
  return REFGEN_PRICE_USD_PER_IMAGE * job.count;
}

// ── Credit pricing (closed-beta P2) ─────────────────────────────────────────────
// The CREDIT ledger is the spend cap (M1). Two distinct numbers:
//  - pricedGenCredits / pricedRefgenCredits = the CHARGE we debit the user, deterministic,
//    in INTERNAL credits (1 internal credit = $0.01), with margin. RESERVE and SETTLE both
//    use this exact value → reserve == settle, no variable delta.
//  - genSpentUsd / refgenSpentUsd (above) = the true fal COST, record-only. Margin = the gap.

/** Internal credit accounting unit: 1 internal credit = $0.01. balance/ledger are internal. */
export const CREDITS_PER_USD = 100;
/** Display denomination: 1 user-facing credit = 10 internal = $0.10. Charges are whole
 *  displayed credits (×10 internal) so per-action costs read as small round numbers. */
export const INTERNAL_PER_DISPLAY = 10;
const USD_PER_DISPLAY_CREDIT = 0.1;

/** Displayed credits from a USD amount: round UP to the $0.10 unit, min 1 (never
 *  under-charge, never zero). */
function displayedFromUsd(usd: number): number {
  return Math.max(1, Math.ceil(usd / USD_PER_DISPLAY_CREDIT));
}

/** Video models whose credit charge is a flat per-resolution number (BytePlus Seedance,
 *  priced by final locked costing, not the record-only COGS). All other models charge
 *  displayedFromUsd(true cost). */
export const FLAT_PRICED_VIDEO_MODELS = new Set<string>(["seedance-2-fast"]);
export function isFlatPricedVideoModel(model: string): boolean { return FLAT_PRICED_VIDEO_MODELS.has(model); }

/** Flat video charge table for Seedance 2.0 Fast:
 *  720p 5s → 8cr, 720p 10s → 14cr, whole-clip reference video → 16cr.
 *  Unknown/higher resolution stays at the 16cr guardrail. */
export const VIDEO_CREDITS_BY_RESOLUTION: Record<string, number> = { "720p": 8, "1080p": 16 };
export const VIDEO_CREDITS_720P_10S = 14;
export const REFERENCE_VIDEO_CREDITS = 16;

export function pricedGenCredits(job: GenSpendInput): number {
  if (job.kind === "VIDEO") {
    if (isFlatPricedVideoModel(job.model)) {
      if (job.referenceVideoGenerationId) return REFERENCE_VIDEO_CREDITS * INTERNAL_PER_DISPLAY;
      const r = job.videoOptions?.resolution ?? "720p";
      const seconds = job.videoOptions?.seconds ?? 5;
      if (r === "720p" && seconds >= 10) return VIDEO_CREDITS_720P_10S * INTERNAL_PER_DISPLAY;
      return (VIDEO_CREDITS_BY_RESOLUTION[r] ?? 16) * INTERNAL_PER_DISPLAY; // BytePlus: flat per resolution
    }
    return displayedFromUsd(genSpentUsd(job)) * INTERNAL_PER_DISPLAY; // fal models: per-model USD cost (restores correct scaling)
  }
  return job.count * INTERNAL_PER_DISPLAY; // 1 displayed credit per image
}
/** DETERMINISTIC charge in INTERNAL credits for a refgen job: 1 displayed credit per image. */
export function pricedRefgenCredits(job: RefGenSpendInput): number {
  return job.count * INTERNAL_PER_DISPLAY;
}
/** Internal credits → user-facing displayed credits (view seam only — never feed this
 *  back into the ledger/balance, which are always internal). */
export function displayCredits(internal: number): number {
  return internal / INTERNAL_PER_DISPLAY;
}

/** A new org's one-time welcome grant (internal credits, 1 = $0.01).
 *
 *  20 DISPLAYED credits = 20 × INTERNAL_PER_DISPLAY internal — the #543 Founder decision
 *  (2026-07-31): enough for one complete Otto experience (a full conversation + image +
 *  critique ≈ 9.5 displayed, one 5s video = 8 displayed), and it lands only AFTER the
 *  merchant verifies their email.
 *
 *  Supersedes the closed-beta seed (1000 → 100 in #66 → 20 here). It is granted
 *  idempotently in the org-bootstrap path under the stable key "signup:<orgId>"; the key
 *  is deliberately UNCHANGED, because a new key would re-grant to every org that already
 *  received the old amount. */
export const SIGNUP_GRANT_CREDITS = 20 * INTERNAL_PER_DISPLAY;

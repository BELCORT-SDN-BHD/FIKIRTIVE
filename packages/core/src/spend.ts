/**
 * Pure spend-snapshot helpers (OPT-6 P3a). RECORD-ONLY: the worker calls these at
 * the commit point to freeze GenJob.spentUsd / RefGenJob.spentUsd, exactly when
 * money is committed (like Generation.entitySnapshot). NO prisma, NO LLM — pure
 * functions over the price truth in gen.ts/refgen.ts so the money-critical worker
 * write is one byte-stable call. These never gate or influence spend.
 */
import {
  GEN_PRICE_USD_PER_IMAGE,
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
  /** GenJob.videoOptions Json: { seconds, resolution, aspectRatio, fps, audio }. */
  videoOptions: { seconds?: number; resolution?: string; audio?: boolean } | null;
}

/** Frozen USD for a committed GenJob. Video: videoPriceUsd over the job's resolved
 *  options (fall back to the model's defaults exactly as the worker does at the
 *  provider call — never NaN). Image: flat per-image × count. */
export function genSpentUsd(job: GenSpendInput): number {
  if (job.kind === "VIDEO") {
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

/** Flat per-resolution video charge (BytePlus Seedance 2.0 fast; covers the t2v
 *  worst case, healthy margin on the i2v primary path). 1080p (and anything not
 *  720p) → 16 cr; 720p → 7 cr. Image = 1 displayed credit per image. */
const VIDEO_CREDITS_BY_RESOLUTION: Record<string, number> = { "720p": 7, "1080p": 16 };
export function pricedGenCredits(job: GenSpendInput): number {
  if (job.kind === "VIDEO") {
    const r = job.videoOptions?.resolution ?? "720p";
    const displayed = VIDEO_CREDITS_BY_RESOLUTION[r] ?? 16; // unknown/higher res → the 1080p price (never under-charge)
    return displayed * INTERNAL_PER_DISPLAY;
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

/** Beta: a new org's one-time CreditAccount seed (internal credits, 1 = $0.01).
 *  1000 DISPLAYED credits = 1000 × INTERNAL_PER_DISPLAY internal. Granted idempotently
 *  in the org-bootstrap path (requireOwner + events.signIn) under key "signup:<orgId>". */
export const BETA_INITIAL_GRANT_CREDITS = 1000 * INTERNAL_PER_DISPLAY;

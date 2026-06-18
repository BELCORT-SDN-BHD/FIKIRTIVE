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

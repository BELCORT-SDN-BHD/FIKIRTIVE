import { INGEST_QUEUE, RENDER_QUEUE, REFGEN_QUEUE } from "@artlio/core";

/** Queue names — single source for web (producers) and worker (consumers). */
export const QUEUES = {
  /** Ingest pipeline: ffprobe metadata (thumbnails land later, eng T5). */
  ingest: INGEST_QUEUE,
  /** D21 sweeper: purge soft-deleted assets past the 30-day window when refcount = 0. */
  sweep: "sweep",
  /** Editor render pipeline: artlioEdit → ffmpeg → asset. */
  render: RENDER_QUEUE,
  /** Phase 2 reference generation: prompt → provider → GENERATED refs. */
  refgen: REFGEN_QUEUE,
} as const;

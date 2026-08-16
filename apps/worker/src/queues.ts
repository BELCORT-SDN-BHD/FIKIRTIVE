import { INGEST_QUEUE, RENDER_QUEUE, REFGEN_QUEUE, GEN_QUEUE, CAPTION_QUEUE } from "@fikirtive/core";

/** Queue names — single source for web (producers) and worker (consumers). */
export const QUEUES = {
  /** Ingest pipeline: ffprobe metadata (thumbnails land later, eng T5). */
  ingest: INGEST_QUEUE,
  /** Editor render pipeline: fikirtiveEdit → ffmpeg → asset. */
  render: RENDER_QUEUE,
  /** Phase 2 reference generation: prompt → provider → GENERATED refs. */
  refgen: REFGEN_QUEUE,
  /** Redesign shot/session generation: prompt → provider → Generation candidate. */
  gen: GEN_QUEUE,
  /** $0 caption job: extract audio → whisper.cpp → cached transcript (NEVER fal). */
  caption: CAPTION_QUEUE,
} as const;

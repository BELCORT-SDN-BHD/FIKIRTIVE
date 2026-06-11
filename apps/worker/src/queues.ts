/** Queue names — single source for web (producers) and worker (consumers). */
export const QUEUES = {
  /** Ingest pipeline: hash verify → ffprobe → thumbnail → last frame (eng T5). */
  ingest: "ingest",
  /** D21 sweeper: purge soft-deleted assets past the 30-day window when refcount = 0. */
  sweep: "sweep",
  /** Editor render pipeline (phase-③ tracer): artlioEdit → ffmpeg → asset. */
  render: "render",
} as const;

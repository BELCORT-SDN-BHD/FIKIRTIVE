/**
 * Ingest pipeline skeleton (eng T5 fills this in):
 *   1. server-side SHA-256 re-verify (D19 rule 3 — client hash is a hint, not truth)
 *   2. ffprobe validation (corrupt file → placeholder, never blocks the queue)
 *   3. thumbnail + last frame via ffmpeg presigned-URL range reads
 *      (`-ss`/`-sseof` BEFORE `-i` — D10 spec; argv arrays via execa, never shell strings)
 *   4. create Asset + Generation(candidate) rows
 *
 * Handler must stay idempotent: content-hash storage keys make re-runs harmless.
 */
export interface IngestJobData {
  ownerId: string;
  /** Client-computed hash (fast-path hint; worker re-verifies). */
  claimedHash: string;
  ext: string;
  originalFilename: string;
  sizeBytes: number;
}

export async function handleIngest(data: IngestJobData): Promise<void> {
  // T5 implementation lands here. Scaffold proves the queue wiring end to end.
  console.log(`[ingest] received ${data.originalFilename} (${data.sizeBytes} bytes)`);
}

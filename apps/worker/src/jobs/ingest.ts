/**
 * Ingest: probe media metadata into the Asset row (duration, dimensions).
 * Minimal T5 slice — the editor needs REAL durations (kills the last mock).
 * Thumbnails/last-frame land later on this same skeleton.
 *
 * Idempotent by construction: probing twice writes the same values.
 */
import path from "node:path";
import { access } from "node:fs/promises";
import { execa } from "execa";
import { prisma } from "@artlio/db";
import { storageKey } from "@artlio/core";

// same resolution as the render job / apps/web storage (cwd = app dir → repo/.data)
const LOCAL_ROOT =
  process.env.ARTLIO_DATA_DIR ?? path.join(process.cwd(), "..", "..", ".data", "storage");

export interface IngestJobData {
  assetId: string;
}

interface ProbeResult {
  durationS: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
}

/** ffprobe a local file — exported for the render job (audio-stream detection). */
export async function probeFile(file: string): Promise<ProbeResult> {
  const { stdout } = await execa(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    { timeout: 60_000 },
  );
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  const duration = Number(data.format?.duration ?? video?.duration ?? NaN);
  return {
    durationS: Number.isFinite(duration) ? duration : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasAudio: Boolean(audio),
  };
}

export async function handleIngest(data: IngestJobData): Promise<void> {
  const asset = await prisma.asset.findUnique({ where: { id: data.assetId } });
  if (!asset) {
    console.error(`[ingest] asset ${data.assetId} missing — dropping`);
    return;
  }
  const file = path.join(LOCAL_ROOT, storageKey(asset.ownerId, asset.contentHash, asset.ext));
  try {
    await access(file);
  } catch {
    // T4 note: in prod the blob lives in R2 — this branch downloads first.
    console.error(`[ingest] blob for ${asset.id} not on local store — skipping (tracer scope)`);
    return;
  }
  const probe = await probeFile(file);
  await prisma.asset.update({
    where: { id: asset.id },
    data: {
      durationS: probe.durationS,
      width: probe.width,
      height: probe.height,
    },
  });
  console.log(
    `[ingest] ${asset.id}: ${probe.width}x${probe.height} ${probe.durationS ?? "?"}s audio=${probe.hasAudio}`,
  );
}

/**
 * Ingest: probe media metadata into the Asset row (duration, dimensions).
 * Minimal T5 slice — the editor needs REAL durations (kills the last mock).
 * Thumbnails/last-frame land later on this same skeleton.
 *
 * Idempotent by construction: probing twice writes the same values.
 */
import { execa } from "execa";
import { prisma } from "@artlio/db";
import { storageKey } from "@artlio/core";
import { storage } from "../storage.js";

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
  let file: string;
  try {
    file = await storage.ffmpegInput(storageKey(asset.ownerId, asset.contentHash, asset.ext));
  } catch {
    console.error(`[ingest] blob for ${asset.id} unreachable — skipping`);
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

/**
 * Render handler (editor slice — tracer skeleton grown into the meat phase).
 * Contract → ffmpeg mapping:
 *   clip.asset.trim          → -ss BEFORE -i (fast keyframe seek, D10 rule)
 *   clip.length              → -t per input (applies to audio streams too)
 *   transition in/out (fade) → per-clip fade/afade to black over `duration`
 *   clip.fit                 → contain: scale(decrease)+pad · crop: scale(increase)+crop
 *   asset.volume             → volume filter; clip audio delayed to its
 *                              timeline `start`, mixed with amix
 *   output                   → scale + SAR + fps normalize, libx264/aac
 * Progress: ffmpeg -progress pipe:1 → RenderJob.progress (throttled).
 *
 * Storage note (tracer scope): shared local .data store — prod activation
 * lands with T4 R2 (web/worker are separate containers, no shared disk).
 */
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import { prisma } from "@artlio/db";
import { storage } from "../storage.js";
import {
  artlioEdit,
  editDuration,
  newId,
  srcToStorageKey,
  RENDER_RETRY_LIMIT,
  type ArtlioEdit,
  type ArtlioClip,
  type RenderJobData,
} from "@artlio/core";
import { probeFile } from "./ingest.js";

const SIZES: Record<string, Record<string, [number, number]>> = {
  "16:9": { sd: [854, 480], hd: [1280, 720], "1080": [1920, 1080] },
  "9:16": { sd: [480, 854], hd: [720, 1280], "1080": [1080, 1920] },
  "1:1": { sd: [480, 480], hd: [720, 720], "1080": [1080, 1080] },
};

interface PlannedInput {
  clip: ArtlioClip;
  file: string;
  index: number;
  hasAudio: boolean;
}

function inputArgs(p: PlannedInput): string[] {
  const pre: string[] = [];
  if (p.clip.asset.type === "image") pre.push("-loop", "1");
  if (p.clip.asset.trim && p.clip.asset.type !== "image") pre.push("-ss", String(p.clip.asset.trim));
  return [...pre, "-t", String(p.clip.length), "-i", p.file];
}

/** video chain for one visual clip: normalize + fit + fades, local time base */
function videoChain(p: PlannedInput, w: number, h: number, fps: number): string {
  const fit = p.clip.fit ?? "contain";
  const scale =
    fit === "crop"
      ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
      : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
  const filters = [scale, "setsar=1", `fps=${fps}`];
  const t = p.clip.transition;
  if (t?.in) filters.push(`fade=t=in:st=0:d=${t.duration}`);
  if (t?.out) filters.push(`fade=t=out:st=${Math.max(0, p.clip.length - t.duration)}:d=${t.duration}`);
  return `[${p.index}:v]${filters.join(",")}[v${p.index}]`;
}

/** audio chain for one sounded clip: volume + fades, then delay to timeline start */
function audioChain(p: PlannedInput): string {
  const vol = p.clip.asset.volume ?? 1;
  const filters = [`volume=${vol}`];
  const t = p.clip.transition;
  if (t?.in) filters.push(`afade=t=in:st=0:d=${t.duration}`);
  if (t?.out) filters.push(`afade=t=out:st=${Math.max(0, p.clip.length - t.duration)}:d=${t.duration}`);
  const delayMs = Math.round(p.clip.start * 1000);
  filters.push(`adelay=${delayMs}:all=1`);
  return `[${p.index}:a]${filters.join(",")}[a${p.index}]`;
}

export async function handleRender(data: RenderJobData, retryCount = 0): Promise<void> {
  const job = await prisma.renderJob.findUnique({ where: { id: data.renderJobId } });
  if (!job) {
    console.error(`[render] job row ${data.renderJobId} missing — dropping`);
    return;
  }
  if (job.status === "DONE") return; // idempotent re-delivery

  await prisma.renderJob.update({
    where: { id: job.id },
    data: { status: "RENDERING", progress: 5, startedAt: new Date(), attempts: { increment: 1 } },
  });

  const work = path.join(tmpdir(), `artlio-render-${job.id}`);
  try {
    // contract police: the worker NEVER trusts stored JSON blindly
    const edit = artlioEdit.parse(job.editJson);
    const totalSeconds = editDuration(edit);
    const visualTrack = edit.timeline.tracks.find((t) => t.clips.some((c) => c.asset.type !== "audio"));
    if (!visualTrack) throw new Error("no visual track in edit");
    const audioTracks = edit.timeline.tracks.filter((t) => t !== visualTrack);

    await mkdir(work, { recursive: true });

    // plan all inputs (visual first, then audio-track clips), probing each
    // source once for audio-stream presence
    const planned: PlannedInput[] = [];
    const addInput = async (clip: ArtlioClip) => {
      // local: validated file path · r2: presigned URL (ffmpeg range-reads it)
      const file = await storage.ffmpegInput(srcToStorageKey(clip.asset.src));
      const probe = clip.asset.type === "image" ? { hasAudio: false } : await probeFile(file);
      planned.push({ clip, file, index: planned.length, hasAudio: probe.hasAudio });
    };
    const visualClips = [...visualTrack.clips].sort((a, b) => a.start - b.start);
    for (const c of visualClips) await addInput(c);
    for (const t of audioTracks) for (const c of t.clips) await addInput(c);

    // contract guarantees length>0 per clip so this can't fire post-parse;
    // belt-and-braces against future schema drift (codex review, refuted-but-free)
    if (!(totalSeconds > 0)) throw new Error("empty edit — nothing to render");

    const [w, h] = SIZES[edit.output.aspectRatio]?.[edit.output.resolution] ?? [1920, 1080];
    const fps = edit.output.fps;
    const out = path.join(work, "out.mp4");

    const visualPlanned = planned.filter((p) => p.clip.asset.type !== "audio");
    const sounded = planned.filter(
      (p) => p.hasAudio && (p.clip.asset.volume ?? 1) > 0,
    );

    const graph: string[] = [];
    for (const p of visualPlanned) graph.push(videoChain(p, w, h, fps));
    const concatIn = visualPlanned.map((p) => `[v${p.index}]`).join("");
    graph.push(`${concatIn}concat=n=${visualPlanned.length}:v=1:a=0[v]`);

    let mapAudio = false;
    if (sounded.length > 0) {
      for (const p of sounded) graph.push(audioChain(p));
      const mixIn = sounded.map((p) => `[a${p.index}]`).join("");
      graph.push(
        `${mixIn}amix=inputs=${sounded.length}:duration=longest:normalize=0,atrim=0:${totalSeconds}[a]`,
      );
      mapAudio = true;
    }

    const args: string[] = ["-y"];
    for (const p of planned) args.push(...inputArgs(p));
    args.push("-filter_complex", graph.join(";"), "-map", "[v]");
    if (mapAudio) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "192k");
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
    args.push("-progress", "pipe:1", "-nostats", out);

    console.log(
      `[render] ${job.id}: ffmpeg ${visualPlanned.length} visual + ${sounded.length} audio → ${w}x${h}@${fps}, ${totalSeconds}s`,
    );

    // live progress from -progress pipe:1, throttled to spare the DB
    const proc = execa("ffmpeg", args, { timeout: 1000 * 60 * 10, buffer: false });
    // -progress output is stream-framed: buffer to complete lines before
    // parsing (codex review — chunks split keys mid-line)
    let lastWrite = 0;
    let acc = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      acc += chunk.toString();
      const lines = acc.split("\n");
      acc = lines.pop() ?? "";
      let latestUs: number | null = null;
      for (const line of lines) {
        const m = /^out_time_us=(\d+)$/.exec(line.trim());
        if (m) latestUs = Number(m[1]);
      }
      if (latestUs == null) return;
      const pct = Math.min(95, Math.round((latestUs / 1e6 / totalSeconds) * 90) + 5);
      const now = Date.now();
      if (now - lastWrite < 2000) return;
      lastWrite = now;
      prisma.renderJob
        .update({ where: { id: job.id }, data: { progress: pct } })
        .catch(() => {});
    });
    await proc;

    // store the output with the same content-addressed semantics as every asset
    const bytes = await readFile(out);
    const { contentHash } = await storage.put(job.ownerId, bytes, "mp4", "video/mp4");
    const asset = await prisma.asset.upsert({
      where: { ownerId_contentHash: { ownerId: job.ownerId, contentHash } },
      update: { deletedAt: null },
      create: {
        id: newId(),
        ownerId: job.ownerId,
        contentHash,
        ext: "mp4",
        mime: "video/mp4",
        sizeBytes: BigInt(bytes.byteLength),
        originalFilename: `render-${job.id}.mp4`,
        source: "RENDER",
        width: w,
        height: h,
        durationS: totalSeconds,
      },
    });

    await prisma.renderJob.update({
      where: { id: job.id },
      data: { status: "DONE", progress: 100, outputAssetId: asset.id, finishedAt: new Date(), error: "" },
    });
    console.log(`[render] ${job.id}: DONE → asset ${asset.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
    // FAILED only when retries are exhausted: pg-boss retryCount is 0-based,
    // so the LAST delivery has retryCount === retryLimit — `>=` marks terminal
    // exactly once, on that delivery (codex off-by-one claim refuted by the
    // delivery math: limit 2 → deliveries at retryCount 0,1,2).
    const final = retryCount >= RENDER_RETRY_LIMIT;
    console.error(`[render] ${job.id}: ${final ? "FAILED" : "retrying"} — ${message}`);
    await prisma.renderJob.update({
      where: { id: job.id },
      data: final
        ? { status: "FAILED", error: message, finishedAt: new Date() }
        : { status: "QUEUED", error: message, progress: 0 },
    });
    throw err; // pg-boss owns the retry schedule
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

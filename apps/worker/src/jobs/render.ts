/**
 * Render handler (editor slice, phase-③ tracer skeleton — kept and hardened,
 * never thrown away). Dumbest possible cut for now: normalize every clip to
 * the output size/fps and hard-concat. Trim/transitions/audio layer onto
 * THIS skeleton in the meat phase by extending buildFfmpegArgs only.
 *
 * Storage note (tracer scope): reads/writes the shared local .data store —
 * end-to-end is LOCAL until T4 moves blobs to R2 (in prod, web and worker
 * are separate containers with no shared disk).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import { prisma } from "@artlio/db";
import {
  artlioEdit,
  editDuration,
  newId,
  srcToStorageKey,
  storageKey,
  RENDER_RETRY_LIMIT,
  type ArtlioEdit,
  type RenderJobData,
} from "@artlio/core";

// same resolution as apps/web/lib/storage.ts (both run with cwd = their app
// dir → repo/.data); ARTLIO_DATA_DIR overrides for anything else
const LOCAL_ROOT =
  process.env.ARTLIO_DATA_DIR ?? path.join(process.cwd(), "..", "..", ".data", "storage");

const SIZES: Record<string, Record<string, [number, number]>> = {
  "16:9": { sd: [854, 480], hd: [1280, 720], "1080": [1920, 1080] },
  "9:16": { sd: [480, 854], hd: [720, 1280], "1080": [1080, 1920] },
  "1:1": { sd: [480, 480], hd: [720, 720], "1080": [1080, 1080] },
};

function clipArgs(edit: ArtlioEdit, clip: ArtlioEdit["timeline"]["tracks"][number]["clips"][number], file: string): string[] {
  // seek BEFORE -i: fast keyframe seek on presigned/range sources (D10 rule)
  const pre: string[] = [];
  if (clip.asset.type === "image") pre.push("-loop", "1");
  if (clip.asset.trim && clip.asset.type !== "image") pre.push("-ss", String(clip.asset.trim));
  return [...pre, "-t", String(clip.length), "-i", file];
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
    data: { status: "RENDERING", progress: 10, startedAt: new Date(), attempts: { increment: 1 } },
  });

  const work = path.join(tmpdir(), `artlio-render-${job.id}`);
  try {
    // contract police: the worker NEVER trusts stored JSON blindly
    const edit = artlioEdit.parse(job.editJson);
    const visual = edit.timeline.tracks.find((t) =>
      t.clips.some((c) => c.asset.type !== "audio"),
    );
    if (!visual) throw new Error("no visual track in edit");
    const clips = [...visual.clips].sort((a, b) => a.start - b.start);

    await mkdir(work, { recursive: true });

    // resolve sources from the shared content-addressed store
    const inputs: string[] = [];
    for (const c of clips) {
      const file = path.join(LOCAL_ROOT, srcToStorageKey(c.asset.src));
      await access(file); // missing source = loud failure, not a black frame
      inputs.push(file);
    }

    const [w, h] = SIZES[edit.output.aspectRatio]?.[edit.output.resolution] ?? [1920, 1080];
    const fps = edit.output.fps;
    const out = path.join(work, "out.mp4");

    // normalize every clip (scale+pad to frame, SAR, fps) then concat (video-only tracer)
    const args: string[] = ["-y"];
    for (let i = 0; i < clips.length; i++) args.push(...clipArgs(edit, clips[i]!, inputs[i]!));
    const norm = clips
      .map(
        (_, i) =>
          `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[v${i}]`,
      )
      .join(";");
    const concatIn = clips.map((_, i) => `[v${i}]`).join("");
    args.push(
      "-filter_complex",
      `${norm};${concatIn}concat=n=${clips.length}:v=1:a=0[v]`,
      "-map",
      "[v]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      out,
    );

    console.log(`[render] ${job.id}: ffmpeg ${clips.length} clips → ${w}x${h}@${fps}`);
    await prisma.renderJob.update({ where: { id: job.id }, data: { progress: 30 } });
    await execa("ffmpeg", args, { timeout: 1000 * 60 * 10 });
    await prisma.renderJob.update({ where: { id: job.id }, data: { progress: 80 } });

    // store the output with the same content-addressed semantics as every asset
    const bytes = await readFile(out);
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const key = storageKey(job.ownerId, contentHash, "mp4");
    const dest = path.join(LOCAL_ROOT, key);
    await mkdir(path.dirname(dest), { recursive: true });
    try {
      await access(dest); // dedup
    } catch {
      await writeFile(dest, bytes);
    }
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
        durationS: editDuration(edit),
      },
    });

    await prisma.renderJob.update({
      where: { id: job.id },
      data: { status: "DONE", progress: 100, outputAssetId: asset.id, finishedAt: new Date(), error: "" },
    });
    console.log(`[render] ${job.id}: DONE → asset ${asset.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
    // FAILED only when retries are exhausted (codex review): during backoff
    // the row goes back to QUEUED so the UI never claims a terminal failure
    // that a retry may still flip to DONE.
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

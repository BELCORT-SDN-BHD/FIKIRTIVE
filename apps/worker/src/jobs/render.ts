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
  renderDuration,
  newId,
  srcToStorageKey,
  RENDER_RETRY_LIMIT,
  type ArtlioEdit,
  type ArtlioClip,
  type BetweenClipTransition,
  type TransitionDirection,
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

/** video chain for one visual clip: normalize geometry + colorspace + timebase,
 *  reset PTS to 0 (xfade/concat require monotonic, zero-based PTS), then the
 *  LEGACY per-clip fade-to-black (kept for backward-compat). Output [v${index}].
 *  format=yuv420p + settb=AVTB + setpts=PTS-STARTPTS are REQUIRED before xfade —
 *  the encoder-only -pix_fmt is not enough. */
function videoChain(p: PlannedInput, w: number, h: number, fps: number): string {
  const fit = p.clip.fit ?? "contain";
  const scale =
    fit === "crop"
      ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
      : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
  const filters = [scale, "setsar=1", `fps=${fps}`, "format=yuv420p", "settb=AVTB", "setpts=PTS-STARTPTS"];
  const t = p.clip.transition; // legacy per-clip fade-to-black
  if (t?.in) filters.push(`fade=t=in:st=0:d=${t.duration}`);
  if (t?.out) filters.push(`fade=t=out:st=${Math.max(0, p.clip.length - t.duration)}:d=${t.duration}`);
  return `[${p.index}:v]${filters.join(",")}[v${p.index}]`;
}

/** Map an Artlio between-clip transition to an ffmpeg xfade `transition=` value.
 *  All values verified present in the worker's ffmpeg build (Debian trixie 7.x).
 *  Directional types default to "left" when no direction is given. Flip has no
 *  native xfade — we approximate it with `vertopen` (a vertical card-flip-ish
 *  reveal); swapping this single value is the only change if it ever reads
 *  poorly. */
function transitionToXfade(tr: BetweenClipTransition): string {
  const dir: TransitionDirection = tr.direction ?? "left";
  switch (tr.type) {
    case "fade":
    case "cross":
      return "fade";
    case "slide":
      return { left: "slideleft", right: "slideright", up: "slideup", down: "slidedown" }[dir];
    case "wipe":
      return { left: "wipeleft", right: "wiperight", up: "wipeup", down: "wipedown" }[dir];
    case "clockwipe":
      return "radial";
    case "iris":
      // iris in (open from center) vs out (close to center); up/left = open
      return dir === "down" || dir === "right" ? "circleclose" : "circleopen";
    case "flip":
      return "vertopen"; // best-effort approximation (no native xfade flip)
  }
}

/** Map a clip's start from EDIT time to RENDERED time: subtract the total
 *  transition overlap that occurs strictly BEFORE this clip on the visual track.
 *  Audio-track clips (not on the visual track) shift by the full overlap that
 *  precedes their edit-time start. */
function renderedStartSeconds(
  clip: ArtlioClip,
  visualPlanned: PlannedInput[],
  transitions: BetweenClipTransition[],
): number {
  // cumulative overlap (s) that has been applied by each visual clip's edit start
  const byFrom = new Map<number, number>();
  for (const tr of transitions) byFrom.set(tr.fromClipIndex, tr.durationMs / 1000);
  let accAtStart = 0;
  const overlapAtEditStart: { editStart: number; overlap: number }[] = [{ editStart: 0, overlap: 0 }];
  for (let i = 1; i < visualPlanned.length; i++) {
    accAtStart += byFrom.get(i - 1) ?? 0;
    overlapAtEditStart.push({ editStart: visualPlanned[i]!.clip.start, overlap: accAtStart });
  }
  // pick the overlap for the last boundary at or before this clip's edit start
  let overlapBefore = 0;
  for (const e of overlapAtEditStart) {
    if (e.editStart <= clip.start + 1e-6) overlapBefore = e.overlap;
  }
  return Math.max(0, clip.start - overlapBefore);
}

/** audio chain for one sounded clip: resample + volume + legacy afade, then
 *  delay to the RENDERED-time start (transitions shrink the timeline). A video
 *  transition's audio cross-fades structurally: the earlier clip's tail gets an
 *  afade=out over the transition, the later clip's head an afade=in, then each is
 *  delayed so they overlap by exactly the transition duration — amix sums the two
 *  faded signals into a true crossfade (not a summed volume bump). Audio-less
 *  clips are excluded from `sounded` upstream, so amix=duration=longest +
 *  atrim pads the mix to full rendered length with silence (no anullsrc input
 *  needed). Output [a${index}]. */
function audioChain(
  p: PlannedInput,
  visualPlanned: PlannedInput[],
  transitions: BetweenClipTransition[],
): string {
  const vol = p.clip.asset.volume ?? 1;
  const filters = ["aresample=async=1:first_pts=0", `volume=${vol}`];
  const t = p.clip.transition; // legacy per-clip afade
  if (t?.in) filters.push(`afade=t=in:st=0:d=${t.duration}`);
  if (t?.out) filters.push(`afade=t=out:st=${Math.max(0, p.clip.length - t.duration)}:d=${t.duration}`);

  // crossfade the audio over each visual transition this clip participates in.
  // A transition (fromClipIndex i-1 → i) cross-fades clip (i-1)'s tail with clip
  // i's head. `vIdx` is this clip's position in the visual order; -1 for audio-track
  // clips, which don't get transition crossfades.
  const vIdx = visualPlanned.findIndex((v) => v === p);
  if (vIdx >= 0) {
    for (const tr of transitions) {
      const durS = tr.durationMs / 1000;
      if (tr.fromClipIndex === vIdx) {
        // this clip is the EARLIER side: fade its tail out over the transition
        filters.push(`afade=t=out:st=${Math.max(0, p.clip.length - durS)}:d=${durS}`);
      }
      if (tr.toClipIndex === vIdx) {
        // this clip is the LATER side: fade its head in over the transition
        filters.push(`afade=t=in:st=0:d=${durS}`);
      }
    }
  }

  const delayMs = Math.round(renderedStartSeconds(p.clip, visualPlanned, transitions) * 1000);
  if (delayMs > 0) filters.push(`adelay=${delayMs}:all=1`);
  return `[${p.index}:a]${filters.join(",")}[a${p.index}]`;
}

export async function handleRender(data: RenderJobData, retryCount = 0): Promise<void> {
  const job = await prisma.renderJob.findUnique({ where: { id: data.renderJobId } });
  if (!job) {
    console.error(`[render] job row ${data.renderJobId} missing — dropping`);
    return;
  }
  if (job.status === "DONE") return; // idempotent re-delivery

  // atomic claim: take a QUEUED job, or RE-take a RENDERING one whose attempt is
  // long past the ffmpeg/expire window (a crashed render — re-rendering is free,
  // no fal spend). A redelivery while another worker is actively rendering loses
  // the claim and exits, so it can't start a 2nd ffmpeg or flip DONE→RENDERING (#3).
  const STALE_MS = 1000 * 60 * 13; // > ffmpeg timeout (10m), < queue expire (15m) so a crashed render is both redelivered AND claimable
  const claim = await prisma.renderJob.updateMany({
    where: { id: job.id, OR: [{ status: "QUEUED" }, { status: "RENDERING", startedAt: { lt: new Date(Date.now() - STALE_MS) } }] },
    data: { status: "RENDERING", progress: 5, startedAt: new Date(), attempts: { increment: 1 } },
  });
  if (claim.count === 0) return; // another delivery owns it (active render or already settled)

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

    // cap render output at HD (720p): a 1080p ffmpeg render OOM-crashed the worker.
    // 720p is the agreed export quality; legacy 1080 edits still render, just at 720p.
    const res = edit.output.resolution === "1080" ? "hd" : edit.output.resolution;
    const [w, h] = SIZES[edit.output.aspectRatio]?.[res] ?? [1280, 720];
    const fps = edit.output.fps;
    const out = path.join(work, "out.mp4");

    const visualPlanned = planned.filter((p) => p.clip.asset.type !== "audio");
    const sounded = planned.filter(
      (p) => p.hasAudio && (p.clip.asset.volume ?? 1) > 0,
    );

    // visualPlanned is already in timeline order (visualClips sorted by start, above).
    const transitions = visualTrack.transitions ?? [];

    // belt-and-braces (contract already enforces these at parse; guard against
    // schema drift so a bad transition can't produce a negative xfade offset or
    // a hang). All clips render at the same w×h (videoChain), so xfade's
    // equal-dimensions requirement holds by construction.
    for (const tr of transitions) {
      const from = visualPlanned[tr.fromClipIndex];
      const to = visualPlanned[tr.toClipIndex];
      if (!from || !to || tr.toClipIndex !== tr.fromClipIndex + 1) {
        throw new Error(`transition references non-adjacent or missing clips (${tr.fromClipIndex}→${tr.toClipIndex})`);
      }
      const durS = tr.durationMs / 1000;
      if (durS >= from.clip.length || durS >= to.clip.length) {
        throw new Error(`transition ${durS}s ≥ an adjacent clip length — would push xfade offset past a boundary`);
      }
    }

    const renderSeconds = renderDuration(edit);

    const graph: string[] = [];
    // per-clip video normalization (geometry + colorspace + timebase + PTS reset)
    for (const p of visualPlanned) graph.push(videoChain(p, w, h, fps));

    // chain xfade per transition; hard cuts concat. Returns the final [v] label.
    // The chain is LINEAR (one filter node per clip boundary), not quadratic.
    let vLabel: string;
    if (visualPlanned.length === 1) {
      vLabel = `[v${visualPlanned[0]!.index}]`;
    } else {
      const byFrom = new Map<number, BetweenClipTransition>();
      for (const tr of transitions) byFrom.set(tr.fromClipIndex, tr);
      let acc = `[v${visualPlanned[0]!.index}]`;
      let accEnd = visualPlanned[0]!.clip.length; // rendered duration of `acc`
      let stage = 0;
      for (let i = 1; i < visualPlanned.length; i++) {
        const cur = visualPlanned[i]!;
        const tr = byFrom.get(i - 1); // transition from clip (i-1) → i
        const next = `[vx${stage}]`;
        if (tr) {
          const durS = tr.durationMs / 1000;
          const offset = accEnd - durS; // overlap starts durS before acc ends
          graph.push(
            `${acc}[v${cur.index}]xfade=transition=${transitionToXfade(tr)}:duration=${durS}:offset=${offset}${next}`,
          );
          accEnd = accEnd + cur.clip.length - durS; // clips overlap by durS
        } else {
          graph.push(`${acc}[v${cur.index}]concat=n=2:v=1:a=0${next}`);
          accEnd = accEnd + cur.clip.length;
        }
        acc = next;
        stage++;
      }
      vLabel = acc;
    }

    let mapAudio = false;
    if (sounded.length > 0) {
      for (const p of sounded) graph.push(audioChain(p, visualPlanned, transitions));
      const mixIn = sounded.map((p) => `[a${p.index}]`).join("");
      graph.push(
        `${mixIn}amix=inputs=${sounded.length}:duration=longest:normalize=0,aresample=async=1:first_pts=0,atrim=0:${renderSeconds}[a]`,
      );
      mapAudio = true;
    }

    const args: string[] = ["-y"];
    for (const p of planned) args.push(...inputArgs(p));
    args.push("-filter_complex", graph.join(";"), "-map", vLabel);
    if (mapAudio) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "192k");
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
    args.push("-progress", "pipe:1", "-nostats", out);

    console.log(
      `[render] ${job.id}: ffmpeg ${visualPlanned.length} visual (${transitions.length} transitions) + ${sounded.length} audio → ${w}x${h}@${fps}, ${renderSeconds}s`,
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
      const pct = Math.min(95, Math.round((latestUs / 1e6 / renderSeconds) * 90) + 5);
      const now = Date.now();
      if (now - lastWrite < 2000) return;
      lastWrite = now;
      // guard on RENDERING so a late-arriving progress write can't land after the
      // terminal DONE/100 write and freeze the bar below 100 (#8)
      prisma.renderJob
        .updateMany({ where: { id: job.id, status: "RENDERING" }, data: { progress: pct } })
        .catch(() => {});
    });
    await proc;

    // store the output with the same content-addressed semantics as every asset
    const bytes = await readFile(out);
    const { contentHash } = await storage.put(job.ownerId, bytes, "mp4");
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
        durationS: renderSeconds,
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

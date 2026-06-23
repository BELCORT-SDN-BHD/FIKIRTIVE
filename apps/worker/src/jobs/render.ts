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
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import { prisma } from "@fikirtive/db";
import { storage } from "../storage.js";
import { sanitizeError, scrubUrls } from "../redact.js";
import {
  fikirtiveEdit,
  editDuration,
  renderDuration,
  newId,
  srcToStorageKey,
  RENDER_RETRY_LIMIT,
  type FikirtiveEdit,
  type FikirtiveClip,
  type AudioRole,
  type BetweenClipTransition,
  type TransitionDirection,
  type RenderJobData,
  type CaptionCue,
  type TextOverlay,
} from "@fikirtive/core";
import { probeFile } from "./ingest.js";

const SIZES: Record<string, Record<string, [number, number]>> = {
  "16:9": { sd: [854, 480], hd: [1280, 720], "1080": [1920, 1080] },
  "9:16": { sd: [480, 854], hd: [720, 1280], "1080": [1080, 1920] },
  "1:1": { sd: [480, 480], hd: [720, 720], "1080": [1080, 1080] },
};

interface PlannedInput {
  clip: FikirtiveClip;
  file: string;
  index: number;
  hasAudio: boolean;
  /** which kind of track this clip came from (EP4 ducking partitions by this) */
  trackKind: "visual" | "audio";
  /** the owning audio track's role, if any (EP4); undefined on visual clips */
  audioRole?: AudioRole;
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

/** Map an Fikirtive between-clip transition to an ffmpeg xfade `transition=` value.
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

/** Map an EDIT-time timeline position (seconds) to RENDERED time: subtract the
 *  total visual-track transition overlap that occurs strictly BEFORE that
 *  position. Transitions shrink the timeline, so any timeline-addressed feature
 *  (clip starts, captions, overlays) must shift by the overlap accumulated up to
 *  its edit-time position. */
function renderedTimelineSeconds(
  editSeconds: number,
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
  // pick the overlap for the last boundary at or before this edit-time position
  let overlapBefore = 0;
  for (const e of overlapAtEditStart) {
    if (e.editStart <= editSeconds + 1e-6) overlapBefore = e.overlap;
  }
  return Math.max(0, editSeconds - overlapBefore);
}

/** Map a clip's start from EDIT time to RENDERED time (thin wrapper over
 *  renderedTimelineSeconds at the clip's edit-time start). */
function renderedStartSeconds(
  clip: FikirtiveClip,
  visualPlanned: PlannedInput[],
  transitions: BetweenClipTransition[],
): number {
  return renderedTimelineSeconds(clip.start, visualPlanned, transitions);
}

// --- EP3 burn-in (captions ASS + static text drawtext) — $0, no network ---

/** Baked by the Dockerfile's fonts-dejavu-core (Task 5). Module const so it's
 *  swappable; ASS subtitles= also resolves fonts via fontconfig. */
const DRAWTEXT_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

/** ASS timestamps are H:MM:SS.cs (centiseconds). */
function assTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  const cs2 = cs >= 100 ? 99 : cs; // round-up guard
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs2).padStart(2, "0")}`;
}

/** Escape ASS dialogue text: newlines → \N, strip the override-block opener so
 *  caption text can't inject ASS style tags. */
function escapeAssText(text: string): string {
  return text.replace(/\r?\n/g, "\\N").replace(/[{}]/g, "");
}

/** Escape a value for use inside an ffmpeg -filter_complex argument. ffmpeg
 *  splits filters on ',' and ';', options on ':', and treats '\' specially;
 *  drawtext text additionally interprets '%' (strftime) and "'" terminates a
 *  quoted value. Order matters: backslash first. */
function escapeForFilter(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/%/g, "\\%");
}

/** Build an ASS subtitle file (one default bottom style scaled to height) from
 *  the contract captions, converting each window to RENDERED time. Returns the
 *  written path, or null when there are no captions. */
async function buildAssFile(
  captions: CaptionCue[],
  work: string,
  w: number,
  h: number,
  visualPlanned: PlannedInput[],
  transitions: BetweenClipTransition[],
): Promise<string | null> {
  if (captions.length === 0) return null;
  const fontSize = Math.max(16, Math.round(h * 0.05)); // ~5% of frame height
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,DejaVu Sans,${fontSize},&H00FFFFFF,&H00000000,&H80000000,0,1,2,1,2,40,40,${Math.round(h * 0.06)},1`,
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  for (const c of captions) {
    const startR = renderedTimelineSeconds(c.startMs / 1000, visualPlanned, transitions);
    const endR = renderedTimelineSeconds((c.startMs + c.lengthMs) / 1000, visualPlanned, transitions);
    if (endR <= startR) continue;
    lines.push(`Dialogue: 0,${assTime(startR)},${assTime(endR)},Default,,0,0,0,,${escapeAssText(c.text)}`);
  }
  const assPath = path.join(work, "captions.ass");
  await writeFile(assPath, lines.join("\n"), "utf8");
  return assPath;
}

/** One drawtext filter node for a static text overlay, chaining prevLabel →
 *  nextLabel. Timing in RENDERED time via enable='between(t,...)'. */
function drawtextNode(
  overlay: TextOverlay,
  prevLabel: string,
  nextLabel: string,
  visualPlanned: PlannedInput[],
  transitions: BetweenClipTransition[],
): string {
  const startR = renderedTimelineSeconds(overlay.startMs / 1000, visualPlanned, transitions);
  const endR = renderedTimelineSeconds((overlay.startMs + overlay.lengthMs) / 1000, visualPlanned, transitions);
  const y =
    overlay.position === "top"
      ? "(h*0.08)"
      : overlay.position === "center"
        ? "(h-text_h)/2"
        : "(h-text_h-h*0.08)"; // bottom
  const text = escapeForFilter(overlay.text);
  const opts = [
    `fontfile=${escapeForFilter(DRAWTEXT_FONT)}`,
    `text='${text}'`,
    `fontsize=${overlay.style.fontSize}`,
    `fontcolor=${overlay.style.color}`,
    "x=(w-text_w)/2",
    `y=${y}`,
    "box=1",
    "boxcolor=black@0.4",
    "boxborderw=8",
    `enable='between(t,${startR},${endR})'`,
  ];
  return `${prevLabel}drawtext=${opts.join(":")}${nextLabel}`;
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

/** Build the audio mix filtergraph from the per-clip [a${index}] labels.
 *  Default path: a flat amix of all sounded clips (the EP1 behavior).
 *  Ducking path (EP4): sounded clips split into THREE groups — bed (music-role
 *  audio track), voice (a voice-role audio track's clips OR any native visual-clip
 *  audio), and neutral (an audio track with NO role). If a music bed AND ≥1 voice
 *  source both have sounded clips, the bed is compressed UNDER the voice via
 *  sidechaincompress, then re-mixed with the dry voice and any neutral tracks (a
 *  neutral track rides flat — it neither ducks nor is ducked). sidechaincompress is in the
 *  worker's Debian-trixie ffmpeg 7.x (node:22-trixie-slim + apt-get ffmpeg,
 *  Dockerfile L4-5; same family as the EP1 xfade/acrossfade). The final node
 *  ALWAYS ends with ,aresample=async=1:first_pts=0,atrim=0:${renderSeconds}[a]
 *  so the downstream -map [a] is unchanged (the load-bearing EP1 invariant).
 *  normalize=0 is kept on every amix (avoids a volume bump). Returns the lines
 *  to append + true if audio should be mapped. */
function buildAudioMix(sounded: PlannedInput[], renderSeconds: number): { lines: string[]; mapAudio: boolean } {
  if (sounded.length === 0) return { lines: [], mapAudio: false };
  const lab = (p: PlannedInput) => `[a${p.index}]`;
  const tail = `aresample=async=1:first_pts=0,atrim=0:${renderSeconds}[a]`;

  // partition into THREE groups (EP4 P2): only a music bed under an explicit
  // voice trigger ducks. An UN-roled audio track is NEUTRAL — it never ducks the
  // bed and is never a sidechain key; it just rides flat in the final mix.
  //   voice   = native visual-clip audio OR an audio track with audioRole "voice"
  //   bed     = an audio track with audioRole "music" (the ducked layer)
  //   neutral = an audio track with NO audioRole (undefined)
  const isMusic = (p: PlannedInput) => p.trackKind === "audio" && p.audioRole === "music";
  const isVoice = (p: PlannedInput) =>
    p.trackKind === "visual" || (p.trackKind === "audio" && p.audioRole === "voice");
  const bed = sounded.filter(isMusic);
  const voice = sounded.filter(isVoice);
  const neutral = sounded.filter((p) => !isMusic(p) && !isVoice(p));
  const duckable = bed.length > 0 && voice.length > 0;

  if (!duckable) {
    // flat mix (EP1 behavior) — covers every legacy edit and any non-ducked edit
    const mixIn = sounded.map(lab).join("");
    return {
      lines: [`${mixIn}amix=inputs=${sounded.length}:duration=longest:normalize=0,${tail}`],
      mapAudio: true,
    };
  }

  const lines: string[] = [];
  // 1) sub-mix the voice sources → [vmix]
  const voiceIn = voice.map(lab).join("");
  lines.push(`${voiceIn}amix=inputs=${voice.length}:duration=longest:normalize=0[vmix]`);
  // 2) sub-mix the bed sources → [bmix]
  const bedIn = bed.map(lab).join("");
  lines.push(`${bedIn}amix=inputs=${bed.length}:duration=longest:normalize=0[bmix]`);
  // 3) duck the bed under the voice. The voice is the SIDECHAIN trigger; it must
  //    be split because we also need it dry in the final mix. asplit duplicates it.
  lines.push(`[vmix]asplit=2[vkey][vout]`);
  lines.push(`[bmix][vkey]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[duck]`);
  // 4) final mix: dry voice + ducked bed + any neutral tracks → [a] (load-bearing tail).
  //    neutral rides flat (it neither ducks nor is ducked).
  const finalIn = `[vout][duck]${neutral.map(lab).join("")}`;
  lines.push(`${finalIn}amix=inputs=${2 + neutral.length}:duration=longest:normalize=0,${tail}`);
  return { lines, mapAudio: true };
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

  const work = path.join(tmpdir(), `fikirtive-render-${job.id}`);
  try {
    // contract police: the worker NEVER trusts stored JSON blindly
    const edit = fikirtiveEdit.parse(job.editJson);
    const totalSeconds = editDuration(edit);
    const visualTrack = edit.timeline.tracks.find((t) => t.clips.some((c) => c.asset.type !== "audio"));
    if (!visualTrack) throw new Error("no visual track in edit");
    const audioTracks = edit.timeline.tracks.filter((t) => t !== visualTrack);

    await mkdir(work, { recursive: true });

    // plan all inputs (visual first, then audio-track clips), probing each
    // source once for audio-stream presence
    const planned: PlannedInput[] = [];
    const addInput = async (clip: FikirtiveClip, trackKind: "visual" | "audio", audioRole?: AudioRole) => {
      // local: validated file path · r2: presigned URL (ffmpeg range-reads it)
      const file = await storage.ffmpegInput(srcToStorageKey(clip.asset.src));
      const probe = clip.asset.type === "image" ? { hasAudio: false } : await probeFile(file);
      planned.push({ clip, file, index: planned.length, hasAudio: probe.hasAudio, trackKind, audioRole });
    };
    const visualClips = [...visualTrack.clips].sort((a, b) => a.start - b.start);
    for (const c of visualClips) await addInput(c, "visual");
    for (const t of audioTracks) for (const c of t.clips) await addInput(c, "audio", t.audioRole);

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

    // belt-and-braces (contract enforces ≤1 music track; guard against drift).
    // Ducking needs at least one bed clip AND one voice source, else it falls
    // back to the flat mix — buildAudioMix handles that, but assert the partition
    // can never produce an empty amix input list.
    const musicSounded = sounded.filter((p) => p.trackKind === "audio" && p.audioRole === "music");
    const musicTrackCount = new Set(
      planned.filter((p) => p.trackKind === "audio" && p.audioRole === "music").map((p) => p.audioRole),
    ).size;
    if (musicTrackCount > 1) {
      throw new Error("more than one music-role audio track — ducking is ambiguous");
    }
    void musicSounded; // partition recomputed inside buildAudioMix; this only asserts the cap

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

    // EP3 burn-in: append captions (ASS subtitles=) + static text overlays
    // (drawtext) onto the SINGLE final composited video stream — AFTER the
    // xfade/concat chain set vLabel, BEFORE -map. This NEVER touches the
    // per-clip [v${index}] labels, the offset/accEnd math, renderSeconds, or the
    // audio amix. Timing is in RENDERED time. $0 — no network/spend path.
    const captions = edit.timeline.captions ?? [];
    const overlays = edit.timeline.textOverlays ?? [];
    const assPath = await buildAssFile(captions, work, w, h, visualPlanned, transitions);
    if (assPath) {
      graph.push(`${vLabel}subtitles=${escapeForFilter(assPath)}[vsub]`);
      vLabel = "[vsub]";
    }
    overlays.forEach((overlay, i) => {
      const next = `[vtxt${i}]`;
      graph.push(drawtextNode(overlay, vLabel, next, visualPlanned, transitions));
      vLabel = next;
    });

    if (sounded.length > 0) {
      for (const p of sounded) graph.push(audioChain(p, visualPlanned, transitions));
    }
    const { lines: mixLines, mapAudio } = buildAudioMix(sounded, renderSeconds);
    for (const line of mixLines) graph.push(line);

    const args: string[] = ["-y"];
    for (const p of planned) args.push(...inputArgs(p));
    args.push("-filter_complex", graph.join(";"), "-map", vLabel);
    if (mapAudio) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "192k");
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
    args.push("-progress", "pipe:1", "-nostats", out);

    // matches buildAudioMix's duckable test (bed = music; voice = visual native
    // audio OR a voice-role audio track; a neutral un-roled track does NOT duck).
    const ducked = sounded.some((p) => p.trackKind === "audio" && p.audioRole === "music") &&
      sounded.some((p) => p.trackKind === "visual" || (p.trackKind === "audio" && p.audioRole === "voice"));
    console.log(
      `[render] ${job.id}: ffmpeg ${visualPlanned.length} visual (${transitions.length} transitions) + ${sounded.length} audio${ducked ? " (ducking)" : ""} → ${w}x${h}@${fps}, ${renderSeconds}s`,
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
    // PERSISTED error must never carry the ffmpeg argv (it contains the presigned
    // -i media URL + X-Amz signature) — it surfaces verbatim in the admin UI. Store
    // a sanitized summary; keep the full (URL-scrubbed) detail in server logs only.
    const safe = sanitizeError(err);
    // FAILED only when retries are exhausted: pg-boss retryCount is 0-based,
    // so the LAST delivery has retryCount === retryLimit — `>=` marks terminal
    // exactly once, on that delivery (codex off-by-one claim refuted by the
    // delivery math: limit 2 → deliveries at retryCount 0,1,2).
    const final = retryCount >= RENDER_RETRY_LIMIT;
    console.error(`[render] ${job.id}: ${final ? "FAILED" : "retrying"} — ${scrubUrls(err instanceof Error ? err.message : String(err)).slice(0, 1000)}`);
    await prisma.renderJob.update({
      where: { id: job.id },
      data: final
        ? { status: "FAILED", error: safe, finishedAt: new Date() }
        : { status: "QUEUED", error: safe, progress: 0 },
    });
    // rethrow a SANITIZED error: pg-boss serializes the thrown error into its own
    // job.output column, so throwing the raw `err` would re-leak the argv/URL there.
    throw new Error(safe); // pg-boss owns the retry schedule
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

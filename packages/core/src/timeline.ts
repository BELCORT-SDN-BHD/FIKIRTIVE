import { z } from "zod";

/**
 * Editor contract (dev-process step 1: contract-first).
 *
 * The shape is a SUBSET of Shotstack's Edit JSON — their Studio SDK emits it,
 * our worker renders it with ffmpeg. Parsing is CANONICALIZING: zod strips
 * unknown fields (Studio may emit extras we don't support), and callers MUST
 * persist the PARSED value, never the raw input — so nothing outside this
 * schema ever reaches the database or the worker. The worker re-parses before
 * rendering (both ends police the same contract).
 *
 * Ratified scope boundary (video-editor feasibility decision, 2026-06-11):
 * 1 visual track + up to 2 audio tracks, hard cuts + fade transitions,
 * trim/split/reorder. Anything beyond (multi-video-track compositing,
 * keyframes, color) requires a NEW adjudication.
 *
 * ffmpeg mapping (worker side):
 *   clip.asset.trim       → -ss before -i (seek into source)
 *   clip.length           → -t per input segment
 *   transition fade (dur) → per-clip fade=t=in/out to/from black (afade on audio);
 *                           NOT a cross-fade/overlap between adjacent clips
 *   asset.volume          → volume filter feeding amix
 *   output.resolution     → scale + SAR normalize before concat
 *
 * Product caps (codex review 2026-06-11): every number is finite and bounded —
 * unbounded values validate into impossible ffmpeg argv / infinite renders.
 */

export const MAX_CLIPS_PER_TRACK = 100;
export const MAX_CLIP_SECONDS = 60 * 10; // one clip ≤ 10 min
export const MAX_TIMELINE_SECONDS = 60 * 30; // a cut ≤ 30 min
export const MAX_TRIM_SECONDS = 60 * 60 * 4; // seek ≤ 4 h into a source
export const TRANSITION_MAX_SECONDS = 2;
export const TRANSITION_DEFAULT_SECONDS = 0.5;

export const MAX_CAPTIONS = 500;
export const MAX_OVERLAYS = 50;
export const MAX_CAPTION_CHARS = 500;
export const MAX_OVERLAY_CHARS = 200;
export const MAX_FONT_PX = 200;
export const OVERLAY_POSITIONS = ["top", "center", "bottom"] as const;
export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];

/** extension allow-list per asset type — a mismatch is a contract violation */
export const EXT_BY_TYPE = {
  video: ["mp4", "mov", "webm", "mkv"],
  image: ["png", "jpg", "jpeg", "webp", "gif", "avif"],
  audio: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
} as const;

/** App-relative media URL: the browser can play it, the worker can map it
 *  back to a storage key by stripping the /files/ prefix. */
export const mediaSrc = z
  .string()
  .max(512)
  .regex(/^\/files\/u\/[A-Za-z0-9_-]+\/[0-9a-f]{64}\.[0-9a-z]{1,8}$/, {
    message: "src must be an app-relative /files/u/<owner>/<sha256>.<ext> URL",
  });

function srcExt(src: string): string {
  return src.slice(src.lastIndexOf(".") + 1);
}

const finiteSeconds = (max: number) => z.number().finite().min(0).max(max);

function assetSchema<T extends keyof typeof EXT_BY_TYPE>(type: T) {
  return z
    .object({
      type: z.literal(type),
      src: mediaSrc,
      /** seconds into the SOURCE file where playback starts (default 0) */
      trim: finiteSeconds(MAX_TRIM_SECONDS).optional(),
      /** 0..1 (images are silent; the worker ignores volume on them) */
      volume: z.number().finite().min(0).max(1).optional(),
    })
    .superRefine((a, ctx) => {
      const allowed: readonly string[] = EXT_BY_TYPE[type];
      if (!allowed.includes(srcExt(a.src))) {
        ctx.addIssue({
          code: "custom",
          message: `${type} asset src must end in .${allowed.join("/.")} (got .${srcExt(a.src)})`,
        });
      }
    });
}

export const visualAsset = z.union([assetSchema("video"), assetSchema("image")]);
export const audioAsset = assetSchema("audio");

const transition = z.object({
  in: z.enum(["fade"]).optional(),
  out: z.enum(["fade"]).optional(),
  /** fade duration in seconds (contractual, not worker-invented) */
  duration: z.number().finite().gt(0).max(TRANSITION_MAX_SECONDS).default(TRANSITION_DEFAULT_SECONDS),
});

/** Between-clip transition types (the LTX 7-tile library, minus "None"
 *  which = the ABSENCE of an entry — never stored). "fade" here is a
 *  cross-fade between clips, distinct from the legacy per-clip fade-to-black. */
export const TRANSITION_TYPES = ["cross", "slide", "wipe", "flip", "clockwipe", "iris", "fade"] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

export const TRANSITION_DIRECTIONS = ["left", "right", "up", "down"] as const;
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];

/** Audio-track role for auto-ducking (EP4). "music" = a bed ducked UNDER any
 *  "voice" signal (the voice audio track + native visual-clip dialogue) via
 *  ffmpeg sidechaincompress. Absent on every legacy edit and any edit that
 *  doesn't opt in → the worker uses a flat amix (no ducking). Roles are
 *  visual-track-illegal (a role describes an audio bed/voice, not picture). */
export const AUDIO_ROLES = ["voice", "music"] as const;
export type AudioRole = (typeof AUDIO_ROLES)[number];

/** A transition is a relationship BETWEEN two gapless-adjacent visual clips.
 *  It lives on the TRACK (track.transitions[]), NOT on a clip — the editor
 *  round-trips clips through Shotstack's Edit, whose schema strips unknown clip
 *  fields, so transition data must not ride on a clip. durationMs is an integer
 *  in milliseconds (the UI thinks in ms); the worker divides by 1000 for ffmpeg
 *  seconds (render.ts uses SECONDS). Upper bound mirrors the legacy
 *  TRANSITION_MAX_SECONDS; the per-pair "≤ half the shorter clip" guard and the
 *  gapless-adjacency check are on the timeline refine (where clip lengths and
 *  positions are in scope). */
export const betweenClipTransition = z.object({
  fromClipIndex: z.number().int().min(0),
  toClipIndex: z.number().int().min(0),
  type: z.enum(TRANSITION_TYPES),
  durationMs: z.number().int().gt(0).max(TRANSITION_MAX_SECONDS * 1000),
  direction: z.enum(TRANSITION_DIRECTIONS).optional(),
});
export type BetweenClipTransition = z.infer<typeof betweenClipTransition>;

/** A caption cue is a TIMELINE-time-addressed text window (absolute, integer ms),
 *  NOT clip-relative — it can span clip boundaries. Lives on timeline.captions[]
 *  (NOT on a clip: Shotstack strips unknown clip fields; burn-in is on the final
 *  composited stream). The worker converts startMs→RENDERED time (transitions
 *  shrink the timeline) and builds an ASS file for ffmpeg subtitles=. */
export const captionCue = z.object({
  startMs: z.number().int().min(0).max(MAX_TIMELINE_SECONDS * 1000),
  lengthMs: z.number().int().gt(0).max(MAX_CLIP_SECONDS * 1000),
  text: z.string().min(1).max(MAX_CAPTION_CHARS),
});
export type CaptionCue = z.infer<typeof captionCue>;

/** A static text overlay (timeline-time-addressed, integer ms). Static only —
 *  animated text is deferred. Worker → drawtext with enable='between(t,...)'
 *  in RENDERED time. Lives on timeline.textOverlays[] (same reason as captions). */
export const overlayStyle = z.object({
  fontSize: z.number().int().min(8).max(MAX_FONT_PX).default(48),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#ffffff"),
});
export const textOverlay = z.object({
  startMs: z.number().int().min(0).max(MAX_TIMELINE_SECONDS * 1000),
  lengthMs: z.number().int().gt(0).max(MAX_CLIP_SECONDS * 1000),
  text: z.string().min(1).max(MAX_OVERLAY_CHARS),
  position: z.enum(OVERLAY_POSITIONS).default("bottom"),
  // thunk (not a literal {}) so the default carries overlayStyle's own bounded
  // nested defaults (fontSize:48, color:#ffffff) AND typechecks under zod v4 +
  // tsc (a literal {} fails strict typing — the input type requires both fields).
  style: overlayStyle.default(() => overlayStyle.parse({})),
});
export type TextOverlay = z.infer<typeof textOverlay>;

export const clip = z
  .object({
    asset: z.union([visualAsset, audioAsset]),
    /** seconds on the TIMELINE where this clip begins */
    start: finiteSeconds(MAX_TIMELINE_SECONDS),
    /** seconds of duration on the timeline */
    length: z.number().finite().gt(0).max(MAX_CLIP_SECONDS),
    transition: transition.optional(),
    /** how visuals fill the frame (subset of Shotstack's fit) */
    fit: z.enum(["crop", "contain"]).optional(),
  })
  .superRefine((c, ctx) => {
    if (!c.transition) return;
    if (c.asset.type === "audio") {
      ctx.addIssue({ code: "custom", message: "transitions are visual-track only" });
      return;
    }
    if (c.length < c.transition.duration * 2) {
      ctx.addIssue({
        code: "custom",
        message: `clip too short for its ${c.transition.duration}s fade (needs ≥ ${c.transition.duration * 2}s)`,
      });
    }
  });

export const track = z.object({
  clips: z.array(clip).min(1).max(MAX_CLIPS_PER_TRACK),
  /** between-clip transitions (visual track only; validated in timeline.superRefine
   *  where adjacent clip lengths and positions are in scope). The gapless requirement
   *  is enforced LOCALLY here — only a transition's two referenced clips must be
   *  gapless-adjacent; a track with a gap and NO transitions still parses (legacy
   *  edits may contain gaps). None = the absence of an entry. */
  transitions: z.array(betweenClipTransition).max(MAX_CLIPS_PER_TRACK).optional(),
  /** audio-track role for ducking (EP4); audio tracks only. None = the absence
   *  of an entry → flat mix. Validated in timeline.superRefine (track
   *  composition + the ≤1-music-track rule are in scope there). */
  audioRole: z.enum(AUDIO_ROLES).optional(),
});

function clipsOverlap(clips: z.infer<typeof clip>[]): boolean {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const EPS = 1e-6;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    if (prev.start + prev.length > sorted[i]!.start + EPS) return true;
  }
  return false;
}

const isVisualTrack = (t: z.infer<typeof track>) =>
  t.clips.some((c) => c.asset.type !== "audio");

export const timeline = z
  .object({
    background: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#000000"),
    tracks: z.array(track).min(1).max(3),
    captions: z.array(captionCue).max(MAX_CAPTIONS).optional(),
    textOverlays: z.array(textOverlay).max(MAX_OVERLAYS).optional(),
  })
  .superRefine((tl, ctx) => {
    const visual = tl.tracks.filter(isVisualTrack).length;
    const audio = tl.tracks.length - visual;
    if (visual > 1) {
      ctx.addIssue({
        code: "custom",
        message: `at most 1 visual track (got ${visual}) — multi-track compositing is out of scope`,
      });
    }
    if (audio > 2) {
      ctx.addIssue({
        code: "custom",
        message: `at most 2 audio tracks (got ${audio})`,
      });
    }
    let end = 0;
    const EPS = 1e-6;
    tl.tracks.forEach((t, i) => {
      if (clipsOverlap(t.clips)) {
        ctx.addIssue({ code: "custom", message: `track ${i}: clips overlap` });
      }
      const mixed = isVisualTrack(t) && t.clips.some((c) => c.asset.type === "audio");
      if (mixed) {
        ctx.addIssue({ code: "custom", message: `track ${i}: audio clips belong on their own track` });
      }
      // audioRole is audio-track only; the count guard (≤1 music) is below the loop
      if (t.audioRole && isVisualTrack(t)) {
        ctx.addIssue({ code: "custom", message: `track ${i}: audioRole is for audio tracks only (a visual track has no bed/voice role)` });
      }
      // between-clip transition validation. The gapless requirement is LOCAL: each
      // transition's two referenced clips must be gapless-adjacent. A track with a
      // gap and NO transitions still parses (legacy edits may contain gaps — the
      // current renderer ignores `start`, so a global gapless reject would make old
      // edits unloadable). Visual-track only.
      if (t.transitions && t.transitions.length > 0) {
        if (!isVisualTrack(t)) {
          ctx.addIssue({ code: "custom", message: `track ${i}: between-clip transitions are visual-track only` });
        } else {
          // transition indices address clips in timeline order (sorted by start)
          const ordered = [...t.clips].sort((a, b) => a.start - b.start);
          // each boundary carries AT MOST one transition: renderDuration() sums all
          // entries but the worker collapses by fromClipIndex into a single xfade, so
          // a duplicate boundary would double-count the subtracted overlap.
          const seenFrom = new Set<number>();
          for (const tr of t.transitions) {
            if (seenFrom.has(tr.fromClipIndex)) {
              ctx.addIssue({
                code: "custom",
                message: `track ${i}: duplicate transition on boundary ${tr.fromClipIndex}→${tr.fromClipIndex + 1} — each boundary may have at most one transition`,
              });
              continue;
            }
            seenFrom.add(tr.fromClipIndex);
            if (tr.toClipIndex !== tr.fromClipIndex + 1) {
              ctx.addIssue({
                code: "custom",
                message: `track ${i}: transition must be between adjacent clips (consecutive fromClipIndex+1==toClipIndex)`,
              });
              continue;
            }
            const from = ordered[tr.fromClipIndex];
            const to = ordered[tr.toClipIndex];
            if (!from || !to) {
              ctx.addIssue({ code: "custom", message: `track ${i}: transition references a clip index out of range` });
              continue;
            }
            // gapless-adjacent: the later clip starts exactly where the earlier ends
            if (Math.abs(to.start - (from.start + from.length)) > EPS) {
              ctx.addIssue({
                code: "custom",
                message: `track ${i}: transition requires gapless-adjacent clips (clip ${tr.fromClipIndex} ends at ${from.start + from.length}s but clip ${tr.toClipIndex} starts at ${to.start}s)`,
              });
              continue;
            }
            const halfShorterMs = (Math.min(from.length, to.length) / 2) * 1000;
            if (tr.durationMs > halfShorterMs + EPS) {
              ctx.addIssue({
                code: "custom",
                message: `track ${i}: transition ${tr.durationMs}ms too long — must be ≤ half the shorter adjacent clip (${Math.round(halfShorterMs)}ms)`,
              });
            }
          }
        }
      }
      for (const c of t.clips) end = Math.max(end, c.start + c.length);
    });
    const musicTracks = tl.tracks.filter((t) => !isVisualTrack(t) && t.audioRole === "music").length;
    if (musicTracks > 1) {
      ctx.addIssue({ code: "custom", message: `at most one music track may duck (got ${musicTracks}) — mark only the bed as "music"` });
    }
    if (end > MAX_TIMELINE_SECONDS) {
      ctx.addIssue({
        code: "custom",
        message: `timeline runs ${Math.round(end)}s — cap is ${MAX_TIMELINE_SECONDS}s`,
      });
    }
    // caption/overlay bounds-in-context: every window must fit inside the timeline
    // ([0, editDuration]). `end` is the max clip end (= editDuration) computed above.
    const limit = end; // editDuration is in scope as `end`
    for (const c of tl.captions ?? []) {
      if (c.startMs / 1000 + c.lengthMs / 1000 > limit + EPS)
        ctx.addIssue({
          code: "custom",
          message: `caption window ends past the timeline (${(c.startMs + c.lengthMs) / 1000}s > ${limit}s)`,
        });
    }
    for (const o of tl.textOverlays ?? []) {
      if (o.startMs / 1000 + o.lengthMs / 1000 > limit + EPS)
        ctx.addIssue({
          code: "custom",
          message: `text overlay window ends past the timeline (${(o.startMs + o.lengthMs) / 1000}s > ${limit}s)`,
        });
    }
  });

export const output = z.object({
  format: z.literal("mp4"),
  /** rendered height; width derives from aspectRatio */
  resolution: z.enum(["sd", "hd", "1080"]).default("hd"), // 720p cap (1080 OOM'd ffmpeg); "1080" kept for legacy stored edits, render caps it to hd
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  fps: z.union([z.literal(25), z.literal(30)]).default(25),
});

/** The whole document the editor saves and the worker renders.
 *  ALWAYS persist fikirtiveEdit.parse(input) — the parsed value is the contract. */
export const fikirtiveEdit = z.object({
  timeline,
  output,
});
export type FikirtiveEdit = z.infer<typeof fikirtiveEdit>;
export type FikirtiveClip = z.infer<typeof clip>;

/** pg-boss job payload — the job row is persisted BEFORE dispatch (the
 *  Modal triple-insurance pattern reused): queue loss never orphans a render. */
export const renderJobData = z.object({
  renderJobId: z.string().min(1).max(64),
});
export type RenderJobData = z.infer<typeof renderJobData>;

export const RENDER_QUEUE = "render";
/** metadata probe queue (worker-owned; web dispatches best-effort) */
export const INGEST_QUEUE = "ingest";
/** The ingest dead-letter target. The worker has always created it from the same
 *  `${INGEST_QUEUE}.dlq` expression inline; naming it here lets the dead-letter
 *  census (#793) enumerate all seven DLQs from one place instead of a literal. */
export const INGEST_DLQ = `${INGEST_QUEUE}.dlq`;
export const RENDER_DLQ = `${RENDER_QUEUE}.dlq`;
export const RENDER_RETRY_LIMIT = 2;
/** Shared by BOTH sides (codex review): whoever boots first creates the queue
 *  with identical policy, so dispatch never races worker startup. */
export const RENDER_QUEUE_POLICY = {
  retryLimit: RENDER_RETRY_LIMIT,
  retryDelay: 20,
  retryBackoff: true,
  expireInSeconds: 60 * 15, // > ffmpeg timeout so jobs never expire mid-render
  deadLetter: RENDER_DLQ,
} as const;

/** RenderJob.status lifecycle (DB enum mirrors this) */
export const RENDER_STATUSES = ["QUEUED", "RENDERING", "DONE", "FAILED"] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];

/** $0 caption job: extract audio → whisper.cpp → cached transcript. SEPARATE
 *  queue from render so a slow transcribe never blocks a render. The payload
 *  holds ONLY the row id; the row holds the real data. */
export const captionJobData = z.object({ captionJobId: z.string().min(1).max(64) });
export type CaptionJobData = z.infer<typeof captionJobData>;
export const CAPTION_QUEUE = "caption";
export const CAPTION_DLQ = `${CAPTION_QUEUE}.dlq`;
export const CAPTION_RETRY_LIMIT = 2;
export const CAPTION_QUEUE_POLICY = {
  retryLimit: CAPTION_RETRY_LIMIT,
  retryDelay: 20,
  retryBackoff: true,
  expireInSeconds: 60 * 15, // > whisper timeout (10m) so a job never expires mid-transcribe
  deadLetter: CAPTION_DLQ,
} as const;

/**
 * Which GENERATION of cached transcripts the product currently reads and writes.
 *
 * This is the value stored in `Transcript.model` (@@unique([contentHash, model])) — the column
 * is named after what it used to hold, but what it holds now is this generation tag, and that
 * change is the whole point (#787 r2).
 *
 * ── why a generation and not the engine's model name ──────────────────────────────────────
 * Two independent requirements collide, and a generation tag is the one thing that satisfies
 * both:
 *
 *   1. The reader must not know the engine. `apps/web` naming a model was the silent half of
 *      #787: two copies of one constant, and changing the worker's copy alone would have
 *      emptied every merchant's captions with no error anywhere.
 *   2. Selecting a row must be STRUCTURAL, not chronological. "Newest row wins" is not a
 *      guarantee: during a rolling deploy an OLD worker can finish a job AFTER a new one and
 *      write the later row, so the freshest row can be the stale engine's — and the new
 *      worker's cache hit means it is never corrected. A merchant would then be shown an
 *      English transcript of Malay audio, permanently, with nothing logged.
 *
 * A generation tag is not the engine's name (requirement 1 holds: this constant travels to the
 * web app, the model name never does) and it is not a timestamp (requirement 2 holds: a row
 * either carries the current generation or it is invisible, whenever it was written).
 *
 * ── rolling deploys are safe in BOTH directions ───────────────────────────────────────────
 * Old and new code overlap for minutes on every deploy, in both mixed states:
 *   · new web + old worker → old worker writes the OLD tag; new web asks for this one, finds
 *     nothing, returns []. The merchant sees "no captions yet" and can re-run — an honest
 *     empty, never a wrong language.
 *   · old web + new worker → new worker writes THIS tag; old web asks for the old one and
 *     likewise finds nothing. Same honest empty.
 * Neither direction can serve one engine's transcript as another's, because neither direction
 * involves a comparison — only an exact tag match. The rows also never collide: different tags
 * are different keys under the unique index, so both workers can write during the overlap.
 *
 * ── bump it when, and only when, older transcripts stop being equivalent ──────────────────
 * Changing the transcription model or its decoding flags means the cached cues are no longer
 * what the current pipeline would produce; bump this and the old rows retire themselves. The
 * bump is pinned against the worker's model constant by a test (apps/worker caption.test.ts),
 * so the model cannot move without this moving too.
 *
 * g1 = the retired English-only era (rows tagged "base.en"). g2 = multilingual (#787).
 */
export const TRANSCRIPT_GENERATION = "g2";

/** strip the /files/ prefix → storage key (worker side) */
export function srcToStorageKey(src: string): string {
  return src.replace(/^\/files\//, "");
}

export function storageKeyToSrc(key: string): string {
  return `/files/${key}`;
}

/** total timeline duration in seconds (max end across tracks) */
export function editDuration(edit: FikirtiveEdit): number {
  let end = 0;
  for (const t of edit.timeline.tracks)
    for (const c of t.clips) end = Math.max(end, c.start + c.length);
  return end;
}

/** Rendered OUTPUT duration in seconds: the timeline length minus the time each
 *  between-clip transition overlaps (clips slide together by the transition).
 *  Used by the worker for the audio mix length, the -progress total, and the
 *  stored asset durationS. durationMs is divided by 1000 (contract is ms; the
 *  worker renders in seconds). */
export function renderDuration(edit: FikirtiveEdit): number {
  let overlapMs = 0;
  for (const t of edit.timeline.tracks)
    for (const tr of t.transitions ?? []) overlapMs += tr.durationMs;
  return editDuration(edit) - overlapMs / 1000;
}

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
    tl.tracks.forEach((t, i) => {
      if (clipsOverlap(t.clips)) {
        ctx.addIssue({ code: "custom", message: `track ${i}: clips overlap` });
      }
      const mixed = isVisualTrack(t) && t.clips.some((c) => c.asset.type === "audio");
      if (mixed) {
        ctx.addIssue({ code: "custom", message: `track ${i}: audio clips belong on their own track` });
      }
      for (const c of t.clips) end = Math.max(end, c.start + c.length);
    });
    if (end > MAX_TIMELINE_SECONDS) {
      ctx.addIssue({
        code: "custom",
        message: `timeline runs ${Math.round(end)}s — cap is ${MAX_TIMELINE_SECONDS}s`,
      });
    }
  });

export const output = z.object({
  format: z.literal("mp4"),
  /** rendered height; width derives from aspectRatio */
  resolution: z.enum(["sd", "hd", "1080"]).default("1080"),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  fps: z.union([z.literal(25), z.literal(30)]).default(25),
});

/** The whole document the editor saves and the worker renders.
 *  ALWAYS persist artlioEdit.parse(input) — the parsed value is the contract. */
export const artlioEdit = z.object({
  timeline,
  output,
});
export type ArtlioEdit = z.infer<typeof artlioEdit>;
export type ArtlioClip = z.infer<typeof clip>;

/** pg-boss job payload — the job row is persisted BEFORE dispatch (the
 *  Modal triple-insurance pattern reused): queue loss never orphans a render. */
export const renderJobData = z.object({
  renderJobId: z.string().min(1).max(64),
});
export type RenderJobData = z.infer<typeof renderJobData>;

export const RENDER_QUEUE = "render";
/** metadata probe queue (worker-owned; web dispatches best-effort) */
export const INGEST_QUEUE = "ingest";
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

/** strip the /files/ prefix → storage key (worker side) */
export function srcToStorageKey(src: string): string {
  return src.replace(/^\/files\//, "");
}

export function storageKeyToSrc(key: string): string {
  return `/files/${key}`;
}

/** total timeline duration in seconds (max end across tracks) */
export function editDuration(edit: ArtlioEdit): number {
  let end = 0;
  for (const t of edit.timeline.tracks)
    for (const c of t.clips) end = Math.max(end, c.start + c.length);
  return end;
}

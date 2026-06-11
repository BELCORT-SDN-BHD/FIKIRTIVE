import { z } from "zod";

/**
 * Editor contract (dev-process step 1: contract-first).
 *
 * The shape is a STRICT SUBSET of Shotstack's Edit JSON — their Studio SDK
 * emits it, our worker renders it with ffmpeg, and nothing outside this
 * schema is accepted. Ratified scope boundary (video-editor feasibility
 * decision, 2026-06-11): 1 video track + up to 2 audio tracks, hard cuts +
 * fade transitions, trim/split/reorder. Anything beyond (multi-video-track
 * compositing, keyframes, color) requires a NEW adjudication.
 *
 * ffmpeg mapping (worker side):
 *   clip.asset.trim   → -ss before -i (seek into source)
 *   clip.length       → -t per input segment
 *   transition fade   → xfade/acrossfade with computed offsets
 *   asset.volume      → volume filter feeding amix
 *   output.resolution → scale + SAR normalize before concat
 */

/** App-relative media URL: the browser can play it, the worker can map it
 *  back to a storage key by stripping the /files/ prefix. */
export const mediaSrc = z
  .string()
  .regex(/^\/files\/u\/[A-Za-z0-9_-]+\/[0-9a-f]{64}\.[0-9a-z]{1,8}$/, {
    message: "src must be an app-relative /files/u/<owner>/<sha256>.<ext> URL",
  });

export const visualAsset = z.object({
  type: z.enum(["video", "image"]),
  src: mediaSrc,
  /** seconds into the SOURCE file where playback starts (default 0) */
  trim: z.number().min(0).optional(),
  /** 0..1, video tracks only (images are silent) */
  volume: z.number().min(0).max(1).optional(),
});

export const audioAsset = z.object({
  type: z.literal("audio"),
  src: mediaSrc,
  trim: z.number().min(0).optional(),
  volume: z.number().min(0).max(1).optional(),
});

const transition = z.object({
  in: z.enum(["fade"]).optional(),
  out: z.enum(["fade"]).optional(),
});

export const clip = z.object({
  asset: z.union([visualAsset, audioAsset]),
  /** seconds on the TIMELINE where this clip begins */
  start: z.number().min(0),
  /** seconds of duration on the timeline */
  length: z.number().gt(0),
  transition: transition.optional(),
  /** how visuals fill the frame (subset of Shotstack's fit) */
  fit: z.enum(["crop", "contain"]).optional(),
});

export const track = z.object({
  clips: z.array(clip).min(1),
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
    tl.tracks.forEach((t, i) => {
      if (clipsOverlap(t.clips)) {
        ctx.addIssue({ code: "custom", message: `track ${i}: clips overlap` });
      }
      const mixed = isVisualTrack(t) && t.clips.some((c) => c.asset.type === "audio");
      if (mixed) {
        ctx.addIssue({ code: "custom", message: `track ${i}: audio clips belong on their own track` });
      }
    });
  });

export const output = z.object({
  format: z.literal("mp4"),
  /** rendered height; width derives from aspectRatio */
  resolution: z.enum(["sd", "hd", "1080"]).default("1080"),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  fps: z.union([z.literal(25), z.literal(30)]).default(25),
});

/** The whole document the editor saves and the worker renders. */
export const artlioEdit = z.object({
  timeline,
  output,
});
export type ArtlioEdit = z.infer<typeof artlioEdit>;
export type ArtlioClip = z.infer<typeof clip>;

/** pg-boss job payload — the job row is persisted BEFORE dispatch (the
 *  Modal triple-insurance pattern reused): queue loss never orphans a render. */
export const renderJobData = z.object({
  renderJobId: z.string().min(1),
});
export type RenderJobData = z.infer<typeof renderJobData>;

export const RENDER_QUEUE = "render";

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

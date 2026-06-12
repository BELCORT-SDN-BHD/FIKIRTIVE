/**
 * Shot/session generation contract (redesign — Gen space "Generate").
 *
 * Unlike refgen (which produces an entity's ReferenceImages), this produces a
 * Generation (a candidate/shot result) the way uploadCandidates does — same
 * Generation row, source GENERATED, optionally bound to a shot. Conditioning
 * is the @mentioned entities' reference images, resolved server-side from
 * entityIds (D19 trust boundary — no client URLs).
 *
 * v1 = image (t2i / ref-conditioned edit) via the shared GenerationProvider.
 * Video (i2v) lands as a follow-up slice on this same skeleton.
 */
import { z } from "zod";

export const GEN_MODELS = ["seedream"] as const;
export type GenModel = (typeof GEN_MODELS)[number];
/** Video model menu (fal) — mirrors LTX Studio's lineup. Kling 2.5 is the silent,
 *  cheap default; every other model generates native audio. Order = picker order
 *  (silent default first, then sound models cheapest→priciest). */
export const GEN_VIDEO_MODELS = [
  "kling", "veo3.1-lite", "ltx-2", "kling-2.6", "kling-3", "veo3.1-fast", "seedance-2-fast", "veo3.1",
] as const;
export type GenVideoModel = (typeof GEN_VIDEO_MODELS)[number];

export const GEN_KINDS = ["image", "video"] as const;
export type GenKind = (typeof GEN_KINDS)[number];

export const MAX_GEN_COUNT = 4;
export const MAX_GEN_PROMPT = 2000;
export const MAX_GEN_ENTITIES = 8;
export const GEN_VIDEO_SECONDS = 5;
/** Image price is flat per image; video price is dynamic — see videoPriceUsd
 *  (scales with duration × resolution × audio × count). */
export const GEN_PRICE_USD_PER_IMAGE = 0.035;
/** Per-model facts: `label` for the picker, `sound` = generates native audio,
 *  `tail` = supports an end frame. Controls + price live in the two helpers below. */
export const GEN_VIDEO_MODEL_INFO: Record<GenVideoModel, { label: string; sound: boolean; tail: boolean }> = {
  "kling":           { label: "Kling 2.5",         sound: false, tail: true },
  "veo3.1-lite":     { label: "Veo 3.1 Lite",      sound: true, tail: false },
  "ltx-2":           { label: "LTX-2",             sound: true, tail: false },
  "kling-2.6":       { label: "Kling 2.6 Pro",     sound: true, tail: true },
  "kling-3":         { label: "Kling 3.0 Pro",     sound: true, tail: true },
  "veo3.1-fast":     { label: "Veo 3.1 Fast",      sound: true, tail: true },
  "seedance-2-fast": { label: "Seedance 2.0 Fast", sound: true, tail: true },
  "veo3.1":          { label: "Veo 3.1",           sound: true, tail: true },
};

/** Per-model controls — each exposes exactly what its fal endpoint accepts (i2v
 *  limits; aspect is t2v-only on some models, deriving from the source image in
 *  i2v). Empty array = no such control. `audioToggle` false = always silent
 *  (Kling 2.5). Lists are default-first. `maxCount` = batch ceiling (we enqueue N
 *  one-clip jobs — fal video has no num_videos param). Add a model: one entry
 *  here + one in @artlio/generation's VIDEO_CFG. */
export type VideoModelOptions = {
  durations: number[];
  resolutions: string[];
  aspectRatios: string[];
  fps: number[];
  audioToggle: boolean;
  maxCount: number;
};
export const GEN_VIDEO_MODEL_OPTIONS: Record<GenVideoModel, VideoModelOptions> = {
  "kling":           { durations: [5, 10],   resolutions: [],                           aspectRatios: [],               fps: [],       audioToggle: false, maxCount: 4 },
  "veo3.1-lite":     { durations: [4, 6, 8],  resolutions: ["720p"],                    aspectRatios: ["16:9", "9:16"], fps: [],       audioToggle: true,  maxCount: 4 },
  "ltx-2":           { durations: [6, 8, 10], resolutions: ["1080p", "1440p", "2160p"], aspectRatios: [],               fps: [25, 50], audioToggle: true,  maxCount: 4 },
  "kling-2.6":       { durations: [5, 10],   resolutions: [],                           aspectRatios: [],               fps: [],       audioToggle: true,  maxCount: 4 },
  "kling-3":         { durations: [5, 10],   resolutions: [],                           aspectRatios: [],               fps: [],       audioToggle: true,  maxCount: 4 },
  "seedance-2-fast": { durations: [5, 10],   resolutions: ["720p"],                    aspectRatios: ["16:9", "9:16"], fps: [],       audioToggle: true,  maxCount: 4 },
  "veo3.1-fast":     { durations: [4, 6, 8],  resolutions: ["720p", "1080p"],           aspectRatios: ["16:9", "9:16"], fps: [],       audioToggle: true,  maxCount: 4 },
  "veo3.1":          { durations: [4, 6, 8],  resolutions: ["720p", "1080p", "4k"],     aspectRatios: ["16:9", "9:16"], fps: [],       audioToggle: true,  maxCount: 4 },
};

/** A model's default selections (first of each list; audio on for sound models). */
export function videoDefaults(model: GenVideoModel): { seconds: number; resolution: string; aspectRatio: string; fps: number; audio: boolean } {
  const o = GEN_VIDEO_MODEL_OPTIONS[model];
  return { seconds: o.durations[0]!, resolution: o.resolutions[0] ?? "", aspectRatio: o.aspectRatios[0] ?? "", fps: o.fps[0] ?? 0, audio: o.audioToggle };
}

/** Per-second fal rate ($/s) by model/resolution/audio — basis for the live price
 *  hint. Verified against each model's fal pricing page. */
function videoRateUsdPerSec(model: GenVideoModel, resolution: string, audio: boolean): number {
  switch (model) {
    case "kling": return 0.07;                                             // always silent
    case "kling-2.6": return audio ? 0.14 : 0.07;
    case "kling-3": return audio ? 0.168 : 0.112;
    case "seedance-2-fast": return 0.2419;                                  // audio included, flat
    case "ltx-2": return resolution === "2160p" ? 0.24 : resolution === "1440p" ? 0.12 : 0.06;
    case "veo3.1-lite": return resolution === "1080p" ? (audio ? 0.08 : 0.05) : (audio ? 0.05 : 0.03);
    case "veo3.1-fast": return audio ? 0.15 : 0.10;
    case "veo3.1": return resolution === "4k" ? (audio ? 0.60 : 0.40) : (audio ? 0.40 : 0.20);
  }
}

/** Live total for a batch: count × seconds × per-second rate. */
export function videoPriceUsd(model: GenVideoModel, opts: { seconds: number; resolution: string; audio: boolean; count: number }): number {
  return opts.count * opts.seconds * videoRateUsdPerSec(model, opts.resolution, opts.audio);
}

export const genRequest = z
  .object({
    projectId: z.string().min(1).max(64),
    // when set, the result attaches to this shot; else it lands unattached
    shotId: z.string().min(1).max(64).nullish(),
    // i2v source: a specific owned Generation's image to animate (Gen space
    // upload→animate). Server-validated owner+project; not a client URL (D19).
    sourceGenerationId: z.string().min(1).max(64).nullish(),
    // optional end frame for i2v (interpolate source→tail). Same trust boundary.
    tailGenerationId: z.string().min(1).max(64).nullish(),
    prompt: z.string().trim().min(1).max(MAX_GEN_PROMPT),
    entityIds: z.array(z.string().min(1).max(64)).max(MAX_GEN_ENTITIES).default([]),
    count: z.number().int().min(1).max(MAX_GEN_COUNT),
    kind: z.enum(GEN_KINDS).default("image"),
    model: z.string().min(1).max(40).default("seedream"),
    // video controls (optional overrides; absent → the model's videoDefaults).
    // Each is validated against the chosen model's option set in the refine below.
    durationSeconds: z.number().int().min(1).max(60).nullish(),
    resolution: z.string().max(12).nullish(),
    aspectRatio: z.string().max(12).nullish(),
    fps: z.number().int().min(1).max(120).nullish(),
    audio: z.boolean().nullish(),
  })
  .strict()
  // model must match the kind's menu — an unknown video model must never reach
  // the worker and silently spend on a fallback (money safety).
  .superRefine((v, ctx) => {
    const menu: readonly string[] = v.kind === "video" ? GEN_VIDEO_MODELS : GEN_MODELS;
    if (!menu.includes(v.model)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: `model "${v.model}" is not valid for ${v.kind}` });
    }
    // an end frame (tail) is only valid for a video model that supports it — never
    // enqueue (and later pay for) a clip whose model would silently ignore it.
    if (v.tailGenerationId) {
      const supportsTail = v.kind === "video" && GEN_VIDEO_MODEL_INFO[v.model as GenVideoModel]?.tail === true;
      if (!supportsTail) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tailGenerationId"], message: "this model doesn't support an end frame" });
    }
    // every chosen video control must be in the model's option set — a value the
    // fal endpoint would reject (or a more expensive one than priced) must never
    // reach the worker and spend.
    if (v.kind === "video" && (GEN_VIDEO_MODELS as readonly string[]).includes(v.model)) {
      const o = GEN_VIDEO_MODEL_OPTIONS[v.model as GenVideoModel];
      const bad = (path: string, msg: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: msg });
      if (v.durationSeconds != null && !o.durations.includes(v.durationSeconds)) bad("durationSeconds", "duration not available for this model");
      if (v.resolution && !o.resolutions.includes(v.resolution)) bad("resolution", "resolution not available for this model");
      if (v.aspectRatio && !o.aspectRatios.includes(v.aspectRatio)) bad("aspectRatio", "aspect ratio not available for this model");
      if (v.fps != null && !o.fps.includes(v.fps)) bad("fps", "fps not available for this model");
      if (v.audio === false && !o.audioToggle) bad("audio", "this model can't turn audio off");
      if (v.count > o.maxCount) bad("count", "too many clips for this model");
    }
  });
export type GenRequest = z.infer<typeof genRequest>;

export const genJobData = z.object({ genJobId: z.string().min(1).max(64) }).strict();
export type GenJobData = z.infer<typeof genJobData>;

export const GEN_QUEUE = "gen";
export const GEN_DLQ = `${GEN_QUEUE}.dlq`;
export const GEN_RETRY_LIMIT = 2;
export const GEN_QUEUE_POLICY = {
  retryLimit: GEN_RETRY_LIMIT,
  retryBackoff: true,
  deadLetter: GEN_DLQ,
} as const;

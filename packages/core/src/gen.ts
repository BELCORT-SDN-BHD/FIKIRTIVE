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
/** Price hints shown before spend (fal). */
export const GEN_PRICE_USD_PER_IMAGE = 0.035;
export const GEN_PRICE_USD_PER_VIDEO = 0.35; // Kling 2.5 ~5s (silent)
/** Per-model facts shown before spend + used to gate the end-frame (tail) UI.
 *  `priceUsd` = all-in hint for one clip at the model's snapped duration (Kling 5s,
 *  Veo 6s, Seedance 5s, LTX 6s × the model's per-second fal rate, audio included).
 *  `sound` = native audio; `tail` = supports an end frame (last-frame interp). */
export const GEN_VIDEO_MODEL_INFO: Record<GenVideoModel, { label: string; priceUsd: number; sound: boolean; tail: boolean }> = {
  "kling":           { label: "Kling 2.5",         priceUsd: GEN_PRICE_USD_PER_VIDEO, sound: false, tail: true },
  "veo3.1-lite":     { label: "Veo 3.1 Lite",      priceUsd: 0.30, sound: true, tail: false },
  "ltx-2":           { label: "LTX-2",             priceUsd: 0.36, sound: true, tail: false },
  "kling-2.6":       { label: "Kling 2.6 Pro",     priceUsd: 0.70, sound: true, tail: true },
  "kling-3":         { label: "Kling 3.0 Pro",     priceUsd: 0.84, sound: true, tail: true },
  "veo3.1-fast":     { label: "Veo 3.1 Fast",      priceUsd: 0.90, sound: true, tail: true },
  "seedance-2-fast": { label: "Seedance 2.0 Fast", priceUsd: 1.21, sound: true, tail: true },
  "veo3.1":          { label: "Veo 3.1",           priceUsd: 2.40, sound: true, tail: true },
};

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

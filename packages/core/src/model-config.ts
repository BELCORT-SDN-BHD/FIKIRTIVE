import { GEN_MODELS, GEN_VIDEO_MODELS } from "./gen.js";
import { isKnownModelId } from "./model-registry.js";
import { isFlatPricedVideoModel } from "./spend.js";

type Env = Record<string, string | undefined>;
const getEnv = (env?: Env): Env => env ?? (typeof process !== "undefined" ? process.env : {});

export function activeImageModel(): string {
  return GEN_MODELS[0]; // "seedream"
}

export function activeVideoModel(env?: Env): string {
  const want = getEnv(env).OTTO_DEFAULT_VIDEO_MODEL;
  if (want && (GEN_VIDEO_MODELS as readonly string[]).includes(want)) {
    if (isFlatPricedVideoModel(want)) return want;
    // 宪法 5 margin floor: a non-flat model charges ~raw cost (≈zero margin), so an env
    // override to one must NOT take effect — degrade to the flat default instead of
    // letting the UI advertise a model the spend gate would reject on every attempt
    // (split-brain). Selling more models = give them flat floored prices first
    // (FLAT_PRICED_VIDEO_MODELS + costing), not an env flip.
    console.warn(`[model-config] OTTO_DEFAULT_VIDEO_MODEL=${want} has no margin-floored price — using seedance-2-fast instead`);
  }
  // Default to seedance-2-fast: 9:16/16:9 + audio AND flat-priced (宪法 5 margin floor).
  // The old veo3.1-lite default charged displayedFromUsd(cost) ≈ zero margin, so an unset
  // env var silently sold video at cost. Founder overrides via OTTO_DEFAULT_VIDEO_MODEL.
  return (GEN_VIDEO_MODELS as readonly string[]).includes("seedance-2-fast") ? "seedance-2-fast" : GEN_VIDEO_MODELS[0];
}

export function assertSpendableModel(
  model: string,
  kind: "image" | "video",
  env?: Env,
): { ok: true } | { ok: false; error: string } {
  if (!isKnownModelId(model)) return { ok: false, error: "Unknown model." };
  const active = kind === "image" ? activeImageModel() : activeVideoModel(env);
  if (model !== active) return { ok: false, error: "That model isn't enabled right now." };
  // 宪法 5 margin floor: a video model with no flat (floored) price would be charged at
  // ~raw cost (displayedFromUsd fallback in pricedGenCredits) — near-zero margin. Refuse
  // to spend on it even when the env explicitly selects it. Fail closed.
  if (kind === "video" && !isFlatPricedVideoModel(model)) {
    return { ok: false, error: "That video model has no margin-floored price yet, so it can't be sold. Pick a flat-priced model (e.g. seedance-2-fast)." };
  }
  return { ok: true };
}

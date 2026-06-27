import { GEN_MODELS, GEN_VIDEO_MODELS } from "./gen.js";
import { isKnownModelId } from "./model-registry.js";

type Env = Record<string, string | undefined>;
const getEnv = (env?: Env): Env => env ?? (typeof process !== "undefined" ? process.env : {});

export function activeImageModel(): string {
  return GEN_MODELS[0]; // "seedream"
}

export function activeVideoModel(env?: Env): string {
  const want = getEnv(env).OTTO_DEFAULT_VIDEO_MODEL;
  if (want && (GEN_VIDEO_MODELS as readonly string[]).includes(want)) return want;
  // Default to veo3.1-lite (supports 9:16/16:9 + audio; the GEN_VIDEO_MODELS[0]=kling
  // default lacks both). Founder overrides via OTTO_DEFAULT_VIDEO_MODEL.
  return (GEN_VIDEO_MODELS as readonly string[]).includes("veo3.1-lite") ? "veo3.1-lite" : GEN_VIDEO_MODELS[0];
}

export function assertSpendableModel(
  model: string,
  kind: "image" | "video",
  env?: Env,
): { ok: true } | { ok: false; error: string } {
  if (!isKnownModelId(model)) return { ok: false, error: "Unknown model." };
  const active = kind === "image" ? activeImageModel() : activeVideoModel(env);
  if (model !== active) return { ok: false, error: "That model isn't enabled right now." };
  return { ok: true };
}

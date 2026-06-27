import {
  GEN_VIDEO_MODEL_OPTIONS,
  GEN_VIDEO_MODEL_INFO,
  videoDefaults,
  type GenVideoModel,
} from "./gen.js";
import { activeVideoModel } from "./model-config.js";

export interface SuggestModelInput {
  kind: "image" | "video";
  desiredAspect?: string;
  desiredDuration?: number;
  desiredAudio?: boolean;
  hasSourceImage?: boolean;
  hasTail?: boolean;
  /** OPT-6 P2: ids to exclude from the candidate pool (admin-disabled models).
   *  Additive narrowing only — if it would empty the pool, the full typed menu is
   *  used (the typed-menu validity gate downstream stays the authority). */
  disabled?: ReadonlySet<string>;
}

export interface SuggestModelResult {
  model: string;
  params: {
    aspectRatio?: string;
    resolution?: string;
    durationSeconds?: number;
    audio?: boolean;
    count: number;
  };
  reason: string;
  downgraded: boolean;
  requested: { aspect?: string; duration?: number };
}

export function suggestModel(input: SuggestModelInput): SuggestModelResult {
  if (input.kind === "image") {
    return {
      model: "seedream",
      params: { count: 1 },
      reason: "image → Seedream",
      downgraded: false,
      requested: {},
    };
  }

  // For t2v (no source frame) the aspect can only come from a model that EXPOSES it;
  // kept for the aspectDropped flag below (still meaningful even with a locked model).
  const t2vNeedsAspect = !input.hasSourceImage && !!input.desiredAspect;

  // Locked to the single active video model (product decision: one video model, no picker).
  // The spend gate (assertSpendableModel) only allows activeVideoModel(); proposing any other
  // model would freeze a price onto a card that startGen then rejects. Params below are still
  // clamped to THIS model's options, so capability mismatches degrade to the model's defaults.
  const pick = activeVideoModel() as GenVideoModel;

  const o = GEN_VIDEO_MODEL_OPTIONS[pick];
  const d = videoDefaults(pick);

  // Snap a desired value to the model's option list; flag downgraded if we had
  // to substitute.
  function snap<T>(want: T | undefined, list: readonly T[], fallback: T): { v: T; downgraded: boolean } {
    if (want != null && list.includes(want)) return { v: want, downgraded: false };
    return { v: fallback, downgraded: want != null };
  }

  const dur = snap(input.desiredDuration, o.durations, d.seconds);
  const aspect = o.aspectRatios.length > 0
    ? snap(input.desiredAspect, o.aspectRatios, d.aspectRatio)
    : { v: undefined as string | undefined, downgraded: false };

  const audio = o.audioToggle && typeof input.desiredAudio === "boolean" ? input.desiredAudio : d.audio;
  // a desired t2v aspect that NO eligible model could honor (only reachable via the
  // empty-pool fallback) is a genuine downgrade — surface it rather than silently drop.
  const aspectDropped = t2vNeedsAspect && o.aspectRatios.length === 0;
  const downgraded = dur.downgraded || aspect.downgraded || aspectDropped;
  // honest aspect note: a snapped value when the model exposes aspects; "from source
  // frame" for i2v (empty-aspect); "default aspect" for t2v with no aspect to set.
  const aspectNote = o.aspectRatios.length
    ? `${aspect.v}`
    : input.hasSourceImage ? "aspect from source frame" : "default aspect";

  return {
    model: pick,
    params: {
      durationSeconds: dur.v,
      ...(aspect.v ? { aspectRatio: aspect.v } : {}),
      ...(o.resolutions.length ? { resolution: d.resolution } : {}),
      audio,
      count: 1,
    },
    reason: `${GEN_VIDEO_MODEL_INFO[pick].label} — ${aspectNote}, ${dur.v}s`,
    downgraded,
    requested: { aspect: input.desiredAspect, duration: input.desiredDuration },
  };
}

import {
  GEN_VIDEO_MODELS,
  GEN_VIDEO_MODEL_OPTIONS,
  GEN_VIDEO_MODEL_INFO,
  videoDefaults,
  videoPriceUsd,
  type GenVideoModel,
} from "./gen.js";
import { enabledVideoModels } from "./model-registry.js";

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

  const wantTail = !!input.hasTail;
  // For t2v (no source frame) the aspect can only come from a model that EXPOSES it;
  // an empty-aspect (Kling-class) model can't honor a requested aspect, so exclude it
  // when an aspect is desired. For i2v the source frame carries the aspect, so an
  // empty-aspect model stays eligible (usually cheaper) — don't exclude it there.
  const t2vNeedsAspect = !input.hasSourceImage && !!input.desiredAspect;

  // Filter candidates: tail constraint; aspect constraint for models that expose
  // aspectRatios; and (t2v-only) drop empty-aspect models when an aspect is desired.
  const candidates = (GEN_VIDEO_MODELS as readonly string[]).filter((m) => {
    if (input.disabled?.has(m)) return false; // OPT-6 P2: admin-disabled
    const info = GEN_VIDEO_MODEL_INFO[m as GenVideoModel];
    const o = GEN_VIDEO_MODEL_OPTIONS[m as GenVideoModel];
    if (wantTail && !info.tail) return false;
    if (input.desiredAspect && o.aspectRatios.length > 0 && !o.aspectRatios.includes(input.desiredAspect)) return false;
    if (t2vNeedsAspect && o.aspectRatios.length === 0) return false;
    return true;
  });

  // Never end up with an empty pool. If the capability+disabled filter empties
  // the pool, fall back to the ENABLED typed menu so an admin-disabled model is
  // never returned. Only if EVERY video model is disabled (degenerate) fall back
  // to the full typed list — the spend gate will then surface the all-disabled
  // state as an error (no spend).
  const pool =
    candidates.length > 0
      ? candidates
      : (() => {
          const enabled = enabledVideoModels(input.disabled ?? new Set<string>());
          return enabled.length > 0 ? enabled : (GEN_VIDEO_MODELS as readonly string[]).slice();
        })();

  // Pick the cheapest model in the pool (per-second at default settings, 1 clip).
  const pick = pool
    .map((m) => {
      const d = videoDefaults(m as GenVideoModel);
      const rate = videoPriceUsd(m as GenVideoModel, {
        seconds: d.seconds,
        resolution: d.resolution,
        audio: d.audio,
        count: 1,
      });
      return { m, rate };
    })
    .sort((a, b) => a.rate - b.rate)[0]!.m as GenVideoModel;

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

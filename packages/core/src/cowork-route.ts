import {
  GEN_VIDEO_MODEL_OPTIONS,
  GEN_VIDEO_MODEL_INFO,
  GEN_IMAGE_MODEL_OPTIONS,
  imageDefaults,
  normalizeImageAspect,
  videoDefaults,
  type GenModel,
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
    // #643 T2 —— 这里原本 `params: { count: 1 }`，商家要的形状就**在这一步被丢掉**：
    // 后面每一站（卡面、付费请求体、快照、适配器）都再也见不到它，于是商家说「竖版」、
    // 卡面不提形状、引擎出方图，全程没有一句话解释。现在形状在这里定下来，并且和视频侧
    // 一样：吸附到菜单上的一格，吸不上就回默认并**如实标成降级**。
    const model: GenModel = "seedream";
    const menu = GEN_IMAGE_MODEL_OPTIONS[model].aspectRatios;
    const want = normalizeImageAspect(input.desiredAspect);
    const honoured = want !== null && menu.includes(want);
    const aspectRatio = honoured ? want : imageDefaults(model).aspectRatio;
    // 商家提了、但这一格给不了 ⇒ 降级。没提就不是降级（不许无中生有地报警）。
    const downgraded = !!input.desiredAspect && !honoured;
    return {
      model,
      params: { count: 1, aspectRatio },
      reason: `image → Seedream — ${aspectRatio}`,
      downgraded,
      requested: downgraded ? { aspect: input.desiredAspect } : {},
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

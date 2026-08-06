import {
  GEN_VIDEO_MODEL_OPTIONS,
  GEN_VIDEO_MODEL_INFO,
  GEN_IMAGE_MODEL_OPTIONS,
  imageDefaults,
  normalizeImageAspect,
  videoDefaults,
  VIDEO_ASPECT_ADAPTIVE,
  type GenModel,
  type GenVideoModel,
} from "./gen.js";
import { activeImageModel, activeVideoModel } from "./model-config.js";

export interface SuggestModelInput {
  kind: "image" | "video";
  desiredAspect?: string;
  desiredDuration?: number;
  desiredAudio?: boolean;
  hasSourceImage?: boolean;
  hasTail?: boolean;
  /** 后台关掉的模型 id(OPT-6 P2 的 model overlay)。
   *
   *  #647 T6:这个参数以前**收下就扔** —— 后台把唯一那台引擎关掉之后,这里照旧选中它、
   *  照旧算出价,于是 Otto 铸出一张写着 credits、点得下去、而确认的那一刻必然被 spend
   *  闸打回的付费卡。现在它真的算数:选中的那台被关掉 ⇒ 整个函数返回 null。 */
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

/**
 * 引擎被后台关掉时,商家看到的那句话 —— **四个铸卡入口共用这一份**(#647 T6 修复轮 P1-1)。
 *
 * 为什么要有单一来源:Otto propose、proposePack、分镜闸①②、以及「Make another / Try again」
 * 是四条各自独立的路。同一件事在四个地方各写一句话,就是四份会各自漂移的措辞 —— 而商家
 * 只会觉得「这个产品对同一件事说了四种话」。
 *
 * English sentence case;不出现任何引擎/供应商名(商家侧本来就不该见引擎)。
 */
export function generationUnavailableMessage(kind: "image" | "video"): string {
  return kind === "video"
    ? "Video generation is turned off right now."
    : "Image generation is turned off right now.";
}

/**
 * 选型 + 参数吸附。**返回 null = 这一类创作现在没有可用引擎**(唯一那台被后台关掉)。
 *
 * 为什么是 null 而不是「照选不误、让下游拦」:下游那道 spend 闸拦得住**花钱**,拦不住
 * **承诺** —— 卡是 $0 铸的,可它在商家眼里是一个点得下去的确认。null 让编译器逼着每一个
 * 调用点当场表态:要么给诚实空态,要么根本不该走到这里。
 */
export function suggestModel(input: SuggestModelInput): SuggestModelResult | null {
  if (input.kind === "image") {
    if (input.disabled?.has(activeImageModel())) return null;
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
  // #647 T6:菜单上只剩这一台,所以「它被关掉」就是「视频全关」。铸不出真卡就一张都不铸。
  if (input.disabled?.has(pick)) return null;

  const o = GEN_VIDEO_MODEL_OPTIONS[pick];
  // #645 T4:带首帧(i2v)时形状默认 adaptive —— 引擎跟着首帧走,而不是被一个默认值
  // 悄悄改成别的画幅。商家明说了形状,下面 snap 仍然按商家说的来。
  const d = videoDefaults(pick, { hasSourceImage: input.hasSourceImage });

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
  // #645 T4:adaptive 不是一个具体形状 —— 如实说成「跟着首帧走」,绝不翻译成 16:9 之类
  // 的具体值(那就是卡面说一套、引擎做一套)。
  const aspectNote = o.aspectRatios.length
    ? (aspect.v === VIDEO_ASPECT_ADAPTIVE ? "adaptive (follows the source frame)" : `${aspect.v}`)
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

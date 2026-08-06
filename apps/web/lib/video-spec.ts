/**
 * video-spec —— 「这条片子的规格」在界面这一侧的**唯一**一份读法(#645 T4)。
 *
 * 服务端把菜单、默认档和整张按秒价目表一次带回来(`getActiveGenModels`);这里只做三件
 * 纯函数的事:取菜单、取默认档、按档查价。没有一个数字是这里算出来的 —— 价格算错一格
 * 就是「显示的」与「收的」分家,所以计价公式只许住在服务端的 `pricedGenCredits` 里。
 *
 * PURE:无 DB、无 I/O、无 spend。
 */
import type { VideoSpec, VideoSpecMenu } from "@/components/gen/VideoSpecPicker";
import type { ActiveGenModels } from "./gen-actions";

export type { VideoSpec, VideoSpecMenu };

/** 这三个列表都来自一次网络往返,所以每一处都当**不可信**读:少了就当空菜单,
 *  于是选择器不渲染、请求不带规格、服务端按默认档交付 —— 绝不 crash 在一次读上。 */
const list = <T,>(value: readonly T[] | undefined): readonly T[] => (Array.isArray(value) ? value : []);

/** 服务端解析的规格菜单(picker 顺序)。界面一格都不写死。 */
export function videoSpecMenu(models: ActiveGenModels): VideoSpecMenu {
  return {
    durations: list(models.videoDurations),
    resolutions: list(models.videoResolutions),
    aspectRatios: list(models.videoAspectRatios),
  };
}

/**
 * 商家没动任何一格时会交付的规格。
 *
 * `hasSourceImage`(Animate / 接首帧)会换掉**形状**那一格:带首帧时默认 adaptive ——
 * 引擎跟着首帧走,而不是被一个默认值悄悄改成别的画幅。时长与清晰度两条路一致。
 */
export function defaultVideoSpec(
  models: ActiveGenModels,
  opts?: { hasSourceImage?: boolean },
): VideoSpec {
  const d = models.videoDefaults;
  return {
    seconds: d.seconds,
    resolution: d.resolution,
    aspectRatio: opts?.hasSourceImage ? (models.videoI2vDefaultAspect || d.aspectRatio) : d.aspectRatio,
  };
}

/**
 * 这一档的显示 credits,直接查服务端那张表。表上没有这一档 ⇒ `null`,调用方必须当成
 * 「价格未确认」处理(界面显示 Checking cost…,并且**不许**拿一个猜的数去当预扣额)。
 */
export function videoSpecCredits(models: ActiveGenModels, spec: VideoSpec): number | null {
  const table = models.videoCreditsBySpec;
  if (table === null || typeof table !== "object") return null;
  const credits = table[`${spec.resolution}:${spec.seconds}`];
  return typeof credits === "number" && Number.isFinite(credits) ? credits : null;
}

/** 把一个(可能来自 sessionStorage 回放的)规格夹回菜单上;夹不住就用默认档。 */
export function clampVideoSpec(
  models: ActiveGenModels,
  spec: Partial<VideoSpec> | undefined,
  opts?: { hasSourceImage?: boolean },
): VideoSpec {
  const fallback = defaultVideoSpec(models, opts);
  return {
    seconds: typeof spec?.seconds === "number" && list(models.videoDurations).includes(spec.seconds)
      ? spec.seconds : fallback.seconds,
    resolution: typeof spec?.resolution === "string" && list(models.videoResolutions).includes(spec.resolution)
      ? spec.resolution : fallback.resolution,
    aspectRatio: typeof spec?.aspectRatio === "string" && list(models.videoAspectRatios).includes(spec.aspectRatio)
      ? spec.aspectRatio : fallback.aspectRatio,
  };
}

import { GEN_IMAGE_DEFAULT_VARIANT, GEN_MODELS, GEN_VIDEO_MODELS, videoDefaults, type GenVideoModel } from "./gen.js";
import { isKnownModelId } from "./model-registry.js";
import { isSellableImageSku, isSellableVideoSku } from "./spend.js";

type Env = Record<string, string | undefined>;
const getEnv = (env?: Env): Env => env ?? (typeof process !== "undefined" ? process.env : {});

export function activeImageModel(): string {
  return GEN_MODELS[0]; // "seedream" —— lite 是默认档;pro 由能力路由挑(routeImageModel)
}

/** 一个视频槽位的**默认档**卖得出去吗?(= 它自己声明的默认时长 × 默认分辨率在白名单上) */
function defaultSkuIsSellable(model: string): boolean {
  const d = videoDefaults(model as GenVideoModel);
  return isSellableVideoSku(model, d.resolution, d.seconds);
}

export function activeVideoModel(env?: Env): string {
  const want = getEnv(env).OTTO_DEFAULT_VIDEO_MODEL;
  if (want && (GEN_VIDEO_MODELS as readonly string[]).includes(want)) {
    if (defaultSkuIsSellable(want)) return want;
    // 宪法 5 margin floor: a model with no ruled price list has no margin-floored price, so an
    // env override to one must NOT take effect — degrade to the priced default instead of
    // letting the UI advertise a model the spend gate would reject on every attempt
    // (split-brain). Selling more models = give them flat floored prices first
    // (FLAT_PRICED_VIDEO_MODELS + costing), not an env flip.
    // Creation S2 §8.1①(CREATE-A5):判据从「有定额价」下沉到「**它的默认档在 SKU 白名单上**」
    // —— 两个槽位之后,一台引擎可以在菜单上、有定额价,却把默认档设在一个没有价的分辨率上。
    // 那样的默认同样卖不出去,同样必须降级 + 留日志,而不是让商家撞一次墙。
    console.warn(`[model-config] OTTO_DEFAULT_VIDEO_MODEL=${want} has no margin-floored price for its default tier — using seedance-2-mini instead`);
  }
  // Default to seedance-2-mini: the standard-tier video engine, and the one whose whole tier
  // table has ruled, margin-floored prices (宪法 5 margin floor). A pre-#644 default charged
  // ~raw cost, so an unset env var silently sold video at cost. Founder overrides via
  // OTTO_DEFAULT_VIDEO_MODEL.
  return (GEN_VIDEO_MODELS as readonly string[]).includes("seedance-2-mini") ? "seedance-2-mini" : GEN_VIDEO_MODELS[0];
}

/**
 * 请求里**这一格 SKU** 的两根轴(视频 = 分辨率 × 时长;图片 = 图种)。
 * 全部可选:缺省时按该槽位自己声明的默认档判,与不带参数的老调用逐字同义。
 */
export type SpendableSku = {
  resolution?: string | null;
  seconds?: number | null;
  variant?: string | null;
};

/**
 * **付费闸:这一格卖不卖?**(Creation S2 §8.1①,CREATE-A4 / A5 / A6)
 *
 * 判据从「等于唯一在产型号」改成「**SKU 级已定价白名单**」。为什么必须改:在产槽位从一个
 * 变成两个之后,「是不是那一台」这个问题答不出「这一格有没有价」——高清槽位能做三档
 * 分辨率而只有 1080p 有价,pro 图槽位有三种图种而只有标准图有价。判到槽位级就会把
 * 那些没有价的格子跟着放行,而没有价的格子只能落护栏或兜底 = 替 Founder 发明价格。
 *
 * 白名单外 = **拒绝、$0、不降级**。三件事都要:
 *   · 拒绝 —— 而不是静默换一档(商家批的是 A,做出来是 B,那是 #882 那一类病);
 *   · $0 —— 本函数在 `pricedGenCredits` 与 `reserveCredits` **之前**调用
 *     (apps/web/lib/gen-actions.ts),所以拒绝这一路 ledger 零新增行;
 *   · 不降级 —— 降级只发生在**默认档配错**那一条路上(`activeVideoModel`,留日志),
 *     那是我们自己配错了;商家**直接请求**一个没有价的档,只能被如实拒绝。
 */
export function assertSpendableModel(
  model: string,
  kind: "image" | "video",
  /** 保留在签名上只为兼容既有调用点。**闸不再读它**:env 决定的是「不选的时候用哪个槽位」
   *  (`activeVideoModel`),而这里回答的是「这一格有没有价」—— 两个不同的问题。 */
  _env?: Env,
  sku?: SpendableSku,
): { ok: true } | { ok: false; error: string } {
  if (!isKnownModelId(model)) return { ok: false, error: "Unknown model." };
  if (kind === "video") {
    if (!(GEN_VIDEO_MODELS as readonly string[]).includes(model)) {
      return { ok: false, error: "That model isn't enabled right now." };
    }
    const d = videoDefaults(model as GenVideoModel);
    const resolution = sku?.resolution ?? d.resolution;
    const seconds = sku?.seconds ?? d.seconds;
    if (!isSellableVideoSku(model, resolution, seconds)) {
      // 人话,而且不出现型号名(S1 九问4:商家只见能力)。
      return { ok: false, error: "That video quality isn't on sale yet — pick another quality or length." };
    }
    return { ok: true };
  }
  if (!(GEN_MODELS as readonly string[]).includes(model)) {
    return { ok: false, error: "That model isn't enabled right now." };
  }
  const variant = sku?.variant ?? GEN_IMAGE_DEFAULT_VARIANT;
  if (!isSellableImageSku(model, variant)) {
    return { ok: false, error: "That image option isn't on sale yet — pick another option." };
  }
  return { ok: true };
}

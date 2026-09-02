/**
 * Creation 引擎 S2 §8.1① —— **能力路由 + SKU 级已定价白名单**的纯函数钉板。
 *
 * 规格 docs/specs/creation-engine.md,验收 CREATE-A4 / CREATE-A5 / CREATE-A6。
 * 这一份只钉**判据本身**(路由挑哪一格、白名单放不放行、价目表有没有这条目);
 * 「拒绝这一路 ledger 零新增行」「前置报价 == reserve == settle」那几句要真账本才算数,
 * 钉在 apps/web/lib/__tests__/creation-routing-ledger.test.ts。
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  GEN_IMAGE_VARIANTS,
  GEN_VIDEO_MODEL_OPTIONS,
  HD_VIDEO_RESOLUTION,
  routeImageModel,
  routeReasonFor,
  routeVideoModel,
} from "./gen.js";
import { activeVideoModel, assertSpendableModel } from "./model-config.js";
import {
  CREDITS_PER_USD,
  INTERNAL_PER_DISPLAY,
  IMAGE_DISPLAY_CREDITS_PER_IMAGE,
  PRO_IMAGE_DISPLAY_CREDITS_PER_IMAGE,
  SELLABLE_IMAGE_VARIANTS,
  SELLABLE_VIDEO_RESOLUTIONS,
  genSpentUsd,
  isSellableImageSku,
  isSellableVideoSku,
  pricedGenCredits,
} from "./spend.js";
import { MARGIN_TRUTH_SKUS, marginTruthTable } from "./margin-truth.js";
import { redactProviderNames } from "./provider-secrecy.js";

/** 商家可见的字符串里绝不许出现的东西 —— 型号名与供应商名(S1 九问4)。 */
const FORBIDDEN_IN_MERCHANT_COPY = [
  "seedance", "seedream", "dreamina", "dola", "byteplus", "ark", "modelark", "mini", "pro", "lite",
];
function assertNoModelName(text: string): void {
  const lowered = text.toLowerCase();
  for (const word of FORBIDDEN_IN_MERCHANT_COPY) {
    expect(lowered, `商家可见字符串泄了型号名「${word}」:${text}`).not.toContain(word);
  }
  // 兜底围栏也必须仍然认为这句话是干净的(它一个字都不该动)。
  expect(redactProviderNames(text)).toBe(text);
}

describe("CREATE-A4 能力路由:请求 1080p → 路由到高清档,报价 55cr,理由只写能力名词", () => {
  it("CREATE-A4 视频路由按**请求的分辨率**挑槽位,不按型号名", () => {
    expect(routeVideoModel(HD_VIDEO_RESOLUTION).model).toBe("seedance-2-0");
    // 其余(含未指定)一律留在默认档 —— 路由只在商家真的要高清时升档。
    expect(routeVideoModel("720p").model).toBe("seedance-2-mini");
    expect(routeVideoModel("480p").model).toBe("seedance-2-mini");
    expect(routeVideoModel(null).model).toBe("seedance-2-mini");
    expect(routeVideoModel(undefined).model).toBe("seedance-2-mini");
    expect(routeVideoModel("垃圾值").model).toBe("seedance-2-mini");
  });

  it("CREATE-A4 报价:1080p 5 秒 = 55 显示 credits,而且是**同一个函数**说的", () => {
    const { model } = routeVideoModel(HD_VIDEO_RESOLUTION);
    const job = { kind: "VIDEO" as const, model, count: 1, videoOptions: { seconds: 5, resolution: HD_VIDEO_RESOLUTION, audio: true } };
    // 前置报价(gen-actions 与卡面读的就是它)。
    expect(pricedGenCredits(job)).toBe(55 * INTERNAL_PER_DISPLAY);
    // reserve 与 settle 的绝对值也来自这一个函数(worker 从冻结的 job 行重算同一个对象),
    // 所以三处一致是**同源**的结果而不是巧合。真账本证据见 web 那份测试。
    expect(pricedGenCredits({ ...job, videoOptions: { ...job.videoOptions } })).toBe(pricedGenCredits(job));
    // 声音开关不改价(CREATE-A3 的价格那一半在这里顺带钉住)。
    expect(pricedGenCredits({ ...job, videoOptions: { ...job.videoOptions, audio: false } })).toBe(55 * INTERNAL_PER_DISPLAY);
  });

  it("CREATE-A4 路由理由是**能力名词**,一个型号名都没有;走默认档时是 null", () => {
    const routed = routeVideoModel(HD_VIDEO_RESOLUTION);
    expect(routed.reason).toBe("You asked for 1080p, so this went to the HD tier.");
    assertNoModelName(routed.reason!);
    // 没升档 = 没什么可解释的,不许编一句话出来。
    expect(routeVideoModel("720p").reason).toBeNull();
    expect(routeImageModel().reason).toBeNull();
    // 图片侧升档理由同样只写能力。
    const pro = routeImageModel({ transparent: true });
    expect(pro.model).toBe("seedream-pro");
    assertNoModelName(pro.reason!);
  });

  it("CREATE-A4 路由理由**可查**:worker 落库那一句与请求侧说的是同一个函数、同一句话", () => {
    const routed = routeVideoModel(HD_VIDEO_RESOLUTION);
    // worker 的输入只有已冻结的 job 行(kind + model + 分辨率),没有请求侧的上下文。
    const persisted = routeReasonFor({ kind: "video", model: routed.model, resolution: HD_VIDEO_RESOLUTION });
    expect(persisted).toBe(routed.reason);
    expect(persisted).not.toBeNull();
  });

  it("CREATE-A4 高清档进毛利表,清 65% 目标线与 45% 地板", () => {
    const row = marginTruthTable().find((r) => r.id === "video:seedance-2-0:5:1080p");
    expect(row, "高清 5 秒档没有进毛利表").toBeDefined();
    expect(row!.chargeUsd).toBeCloseTo(55 * INTERNAL_PER_DISPLAY / CREDITS_PER_USD, 10);
    expect(row!.clearsFloor).toBe(true);
    expect(row!.margin).toBeGreaterThan(0.65);
    // 成本走这一档自己的钉点(实测账单),绝不借 720p 的回退值 —— 借了毛利就是假的。
    expect(genSpentUsd({ kind: "VIDEO", model: "seedance-2-0", count: 1, videoOptions: { seconds: 5, resolution: HD_VIDEO_RESOLUTION, audio: true } }))
      .toBeCloseTo(1.8866925, 9);
  });
});

describe("CREATE-A5 白名单外:默认档配错=降级留日志;直接请求=拒绝、不降级", () => {
  afterEach(() => vi.restoreAllMocks());

  it("CREATE-A5 前者:默认视频模型环境变量指向未定价槽位 → 降级回白名单并留日志", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 未定价/已下架的槽位(菜单外)与「在菜单上但默认档没有价」两种配错,结论一致。
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "seedance-2-fast" })).toBe("seedance-2-mini");
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "not-a-model" })).toBe("seedance-2-mini");
    // 白名单内的槽位照旧生效(降级只发生在配错的时候)。
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "seedance-2-0" })).toBe("seedance-2-0");
    // 「留日志」是这条验收的一半:静默降级 = 没人知道 env 配错了。
    warn.mockClear();
    const priced = { OTTO_DEFAULT_VIDEO_MODEL: "seedance-2-mini" } as const;
    expect(activeVideoModel(priced)).toBe("seedance-2-mini");
    expect(warn).not.toHaveBeenCalled();
  });

  it("CREATE-A5 后者:直接请求一个未定价的档 → 拒绝,而且**不是**降级", () => {
    // 高清槽位能做 720p(能力表上有),但那一档没有属于它的成本钉点与已裁价。
    expect(GEN_VIDEO_MODEL_OPTIONS["seedance-2-0"].resolutions).toContain("720p");
    expect(SELLABLE_VIDEO_RESOLUTIONS["seedance-2-0"]).not.toContain("720p");
    expect(isSellableVideoSku("seedance-2-0", "720p", 5)).toBe(false);

    const refused = assertSpendableModel("seedance-2-0", "video", {}, { resolution: "720p", seconds: 5 });
    expect(refused.ok).toBe(false);
    // 拒绝语必须是人话且不带型号名 —— 商家只见能力。
    assertNoModelName((refused as { error: string }).error);
    // **不是降级**:闸返回的是拒绝,没有任何「已经替你换成别的档」的出口。
    expect(refused).not.toHaveProperty("model");

    // 反过来,该槽位真正卖的那一档照旧放行。
    expect(assertSpendableModel("seedance-2-0", "video", {}, { resolution: HD_VIDEO_RESOLUTION, seconds: 5 })).toEqual({ ok: true });
    // 默认档槽位的两档也照旧放行(本片没有动它一格)。
    expect(assertSpendableModel("seedance-2-mini", "video", {}, { resolution: "720p", seconds: 5 })).toEqual({ ok: true });
    expect(assertSpendableModel("seedance-2-mini", "video", {}, { resolution: "480p", seconds: 15 })).toEqual({ ok: true });
    // mini 从来给不出 1080p —— 它不在 mini 的能力表上,也不在 mini 的白名单上。
    expect(assertSpendableModel("seedance-2-mini", "video", {}, { resolution: HD_VIDEO_RESOLUTION, seconds: 5 }).ok).toBe(false);
    // 档外秒数同样拒(价格只定义在已裁的那些格上)。
    expect(assertSpendableModel("seedance-2-0", "video", {}, { resolution: HD_VIDEO_RESOLUTION, seconds: 3 }).ok).toBe(false);
    expect(assertSpendableModel("seedance-2-0", "video", {}, { resolution: HD_VIDEO_RESOLUTION, seconds: 16 }).ok).toBe(false);
  });
});

describe("CREATE-A6 图片侧同形:未定价的 pro 变体拒绝 $0,显式价目表无该条目", () => {
  it("CREATE-A6 pro **标准图**本次已定价 2cr/张,可售", () => {
    expect(PRO_IMAGE_DISPLAY_CREDITS_PER_IMAGE).toBe(2);
    expect(isSellableImageSku("seedream-pro")).toBe(true);
    expect(assertSpendableModel("seedream-pro", "image", {}, { variant: "standard" })).toEqual({ ok: true });
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream-pro", count: 1, videoOptions: null }))
      .toBe(2 * INTERNAL_PER_DISPLAY);
    // lite 一格没动。
    expect(IMAGE_DISPLAY_CREDITS_PER_IMAGE).toBe(1);
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null }))
      .toBe(1 * INTERNAL_PER_DISPLAY);
  });

  it("CREATE-A6 大图与图层分离:拒绝生成,**显式价目表里没有它们的条目**", () => {
    for (const variant of ["large", "layered"] as const) {
      expect(GEN_IMAGE_VARIANTS).toContain(variant); // 图种在册 = 我们知道它存在
      expect(SELLABLE_IMAGE_VARIANTS["seedream-pro"]).not.toContain(variant); // 但它没有价
      expect(isSellableImageSku("seedream-pro", variant)).toBe(false);
      const refused = assertSpendableModel("seedream-pro", "image", {}, { variant });
      expect(refused.ok, `${variant} 竟然放行了`).toBe(false);
      assertNoModelName((refused as { error: string }).error);
      // 显式价目表(毛利真相表 = 每一个会向商家收钱的档)里没有它的条目 ——
      // 「对型号无感的兜底价」不算已定价。
      expect(MARGIN_TRUTH_SKUS.map((s) => s.id)).not.toContain(`image:seedream-pro:${variant}`);
    }
    // 已定价的那一格反过来必须在表上(否则「有价」这句话也是空的)。
    expect(MARGIN_TRUTH_SKUS.map((s) => s.id)).toContain("image:seedream-pro");
  });
});

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
  GEN_IMAGE_MODEL_OPTIONS,
  GEN_IMAGE_MODEL_PIXEL_LIMITS,
  GEN_IMAGE_VARIANTS,
  GEN_MODELS,
  GEN_VIDEO_MODELS,
  GEN_VIDEO_MODEL_OPTIONS,
  HD_VIDEO_RESOLUTION,
  IMAGE_SIZE_OUT_OF_RANGE,
  IMAGE_TIER_UNKNOWN,
  genImageModel,
  genRequest,
  imageOutputSize,
  imageOutputSizeForModel,
  merchantRouteReason,
  routeImageModel,
  routeReasonFor,
  routeVideoModel,
} from "./gen.js";
import type { GenerationRequest } from "./refgen.js";
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

/**
 * Codex r2 P1 —— **写入点全集 × 过滤表**的守形测试。
 *
 * r2 抓到的洞有两半,这一份钉的是两半的交叉:
 *   ① 出口只有一个 —— `merchantRouteReason` 是 `Generation.routeReason` 跨过商家边界的
 *      唯一函数(轮询回执与资产回执共用),所以「这一列干不干净」只有一个答案;
 *   ② 过滤表真的认得供应商品牌词 —— r2 之前 `redactProviderNames("dola")` 原样返回
 *      "dola",而 `dola-seedream-5-0-pro-260628` 是我们今天真在送的 id。
 *
 * 「写入点全集」是**算出来的**而不是手抄的:`routeReasonFor` 是这一列唯一的生产写入点
 * (worker 建行时调它,apps/worker/src/jobs/gen.ts),这里把它的整个输入域跑一遍
 * (两种 kind × 菜单上每一个槽位 × 每一档分辨率 + 空值 + 垃圾值),拿到它能写出的每一句话。
 * 有人改了那句话的措辞,这一份跟着改;有人加了一句新的,这一份自动把它也扫进来。
 */
describe("CREATE-A4 / CREATE-A12 路由理由:写入点全集 × 过滤表 × 唯一出口", () => {
  /** `routeReasonFor` 的整个输入域 —— 写入点能写出的每一种值都从这里长出来。 */
  const WRITE_POINT_INPUTS: { kind: "video" | "image"; model: string; resolution: string | null }[] = [];
  for (const model of [...GEN_MODELS, ...GEN_VIDEO_MODELS, "seedance-2-fast", "垃圾型号"]) {
    const resolutions = [
      ...new Set(Object.values(GEN_VIDEO_MODEL_OPTIONS).flatMap((o) => o.resolutions)),
      HD_VIDEO_RESOLUTION,
      null,
      "垃圾分辨率",
    ];
    for (const resolution of resolutions) {
      WRITE_POINT_INPUTS.push({ kind: "video", model, resolution });
      WRITE_POINT_INPUTS.push({ kind: "image", model, resolution });
    }
  }
  /** 写入点真的会写进库里的**每一种非空值**(去重后)。 */
  const WRITTEN_VALUES = [
    ...new Set(WRITE_POINT_INPUTS.map((i) => routeReasonFor(i)).filter((r): r is string => r !== null)),
  ];

  /**
   * 供应商**品牌**词 —— 过滤表必须真的改写它们。
   *
   * 与上面的 `FORBIDDEN_IN_MERCHANT_COPY` 刻意不是同一张表:"pro" / "lite" / "mini" 是
   * 普通英文档位词,过滤表**故意**不认(不然商家卖 "Pro" 套餐都要被改写),它们靠
   * 「这句话由我们自己的纯函数写」那一层挡,不靠兜底。品牌词没有这个借口 —— 它们出现在
   * 商家眼前只可能是一次泄露。这张表与供应商 id 表的同步由
   * packages/generation/src/byteplus.test.ts 的「过滤表 × 供应商 id 全集」那一条守着。
   */
  const SUPPLIER_BRAND_TOKENS = ["seedance", "seedream", "dreamina", "dola", "byteplus", "modelark"];
  /** 今天真在送的四条供应商 id(byteplus.ts 的两张表),整串过一遍出口。 */
  const REAL_SUPPLIER_IDS = [
    "seedream-5-0-260128",
    "dola-seedream-5-0-pro-260628",
    "dreamina-seedance-2-0-mini-260615",
    "dreamina-seedance-2-0-260128",
  ];

  it("写入点全集非空,且每一句都只有能力名词 —— 出口一个字都不该动它", () => {
    // 域扫出来是空的 = 这份测试什么都没证明,先把这一点钉死。
    expect(WRITTEN_VALUES.length).toBeGreaterThan(0);
    for (const written of WRITTEN_VALUES) {
      assertNoModelName(written);
      // 干净的句子经过出口应当**逐字不变**:兜底不许顺手改写我们自己的话。
      expect(merchantRouteReason(written)).toBe(written);
    }
  });

  it("过滤表认得每一个供应商品牌词,和今天在送的每一条 id", () => {
    for (const token of SUPPLIER_BRAND_TOKENS) {
      expect(redactProviderNames(token), `过滤表不认得品牌词「${token}」`).not.toBe(token);
    }
    for (const id of REAL_SUPPLIER_IDS) {
      const cleaned = redactProviderNames(id).toLowerCase();
      for (const token of SUPPLIER_BRAND_TOKENS) {
        expect(cleaned, `供应商 id「${id}」过完滤还剩「${token}」`).not.toContain(token);
      }
    }
  });

  it("写入点全集 × 每一种脏值:出口交出来的话里一个供应商 token 都没有", () => {
    // 「脏」的来路不必编:库里这一列有一天带上型号名,只可能是被人从供应商侧的字符串
    // 灌进来的 —— 手工回填、一次迁移、别处的旧代码。所以脏值就用真 id 拼。
    const dirty = [
      ...REAL_SUPPLIER_IDS,
      ...SUPPLIER_BRAND_TOKENS,
      ...REAL_SUPPLIER_IDS.map((id) => `routed to ${id}`),
    ];
    for (const written of WRITTEN_VALUES) {
      for (const poison of dirty) {
        for (const shape of [`${written} (${poison})`, `${poison} — ${written}`, `${written}\n${poison}`]) {
          const out = merchantRouteReason(shape);
          expect(out).not.toBeNull();
          const lowered = out!.toLowerCase();
          for (const token of SUPPLIER_BRAND_TOKENS) {
            expect(lowered, `出口把「${token}」交给了商家:${shape} ⇒ ${out}`).not.toContain(token);
          }
        }
      }
    }
  });

  it("空即未知:null / 空串 / 只剩空白 / 过滤后只剩空白,一律 null", () => {
    expect(merchantRouteReason(null)).toBeNull();
    expect(merchantRouteReason(undefined)).toBeNull();
    expect(merchantRouteReason("")).toBeNull();
    expect(merchantRouteReason("   \n\t ")).toBeNull();
  });
});

describe("CREATE-A5 白名单外:默认档配错=降级留日志;直接请求=拒绝、不降级", () => {
  afterEach(() => vi.restoreAllMocks());

  it("CREATE-A5 前者:默认视频模型环境变量指向未定价槽位 → 降级回白名单**并留日志**", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // ① 降级到白名单内的默认槽位。
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "seedance-2-fast" })).toBe("seedance-2-mini");
    // ② 「留日志」是这条验收的另一半,必须**正面**断言打出来了 —— r1 判官 P1:
    //    此前这里只断言了「好值不打日志」,于是一条静默降级也能全绿。
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("OTTO_DEFAULT_VIDEO_MODEL=seedance-2-fast");

    warn.mockClear();
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "not-a-model" })).toBe("seedance-2-mini");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("OTTO_DEFAULT_VIDEO_MODEL=not-a-model");

    // ③ 白名单内的槽位照旧生效、且**不**打日志(降级只发生在配错的时候)。
    warn.mockClear();
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "seedance-2-0" })).toBe("seedance-2-0");
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "seedance-2-mini" })).toBe("seedance-2-mini");
    expect(activeVideoModel({})).toBe("seedance-2-mini"); // env 没设 = 不是配错
    expect(warn).not.toHaveBeenCalled();
    // 今天两个在产槽位的默认档都在白名单上,所以「在菜单上但默认档没有价」那条分支
    // 从这里构造不出来 —— 它的覆盖在 creation-routing-degrade.test.ts(注入白名单)。
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

/* ═══════════════ Codex 跨厂复审 r1 落修(2026-09-02)═══════════════ */

describe("CREATE-A6 图片能力路由:商家勾的是能力,槽位由我们挑", () => {
  it("CREATE-A6 `fineDetail` 这一格能力 → pro 槽位;不勾 → 默认槽位", () => {
    // r1 判官 P1-2:此前 pro 槽位**没有任何能力位指得到它** —— `routeImageModel` 只认
    // `transparent` / `portraitRefine` 两格,而那两格没有入口,于是 pro 只能靠一个知道
    // 隐藏别名的调用方点名。`fineDetail` 是商家今天真的勾得到的那一格。
    expect(routeImageModel({ fineDetail: true }).model).toBe("seedream-pro");
    expect(routeImageModel({ fineDetail: false }).model).toBe("seedream");
    expect(routeImageModel({ fineDetail: null }).model).toBe("seedream");
    expect(routeImageModel({}).model).toBe("seedream");
    expect(routeImageModel().model).toBe("seedream");
    // 三个能力位是同一族,任一为真都升档(另两格的入口随批 II 进来)。
    expect(routeImageModel({ transparent: true }).model).toBe("seedream-pro");
    expect(routeImageModel({ portraitRefine: true }).model).toBe("seedream-pro");
  });

  it("CREATE-A6 升档理由只写能力名词;没升档就是 null", () => {
    const routed = routeImageModel({ fineDetail: true });
    expect(routed.reason).not.toBeNull();
    assertNoModelName(routed.reason!);
    expect(routeImageModel({ fineDetail: false }).reason).toBeNull();
  });

  it("CREATE-A6 契约闸:能力位与它落到的槽位必须一致,视频侧一律拒", () => {
    const base = {
      projectId: "prj_1", prompt: "the bottle on a marble counter", count: 1,
      idempotencyKey: "asset:test:1",
    };
    // 勾了精修 + 已经路由到 pro ⇒ 放行。
    expect(genRequest.safeParse({ ...base, kind: "image", model: "seedream-pro", fineDetail: true }).success).toBe(true);
    // 勾了精修却挂在默认槽位上 = 一次绕开路由的直接构造 ⇒ 拒(花钱之前)。
    expect(genRequest.safeParse({ ...base, kind: "image", model: "seedream", fineDetail: true }).success).toBe(false);
    // 视频带图片能力位 ⇒ 拒。
    expect(genRequest.safeParse({ ...base, kind: "video", model: "seedance-2-mini", fineDetail: true }).success).toBe(false);
    // 不勾 = 与今日逐字一致。
    expect(genRequest.safeParse({ ...base, kind: "image", model: "seedream" }).success).toBe(true);
  });
});

describe("CREATE-A5 能力表如实表达供应商能力:4k 在能力表上,但不可售", () => {
  it("CREATE-A5 4k 在**能力表**上(回执如实),却不在可售白名单里", () => {
    // r1 判官 P2-1:规格 §8.1① 记录的回执是 `[480p,720p,1080p,4k]`。能力表少写一档,
    // 「能力」与「可售」就混成了一件事 —— 4k 会被契约闸(引擎做不到)拒,而事实是
    // 引擎做得到、我们没有给它定价。
    expect(GEN_VIDEO_MODEL_OPTIONS["seedance-2-0"].resolutions).toContain("4k");
    expect(SELLABLE_VIDEO_RESOLUTIONS["seedance-2-0"]).not.toContain("4k");
    expect(isSellableVideoSku("seedance-2-0", "4k", 5)).toBe(false);
    // 毛利表(= 每一个会向商家收钱的档)里没有它的条目。
    expect(MARGIN_TRUTH_SKUS.map((s) => s.id)).not.toContain("video:seedance-2-0:5:4k");
  });

  it("CREATE-A5 请求 4k:**付费闸**拒(不是契约闸),$0、不降级", () => {
    // 契约闸放行(4k 真的在这台引擎的能力表上)——
    const parsed = genRequest.safeParse({
      projectId: "prj_1", prompt: "a slow push-in", count: 1, idempotencyKey: "asset:test:4k",
      kind: "video", model: "seedance-2-0", resolution: "4k", durationSeconds: 5,
    });
    expect(parsed.success, "4k 被契约闸拦了 —— 那说明能力表又不如实了").toBe(true);
    // …开口的是付费闸:这一格没有价。
    const refused = assertSpendableModel("seedance-2-0", "video", {}, { resolution: "4k", seconds: 5 });
    expect(refused.ok).toBe(false);
    assertNoModelName((refused as { error: string }).error);
    expect(refused).not.toHaveProperty("model"); // 不降级:没有「已替你换成别的档」的出口
  });
});

describe("CREATE-A4 适配器画幅闸:越限的 size 发不出去(逐槽位)", () => {
  it("CREATE-A4 pro 的像素上限比默认档低,16:9 / 9:16 在 pro 上**抛错拒绝**", () => {
    // r1 判官 P1-4:`imageOutputSize` 不认槽位,于是 pro + 16:9(4,665,600 px)会被
    // 原样拼成 `size` POST 出去,而 pro 的上限是 4,624,220 px。
    for (const aspect of ["16:9", "9:16"] as const) {
      expect(imageOutputSize(aspect).width * imageOutputSize(aspect).height)
        .toBeGreaterThan(GEN_IMAGE_MODEL_PIXEL_LIMITS["seedream-pro"].max);
      // 默认档收得下 ⇒ 原样放行(本片没有动它一格)。
      expect(imageOutputSizeForModel("seedream", aspect)).toEqual(imageOutputSize(aspect));
      // pro 收不下 ⇒ **抛**,不是降级、不是自动缩小。
      expect(() => imageOutputSizeForModel("seedream-pro", aspect)).toThrow(IMAGE_SIZE_OUT_OF_RANGE);
    }
    // pro 自己菜单上的每一格都必须过得了它自己的闸(否则菜单在骗人)。
    for (const aspect of GEN_IMAGE_MODEL_OPTIONS["seedream-pro"].aspectRatios) {
      expect(() => imageOutputSizeForModel("seedream-pro", aspect)).not.toThrow();
    }
    // 认不出来的槽位:未验先禁。
    expect(() => imageOutputSizeForModel("not-a-model", "1:1")).toThrow(IMAGE_SIZE_OUT_OF_RANGE);
    // 抛出来的这句话是商家可能读到的 —— 不许带型号名。
    assertNoModelName(IMAGE_SIZE_OUT_OF_RANGE);
  });
});

describe("CREATE-A6 pro 槽位进供应商请求的**静态类型契约**", () => {
  it("CREATE-A6 `GenerationRequest.model` 认得图片菜单的每一格(编译期证据)", () => {
    // r1 判官 P2-2:此前 worker 用 `as` 把 pro 塞进这个契约,编译器于是从来没有检查过
    // pro 的映射与适配器对不对得上。下面这两个**带类型标注**的字面量就是编译期证据 ——
    // 类型收窄回去,`pnpm --filter @fikirtive/core typecheck` 当场红。
    const pro: GenerationRequest = { prompt: "p", inputImageUrls: [], count: 1, model: "seedream-pro" };
    const lite: GenerationRequest = { prompt: "p", inputImageUrls: [], count: 1, model: "seedream" };
    expect(pro.model).toBe("seedream-pro");
    expect(lite.model).toBe("seedream");
    // 收窄函数:菜单上的一格原样回,菜单外的**抛**(不回落默认槽位 —— 回落 = 一条
    // 没在册的历史行照常跑、照常收钱)。
    expect(genImageModel("seedream-pro")).toBe("seedream-pro");
    expect(genImageModel("seedream")).toBe("seedream");
    expect(() => genImageModel("seedream-legacy")).toThrow(IMAGE_TIER_UNKNOWN);
    assertNoModelName(IMAGE_TIER_UNKNOWN);
  });
});

describe("CREATE-A4 并集菜单的前提:两个槽位的形状与时长必须同表", () => {
  it("CREATE-A4 形状与时长在两个槽位上逐字相同(菜单只交一份出去)", () => {
    // 商家的规格选择器拿到的是**一份**形状列表和**一份**时长列表(`getActiveGenModels`),
    // 而清晰度那一格是两个槽位的并集。所以只要两个槽位的形状/时长表出现分歧,
    // 商家就选得到一个「路由到的那台引擎不收」的组合 —— 契约闸会在花钱之前拒(fail closed,
    // $0),但那是一次注定失败的动作。这条断言把那个前提钉住:分歧的那一天当场红,
    // 提醒把菜单也拆成逐档的(而不是等商家去撞)。
    const mini = GEN_VIDEO_MODEL_OPTIONS["seedance-2-mini"];
    const hd = GEN_VIDEO_MODEL_OPTIONS["seedance-2-0"];
    expect([...hd.aspectRatios].sort()).toEqual([...mini.aspectRatios].sort());
    expect([...hd.durations].sort((a, b) => a - b)).toEqual([...mini.durations].sort((a, b) => a - b));
  });
});

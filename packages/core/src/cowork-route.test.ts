import { describe, expect, it } from "vitest";
import { suggestModel as suggestModelRaw, type SuggestModelInput, type SuggestModelResult } from "./cowork-route.js";
import {
  GEN_VIDEO_MODELS, GEN_VIDEO_MODEL_OPTIONS, GEN_VIDEO_MODEL_INFO,
  GEN_IMAGE_MODEL_OPTIONS, imageDefaults, type GenVideoModel,
} from "./gen.js";
import { activeVideoModel } from "./model-config.js";

/** #647 T6:`suggestModel` 现在会返回 null(唯一引擎被后台关掉)。下面这一大段测的都是
 *  **引擎开着**的路,所以走这个包装:拿到 null 当场就是一条失败,而不是一片
 *  `!` 断言把「没有引擎」这件事悄悄吞掉。null 那条路由文件末尾的 T6 段专门测。 */
function suggestModel(input: SuggestModelInput): SuggestModelResult {
  const r = suggestModelRaw(input);
  if (!r) throw new Error(`suggestModel 意外返回 null(${input.kind})—— 这一段测的是引擎开着的路`);
  return r;
}

describe("suggestModel", () => {
  it("image → seedream with count default", () => {
    const r = suggestModel({ kind: "image" });
    expect(r.model).toBe("seedream");
    expect(r.params.count).toBeGreaterThanOrEqual(1);
  });

  // ---- #643 T2:图片这条路不再把商家要的形状丢在选型那一步 ----------------
  it("图片:没提形状 ⇒ 默认方图,且不是降级", () => {
    const r = suggestModel({ kind: "image" });
    expect(r.params.aspectRatio).toBe(imageDefaults("seedream").aspectRatio);
    expect(r.downgraded).toBe(false);
    expect(r.requested.aspect).toBeUndefined();
  });
  it("图片:菜单上的每一个形状都原样落到 params(一格都不许被吞)", () => {
    for (const a of GEN_IMAGE_MODEL_OPTIONS.seedream.aspectRatios) {
      const r = suggestModel({ kind: "image", desiredAspect: a });
      expect(r.params.aspectRatio, a).toBe(a);
      expect(r.downgraded, a).toBe(false);
    }
  });
  it("图片:商家的人话形状也落地(portrait ⇒ 9:16)", () => {
    const r = suggestModel({ kind: "image", desiredAspect: "portrait" });
    expect(r.params.aspectRatio).toBe("9:16");
    expect(r.downgraded).toBe(false);
  });
  it("图片:引擎给不了的形状 ⇒ 回默认方图,并如实标成降级(绝不静默)", () => {
    const r = suggestModel({ kind: "image", desiredAspect: "5:7" });
    expect(r.params.aspectRatio).toBe(imageDefaults("seedream").aspectRatio);
    expect(r.downgraded).toBe(true);
    expect(r.requested.aspect).toBe("5:7");
  });
  it("图片:reason 只是审计说明 —— 形状的真相在 params 上", () => {
    const r = suggestModel({ kind: "image", desiredAspect: "21:9" });
    expect(r.params.aspectRatio).toBe("21:9");
  });
  it("video honours a 9:16 t2v request with a model that exposes aspect", () => {
    const r = suggestModel({ kind: "video", desiredAspect: "9:16" });
    const o = GEN_VIDEO_MODEL_OPTIONS[r.model as GenVideoModel];
    expect(o.aspectRatios.length === 0 || o.aspectRatios.includes("9:16")).toBe(true);
    if (o.aspectRatios.length) expect(r.params.aspectRatio).toBe("9:16");
  });
  it("empty-aspect (Kling-class) models are NOT disqualified by a desiredAspect", () => {
    const r = suggestModel({ kind: "video", desiredAspect: "9:16", hasSourceImage: true });
    expect(r.model).toBeTruthy();
  });
  it("snaps an unavailable duration to the model's option set and flags downgraded", () => {
    // #645 T4:7 秒现在**是**菜单上的一档,所以旧夹具不再是「给不了的时长」。
    // 换成真正给不了的 30 秒(引擎上限 15),降级语义原样守住。
    const r = suggestModel({ kind: "video", desiredDuration: 30 });
    const o = GEN_VIDEO_MODEL_OPTIONS[r.model as GenVideoModel];
    expect(o.durations).toContain(r.params.durationSeconds);
    expect(r.downgraded).toBe(true);
  });
  it("#645 T4:菜单上的每一档时长都原样落到 params,且不算降级", () => {
    for (const seconds of GEN_VIDEO_MODEL_OPTIONS[activeVideoModel() as GenVideoModel].durations) {
      const r = suggestModel({ kind: "video", desiredDuration: seconds });
      expect(r.params.durationSeconds, `${seconds}s 被吞了`).toBe(seconds);
      expect(r.downgraded, `${seconds}s 不该算降级`).toBe(false);
    }
  });
  it("#645 T4:菜单上的每一个比例都原样落到 params —— Otto 不再静默 16:9", () => {
    for (const aspect of GEN_VIDEO_MODEL_OPTIONS[activeVideoModel() as GenVideoModel].aspectRatios) {
      const r = suggestModel({ kind: "video", desiredAspect: aspect });
      expect(r.params.aspectRatio, `${aspect} 被吞了`).toBe(aspect);
      expect(r.downgraded, `${aspect} 不该算降级`).toBe(false);
    }
  });
  it("always returns audio + count (so videoPriceUsd is truthful)", () => {
    const r = suggestModel({ kind: "video" });
    expect(typeof r.params.audio === "boolean").toBe(true);
    expect(r.params.count).toBe(1);
  });
  it("t2v with a desiredAspect picks a model that actually EXPOSES that aspect (not a cheap empty-aspect model that would silently drop it)", () => {
    const r = suggestModel({ kind: "video", desiredAspect: "9:16" }); // t2v: no source frame
    const o = GEN_VIDEO_MODEL_OPTIONS[r.model as GenVideoModel];
    expect(o.aspectRatios).toContain("9:16");
    expect(r.params.aspectRatio).toBe("9:16");
    expect(r.reason).not.toContain("source");
  });
  it("i2v with a desiredAspect keeps cheap empty-aspect models (aspect comes from the source frame)", () => {
    const r = suggestModel({ kind: "video", desiredAspect: "9:16", hasSourceImage: true });
    const o = GEN_VIDEO_MODEL_OPTIONS[r.model as GenVideoModel];
    if (o.aspectRatios.length === 0) {
      expect(r.params.aspectRatio).toBeUndefined();
      expect(r.reason).toContain("source frame");
    } else {
      expect(r.params.aspectRatio).toBe("9:16");
    }
  });
  it("always returns the active video model regardless of hasTail (locked model; tail capability is an accepted tradeoff)", () => {
    // Before: suggestModel would pick a tail-capable model when hasTail=true.
    // Now: model selection is locked to activeVideoModel() (seedance-2-mini by default;
    // 2026-07-04: only flat margin-floored models are honored) by product decision — the
    // spend gate only allows the active model. hasTail is accepted but does not reroute
    // to a different model; params are still clamped to the active model's options.
    const r = suggestModel({ kind: "video", hasTail: true });
    expect(r.model).toBe(activeVideoModel());
    expect((GEN_VIDEO_MODELS as readonly string[]).includes(r.model)).toBe(true);
  });
  it("an aspect NO model can honor (t2v) flags downgraded and never fabricates the impossible aspect (fallback path)", () => {
    // #645 T4:21:9 现在是菜单上的一格,所以旧夹具换成引擎真给不了的 2:3。
    const r = suggestModel({ kind: "video", desiredAspect: "2:3" });
    expect(r.downgraded).toBe(true);
    expect(r.params.aspectRatio).not.toBe("2:3");
  });
  it("选型仍然锁死在唯一那台在产引擎上(没有 picker,这一条 #647 一格没动)", () => {
    // 商家侧本来就不该见引擎名,所以「选哪台」不是一个选项。这一条守的是:任何输入
    // 组合下,选出来的都还是 activeVideoModel(),而不是被某个参数悄悄换掉。
    const free = suggestModel({ kind: "video" });
    expect(free.model).toBe(activeVideoModel());
    expect((GEN_VIDEO_MODELS as readonly string[]).includes(free.model)).toBe(true);
  });
  it("引擎给不了的比例(2:3)照旧如实标降级,模型 id 不因此改变", () => {
    // (#645 T4:夹具从 21:9 换成 2:3 —— 21:9 已经是菜单上的一格了。)
    const r = suggestModel({ kind: "video", desiredAspect: "2:3" });
    expect(r.model).toBe(activeVideoModel());
    expect(r.downgraded).toBe(true); // 2:3 is not in the model's aspectRatios → snapped
  });
});

// ---------------------------------------------------------------------------
// #647 T6 —— `disabled` 从此真的算数
// ---------------------------------------------------------------------------
//
// 缺陷现场:`suggestModel` 收下 `disabled` 参数,然后**一次也没用过**。后台把唯一那台
// 视频引擎关掉之后,Otto 照旧选中它、照旧算出价、照旧铸出一张商家点得下去的付费卡 ——
// 卡在那里躺着说「11 credits,确认就做」,而确认的那一刻必然被 spend 闸打回。菜单上多
// 出来的那一格不是模型,是**一个确认不了的承诺**。
//
// 修法:唯一的引擎被关掉 ⇒ 这一类创作就是不可用,`suggestModel` 返回 null,由调用方
// 给诚实空态。返回 null 而不是「照选不误」,是为了让编译器逼着每一个入口都表态。
describe("#647 T6 suggestModel 尊重 disabled(关掉唯一引擎 ⇒ 铸不出付费卡)", () => {
  it("视频:唯一在产引擎被关 ⇒ 返回 null(不选型、不报价)", () => {
    expect(suggestModelRaw({ kind: "video", disabled: new Set([activeVideoModel()]) })).toBeNull();
  });

  it("视频:整张菜单都被关 ⇒ 同样返回 null(不再回落到全量菜单)", () => {
    expect(suggestModelRaw({ kind: "video", disabled: new Set(GEN_VIDEO_MODELS as readonly string[]) })).toBeNull();
  });

  it("视频:商家提了形状/时长也不改变结论 —— 没有引擎就是没有引擎", () => {
    expect(
      suggestModelRaw({ kind: "video", desiredAspect: "9:16", desiredDuration: 10, disabled: new Set([activeVideoModel()]) }),
    ).toBeNull();
  });

  it("图片:唯一图像引擎被关 ⇒ 同样返回 null(同一个参数,同一条规矩)", () => {
    expect(suggestModelRaw({ kind: "image", disabled: new Set(["seedream"]) })).toBeNull();
  });

  it("关的是**别的** id ⇒ 一切照旧(narrowing 只许窄,不许无中生有地拦)", () => {
    const r = suggestModelRaw({ kind: "video", disabled: new Set(["kling", "veo3.1", "某个不存在的 id"]) });
    expect(r).not.toBeNull();
    expect(r?.model).toBe(activeVideoModel());
    const img = suggestModelRaw({ kind: "image", disabled: new Set(["seedance-2-mini"]) });
    expect(img).not.toBeNull();
    expect(img?.model).toBe("seedream");
  });

  it("没传 disabled ⇒ 一切照旧(参数是可选的,缺省不等于全关)", () => {
    expect(suggestModelRaw({ kind: "video" })).not.toBeNull();
    expect(suggestModelRaw({ kind: "image" })).not.toBeNull();
  });
});

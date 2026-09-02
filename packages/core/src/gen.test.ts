import { describe, expect, it } from "vitest";
import {
  GEN_VIDEO_MODELS, GEN_VIDEO_MODEL_INFO, modelFamily, deriveMode, MODEL_FAMILIES, GEN_MODES, genRequest,
  GEN_IMAGE_ASPECTS, GEN_IMAGE_DEFAULT_ASPECT, GEN_IMAGE_MAX_PIXELS, GEN_IMAGE_MIN_PIXELS,
  GEN_MODELS, GEN_IMAGE_MODEL_PIXEL_LIMITS,
  GEN_IMAGE_MODEL_OPTIONS, GEN_IMAGE_SIZES, imageDefaults, imageOutputSize, normalizeImageAspect,
  supportsCoherentSet, COHERENT_SET_MIN_IMAGES,
  type GenImageAspect,
} from "./gen.js";

describe("modelFamily", () => {
  // every shipping video model resolves to a known family (version-agnostic, by prefix)
  // #647 T6:菜单收到只剩在产那一台之后,这张表也跟着只剩一行 —— 表与菜单同集由
  // menu-truth.test.ts 钉着,这里钉的是映射本身。
  // Creation S2 §8.1①:高清槽位上架,两台都归 seedance 家族(按前缀,知识库一格不用改)。
  const expected: Record<string, string> = {
    "seedance-2-mini": "seedance",
    "seedance-2-0": "seedance",
  };
  it("maps every video model to a family", () => {
    for (const m of GEN_VIDEO_MODELS) {
      expect(modelFamily(m)).toBe(expected[m]);
    }
  });
  it("maps the image model seedream", () => {
    expect(modelFamily("seedream")).toBe("seedream");
  });
  it("is version-agnostic by prefix (future bumps inherit the family)", () => {
    expect(modelFamily("seedance-3-fast")).toBe("seedance");
    expect(modelFamily("seedream-5")).toBe("seedream");
  });
  it("seedream vs seedance disambiguate (both start with 'seed')", () => {
    expect(modelFamily("seedream")).toBe("seedream");
    expect(modelFamily("seedance-2-mini")).toBe("seedance");
  });
  it("unknown id → undefined (family-neutral fallback, never throws)", () => {
    expect(modelFamily("totally-unknown")).toBeUndefined();
    expect(modelFamily("")).toBeUndefined();
  });
  it("every returned family is in MODEL_FAMILIES", () => {
    for (const m of [...GEN_VIDEO_MODELS, "seedream"]) {
      const f = modelFamily(m);
      expect(f && MODEL_FAMILIES.includes(f)).toBe(true);
    }
  });
});

describe("deriveMode", () => {
  it("image: conditioning refs → i2i, else t2i", () => {
    expect(deriveMode({ kind: "image" })).toBe("t2i");
    expect(deriveMode({ kind: "image", conditioned: false })).toBe("t2i");
    expect(deriveMode({ kind: "image", conditioned: true })).toBe("i2i");
  });
  it("video: no source → t2v; source → i2v; source+tail → i2v-tail", () => {
    expect(deriveMode({ kind: "video" })).toBe("t2v");
    expect(deriveMode({ kind: "video", hasSourceImage: true })).toBe("i2v");
    expect(deriveMode({ kind: "video", hasSourceImage: true, hasTailImage: true })).toBe("i2v-tail");
  });
  it("tail without a source is t2v (an end frame is meaningless without a start)", () => {
    expect(deriveMode({ kind: "video", hasTailImage: true })).toBe("t2v");
  });
  it("every derived mode is in GEN_MODES", () => {
    const cases = [
      deriveMode({ kind: "image" }),
      deriveMode({ kind: "image", conditioned: true }),
      deriveMode({ kind: "video" }),
      deriveMode({ kind: "video", hasSourceImage: true }),
      deriveMode({ kind: "video", hasSourceImage: true, hasTailImage: true }),
    ];
    for (const m of cases) expect(GEN_MODES.includes(m)).toBe(true);
  });
});

describe("genRequest.variantSel", () => {
  const base = { projectId: "p1", prompt: "hi", entityIds: ["e1"], kind: "image", model: "seedream", count: 1, idempotencyKey: "k1" };
  it("defaults absent and accepts an { entityId: variantId } map", () => {
    expect(genRequest.parse(base).variantSel).toBeUndefined();
    expect(genRequest.parse({ ...base, variantSel: { e1: "v1" } }).variantSel).toEqual({ e1: "v1" });
  });
  it("rejects an over-long variant id (a bad id must never reach the worker)", () => {
    expect(() => genRequest.parse({ ...base, variantSel: { e1: "x".repeat(65) } })).toThrow();
  });
  it("rejects a variantSel key that isn't an @mentioned entity (inconsistent → no spend)", () => {
    expect(() => genRequest.parse({ ...base, variantSel: { e2: "v1" } })).toThrow();
    expect(() => genRequest.parse({ ...base, entityIds: [], variantSel: { e1: "v1" } })).toThrow();
  });
});

/**
 * #914 r6(判官 r5 P2)—— 「商家原话」不是这张 schema 的字段,而且**必须不是**。
 *
 * 它曾经是一个可选字段。可是解析这张 schema 的每一个入口都是浏览器能直接调用的 Server
 * Action:收下它,等于让任何调用者往一条商家日后会当成证据看的记录里写任意一句话
 * (#882 approvedEntities 的同一课,只是这次伪造的是出处而不是指令)。因为这张 schema 是
 * `.strict()`,把字段拿掉本身就是那道闸:带上它的请求在花钱之前整单被拒。
 */
describe("genRequest —— 商家原话不进请求体 (#914 r6)", () => {
  const base = { projectId: "p1", prompt: "a cat", count: 1, kind: "image", model: "seedream", idempotencyKey: "k1" };
  it("不带它:照常通过(每一条花钱路都是这样)", () => {
    expect(genRequest.safeParse(base).success).toBe(true);
  });
  it("带上它:整单被拒 —— 不是悄悄剥掉,而是当场失败(多这个字段说明调用方在试图写这条记录)", () => {
    expect(genRequest.safeParse({ ...base, requestedPrompt: "a sentence I made up" }).success).toBe(false);
  });
  it("解析结果里根本没有这个键 —— 下游想读也读不到,只能走服务端那条通道", () => {
    expect(genRequest.parse(base)).not.toHaveProperty("requestedPrompt");
  });
});

// #774 —— 传输层对审批身份的封顶。谁可以**给**这个字段是执行层的事(只有服务端读出的
// 那张卡,见 gen-actions 的 startCoworkGen);这里钉的是「就算给了,形状也得站得住」:
// 一条指向没 @ 到的元素的身份、或同一个元素两份身份,都在能落库之前就落不了地。
describe("genRequest.approvedEntities", () => {
  const base = { projectId: "p1", prompt: "hi", entityIds: ["e1"], kind: "image", model: "seedream", count: 1, idempotencyKey: "k1" };
  const APPROVED = { id: "e1", type: "PRODUCT", name: "Bottle" };
  it("absent by default; a well-formed identity for an @mentioned entity parses", () => {
    expect(genRequest.parse(base).approvedEntities).toBeUndefined();
    expect(genRequest.parse({ ...base, approvedEntities: [APPROVED] }).approvedEntities).toEqual([APPROVED]);
  });
  it("rejects an identity for an entity that isn't @mentioned", () => {
    expect(genRequest.safeParse({ ...base, approvedEntities: [{ ...APPROVED, id: "e9" }] }).success).toBe(false);
  });
  it("rejects two identities for the same entity (which one was approved?)", () => {
    expect(genRequest.safeParse({
      ...base,
      approvedEntities: [APPROVED, { ...APPROVED, name: "Bottle 2" }],
    }).success).toBe(false);
  });
  it("rejects an unknown type and an over-long name (a bad identity never reaches the worker)", () => {
    expect(genRequest.safeParse({ ...base, approvedEntities: [{ ...APPROVED, type: "NOPE" }] }).success).toBe(false);
    expect(genRequest.safeParse({ ...base, approvedEntities: [{ ...APPROVED, name: "x".repeat(121) }] }).success).toBe(false);
  });
});

describe("genRequest.threadId", () => {
  it("genRequest accepts an optional threadId (cowork tag) and rejects an over-long one", () => {
    const base = { projectId: "p1", prompt: "a cat", count: 1, kind: "image", model: "seedream", idempotencyKey: "k1" };
    expect(genRequest.safeParse({ ...base, threadId: "t_123" }).success).toBe(true);
    expect(genRequest.safeParse(base).success).toBe(true); // threadId absent is fine (cowork-only tag)
    expect(genRequest.safeParse({ ...base, threadId: "x".repeat(65) }).success).toBe(false);
  });
});

describe("genRequest.idempotencyKey", () => {
  // every spend request MUST carry a key so it always flows through dedup
  // (startGen pre-check + partial-unique index) — a keyless request could
  // bypass dedup and double-charge.
  const base = { projectId: "p1", prompt: "a cat", count: 1, kind: "image", model: "seedream" };
  it("rejects a missing key (no keyless spend path)", () => {
    expect(genRequest.safeParse(base).success).toBe(false);
  });
  it("rejects a null key (the old .nullish() bypass is gone)", () => {
    expect(genRequest.safeParse({ ...base, idempotencyKey: null }).success).toBe(false);
  });
  it("rejects an empty key", () => {
    expect(genRequest.safeParse({ ...base, idempotencyKey: "" }).success).toBe(false);
  });
  it("accepts a valid key", () => {
    expect(genRequest.safeParse({ ...base, idempotencyKey: "cowork:c1" }).success).toBe(true);
  });
  it("rejects an over-long key (>80, a bad id must never reach the worker)", () => {
    expect(genRequest.safeParse({ ...base, idempotencyKey: "x".repeat(81) }).success).toBe(false);
  });
});

describe("genRequest.referenceVideoGenerationId", () => {
  const base = {
    projectId: "p1",
    prompt: "a cat",
    count: 1,
    kind: "video",
    model: "seedance-2-mini",
    idempotencyKey: "k1",
  };

  it("accepts a reference video on the fixed 5s video path", () => {
    expect(genRequest.safeParse({ ...base, referenceVideoGenerationId: "gen_ref", durationSeconds: 5 }).success).toBe(true);
    expect(genRequest.safeParse({ ...base, referenceVideoGenerationId: "gen_ref" }).success).toBe(true);
  });

  it("rejects reference video on image generation", () => {
    expect(genRequest.safeParse({ ...base, kind: "image", model: "seedream", referenceVideoGenerationId: "gen_ref" }).success).toBe(false);
  });

  it("rejects non-Seedance video jobs with referenceVideoGenerationId", () => {
    // #647 T6:菜单上已经没有第二台引擎了,所以这一条只能用菜单外的 id 来问 —— 它同时
    // 证明契约闸对下架/未知模型仍然 fail closed(既非在册模型,也不是参考视频那一台)。
    expect(genRequest.safeParse({ ...base, model: "veo3.1-lite", referenceVideoGenerationId: "gen_ref", durationSeconds: 5 }).success).toBe(false);
  });

  it("rejects 10s reference-video output before spend because the 16cr price is modeled for 5s output", () => {
    expect(genRequest.safeParse({ ...base, referenceVideoGenerationId: "gen_ref", durationSeconds: 10 }).success).toBe(false);
  });
});

describe("genRequest.tailGenerationId", () => {
  const base = { projectId: "p1", prompt: "a cat", count: 1, kind: "video", model: "seedance-2-mini", idempotencyKey: "k1" };

  it("#646 T5:现役视频模型接受尾帧(引擎支持首+尾帧,闸不再挡)", () => {
    expect(GEN_VIDEO_MODEL_INFO["seedance-2-mini"].tail).toBe(true);
    expect(genRequest.safeParse({ ...base, sourceGenerationId: "gen_src", tailGenerationId: "gen_tail" }).success).toBe(true);
  });

  it("模型真不支持尾帧时照旧在花钱前挡下(闸本身没松)", () => {
    // #647 T6:菜单上已经没有「不支持尾帧」的那一格了(唯一在产的那台支持)。闸的判据
    // 是 `GEN_VIDEO_MODEL_INFO[model]?.tail === true`,所以事实表上查不到的模型一律当
    // 「不支持」—— 用一个下架 id 来问,正好同时钉住这条 fail-closed 语义。
    expect((GEN_VIDEO_MODEL_INFO as Record<string, { tail: boolean } | undefined>)["grok-imagine"]).toBeUndefined();
    const r = genRequest.safeParse({ ...base, model: "grok-imagine", durationSeconds: 6, sourceGenerationId: "gen_src", tailGenerationId: "gen_tail" });
    expect(r.success).toBe(false);
  });

  // ── #646 修复轮 P0-1:尾帧的跨字段前提 ────────────────────────────────────────
  // 闸原本只问「这个模型支不支持尾帧」,不问「这一单到底有没有首帧」。worker 解析尾帧
  // 那一步被 `job.tailGenerationId && sourceAsset` 短路(apps/worker/src/jobs/gen.ts:671):
  // 首帧缺席 ⇒ tailImageUrl 根本没生成 ⇒ 适配器那道守卫看不见原请求 ⇒ 引擎收到的是一支
  // 普通视频,商家却按尾帧那一单付了钱。所以前提必须在花钱之前查。

  it("#646 P0-1:尾帧必须伴随首帧来源 —— 光有尾帧的请求在花钱前就被拒", () => {
    // worker 解析首帧的来源**只有两个**(gen.ts:641-663):显式 sourceGenerationId,
    // 或 shotId 那一格最新的图。两个都没有 ⇒ 这一单的尾帧到不了引擎。
    const bare = genRequest.safeParse({ ...base, tailGenerationId: "gen_tail" });
    expect(bare.success).toBe(false);
    expect(JSON.stringify(bare.error?.issues)).toMatch(/start frame/);
    // 两个合法来源都得放行,否则会误伤「画布动画」(只带 shotId)这条真路。
    expect(genRequest.safeParse({ ...base, sourceGenerationId: "gen_src", tailGenerationId: "gen_tail" }).success).toBe(true);
    expect(genRequest.safeParse({ ...base, shotId: "shot_1", tailGenerationId: "gen_tail" }).success).toBe(true);
  });

  it("#646 P0-1:尾帧与参考视频互斥 —— 同时给出在花钱前就被拒(与适配器同语义)", () => {
    const r = genRequest.safeParse({
      ...base, sourceGenerationId: "gen_src", tailGenerationId: "gen_tail",
      referenceVideoGenerationId: "gen_ref", durationSeconds: 5,
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/reference video/);
  });
});

// ---------------------------------------------------------------------------
// #642 图片形状端到端 —— 契约 / 校验表 / 像素映射
// ---------------------------------------------------------------------------
describe("GEN_IMAGE_MODEL_OPTIONS(图片画幅菜单)", () => {
  it("菜单就是引擎真支持的八个画幅,默认排第一(1:1,与今日方图一致)", () => {
    expect(GEN_IMAGE_MODEL_OPTIONS.seedream.aspectRatios).toEqual([
      "1:1", "9:16", "16:9", "4:3", "3:4", "3:2", "2:3", "21:9",
    ]);
    expect(imageDefaults("seedream").aspectRatio).toBe("1:1");
    expect(GEN_IMAGE_DEFAULT_ASPECT).toBe("1:1");
  });
  it("每个菜单项都有确切的 WxH 映射(菜单上没有一格是假的)", () => {
    // Creation S2 §8.1①:菜单从一格开到两格,所以这条 menu-truth 也逐槽走一遍 ——
    // 「每一格都是真的」对 pro 与对 lite 是同一句话。
    for (const model of GEN_MODELS) {
      for (const a of GEN_IMAGE_MODEL_OPTIONS[model].aspectRatios) {
        expect(GEN_IMAGE_SIZES[a as GenImageAspect], `${model} ${a}`).toBeDefined();
      }
    }
    expect(Object.keys(GEN_IMAGE_SIZES).sort()).toEqual([...GEN_IMAGE_ASPECTS].sort());
  });
});

// ---------------------------------------------------------------------------
// 逐槽像素上限 —— 判官 r2 P1:pro 槽位不能照抄 lite 的画幅表
// ---------------------------------------------------------------------------
describe("图片槽位 × 逐槽像素区间(supported_params 实查回执)", () => {
  const imageBase = {
    projectId: "p1", prompt: "a poster", count: 1, kind: "image", idempotencyKey: "k1",
  } as const;

  it("回执数字逐字钉住(动这两行 = 有人改了回执,必须先拿新回执来)", () => {
    // 零成本只读查询,2026-09-02:
    //   lite `arkcli models get seedream-5-0 --transform supported_params --format json`
    //     → size「总像素 [3686400, 16777216]」
    //   pro  回执原件 preserved/creation-probe-2026-09-02/experiment-3/supported_params-pro.json
    //     → size「总像素 [921600, 4624220]」
    expect(GEN_IMAGE_MODEL_PIXEL_LIMITS.seedream).toEqual({ min: 3_686_400, max: 16_777_216 });
    expect(GEN_IMAGE_MODEL_PIXEL_LIMITS["seedream-pro"]).toEqual({ min: 921_600, max: 4_624_220 });
    // 既有命名出口就是 lite 那一行,不是第二份手抄
    expect(GEN_IMAGE_MIN_PIXELS).toBe(GEN_IMAGE_MODEL_PIXEL_LIMITS.seedream.min);
    expect(GEN_IMAGE_MAX_PIXELS).toBe(GEN_IMAGE_MODEL_PIXEL_LIMITS.seedream.max);
  });

  it("每个槽位菜单上的每一格,总像素都落在**该槽位**回执的区间内", () => {
    for (const model of GEN_MODELS) {
      const { min, max } = GEN_IMAGE_MODEL_PIXEL_LIMITS[model];
      for (const a of GEN_IMAGE_MODEL_OPTIONS[model].aspectRatios) {
        const { width, height } = GEN_IMAGE_SIZES[a as GenImageAspect];
        const pixels = width * height;
        expect(pixels, `${model} ${a} 总像素`).toBeGreaterThanOrEqual(min);
        expect(pixels, `${model} ${a} 总像素`).toBeLessThanOrEqual(max);
      }
    }
  });

  it("菜单也没有无故短一格:被某个槽位排除的画幅,都是**真的**超出它的区间", () => {
    for (const model of GEN_MODELS) {
      const { min, max } = GEN_IMAGE_MODEL_PIXEL_LIMITS[model];
      const menu = GEN_IMAGE_MODEL_OPTIONS[model].aspectRatios as readonly string[];
      for (const a of GEN_IMAGE_ASPECTS) {
        if (menu.includes(a)) continue;
        const { width, height } = GEN_IMAGE_SIZES[a];
        const pixels = width * height;
        expect(pixels < min || pixels > max, `${model} 排除了 ${a},但它其实落在区间内`).toBe(true);
      }
    }
  });

  it("pro 少的正是 16:9 与 9:16(2880×1620 = 4,665,600 px > 4,624,220),且契约闸当场拒", () => {
    expect([...GEN_IMAGE_MODEL_OPTIONS["seedream-pro"].aspectRatios])
      .toEqual(["1:1", "4:3", "3:4", "3:2", "2:3", "21:9"]);
    for (const a of ["16:9", "9:16"] as const) {
      const { width, height } = GEN_IMAGE_SIZES[a];
      expect(width * height, `${a} 总像素`).toBe(4_665_600);
      expect(width * height).toBeGreaterThan(GEN_IMAGE_MODEL_PIXEL_LIMITS["seedream-pro"].max);
      // 引擎收不下的 size 绝不能过闸走到适配器并花钱
      expect(genRequest.safeParse({ ...imageBase, model: "seedream-pro", aspectRatio: a }).success, a)
        .toBe(false);
      // lite 那一格没有被动过 —— 同一个画幅在默认槽位照旧合法
      expect(genRequest.safeParse({ ...imageBase, model: "seedream", aspectRatio: a }).success, a)
        .toBe(true);
    }
  });

  it("pro 菜单上的每一格都真的过得了契约闸,默认档 1:1 也在它自己的区间内", () => {
    for (const a of GEN_IMAGE_MODEL_OPTIONS["seedream-pro"].aspectRatios) {
      expect(genRequest.safeParse({ ...imageBase, model: "seedream-pro", aspectRatio: a }).success, a)
        .toBe(true);
    }
    const def = imageDefaults("seedream-pro").aspectRatio;
    expect(def).toBe("1:1");
    const { width, height } = GEN_IMAGE_SIZES[def as GenImageAspect];
    expect(width * height).toBeLessThanOrEqual(GEN_IMAGE_MODEL_PIXEL_LIMITS["seedream-pro"].max);
  });
});

describe("GEN_IMAGE_SIZES(引擎约束)", () => {
  it("每一档总像素都落在引擎的 WxH 区间内", () => {
    for (const [aspect, { width, height }] of Object.entries(GEN_IMAGE_SIZES)) {
      const pixels = width * height;
      expect(pixels, `${aspect} 总像素`).toBeGreaterThanOrEqual(GEN_IMAGE_MIN_PIXELS);
      expect(pixels, `${aspect} 总像素`).toBeLessThanOrEqual(GEN_IMAGE_MAX_PIXELS);
    }
  });
  it("每一档的实际比例**精确**等于它自称的比例(零容差:约分后必须逐字相等)", () => {
    // 容差是掩盖器。上一版用 1% 容差,把 1600×2848(约分 50:89,偏 0.125%)当成了 9:16 ——
    // 商家买的是 9:16,拿到的是一个「差不多」的形状。这里改成整数约分比对,数学上不留缝。
    const reduce = (a: number, b: number): [number, number] => {
      const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
      const g = gcd(a, b);
      return [a / g, b / g];
    };
    for (const [aspect, { width, height }] of Object.entries(GEN_IMAGE_SIZES)) {
      const [w, h] = aspect.split(":").map(Number) as [number, number];
      expect(reduce(width, height), `${aspect} 必须精确约分为它自称的比例`).toEqual(reduce(w, h));
      const actual = width / height;
      expect(actual).toBeGreaterThanOrEqual(1 / 16);
      expect(actual).toBeLessThanOrEqual(16);
    }
  });
  it("1:1 逐字节保持今日的 2048×2048(补齐画幅不改变既有方图行为)", () => {
    expect(GEN_IMAGE_SIZES["1:1"]).toEqual({ width: 2048, height: 2048 });
  });
});

describe("imageOutputSize", () => {
  it("缺省 / null → 默认画幅的尺寸(方图)", () => {
    expect(imageOutputSize()).toEqual({ width: 2048, height: 2048 });
    expect(imageOutputSize(null)).toEqual({ width: 2048, height: 2048 });
  });
  it("已知画幅 → 该画幅的确切尺寸", () => {
    expect(imageOutputSize("9:16")).toEqual({ width: 1620, height: 2880 });
    expect(imageOutputSize("21:9")).toEqual(GEN_IMAGE_SIZES["21:9"]);
  });
  it("未知画幅 → 回落默认(纯函数,永不抛)", () => {
    expect(imageOutputSize("7:5")).toEqual({ width: 2048, height: 2048 });
  });
});

// ---------------------------------------------------------------------------
// #643 T2 —— 商家用自己的话说形状,也得落到菜单上的那一格
// ---------------------------------------------------------------------------
describe("normalizeImageAspect(商家说法 → 菜单画幅)", () => {
  it("菜单上的比例原样通过", () => {
    for (const a of GEN_IMAGE_ASPECTS) expect(normalizeImageAspect(a)).toBe(a);
  });
  it("写法差异不算不同的形状(空白 / x / × / 全角冒号)", () => {
    expect(normalizeImageAspect(" 9 : 16 ")).toBe("9:16");
    expect(normalizeImageAspect("9x16")).toBe("9:16");
    expect(normalizeImageAspect("9X16")).toBe("9:16");
    expect(normalizeImageAspect("9×16")).toBe("9:16");
    expect(normalizeImageAspect("9:16")).toBe("9:16");
  });
  it("人话说的形状也认(竖版 / 横版 / 方图)—— 否则商家的原话会静默掉成方图", () => {
    expect(normalizeImageAspect("portrait")).toBe("9:16");
    expect(normalizeImageAspect("Vertical")).toBe("9:16");
    expect(normalizeImageAspect("landscape")).toBe("16:9");
    expect(normalizeImageAspect("horizontal")).toBe("16:9");
    expect(normalizeImageAspect("square")).toBe("1:1");
  });
  it("认不出来就是 null —— 绝不猜一个形状替商家做主", () => {
    expect(normalizeImageAspect(undefined)).toBeNull();
    expect(normalizeImageAspect(null)).toBeNull();
    expect(normalizeImageAspect("")).toBeNull();
    expect(normalizeImageAspect("5:7")).toBeNull();
    expect(normalizeImageAspect("cinematic")).toBeNull();
    expect(normalizeImageAspect("1080p")).toBeNull();
  });
  it("认出来的每一个值都真的在菜单上(不可能返回引擎收不下的形状)", () => {
    for (const raw of ["portrait", "landscape", "square", "9x16", "21:9"]) {
      const v = normalizeImageAspect(raw);
      expect(v).not.toBeNull();
      expect(GEN_IMAGE_MODEL_OPTIONS.seedream.aspectRatios).toContain(v!);
    }
  });
});

describe("genRequest 图片画幅校验(照视频侧 superRefine)", () => {
  const base = { projectId: "p1", prompt: "a poster", count: 1, kind: "image", model: "seedream", idempotencyKey: "k1" };
  it("接受菜单上的每一个画幅", () => {
    for (const a of GEN_IMAGE_MODEL_OPTIONS.seedream.aspectRatios) {
      expect(genRequest.safeParse({ ...base, aspectRatio: a }).success, a).toBe(true);
    }
  });
  it("不带画幅仍然合法(默认 1:1,与今日一致)", () => {
    expect(genRequest.safeParse(base).success).toBe(true);
  });
  it("拒绝菜单外的画幅 —— 引擎收不下的值绝不能到 worker 并扣费", () => {
    expect(genRequest.safeParse({ ...base, aspectRatio: "5:7" }).success).toBe(false);
    expect(genRequest.safeParse({ ...base, aspectRatio: "1080p" }).success).toBe(false);
  });
  it("视频侧画幅校验不受影响(仍按视频模型的选项表)", () => {
    const v = { projectId: "p1", prompt: "a clip", count: 1, kind: "video", model: "seedance-2-mini", idempotencyKey: "k1" };
    expect(genRequest.safeParse({ ...v, aspectRatio: "16:9" }).success).toBe(true);
    // 3:2 在图片菜单里,但视频模型不支持 —— 按 kind 分别校验
    expect(genRequest.safeParse({ ...v, aspectRatio: "3:2" }).success).toBe(false);
  });
});

describe("#777 组图(一次出齐一整组连贯的图)的契约闸", () => {
  const base = { projectId: "p1", prompt: "the same model, four angles", kind: "image", model: "seedream", idempotencyKey: "k1" };

  it("能力位:在册引擎声明得出组图,菜单外的 id 一律 false(「不知道」按「不能」处理)", () => {
    expect(GEN_IMAGE_MODEL_OPTIONS.seedream.coherentSet).toBe(true);
    expect(supportsCoherentSet("seedream")).toBe(true);
    expect(supportsCoherentSet("seedance-2-mini")).toBe(false);
    expect(supportsCoherentSet("nope-not-a-model")).toBe(false);
  });

  it("接受:图片 + 在册引擎 + 至少两张", () => {
    for (let count = COHERENT_SET_MIN_IMAGES; count <= GEN_IMAGE_MODEL_OPTIONS.seedream.maxCount; count++) {
      expect(genRequest.safeParse({ ...base, count, coherentSet: true }).success, `count=${count}`).toBe(true);
    }
  });

  it("缺省 / false 仍然合法,且与今日逐字一致(散图)", () => {
    expect(genRequest.safeParse({ ...base, count: 4 }).success).toBe(true);
    expect(genRequest.safeParse({ ...base, count: 4, coherentSet: false }).success).toBe(true);
    expect(genRequest.safeParse({ ...base, count: 1, coherentSet: false }).success).toBe(true);
  });

  it("拒绝:只要一张 —— 一张图不成组,而它会进材料绑定,一个说了不算数的开关会把合法重试判成换了内容", () => {
    expect(genRequest.safeParse({ ...base, count: 1, coherentSet: true }).success).toBe(false);
  });

  it("拒绝:视频 —— 视频端点没有这个能力,放行就是收了钱做不出承诺的东西", () => {
    const v = { projectId: "p1", prompt: "a clip", count: 1, kind: "video", model: "seedance-2-mini", idempotencyKey: "k1" };
    expect(genRequest.safeParse({ ...v, coherentSet: true }).success).toBe(false);
  });

  it("拒绝:不在册的图片引擎(能力位是唯一的开关)", () => {
    expect(genRequest.safeParse({ ...base, count: 2, model: "made-up-engine", coherentSet: true }).success).toBe(false);
  });

  it("组图与散图共用同一张价目:count 不变,价就不变(收费口径没有第二套)", () => {
    // 这里只钉契约面:请求形状变了,但 count 是价格的唯一乘数,而组图一格都没碰它。
    const set = genRequest.parse({ ...base, count: 4, coherentSet: true });
    const spread = genRequest.parse({ ...base, count: 4 });
    expect(set.count).toBe(spread.count);
  });
});

import { describe, expect, it } from "vitest";
import {
  GEN_VIDEO_MODELS, modelFamily, deriveMode, MODEL_FAMILIES, GEN_MODES, genRequest,
  GEN_IMAGE_ASPECTS, GEN_IMAGE_DEFAULT_ASPECT, GEN_IMAGE_MAX_PIXELS, GEN_IMAGE_MIN_PIXELS,
  GEN_IMAGE_MODEL_OPTIONS, GEN_IMAGE_SIZES, imageDefaults, imageOutputSize, type GenImageAspect,
} from "./gen.js";

describe("modelFamily", () => {
  // every shipping video model resolves to a known family (version-agnostic, by prefix)
  const expected: Record<string, string> = {
    kling: "kling",
    "kling-2.6": "kling",
    "kling-3": "kling",
    "veo3.1-lite": "veo",
    "veo3.1-fast": "veo",
    "veo3.1": "veo",
    "ltx-2": "ltx",
    "seedance-2-fast": "seedance",
    "pixverse-v6": "pixverse",
    "grok-imagine": "grok",
    "wan-2.5": "wan",
    "hailuo-02": "hailuo",
    "seedance-2": "seedance",
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
    expect(modelFamily("kling-4")).toBe("kling");
    expect(modelFamily("veo4")).toBe("veo");
  });
  it("seedream vs seedance disambiguate (both start with 'seed')", () => {
    expect(modelFamily("seedream")).toBe("seedream");
    expect(modelFamily("seedance-2-fast")).toBe("seedance");
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
    model: "seedance-2-fast",
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
    expect(genRequest.safeParse({ ...base, model: "veo3.1-lite", referenceVideoGenerationId: "gen_ref", durationSeconds: 6 }).success).toBe(false);
  });

  it("rejects 10s reference-video output before spend because the 16cr price is modeled for 5s output", () => {
    expect(genRequest.safeParse({ ...base, referenceVideoGenerationId: "gen_ref", durationSeconds: 10 }).success).toBe(false);
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
    for (const a of GEN_IMAGE_MODEL_OPTIONS.seedream.aspectRatios) {
      expect(GEN_IMAGE_SIZES[a as GenImageAspect]).toBeDefined();
    }
    expect(Object.keys(GEN_IMAGE_SIZES).sort()).toEqual([...GEN_IMAGE_ASPECTS].sort());
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
    const v = { projectId: "p1", prompt: "a clip", count: 1, kind: "video", model: "seedance-2-fast", idempotencyKey: "k1" };
    expect(genRequest.safeParse({ ...v, aspectRatio: "16:9" }).success).toBe(true);
    // 3:2 在图片菜单里,但视频模型不支持 —— 按 kind 分别校验
    expect(genRequest.safeParse({ ...v, aspectRatio: "3:2" }).success).toBe(false);
  });
});

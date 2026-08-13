/**
 * asset-understanding.test.ts — #784。
 *
 * 最重要的一条在最上面:**「不到一条视频的 1%」是这里断言的,不是文档声明的。**
 * 谁调宽 token 上限、调高采样帧率、放宽视频时长闸门,这一族用例当场红。
 */
import { describe, it, expect } from "vitest";
import {
  UNDERSTANDING_KINDS,
  UNDERSTANDING_CAPS,
  UNDERSTANDING_JSON_SCHEMAS,
  UNDERSTANDING_PROMPTS,
  UNDERSTANDING_VIDEO_COST_SHARE_CEILING,
  UNDERSTANDING_VIDEO_MAX_SECONDS,
  UNDERSTANDING_VIDEO_SAMPLE_FPS,
  UNDERSTANDING_LOW_DETAIL_TOKENS_PER_FRAME,
  UNDERSTANDING_VIDEO_MAX_INPUT_TOKENS,
  UNDERSTANDING_MAX_PRODUCTS_PER_DOC,
  UNDERSTANDING_MAX_FACTS_PER_VIDEO,
  UNDERSTAND_QUEUE_POLICY,
  UNDERSTANDING_REQUEST_TIMEOUT_MS,
  UNDERSTANDING_FREE_GRANT_TOKENS,
  CHEAPEST_VIDEO_COGS_USD,
  understandingCostShare,
  understandingCostUsd,
  understandingWorstCaseUsd,
  understandingRunsWithinFreeGrant,
  understandingDailyCap,
  understandingDailyCeilingUsdPerOwner,
  assetUnderstandingEnabled,
  understandingKindForMime,
  isUnderstandingKind,
  parseImageCaption,
  parseDocExtract,
  parseVideoQa,
  parseUnderstandingJson,
} from "./asset-understanding.js";
import { SEEDANCE_COGS_USD_PER_SECOND, GEN_VIDEO_SECONDS } from "./gen.js";

describe("产品承诺:一次理解 < 一条视频成本的 1%", () => {
  it("每一个 kind 的最坏情况都在天花板以下", () => {
    for (const kind of UNDERSTANDING_KINDS) {
      expect(understandingCostShare(kind)).toBeLessThan(UNDERSTANDING_VIDEO_COST_SHARE_CEILING);
    }
  });

  it("分母是我们卖得最便宜的那一条视频(最不利的比较)", () => {
    expect(CHEAPEST_VIDEO_COGS_USD).toBe(SEEDANCE_COGS_USD_PER_SECOND["480p"] * GEN_VIDEO_SECONDS);
    // 拿 720p 当分母会让同一份预算显得便宜一倍 —— 断言我们没这么做
    expect(CHEAPEST_VIDEO_COGS_USD).toBeLessThan(SEEDANCE_COGS_USD_PER_SECOND["720p"] * GEN_VIDEO_SECONDS);
  });

  it("视频那一档的输入上限确实由采样口径推出来,而不是另抄一个数", () => {
    expect(UNDERSTANDING_VIDEO_MAX_INPUT_TOKENS).toBe(
      Math.ceil(
        UNDERSTANDING_VIDEO_MAX_SECONDS * UNDERSTANDING_VIDEO_SAMPLE_FPS * UNDERSTANDING_LOW_DETAIL_TOKENS_PER_FRAME,
      ),
    );
    expect(UNDERSTANDING_CAPS["video-qa"].maxInputTokens).toBe(UNDERSTANDING_VIDEO_MAX_INPUT_TOKENS);
  });

  it("整段不抽帧的视频会顶破承诺 —— 这正是抽帧闸门存在的理由", () => {
    // 官方口径:720p 每秒两万多 token。整段送一条 5 秒片的输入成本
    const wholeClipInputTokens = 21_736 * GEN_VIDEO_SECONDS;
    const wholeClipShare =
      understandingCostUsd({ inputTokens: wholeClipInputTokens, outputTokens: 500 }) / CHEAPEST_VIDEO_COGS_USD;
    expect(wholeClipShare).toBeGreaterThan(UNDERSTANDING_VIDEO_COST_SHARE_CEILING);
  });

  it("成本算式对 0 与垃圾输入不炸,也不返回负数", () => {
    expect(understandingCostUsd({ inputTokens: 0, outputTokens: 0 })).toBe(0);
    expect(understandingCostUsd({ inputTokens: -5, outputTokens: Number.NaN })).toBe(0);
  });
});

describe("先烧免费额度", () => {
  it("一份免费额度够跑的趟数是个有意义的正整数", () => {
    for (const kind of UNDERSTANDING_KINDS) {
      const runs = understandingRunsWithinFreeGrant(kind);
      expect(Number.isInteger(runs)).toBe(true);
      expect(runs).toBeGreaterThan(0);
      expect(runs * (UNDERSTANDING_CAPS[kind].maxInputTokens + UNDERSTANDING_CAPS[kind].maxOutputTokens))
        .toBeLessThanOrEqual(UNDERSTANDING_FREE_GRANT_TOKENS);
    }
  });
});

describe("总开关与每租户日额(真正兜住花费的两样)", () => {
  it("缺省是开的", () => {
    expect(assetUnderstandingEnabled({})).toBe(true);
  });

  it("off / 0 / false 都关得掉", () => {
    for (const v of ["off", "OFF", "0", "false", " off "]) {
      expect(assetUnderstandingEnabled({ ASSET_UNDERSTANDING: v })).toBe(false);
    }
  });

  it("日额可调,非法值退回默认(绝不静默变成无限)", () => {
    expect(understandingDailyCap({ ASSET_UNDERSTANDING_DAILY_CAP: "5" })).toBe(5);
    expect(understandingDailyCap({ ASSET_UNDERSTANDING_DAILY_CAP: "0" })).toBe(0); // 0 = 全停,合法
    for (const bad of ["-1", "abc", "1.5", ""]) {
      expect(understandingDailyCap({ ASSET_UNDERSTANDING_DAILY_CAP: bad })).toBe(understandingDailyCap({}));
    }
  });

  it("一个商家一天最多让我们花的钱是个可读的小数目", () => {
    const ceiling = understandingDailyCeilingUsdPerOwner({});
    expect(ceiling).toBeGreaterThan(0);
    // 一整天吃满,也还不到一条视频的钱 —— 这就是「成本 < 视频的 1%」在日额上的样子
    expect(ceiling).toBeLessThan(CHEAPEST_VIDEO_COGS_USD * understandingDailyCap({}));
    expect(understandingDailyCeilingUsdPerOwner({ ASSET_UNDERSTANDING_DAILY_CAP: "0" })).toBe(0);
  });
});

describe("素材 → kind 的路由", () => {
  it("图片进 caption,视频进 video-qa", () => {
    expect(understandingKindForMime("image/jpeg")).toBe("image-caption");
    expect(understandingKindForMime("image/png; charset=binary")).toBe("image-caption");
    expect(understandingKindForMime("video/mp4")).toBe("video-qa");
  });

  it("音频与不认识的类型一律不跑 —— 不猜就是不花钱", () => {
    for (const m of ["audio/mpeg", "application/octet-stream", "", "text/plain"]) {
      expect(understandingKindForMime(m)).toBeNull();
    }
  });

  it("doc-extract 不由 mime 触发(它由 caption 的 isDocument 触发)", () => {
    for (const m of ["image/jpeg", "video/mp4", "application/pdf"]) {
      expect(understandingKindForMime(m)).not.toBe("doc-extract");
    }
  });

  it("kind 判定器只认这三个", () => {
    for (const k of UNDERSTANDING_KINDS) expect(isUnderstandingKind(k)).toBe(true);
    expect(isUnderstandingKind("transcribe")).toBe(false);
  });
});

describe("每个 kind 都有齐 prompt / schema / 上限", () => {
  it("三样都在,输出上限都是正数", () => {
    for (const kind of UNDERSTANDING_KINDS) {
      expect(UNDERSTANDING_PROMPTS[kind].length).toBeGreaterThan(40);
      expect(UNDERSTANDING_JSON_SCHEMAS[kind]).not.toBeNull();
      expect(UNDERSTANDING_CAPS[kind].maxOutputTokens).toBeGreaterThan(0);
    }
  });

  it("白标:配置里一个供应商名字都没有", () => {
    const blob = JSON.stringify({ UNDERSTANDING_PROMPTS, UNDERSTANDING_JSON_SCHEMAS }).toLowerCase();
    // 按词界比对,不按子串:"ark" 是 "marketing" 的一截,子串比对会把一句正常的英文判成泄密
    for (const name of ["byteplus", "bytedance", "seedream", "seedance", "ark", "openai", "anthropic", "claude", "gpt"]) {
      expect(blob).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("prompt 里写死了「看不见就别猜」—— Otto 不替商家预判", () => {
    for (const kind of UNDERSTANDING_KINDS) {
      expect(UNDERSTANDING_PROMPTS[kind].toLowerCase()).toMatch(/never (guess|invent)|only state/);
    }
  });
});

describe("队列策略与时钟", () => {
  it("重试是允许的 —— 这条队列不碰商家余额,重投防重靠唯一约束 + CAS", () => {
    expect(UNDERSTAND_QUEUE_POLICY.retryLimit).toBeGreaterThan(0);
    expect(UNDERSTAND_QUEUE_POLICY.retryBackoff).toBe(true);
    expect(UNDERSTAND_QUEUE_POLICY.retryDelay).toBeGreaterThan(0);
  });

  it("队列过期严格大于一次请求超时(留得下落盘的尾巴)", () => {
    expect(UNDERSTAND_QUEUE_POLICY.expireInSeconds * 1000).toBeGreaterThan(UNDERSTANDING_REQUEST_TIMEOUT_MS);
  });

  it("有死信队列 —— 反复读不出来的素材有地方去", () => {
    expect(UNDERSTAND_QUEUE_POLICY.deadLetter).toBe("understand.dlq");
  });
});

describe("产物清洗:模型不是可信输入", () => {
  it("caption:留住能用的,砍掉超长的,isDocument 只认真正的 true", () => {
    const out = parseImageCaption({
      summary: "x".repeat(500),
      category: "y".repeat(80),
      colors: ["red", "blue", "green", "gold", "silver", "black"],
      scene: "shopfront",
      isDocument: "yes",
    });
    expect(out?.summary.length).toBe(300);
    expect(out?.category?.length).toBe(40);
    expect(out?.colors?.length).toBe(4);
    expect(out?.isDocument).toBe(false); // 字符串 "yes" 不是 true
  });

  it("caption:没有 summary 就是解析失败", () => {
    expect(parseImageCaption({ isDocument: true })).toBeNull();
    expect(parseImageCaption({ summary: "   ", isDocument: true })).toBeNull();
    expect(parseImageCaption(null)).toBeNull();
    expect(parseImageCaption("a menu")).toBeNull();
  });

  it("doc:无名产品行直接丢,条数封顶", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ name: `Item ${i}`, price: "RM 5" }));
    const out = parseDocExtract({ products: [...many, { price: "RM 9" }, null, "nope"] });
    expect(out?.products.length).toBe(UNDERSTANDING_MAX_PRODUCTS_PER_DOC);
    expect(out?.products.every((p) => p.name)).toBe(true);
  });

  it("doc:空清单是**合法**结果(读不出来就不猜),不是解析失败", () => {
    expect(parseDocExtract({ products: [] })).toEqual({ products: [] });
  });

  it("doc:形状不对才是解析失败 —— 兜底要有东西可兜", () => {
    expect(parseDocExtract({ items: [] })).toBeNull();
    expect(parseDocExtract("Nasi Lemak RM 5")).toBeNull();
    expect(parseDocExtract(null)).toBeNull();
  });

  it("video:facts 封顶,缺 facts 退成空数组", () => {
    const out = parseVideoQa({ summary: "A small cafe", facts: Array.from({ length: 20 }, (_, i) => `f${i}`) });
    expect(out?.facts.length).toBe(UNDERSTANDING_MAX_FACTS_PER_VIDEO);
    expect(parseVideoQa({ summary: "A small cafe" })?.facts).toEqual([]);
    expect(parseVideoQa({ facts: ["a"] })).toBeNull();
  });

  it("JSON 解析剥得掉围栏与前后废话,坏 JSON 返回 null", () => {
    expect(parseUnderstandingJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseUnderstandingJson('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
    expect(parseUnderstandingJson("not json at all")).toBeNull();
    expect(parseUnderstandingJson("")).toBeNull();
    expect(parseUnderstandingJson("[1,2,3]")).toBeNull(); // 顶层必须是对象
  });
});

describe("最坏情况成本本身", () => {
  it("三个 kind 的最坏情况都是正数,且 doc 比 caption 贵(它要读满一整页)", () => {
    for (const kind of UNDERSTANDING_KINDS) expect(understandingWorstCaseUsd(kind)).toBeGreaterThan(0);
    expect(understandingWorstCaseUsd("doc-extract")).toBeGreaterThan(understandingWorstCaseUsd("image-caption"));
  });
});

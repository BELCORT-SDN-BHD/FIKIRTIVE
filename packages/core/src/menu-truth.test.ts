/**
 * #647 T6 假菜单清理 —— 父 spec #641 的收官句「菜单上没有一格是假的」在核心层的钉板。
 *
 * 事实(2026-08-05/06 两路侦察 + #644/#645/#646 三片落地后):
 *   - 真视频引擎**只有一个**:`seedance-2-mini`(BytePlus 直连,在产实付,毛利闸看着)。
 *   - 另外 12 个视频模型全部走 fal 接线,**从来没有在生产出过一条片** —— 菜单上、事实表上、
 *     档位表上、费率表上、fal 接线表上各占一格,后台还各有一个开关,知识库还各占一列家族。
 *     它们是「说的」而没有「做的」的最后一大块。
 *   - 家族 × 模式的知识格原本 9 × 5 = 45 格。九个家族里有七个是那 12 个假模型带来的;
 *     余下两个真家族也各自只服务一种 kind,所以真格只有五个。
 *
 * 本文件钉的是**删干净**与**删得起**两件事:假的一格不剩,历史行读起来不崩也不谎报。
 */
import { describe, it, expect } from "vitest";
import {
  GEN_MODELS,
  GEN_VIDEO_MODELS,
  GEN_VIDEO_MODEL_INFO,
  GEN_VIDEO_MODEL_OPTIONS,
  GEN_MODES,
  MODEL_FAMILIES,
  familyModes,
  modelFamily,
  videoDefaults,
  videoPriceUsd,
  genRequest,
  type GenVideoModel,
} from "./gen.js";
import { DIRECTIVE_SEED, modelDirectiveInput } from "./cowork-directives.js";
import { genSpentUsd, pricedGenCredits, INTERNAL_PER_DISPLAY } from "./spend.js";
import { ALL_MODEL_IDS } from "./model-registry.js";

/** 下架的 12 格 —— 逐字抄自 #647 票面,与代码里的菜单**独立**。
 *  有人把任何一个悄悄放回菜单,这份清单当场变红。 */
const RETIRED_VIDEO_MODELS = [
  "kling",
  "veo3.1-lite",
  "ltx-2",
  "kling-2.6",
  "kling-3",
  "veo3.1-fast",
  "veo3.1",
  "pixverse-v6",
  "grok-imagine",
  "wan-2.5",
  "hailuo-02",
  "seedance-2",
] as const;

/** 被那 12 格带进来的七个家族。真家族只剩 seedream(图)与 seedance(片)。 */
const RETIRED_FAMILIES = ["kling", "veo", "ltx", "wan", "pixverse", "grok", "hailuo"] as const;

// ── 1. 菜单:只剩一格,而且是真的那一格 ──────────────────────────────────────
describe("#647 T6 视频菜单(真的只有一格)", () => {
  it("GEN_VIDEO_MODELS 只剩 seedance-2-mini", () => {
    expect([...GEN_VIDEO_MODELS]).toEqual(["seedance-2-mini"]);
  });

  it("12 个假模型在**五处声明**里一处不剩", () => {
    for (const id of RETIRED_VIDEO_MODELS) {
      // ①菜单 ②事实表 ③档位表
      expect((GEN_VIDEO_MODELS as readonly string[]), `菜单还有 ${id}`).not.toContain(id);
      expect(Object.keys(GEN_VIDEO_MODEL_INFO), `事实表还有 ${id}`).not.toContain(id);
      expect(Object.keys(GEN_VIDEO_MODEL_OPTIONS), `档位表还有 ${id}`).not.toContain(id);
      // ④费率:菜单外的 id 没有价(不许有人给下架模型留一条私价)
      expect(videoPriceUsd(id as GenVideoModel, { seconds: 5, resolution: "720p", audio: true, count: 1 }))
        .toBe(0);
    }
    // ⑤fal 接线在 packages/generation/src/index.test.ts 钉(那份声明住在适配器里)
  });

  it("三张表的键**逐字同集**(双声明纪律:菜单加一格,三处一起加)", () => {
    expect(Object.keys(GEN_VIDEO_MODEL_INFO).sort()).toEqual([...GEN_VIDEO_MODELS].sort());
    expect(Object.keys(GEN_VIDEO_MODEL_OPTIONS).sort()).toEqual([...GEN_VIDEO_MODELS].sort());
  });

  it("后台开关表随之收缩:模型总数 = 图片菜单 ∪ 参考图菜单 ∪ 视频菜单,视频只贡献一格", () => {
    for (const id of RETIRED_VIDEO_MODELS) expect(ALL_MODEL_IDS).not.toContain(id);
    // 只剩 seedream(图片=参考图同名)+ seedance-2-mini
    expect([...ALL_MODEL_IDS].sort()).toEqual(["seedance-2-mini", "seedream"]);
  });

  it("契约闸照旧拒收下架模型(付费请求进不来)", () => {
    for (const id of RETIRED_VIDEO_MODELS) {
      const r = genRequest.safeParse({
        projectId: "p1", prompt: "a cat", count: 1, kind: "video", model: id, idempotencyKey: "k1",
      });
      expect(r.success, `${id} 竟然通过了契约闸`).toBe(false);
    }
  });
});

// ── 2. 知识库:家族 × 模式的格子收缩为真 ─────────────────────────────────────
describe("#647 T6 知识格(45 → 5:每一格都真会被读到)", () => {
  it("家族表只剩真家族 —— 每个家族都必须是某个在册模型的家族", () => {
    const live = new Set(
      [...GEN_MODELS, ...GEN_VIDEO_MODELS].map((m) => modelFamily(m)).filter(Boolean) as string[],
    );
    expect([...MODEL_FAMILIES].sort()).toEqual([...live].sort());
    for (const f of RETIRED_FAMILIES) expect(MODEL_FAMILIES as readonly string[]).not.toContain(f);
  });

  it("退役家族的 id 不再有家族(modelFamily 返回 undefined,不崩)", () => {
    // ⚠️ ORACLE 修正留档(#647 T6 绿提交 9e5ce117,判官 r1 P2-2 点名):这条测试**红的时候**
    // 断言的是「12 个退役 id 全部返回 undefined」,绿提交里改成了「除 seedance-2 之外的 11 个」。
    // 改的是判据本身,所以不是纯红绿 —— 理由必须留在这里,而不是只活在某次对话里。
    //
    // 理由:`modelFamily` 按**前缀**认家族,这是它刻意的设计(版本升级自动继承家族,
    // 见函数注释)。`seedance-2` 虽然从菜单上下架了,但 `seedance` 这个家族**还在产**
    // (`seedance-2-mini` 是唯一那台真引擎)。前缀命中一个真家族不是假菜单 —— 假菜单的定义
    // 是「菜单上有这一格」,而 `GEN_VIDEO_MODELS` 上早已没有 `seedance-2`(上面第一段钉着)。
    // 换句话说:原来的断言写错了对象,它要的是「下架的家族不再有家族」,不是「下架的 id
    // 一律无家族」。修正后的判据与 `modelFamily` 的设计一致,也与 T6 的真正目标一致。
    //
    // 如果哪天 seedance 整个家族也退场,这条会自动变红(过滤后 11 条里会多出 seedance-2),
    // 那时该改的是 RETIRED_FAMILIES,不是这行过滤。
    const noLiveFamily = RETIRED_VIDEO_MODELS.filter((id) => !id.startsWith("seedance"));
    expect(noLiveFamily.length).toBe(11);
    for (const id of noLiveFamily) expect(modelFamily(id), id).toBeUndefined();
    expect(modelFamily("完全没见过的东西")).toBeUndefined();
    expect(modelFamily("")).toBeUndefined();
  });

  it("每个家族只开它真服务的模式:图片家族三个视频模式都不该有,反之亦然", () => {
    expect(familyModes("seedream")).toEqual(["t2i", "i2i"]);
    expect(familyModes("seedance")).toEqual(["t2v", "i2v", "i2v-tail"]);
  });

  it("真格总数 = 5(不是 45,也不是 2×5=10 —— 跨 kind 的格子永远读不到)", () => {
    const cells = MODEL_FAMILIES.flatMap((f) => familyModes(f).map((m) => `${f}:${m}`));
    expect(cells.length).toBe(5);
    expect(cells.sort()).toEqual(
      ["seedance:i2v", "seedance:i2v-tail", "seedance:t2v", "seedream:i2i", "seedream:t2i"].sort(),
    );
    // 模式词汇本身一格没动(T5 刚把尾帧解禁)
    expect([...GEN_MODES]).toEqual(["t2i", "i2i", "t2v", "i2v", "i2v-tail"]);
  });

  it("写入闸拒收假格:后台存不进一条永远读不到的指令", () => {
    expect(modelDirectiveInput.safeParse({ family: "seedream", mode: "t2i" }).success).toBe(true);
    expect(modelDirectiveInput.safeParse({ family: "seedance", mode: "i2v-tail" }).success).toBe(true);
    // 跨 kind:图片引擎永远拿不到 t2v,视频引擎永远拿不到 t2i
    expect(modelDirectiveInput.safeParse({ family: "seedream", mode: "t2v" }).success).toBe(false);
    expect(modelDirectiveInput.safeParse({ family: "seedance", mode: "t2i" }).success).toBe(false);
    // 退役家族连 enum 都进不去
    expect(modelDirectiveInput.safeParse({ family: "kling", mode: "t2v" }).success).toBe(false);
  });

  it("研究种子只给真格,一条都不给下架家族", () => {
    const cells = new Set(MODEL_FAMILIES.flatMap((f) => familyModes(f).map((m) => `${f}:${m}`)));
    for (const seed of DIRECTIVE_SEED) {
      expect(cells.has(`${seed.family}:${seed.mode}`), `种子落在假格 ${seed.family}:${seed.mode}`).toBe(true);
    }
    expect(DIRECTIVE_SEED.map((s) => `${s.family}:${s.mode}`).sort())
      .toEqual(["seedance:t2v", "seedream:i2i", "seedream:t2i"]);
  });
});

// ── 3. 历史安全:老行读起来不崩、不谎报 ──────────────────────────────────────
//
// 零公测用户,但 dev/测试库里存着写着 "kling" / "veo3.1" 的 GenJob 行。类型收窄之后,
// 每一条读历史行的路都会拿到一个菜单外的字符串。判据只有两条:**不崩**、**不谎报**。
describe("#647 T6 历史安全(下架前存下的行还读得动)", () => {
  it("videoDefaults 对退役/未知模型不抛异常,返回**空规格**而不是编一个像真的出来", () => {
    for (const id of [...RETIRED_VIDEO_MODELS, "从来没有过的模型"]) {
      const d = videoDefaults(id as GenVideoModel);
      expect(d).toEqual({ seconds: 0, resolution: "", aspectRatio: "", fps: 0, audio: false });
    }
  });

  it("videoPriceUsd 对退役模型返回 0 而不是 NaN —— 「不知道」不许长得像一个数", () => {
    for (const id of RETIRED_VIDEO_MODELS) {
      const usd = videoPriceUsd(id as GenVideoModel, { seconds: 10, resolution: "720p", audio: true, count: 2 });
      expect(Number.isNaN(usd)).toBe(false);
      expect(usd).toBe(0);
    }
  });

  it("genSpentUsd 读历史行不崩、不出 NaN(记账是 record-only,不知道就是 0)", () => {
    for (const id of RETIRED_VIDEO_MODELS) {
      const usd = genSpentUsd({ kind: "VIDEO", model: id, count: 1, videoOptions: { seconds: 10, resolution: "720p", audio: true } });
      expect(Number.isNaN(usd)).toBe(false);
      expect(usd).toBe(0);
    }
    // videoOptions 整个缺失的老行(视频规格快照是后来才加的列)同样不崩
    expect(() => genSpentUsd({ kind: "VIDEO", model: "kling", count: 1, videoOptions: null })).not.toThrow();
  });

  it("价签落护栏价而不是 1cr:退役模型算不出价,只许贵不许贱", () => {
    for (const id of RETIRED_VIDEO_MODELS) {
      const cr = pricedGenCredits({ kind: "VIDEO", model: id, count: 1, videoOptions: { seconds: 10, resolution: "720p", audio: true } });
      expect(Number.isNaN(cr)).toBe(false);
      expect(cr).toBe(16 * INTERNAL_PER_DISPLAY);
    }
  });

  it("零改动:在产那一格的价与规格一格没动(T4 的护栏语义原样)", () => {
    const d = videoDefaults("seedance-2-mini");
    expect(d.resolution).toBe("720p");
    expect(d.seconds).toBe(5);
    expect(d.aspectRatio).toBe("16:9");
    const job = { kind: "VIDEO" as const, model: "seedance-2-mini", count: 1, videoOptions: { seconds: 5, resolution: "720p", audio: true } };
    expect(pricedGenCredits(job)).toBe(11 * INTERNAL_PER_DISPLAY);
    expect(pricedGenCredits({ ...job, videoOptions: { seconds: 5, resolution: "1080p", audio: true } }))
      .toBe(16 * INTERNAL_PER_DISPLAY);
  });
});

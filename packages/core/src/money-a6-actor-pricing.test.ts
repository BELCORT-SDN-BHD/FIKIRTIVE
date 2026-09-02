/**
 * MONEY-A6 —— **演员不加钱**(规格 docs/specs/money-engine.md §2 验收表 / §7.7)。
 *
 * 验收表原文:「商家用演员库角色出一条视频,再用同参数(同时长同分辨率)出一条不带演员的
 * ⇒ 两次报价逐字相等;消费历史不存在『演员费』行」。
 *
 * ── 为什么这条锚值得单独立在 core 层 ──────────────────────────────────────────
 * 今天它是**真的**:`GenSpendInput` 这个报价输入里根本没有演员那一维,所以「同参数」的两条
 * 视频算出来的数必然相同。这条用例钉的不是「现在对不对」,是「以后别人改坏了会不会有人知道」 ——
 * 而这一格恰恰是最容易被悄悄改坏的:Arcads 约 $110/月只给 10 条演员视频、HeyGen 给数字人
 * 溢价,行业惯例就是给"人"加价,所以「顺手给演员加一点」是一个会自己冒出来的想法。
 * Founder 2026-08-31 拍板反着打:**不加价,当卖点**——依据是参考图输入零计费的实测回执
 * (成片账单 prompt_tokens=0,`preserved/creation-probe-2026-08-29/`),成本上站得住。
 *
 * 所以本文件钉两件事,一件行为一件结构:
 *   ① **同参数两次报价逐字相等**,并且**多带一份素材也一格不变** —— 演员在引擎那边是
 *      一张参考图,而参考图不在成本公式里(`(参考视频秒数 + 出片秒数) × 像素 × 帧率`)。
 *   ② **报价输入的形状里没有演员那一维**:`pricedGenCredits` 只读 kind/model/count/
 *      videoOptions/referenceVideoGenerationId 五个字段。哪天有人要加演员费,他必须先往
 *      这个输入里加一个字段 —— 而那时这条用例会指着他说:这需要 Founder 先裁价。
 *
 * 真库那一侧的同一件事(预扣与结算也逐格相同)已经在
 * `apps/web/lib/__tests__/gen-ledger.test.ts` 的 #785 用例里跑着,本文件不重复它。
 */
import { describe, it, expect } from "vitest";
import { INTERNAL_PER_DISPLAY, genSpentUsd, pricedGenCredits, type GenSpendInput } from "./spend.js";

/** 一条"同参数"的视频单。演员/产品图/logo 这些 @元素**不在这个类型里** —— 那正是本文件的论点。 */
function videoJob(over: Partial<GenSpendInput> = {}): GenSpendInput {
  return {
    kind: "VIDEO",
    model: "seedance-2-mini",
    count: 1,
    referenceVideoGenerationId: null,
    videoOptions: { seconds: 5, resolution: "720p" },
    ...over,
  };
}

describe("MONEY-A6 — 演员出镜不加价:同参数两次报价逐字相等", () => {
  it("MONEY-A6:带演员与不带演员,同时长同分辨率 ⇒ 同一个数(逐字相等,不是「接近」)", () => {
    // 「带演员」在下单那一侧的形状是 entityIds 多了一个演员实体;它到不了报价这一层,
    // 所以两边喂进来的就是**同一个** GenSpendInput —— 这本身就是结论的一半。
    const withActor = pricedGenCredits(videoJob());
    const withoutActor = pricedGenCredits(videoJob());
    expect(withActor).toBe(withoutActor);
    expect(withActor).toBeGreaterThan(0); // 不是两个 0 在互相印证
  });

  it("MONEY-A6:每一个可售档都逐字相等 —— 不是只在默认那一格上对", () => {
    for (const resolution of ["480p", "720p", "1080p"]) {
      for (const seconds of [5, 10, 15]) {
        const a = pricedGenCredits(videoJob({ videoOptions: { seconds, resolution } }));
        const b = pricedGenCredits(videoJob({ videoOptions: { seconds, resolution } }));
        expect(a, `${resolution}/${seconds}s 两次报价不一致`).toBe(b);
      }
    }
  });

  it("MONEY-A6:多带几份 @素材(演员脸、产品图、logo)一格不改 —— 参考图不在成本公式里", () => {
    const bare = videoJob();
    // 把下单那一侧真实存在的素材字段硬塞进报价输入:哪天有人开始读它们,这条会红。
    const loaded = { ...bare, entityIds: ["ent_actor", "ent_product", "ent_logo"], referenceImageIds: ["ri_1", "ri_2"] } as GenSpendInput;
    expect(pricedGenCredits(loaded)).toBe(pricedGenCredits(bare));
    expect(genSpentUsd(loaded)).toBe(genSpentUsd(bare)); // 记账那一侧同样不看
  });

  it("MONEY-A6:图片单同理 —— 只按张数,不按「这张里有没有人」", () => {
    const plain: GenSpendInput = { kind: "IMAGE", model: "seedream", count: 3, referenceVideoGenerationId: null, videoOptions: null };
    const withActor = { ...plain, entityIds: ["ent_actor"] } as GenSpendInput;
    expect(pricedGenCredits(withActor)).toBe(pricedGenCredits(plain));
    expect(pricedGenCredits(plain) % INTERNAL_PER_DISPLAY).toBe(0); // 按整显示格,没有「半张脸费」
  });

  it("MONEY-A6:报价输入里没有演员那一维 —— 加演员费必须先改这个形状(于是必须先裁价)", () => {
    // 一份「演员费会长在哪里」的词表。它不是措辞洁癖:这五个词是行业里给人加价时用的名字,
    // 而报价输入一旦多出其中任何一个字段,就意味着有人在没有裁价的情况下动了价格法。
    const forbidden = ["actor", "person", "face", "talent", "avatar"];
    const shape = Object.keys(videoJob());
    for (const key of shape) {
      for (const word of forbidden) {
        expect(
          key.toLowerCase().includes(word),
          `GenSpendInput 多出了一个 "${key}" 字段 —— 报价开始看「有没有人」了。` +
            `Founder 2026-08-31 拍板「不加价,当卖点」(依据:参考图输入零计费有实测回执),` +
            `所以这是一个必须先经 Founder 裁价的改动,不是一次实现细节。`,
        ).toBe(false);
      }
    }
    // 形状本身也钉住:五个字段,一个不多。
    expect(shape.sort()).toEqual(["count", "kind", "model", "referenceVideoGenerationId", "videoOptions"]);
  });
});

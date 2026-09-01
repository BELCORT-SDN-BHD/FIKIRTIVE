/**
 * 钱引擎 S2 §7.3 —— **素材理解计费面**的定价验收(MONEY-A9 地基层)。
 *
 * 背景一句话:理解(看图 / 读文档 / 看视频)从前是平台自费、商家零触点;Founder
 * 2026-08-31 裁决「就是用户使用照算」,它**已经**变成一个真正的计费面 —— 每一件新上传的
 * 图片和视频在建行那一刻就锁价,免费只剩 A9 迁移之前的存量老行。于是它第一次需要一个价,
 * 而这个文件钉的就是那个价的**来源**:
 *   ① 三类各收 1 internal credit(= $0.01 = 0.1 显示 credit)/件;
 *   ② 那个 1 不是抄来的 —— 它是 65% 定价法对「最坏成本」算出来再向上取整的结果;
 *   ③ 最坏成本本身也不是抄来的 —— token 上限 × 成本钉点;
 *   ④ 改钉点,价真的会动(不是一句承诺,下面有一个把成本乘 10 的演示);
 *   ⑤ 三类都进了毛利真相表,并且清得了地板。
 *
 * 与 `money-derivation.test.ts` 的分工完全一致:那边钉生成侧的推导,这边钉理解档的推导。
 * 本文件**不测**钱路接线(reserve/settle、快照写入、暂停态)—— 那是 worker 侧的验收,
 * 在 `apps/worker/src/jobs/understand.test.ts` 的「MONEY-A9」三组(A9 已转正,不再是占位)。
 */
import { describe, it, expect } from "vitest";
import {
  CREDITS_PER_USD,
  GEN_MARGIN_TARGET,
  UNDERSTANDING_PRICED_INTERNAL,
  deriveUsageInternalCredits,
  pricedUnderstandingCredits,
} from "./spend.js";
import { UNDERSTANDING_KINDS, understandingWorstCaseUsd } from "./asset-understanding.js";
import { marginTruthTable } from "./margin-truth.js";

describe("MONEY-A9 素材理解定价:三类各 1 internal credit,而且那个 1 是算出来的", () => {
  it("三类现值各 1 internal credit/件,且报价函数与价目表是同一个数", () => {
    // 现值锚。1 internal = $0.01 = 0.1 显示 credit —— 规格 §7.3 的「三类各≈1 internal」。
    for (const kind of UNDERSTANDING_KINDS) {
      expect(pricedUnderstandingCredits(kind), `${kind} 的按件价`).toBe(1);
      expect(pricedUnderstandingCredits(kind)).toBe(UNDERSTANDING_PRICED_INTERNAL[kind]);
    }
    expect(Object.keys(UNDERSTANDING_PRICED_INTERNAL).sort()).toEqual([...UNDERSTANDING_KINDS].sort());
  });

  it("推导同源:价目表逐格 = 65% 公式对该类最坏成本的结果(全仓没有第二份手抄价)", () => {
    // 这一条是 A1 那条纪律在理解档上的样子:价目表不许是一张手抄的表,它必须**等于**
    // 现算的结果。手抄一份,供应商涨价时就没有任何机器会告诉我们卖亏了。
    for (const kind of UNDERSTANDING_KINDS) {
      expect(UNDERSTANDING_PRICED_INTERNAL[kind], `${kind} 必须与公式同源`).toBe(
        deriveUsageInternalCredits(understandingWorstCaseUsd(kind)),
      );
    }
  });

  it("最坏成本锚:看图 $0.00128 / 读文档 $0.00160 / 看视频 $0.00140(token 上限 × 钉点)", () => {
    // 毛利闸那边手抄的是同样这三个数(scripts/check-margin-floor.mjs 的 COGS_INPUTS),
    // 两边对不上 = assertCogsAgreement 红。这里钉的是**核心侧**那一个证人。
    expect(understandingWorstCaseUsd("image-caption")).toBeCloseTo(0.00128, 10);
    expect(understandingWorstCaseUsd("doc-extract")).toBeCloseTo(0.0016, 10);
    expect(understandingWorstCaseUsd("video-qa")).toBeCloseTo(0.0014, 10);
  });

  it("65% 语义成立:每一类的面值毛利率都不低于目标线", () => {
    // 「不低于」而不是「等于」:向上取整必然把毛利抬上去(1 internal 是能收的最小一格),
    // 三类实际落在 84%–88%。要守的是**不许落到目标线之下**,那才是定价法的内容。
    for (const kind of UNDERSTANDING_KINDS) {
      const priceUsd = pricedUnderstandingCredits(kind) / CREDITS_PER_USD;
      const costUsd = understandingWorstCaseUsd(kind);
      const margin = (priceUsd - costUsd) / priceUsd;
      expect(margin, `${kind} 毛利率 ${(margin * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(GEN_MARGIN_TARGET - 1e-9);
    }
  });

  it("改钉点价就动:成本涨 10 倍,公式价从 1 变 4(不是一句承诺,是一次演算)", () => {
    // 0.00128 × 10 = $0.0128 一件 → 0.0128 / 0.35 × 100 = 3.657… internal → 向上取整 = 4。
    // 这一条演示的是「成本是输入、价格是输出」:钉点动,价当场跟着动,没有人手抄的中间站。
    expect(deriveUsageInternalCredits(0.00128 * 10)).toBe(4);
    // 同一条公式对现值仍是 1 —— 上面那个 4 不是把规则改松了。
    expect(deriveUsageInternalCredits(0.00128)).toBe(1);
  });

  it("三类都在毛利真相表里,而且都清得了地板", () => {
    // 理解 2026-09-01 之前从没被毛利表量过(它当时不收钱)。开始收钱却不在表上,
    // 就是「一个从来没被闸看过的付费面」—— 那正是 M1-c 修过一次的病。
    const rows = marginTruthTable();
    for (const kind of UNDERSTANDING_KINDS) {
      const row = rows.find((r) => r.id === `understanding:${kind}`);
      expect(row, `毛利表必须有 understanding:${kind}`).toBeDefined();
      expect(row!.clearsFloor, `understanding:${kind} 毛利率 ${(row!.margin * 100).toFixed(1)}%`).toBe(true);
    }
  });
});

import { describe, it, expect } from "vitest";
import {
  MARGIN_FLOOR,
  MARGIN_TRUTH_SKUS,
  BELOW_FLOOR_PENDING_FOUNDER_RULING,
  pendingRulingFor,
  marginTruthTable,
  formatMarginTruthTable,
} from "./margin-truth.js";

/**
 * #644 T3 —— **测试即报表**。
 *
 * 这个文件里的每个数字都是「现在真的收多少 / 真的花多少」算出来的:收费来自
 * `pricedGenCredits`(商家真被扣的那一个值),成本来自 `genSpentUsd`(记账基准)。
 * 任何一边动一格,下面的断言立刻变红 —— 毛利就再也不可能被悄悄改掉。
 *
 * 报表本体在 `formatMarginTruthTable`,跑测试就会打印出来(见文件末的 it)。
 */
describe("#644 毛利真相表(修正后 COGS × 现行收费)", () => {
  const rows = new Map(marginTruthTable().map((r) => [r.id, r]));
  const row = (id: string) => {
    const r = rows.get(id);
    expect(r, `毛利表缺少档位 ${id}`).toBeDefined();
    return r!;
  };

  it("图片 1 张:收 1cr = $0.10,成本 $0.035,毛利 $0.065 = 65.0%", () => {
    const r = row("image:seedream");
    expect(r.chargeUsd).toBeCloseTo(0.1, 6);
    expect(r.cogsUsd).toBeCloseTo(0.035, 6);
    expect(r.grossUsd).toBeCloseTo(0.065, 6);
    expect(r.margin).toBeCloseTo(0.65, 4);
    expect(r.clearsFloor).toBe(true);
  });

  it("参考图 1 张:收 1cr = $0.10,成本 $0.035,毛利 $0.065 = 65.0%", () => {
    const r = row("refgen:seedream");
    expect(r.chargeUsd).toBeCloseTo(0.1, 6);
    expect(r.cogsUsd).toBeCloseTo(0.035, 6);
    expect(r.grossUsd).toBeCloseTo(0.065, 6);
    expect(r.margin).toBeCloseTo(0.65, 4);
    expect(r.clearsFloor).toBe(true);
  });

  it("720p 5s:收 8cr = $0.80,成本 $0.6048,毛利 $0.1952 = 24.4% —— 跌破 45% 地板", () => {
    const r = row("video:seedance-2-fast:5:720p");
    expect(r.chargeUsd).toBeCloseTo(0.8, 6);
    expect(r.cogsUsd).toBeCloseTo(0.6048, 6);
    expect(r.grossUsd).toBeCloseTo(0.1952, 6);
    expect(r.margin).toBeCloseTo(0.244, 4);
    expect(r.clearsFloor).toBe(false);
  });

  it("720p 10s:收 14cr = $1.40,成本 $1.2096,毛利 $0.1904 = 13.6% —— 跌破 45% 地板", () => {
    const r = row("video:seedance-2-fast:10:720p");
    expect(r.chargeUsd).toBeCloseTo(1.4, 6);
    expect(r.cogsUsd).toBeCloseTo(1.2096, 6);
    expect(r.grossUsd).toBeCloseTo(0.1904, 6);
    expect(r.margin).toBeCloseTo(0.136, 4);
    expect(r.clearsFloor).toBe(false);
  });

  it("整段参考视频(6s 参考上限 + 5s 出片):收 16cr = $1.60,成本 $0.78408,毛利 $0.81592 = 51.0%", () => {
    const r = row("video:seedance-2-fast:ref");
    expect(r.chargeUsd).toBeCloseTo(1.6, 6);
    expect(r.cogsUsd).toBeCloseTo(0.78408, 6);
    expect(r.grossUsd).toBeCloseTo(0.81592, 6);
    expect(r.margin).toBeCloseTo(0.50995, 4);
    // 含视频输入走 $3.30/M(低于无视频输入的 $5.60/M),所以修正后这一档反而**变好**了。
    expect(r.clearsFloor).toBe(true);
  });

  it("没有一档是负毛利(收费低于成本 = 卖一单亏一单,必须当场发现)", () => {
    for (const r of marginTruthTable()) {
      expect(r.grossUsd, `${r.id} 收 $${r.chargeUsd} 成本 $${r.cogsUsd} —— 收费低于成本`).toBeGreaterThan(0);
    }
  });

  it("跌破地板的档位 = 待 Founder 裁决名单,一格不多一格不少", () => {
    const belowFloor = marginTruthTable().filter((r) => !r.clearsFloor).map((r) => r.id).sort();
    expect(belowFloor).toEqual(BELOW_FLOOR_PENDING_FOUNDER_RULING.map((p) => p.tier).sort());
  });

  it("待裁决名单的每一条都带齐「为什么 / 谁在裁 / 什么时候必须裁完」—— 裸 id = 永久豁免", () => {
    expect(BELOW_FLOOR_PENDING_FOUNDER_RULING.length).toBeGreaterThan(0);
    for (const entry of BELOW_FLOOR_PENDING_FOUNDER_RULING) {
      // 指向真实存在的档位(名单不能烂成指向空气)。
      expect(rows.has(entry.tier), `${entry.tier} 不是毛利表里的档位`).toBe(true);
      expect(pendingRulingFor(entry.tier)).toEqual(entry);
      // 逐档理由,不是复制的全局套话。
      expect(entry.reason.trim().length, `${entry.tier} 缺逐档理由`).toBeGreaterThan(20);
      expect(entry.rulingRef, `${entry.tier} 缺裁决引用`).toMatch(/^https:\/\/github\.com\//);
      // 到期日必须是真日期 —— CI 闸过了这天就变红,逼裁决发生。
      expect(entry.reviewBy, `${entry.tier} 的 reviewBy 格式不对`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(entry.reviewBy)), `${entry.tier} 的 reviewBy 不是真日期`).toBe(false);
    }
  });

  it("不在名单上的档位查不到裁决记录", () => {
    expect(pendingRulingFor("image:seedream")).toBeUndefined();
    expect(pendingRulingFor("video:ghost:99:8k")).toBeUndefined();
  });

  it("真相表覆盖了 SKU 清单里的每一档(报表不能悄悄漏掉一行)", () => {
    expect(marginTruthTable().map((r) => r.id)).toEqual(MARGIN_TRUTH_SKUS.map((s) => s.id));
    expect(MARGIN_FLOOR).toBe(0.45);
  });

  it("打印毛利真相表(报表本体)", () => {
    const report = formatMarginTruthTable(marginTruthTable());
    console.log(`\n${report}\n`);
    expect(report).toContain("13.6%");
  });
});

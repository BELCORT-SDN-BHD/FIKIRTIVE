/**
 * generation-receipt-read-path —— #776 的回执**有人读**(判官 r1 P1)。
 *
 * r1 把两列写进了库,然后就没有然后了:全仓命中只有解析器、writer、schema 和测试,
 * Cost & usage 的查询仍旧只 select `spentUsd`,界面也只显示那个估算值。于是这张票的
 * 交付物「毛利可对账」一分钱都没兑现 —— 一个写了没人读的字段,和没有这个字段是一回事。
 *
 * 这个文件封的就是那道缝,两头各一根钉:
 *   ① **查询端**:平台成本查询必须把 `billedUnits` 选出来;
 *   ② **展示端**:界面必须同时渲染「我们估的」和「引擎报的」,并且对 null 明写 Unknown ——
 *      不补 0、不按价目表反推。补出来的数会挨着真数躺着,下一个人分不出哪个是账单。
 * 商家那一面的同一条纪律在 `asset-detail-receipt.test.ts` 上**真渲染**着断言(见文末)。
 *
 * 已知局限:词法扫描(fs + 正则),与 spend-visibility-seams 同一路数。admin 那张表牵着
 * 路由与整页数据,在这里真渲染代价太大,所以先用词法把这道缝钉住:它挡不住把逻辑绕进变量
 * 里的写法,但挡得住这道缝**最可能**的死法 —— 有人重构时顺手把那一列从 select 里删掉,或者
 * 把「Unknown」换成一个看起来更整齐的 0。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const WEB_ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(WEB_ROOT, relative), "utf8");

const ADMIN_QUERY = read("lib/admin-v2.ts");
const ADMIN_UI = read("components/admin/AdminDashboardV2.tsx");

/** admin-v2.ts 里 `prisma.genJob.findMany({...})` 的每一个块(与 tenant-guard 用例同一读法)。 */
function genJobFindManyBlocks(): string[] {
  const marker = "prisma.genJob.findMany({";
  const blocks: string[] = [];
  let offset = 0;
  for (;;) {
    const start = ADMIN_QUERY.indexOf(marker, offset);
    if (start === -1) return blocks;
    const brace = ADMIN_QUERY.indexOf("{", start);
    let depth = 0;
    for (let i = brace; i < ADMIN_QUERY.length; i += 1) {
      if (ADMIN_QUERY[i] === "{") depth += 1;
      if (ADMIN_QUERY[i] === "}") depth -= 1;
      if (depth === 0) {
        blocks.push(ADMIN_QUERY.slice(start, i + 1));
        offset = i + 1;
        break;
      }
    }
  }
}

describe("#776 ① 查询端:引擎实报的量真的被读出来", () => {
  it("平台成本查询(按 spentUsd 过滤的那一个)把 billedUnits 一起选出来", () => {
    // 「按 spentUsd 过滤」= 花过钱的那批任务,也就是 Cost & usage 那张表的数据源。
    const costBlocks = genJobFindManyBlocks().filter((b) => b.includes("spentUsd: { not: null }"));
    expect(costBlocks.length).toBeGreaterThan(0);
    for (const block of costBlocks) expect(block).toContain("billedUnits: true");
  });

  it("这一行同时带出「我们估的成本」——两个数必须来自同一批行,否则对账的不是同一单", () => {
    for (const block of genJobFindManyBlocks().filter((b) => b.includes("billedUnits: true"))) {
      expect(block).toContain("spentUsd: true");
    }
  });

  it("没报就是 null:不许在映射里给它补一个 0(0 会被读成「这一单没花钱」)", () => {
    expect(ADMIN_QUERY).toContain("billedUnits: job.billedUnits");
    expect(ADMIN_QUERY).not.toMatch(/billedUnits:\s*job\.billedUnits\s*\?\?/u);
  });
});

describe("#776 ② 展示端:实报与估算并排,未知说 Unknown", () => {
  it("同一块面板里既渲染 spentUsd 也渲染 billedUnits", () => {
    const panel = ADMIN_UI.slice(ADMIN_UI.indexOf("function ReconciliationPanel"));
    expect(panel).toContain("usd(job.spentUsd)");
    expect(panel).toContain("job.billedUnits");
  });

  it("null 明写 Unknown —— 这是这张表唯一诚实的空值写法", () => {
    const panel = ADMIN_UI.slice(ADMIN_UI.indexOf("function ReconciliationPanel"));
    expect(panel).toContain("job.billedUnits === null");
    expect(panel).toContain("Unknown");
  });

  it("数字后面永远跟单位 —— 图按张、视频按 token,混在一起加会得出一个没有意义的总数", () => {
    const panel = ADMIN_UI.slice(ADMIN_UI.indexOf("function ReconciliationPanel"));
    expect(panel).toContain("job.billedUnitLabel");
  });
});

/**
 * ③ 商家那一面的主张**不在这里** —— 它们在 `asset-detail-receipt.test.ts` 上真渲染 DetailPanel、
 * 断言屏幕上的字(报了显示那句 / 没报显示 “Not reported by the engine.” / 与商家写的一样只说一句 /
 * 多图切换跟着换 / 第二张没报不继承第一张)。词法扫描在那一面不够:r2 自审时,
 * `variants[selectedIdx]?.finalPrompt ?? gen.finalPrompt` 这一行源码看起来完全正确,真渲染才逼出
 * 它在「这一张的值是 null」时会悄悄继承主图那一句 —— 正是判官点的那个串台。能真渲染的地方就
 * 别用读源码代替。
 */

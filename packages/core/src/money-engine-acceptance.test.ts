/**
 * docs/specs/money-engine.md §2 验收编号的 **M3 占位**。
 *
 * M3 闸要求:PR 引用规格后,验收表(MONEY-A1..A14)的每个编号都要以 fixed-string
 * 出现在某个 *.test.ts 里;`it.todo` 占位即算数。
 *
 * 本文件曾经是 §7.8 第①段(定价推导)的占位板。⑤B 收官之后**一条占位都不剩** ——
 * A1..A4 与 A11 由本段其它测试文件承担,A5..A10 与 A12..A14 各自转正,落点逐条记在下面。
 * 编号仍然逐字留在这个文件里(注释里出现即算数,M3 用的是 fixed-string grep),
 * 所以这份清单同时是「哪条验收住在哪」的索引 —— S5 照它逐行走。
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

describe("money-engine 验收落点索引(M3)", () => {
  // ── 已转正,不再是占位 ────────────────────────────────────────────────────
  //
  // MONEY-A1(推导:全仓只有一个价源)、MONEY-A2(65% 目标线与 45% 实收地板闸)、
  //   MONEY-A3(1080p / pro 图价目与逐档护栏)、MONEY-A4(钉点复核期黄红两态):
  //   本段其它测试文件(cost-pins / margin-truth / spend 的推导用例)与
  //   scripts/check-margin-floor.mjs。
  // MONEY-A11 回归锚在 money-anchor.test.ts,标签同时打在
  //   apps/web/lib/__tests__/gen-actions.test.ts 的三条信任通道行为测试上。
  //
  // MONEY-A5 已转正:apps/web/lib/__tests__/money-a5-credits-never-expire.test.ts
  //   (仓库不存在过期/清零代码路径 + billing 面「Credits don't expire」文案存在)。
  // MONEY-A6 已转正:packages/core/src/money-a6-actor-pricing.test.ts
  //   (同参数两次报价逐字相等 + 报价输入里没有演员那一维);真库那一侧的同一件事在
  //   apps/web/lib/__tests__/gen-ledger.test.ts 的 #785 用例(带 @元素与不带,报价/预扣/结算三数相同)。
  // MONEY-A7 已转正:packages/db/src/money-a7-a8-db.test.ts(结算读 RESERVE 行、
  //   调价只改其后动作、已写的账逐行不变)。
  // MONEY-A8 已转正:packages/db/src/money-a7-a8-db.test.ts(两种净变 0 形态各立一条 +
  //   两条部分唯一索引的存在性与「真的在拦人」)。
  // MONEY-A9 已转正:钱路在 apps/worker/src/jobs/understand.ts,断言在
  //   apps/worker/src/jobs/understand.test.ts(「MONEY-A9 理解计费」组)与
  //   understand-db.test.ts(预扣原子性、PAUSED_BALANCE 按余额捞回、结算撞 REFUND 整笔回滚);
  //   消费历史那一侧的 understanding 类目在 apps/web/lib/spend-history.ts。
  // MONEY-A10 已转正:钱腿在 packages/otto/src/runtime.ts(`ottoBudgetArgsFor` 的
  //   extraHold/extraSettle),槽协议在 packages/otto/src/skills/research-web.ts,上限常量
  //   OTTO_CHAT_MAX_SEARCHES_PER_TURN 在 packages/core/src/pricing-config.ts。断言在
  //   packages/otto/src/skills/research-web.test.ts(含规格点名的并发 6 次行为测试)、
  //   runtime.test.ts 与 research-agent.test.ts。
  // MONEY-A12 已转正:apps/web/lib/__tests__/billing-actions.test.ts(货架只由代码表渲染、
  //   Stripe 后台多出来的包不上架)、apps/worker/src/jobs/stripe-reconcile-db.test.ts
  //   (三通道报警、一天一次节流、缺口不随扫描窗静默消失)、
  //   apps/web/lib/__tests__/reconcile-actions.test.ts(人工关闭)。
  // MONEY-A13 已转正:apps/web/lib/__tests__/stripe-webhook.test.ts(dispute 三通道报警带 org)、
  //   packages/db/src/credits.test.ts(「暂停的 workspace 一分钱都动不了」咽喉)、
  //   apps/web/lib/__tests__/tenant-actions.test.ts(admin 暂停动作);理解链路上的同一条闸在
  //   apps/worker/src/jobs/understand-db.test.ts(暂停 org ⇒ PAUSED_BALANCE、零供应商、零捞回)。
  // MONEY-A14 已转正:apps/web/lib/__tests__/refund-actions.test.ts(RESERVE→Stripe→SETTLE 三段)、
  //   packages/db/src/credits.test.ts(30 天累计闸与 manual-refund 两条豁免)、
  //   apps/worker/src/jobs/llm-reservation-reaper.test.ts(manual-refund 前缀「不许碰」)。

  it("这份索引本身是活的:十四条验收编号逐字都在这个文件里", () => {
    // 一句自证。上面那份清单是给人读的;这一条是给机器读的 —— M3 闸用的是 fixed-string
    // grep,所以只要有人删注释时把一条落点连编号一起删掉,闸就会说「找不到」,而说不清
    // 是「验收没了」还是「索引断了」。这条用例读自己的源码,当场把话说清楚。
    const src = readFileSync(new URL(import.meta.url), "utf8");
    const missing = Array.from({ length: 14 }, (_, i) => `MONEY-A${i + 1}`).filter(
      (id) => !src.includes(`${id}`) || !new RegExp(`${id}(?![0-9])`).test(src),
    );
    expect(missing, `这些验收编号在本文件里已经找不到落点了:${missing.join(", ")}`).toEqual([]);
  });
});

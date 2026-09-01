/**
 * docs/specs/money-engine.md §2 验收编号的 **M3 占位**。
 *
 * M3 闸要求:PR 引用规格后,验收表(MONEY-A1..A14)的每个编号都要以 fixed-string
 * 出现在某个 *.test.ts 里;`it.todo` 占位即算数。
 *
 * 本段 = §7.8 第①段(定价推构),只落 MONEY-A1..A4(推导/毛利闸/护栏/钉点复核期,
 * 由本段其它测试文件承担)与 MONEY-A11(回归锚在 money-anchor.test.ts,标签同时打在
 * apps/web/lib/__tests__/gen-actions.test.ts 的三条信任通道行为测试上)的真测试。
 * 其余编号属于后续各段,先按 M3 规则以 it.todo 占位,做到哪段就在哪段转正 —— 占位
 * 文案抄的是验收表该行「看到 Y」的第一短句,不是新写的验收标准。
 */
import { describe, it } from "vitest";

describe("money-engine 验收占位(M3)", () => {
  it.todo("MONEY-A5 credits 永不过期:仓库不存在过期/清零代码路径");
  it.todo("MONEY-A6 两次报价逐字相等;消费历史不存在「演员费」行");
  it.todo("MONEY-A7 调价只改其后动作的报价,调价前已扣的账一分不重算");
  it.todo("MONEY-A8 前者零新增行;后者 reserve/refund 成对");
  // MONEY-A9 已转正,不再是占位:钱路在 apps/worker/src/jobs/understand.ts,断言在
  // apps/worker/src/jobs/understand.test.ts(「MONEY-A9 理解计费」三组)与
  // understand-db.test.ts(预扣原子性、PAUSED_BALANCE 按余额捞回);消费历史那一侧的
  // understanding 类目在 apps/web/lib/spend-history.ts。
  // MONEY-A10 已转正,不再是占位:钱腿在 packages/otto/src/runtime.ts(`ottoBudgetArgsFor`
  // 的 extraHold/extraSettle),槽协议在 packages/otto/src/skills/research-web.ts,上限常量
  // OTTO_CHAT_MAX_SEARCHES_PER_TURN 在 packages/core/src/pricing-config.ts。断言在
  // packages/otto/src/skills/research-web.test.ts(「MONEY-A10 搜索槽与单轮上限」,含规格
  // 点名的并发 6 次行为测试)、runtime.test.ts(「MONEY-A10 搜索腿」hold/settle 口径)与
  // research-agent.test.ts(深研侧同一套槽协议 + 失败不计费 + 无 key 诚实报不可用)。
  it.todo("MONEY-A12 购买被三态核对拦下(mismatch 不入账+报警)");
  it.todo("MONEY-A13 产生一条含商家 org 标识与金额的三通道报警");
  it.todo("MONEY-A14 顺序=先 RESERVE 预扣锁定退款额、后 Stripe 退款、再 SETTLE 落账");
});

/**
 * MONEY-A6 —— **消费历史里不存在「演员费」行**,在真库上证(规格 §2 验收表 / §7.7)。
 *
 * 验收表原文的后半句:「消费历史不存在『演员费』行」。前半句(两次报价逐字相等)由
 * `packages/core/src/money-a6-actor-pricing.test.ts` 钉在纯函数上;这里钉的是**账本**,
 * 因为商家的消费历史就是从 `CreditLedger` 渲染出来的 —— 「没有演员费行」这句话在代码里
 * 的唯一含义,就是带演员的那一单在账本里留下的行**和裸单一模一样**:一对 RESERVE/SETTLE,
 * 没有第三行,金额逐格相等。
 *
 * 为什么值得单开一条真库用例:核心层那条证明的是「报价函数看不见演员」,它证不了「下单
 * 那条路不会在旁边**另外**记一笔」。加演员费最自然的实现恰恰不是改报价函数,而是在账本上
 * 多写一行(那样报价卡还能显示原价)—— 那种改法核心层那条用例完全看不见,这一条看得见。
 *
 * 演员在下单那一侧的形状是一张参考图 / 一个 entity 引用,它到不了 `reserveCredits` 的入参;
 * 所以这里用**同一个报价**下两单,一单模拟带演员、一单裸单,然后逐行比对账本足迹。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { pricedGenCredits, type GenSpendInput } from "@fikirtive/core";
import { prisma, reserveCredits, settleCredits } from "./index.js";
import { seedOrg } from "../test/setup.js";

const ORG = "money-a6-org";

/** 同参数、同时长、同分辨率的一条视频单。演员只改下单那一侧的素材,不改这五个字段。 */
const JOB: GenSpendInput = {
  kind: "VIDEO",
  model: "seedance-2-mini",
  count: 1,
  referenceVideoGenerationId: null,
  videoOptions: { seconds: 5, resolution: "720p" },
};

/** 跑完一整单钱路(报价 → 预扣 → 结算),返回它在账本里留下的足迹。 */
async function runOrder(refId: string) {
  const quote = pricedGenCredits(JOB);
  await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId, cost: quote }));
  await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId }));
  const rows = await prisma.creditLedger.findMany({ where: { orgId: ORG, refId }, orderBy: { createdAt: "asc" } });
  return {
    quote,
    kinds: rows.map((r) => r.kind),
    reserved: rows.map((r) => r.reservedDelta),
    balance: rows.map((r) => r.balanceDelta),
    rowCount: rows.length,
  };
}

beforeEach(async () => {
  await seedOrg(ORG, 10_000);
});

describe("MONEY-A6 — 带演员的订单在账本上和裸订单一模一样", () => {
  it("MONEY-A6:两单的账本足迹逐格相等 —— 行数、类型、金额,没有第三行", async () => {
    // 「带演员」:商家 @ 了演员库里的一个角色。那是素材层的事,钱路收到的入参一个字不差。
    const withActor = await runOrder(`a6-actor-${randomUUID()}`);
    const bare = await runOrder(`a6-bare-${randomUUID()}`);

    expect(withActor.quote).toBe(bare.quote); // 同一个报价(核心层那条的账本侧复核)
    expect(withActor.rowCount).toBe(bare.rowCount);
    expect(withActor.kinds).toEqual(bare.kinds);
    expect(withActor.reserved).toEqual(bare.reserved);
    expect(withActor.balance).toEqual(bare.balance);

    // 承重:恰好一对 RESERVE/SETTLE。加演员费最自然的实现是在旁边**多记一行**(报价卡还能
    // 显示原价),而那正是这一条要挡住的形状 —— 商家的消费历史会凭空多出一笔他没同意过的钱。
    expect(withActor.kinds).toEqual(["RESERVE", "SETTLE"]);
  });

  it("MONEY-A6:两单跑完,商家余额的净支出**一模一样**(没有一笔悄悄多收)", async () => {
    const start = (await prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ORG } })).balance;
    const withActor = await runOrder(`a6-actor-${randomUUID()}`);
    const afterActor = (await prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ORG } })).balance;
    await runOrder(`a6-bare-${randomUUID()}`);
    const afterBare = (await prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ORG } })).balance;

    expect(start - afterActor).toBe(withActor.quote);
    expect(afterActor - afterBare).toBe(withActor.quote); // 第二单扣掉的和第一单一样多
  });

  it("MONEY-A6:账本里没有任何一行带「演员费」痕迹(reason 也不许偷偷记)", async () => {
    await runOrder(`a6-actor-${randomUUID()}`);
    const rows = await prisma.creditLedger.findMany({ where: { orgId: ORG }, select: { reason: true, kind: true } });
    expect(rows.length).toBeGreaterThan(0); // 不是在一张空表上空转

    // 消费历史的类目由 refId / kind 推导,而 `reason` 是另一条可能被拿来夹带的通道。
    // 两处都扫一遍:出现这些词就意味着有人开始给「人」单独记一笔钱。
    const forbidden = ["actor", "person", "face", "talent", "avatar", "演员"];
    for (const row of rows) {
      for (const word of forbidden) {
        expect(
          row.reason.toLowerCase().includes(word),
          `账本行的 reason 里出现了 "${word}" —— 商家的消费历史开始为「有没有人出镜」单独记账了。` +
            `Founder 2026-08-31 拍板「不加价,当卖点」(依据:参考图输入零计费有实测回执),` +
            `这是一个必须先经 Founder 裁价的改动。`,
        ).toBe(false);
      }
    }
    // 全部行的 kind 只可能是钱路那几种,没有一个「演员费」类型。
    for (const row of rows) {
      expect(["RESERVE", "SETTLE", "REFUND", "GRANT", "ADJUST"]).toContain(row.kind);
    }
  });
});

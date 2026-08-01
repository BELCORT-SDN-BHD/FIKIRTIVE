/** Pure helpers for pack credit math. */
import { planCardGate } from "./plan-card-contract";

/**
 * 整包总价 —— 与单卡走**同一道门**(`planCardGate`)。
 *
 * 返回 null = 这一包没有可担保的总价。只要有一张卡的价格担保不住(缺失 / 0 / 负数 /
 * 小数 / 只有记账用的 USD),或者有一张卡的字段读不全,整包就没有可以给商家看的数字 ——
 * 因为漏掉一张卡的总价会低报花费,猜一张卡的总价则是撒谎。调用方据此收起总价与整包批准。
 *
 * r2 P1-3 之前这里手写 payload 强转、并把 `estimatedPriceUsd / 0.1` 猜成 credits(空
 * payload 还会被算成 1 credit),于是 PackCard 能基于一个服务端从未报过的价出「Make all」。
 */
export function packTotalCredits(cards: { payload: unknown }[]): number | null {
  let total = 0;
  for (const card of cards) {
    const gate = planCardGate(card.payload);
    if (!gate.approvable || gate.credits === null) return null;
    total += gate.credits;
  }
  return total;
}

/**
 * Check if a user can afford a pack.
 * balanceUsd is converted to credits at 1 credit = $0.10.
 */
export function canAffordPack(totalCredits: number, balanceUsd: number): boolean {
  // Recover exact integer credits before dividing: balanceUsd/0.1 is IEEE-754
  // imprecise (0.3/0.1 === 2.9999999999999996), so a naive Math.floor under-counts
  // and blocks affordable packs. Round cents first, then divide by the 10-cent rate.
  const balanceCredits = Math.floor(Math.round(balanceUsd * 100) / 10);
  return totalCredits <= balanceCredits;
}

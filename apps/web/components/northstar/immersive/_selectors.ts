/**
 * 北极星 · 沉浸式共享 selectors(跨区派生读的单一源)
 *
 * `_mock.ts` 是唯一 tenant aggregate root(蓝图 §3.2)。此前各页把跨区读内联重算,
 * 并开始与源事实漂移(deal 金额与 totalOrdersMyr 对不上)。这一层把那些读收成共享
 * 纯函数:home/account/crm 调同一个,不再各自 sum。
 *
 * 铁律:纯函数、零后台 import、确定性(无 Date.now / 无 Math.random / 无 locale API)。
 * 数据只从 _mock 派生 —— 永不新造品牌事实。
 */

import {
  NS_BRAND,
  NS_CREDIT_LEDGER,
  NS_ANALYTICS,
  NS_SCHEDULED_POSTS,
  NS_PRODUCTS,
  NS_CONTACTS,
  type NsScheduledPost,
  type NsProduct,
} from "@/components/northstar/_mock";

/* ── 额度概览(派生自 NS_BRAND + NS_CREDIT_LEDGER) ─────────────────────────── */
export function creditSummary(): { balance: number; spentThisWeek: number; toppedUp: number } {
  const spent = NS_CREDIT_LEDGER.filter((r) => r.credits < 0).reduce((s, r) => s + -r.credits, 0);
  const toppedUp = NS_CREDIT_LEDGER.filter((r) => r.credits > 0).reduce((s, r) => s + r.credits, 0);
  return {
    balance: NS_BRAND.creditBalance,
    spentThisWeek: spent,
    toppedUp,
  };
}

/* ── 触达总量(28 天 reach 求和;home KPI「Reach·28天」用) ──────────────────── */
export function reachTotal(): number {
  return NS_ANALYTICS.reach.reduce((s, p) => s + p.value, 0);
}

/* ── 已发帖(评论源 / home;派生自 NS_SCHEDULED_POSTS) ─────────────────────── */
export function publishedPosts(): NsScheduledPost[] {
  return NS_SCHEDULED_POSTS.filter((p) => p.status === "published");
}

/* ── 畅销品(knowledge 答案 / campaign hooks;派生自 NS_PRODUCTS.bestSeller) ── */
export function bestSellers(): NsProduct[] {
  return NS_PRODUCTS.filter((p) => p.bestSeller);
}

/* ── 成交金额(单一源:客户的 totalOrdersMyr) ──────────────────────────────
 * 修 deals↔contacts 金额漂移(蓝图 §3.2 / §7.3):同一客户在 contacts 页与 deals 页
 * 必须显示同一笔钱。deal 金额从这里派生,不再各写各的硬编码。未知客户返回 0。 */
export function dealAmountMyr(contactId: string): number {
  return NS_CONTACTS.find((c) => c.id === contactId)?.totalOrdersMyr ?? 0;
}

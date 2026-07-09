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
  NS_CAMPAIGN,
  NS_PRODUCTS,
  NS_CONTACTS,
  NS_CAMPAIGNS,
  NS_TRENDS,
  NS_ASSETS,
  NS_CONVERSATIONS,
  NS_OTTO_STREAM,
  type NsScheduledPost,
  type NsProduct,
  type NsContact,
  type NsCampaignSummary,
  type NsCampaignStatus,
  type NsTrendSnapshot,
  type NsAsset,
  type NsConversation,
  type NsOttoStreamMessage,
  type NsLifecycle,
} from "@/components/northstar/_mock";
// 队 cx-campaign-schedule:postsForCampaign 改从 store live 源派生(见下)。_store 是同目录
// 的纯 client 内存单例(非后台),读它不违反 fence;仍无 Date.now / Math.random。
import { scheduledPosts, campaignEntries } from "./_store";

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

/* ═══════════════════════════════════════════════════════════════════════════
 * F1 世界圣经收敛:跨区派生读的单一源(campaign 容器 / Otto 单流 / research 燃料 / CRM)。
 * 各区调这些,不再各自 filter/sum;全部纯函数、确定性、只从 _mock 派生。
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── Campaign 容器(D1):按状态取 / 单个查 ─────────────────────────────────── */
export function campaignsByStatus(status: NsCampaignStatus): NsCampaignSummary[] {
  return NS_CAMPAIGNS.filter((c) => c.status === status);
}
export function activeCampaign(): NsCampaignSummary | undefined {
  return NS_CAMPAIGNS.find((c) => c.status === "ACTIVE");
}
/** campaign 预算余额(budget − spent;详情页 + 列表卡「headroom」读它)。 */
export function campaignHeadroom(c: NsCampaignSummary): number {
  return c.budgetCredits - c.spentCredits;
}

/* ── Otto 单流(D2):同一条流,按 campaign 过滤的视图(campaign 详情「对话」tab 用)。
 * 这就是 D2 的核心 —— 不是另一条对话,是这条流的一种看法。无 campaignId 即全流。 */
export function ottoStreamForCampaign(campaignId: string): NsOttoStreamMessage[] {
  return NS_OTTO_STREAM.filter((m) => m.context.campaignId === campaignId);
}
/** Otto 流按区过滤(某区的 context chip 深链回来时,只看该区的往来)。 */
export function ottoStreamForZone(zone: NsOttoStreamMessage["context"]["zone"]): NsOttoStreamMessage[] {
  return NS_OTTO_STREAM.filter((m) => m.context.zone === zone);
}
/** dock 小窗显示末尾 n 条(与 /otto 全屏同源,只是窗口大小不同)。 */
export function ottoStreamTail(n: number): NsOttoStreamMessage[] {
  return NS_OTTO_STREAM.slice(Math.max(0, NS_OTTO_STREAM.length - n));
}

/* ── Research 燃料(D3):某 campaign 引用的 trends / 独立 trends ───────────── */
export function trendsForCampaign(campaignId: string): NsTrendSnapshot[] {
  return NS_TRENDS.filter((t) => t.campaignId === campaignId);
}
/** 不挂任何 campaign 的独立趋势("这周什么在火",D3:research 可独立存在)。 */
export function standaloneTrends(): NsTrendSnapshot[] {
  return NS_TRENDS.filter((t) => !t.campaignId);
}

/* ── Campaign 自动收纳(D1):切片自动长在 campaign 上 —— 资产 / 帖子 / 对话 ── */
export function assetsForCampaign(campaignId: string): NsAsset[] {
  return NS_ASSETS.filter((a) => a.campaignId === campaignId);
}
/**
 * 队 cx-campaign-schedule(断层 4 修复):postsForCampaign 从 store live 源派生。
 * 此前读静态 NS_SCHEDULED_POSTS,而排期区读 live campaignEntries —— 同一 campaign
 * 在详情/列表与排期两屏数字互相矛盾。改为:该 campaign 的 live 帖(scheduledPosts)
 * ∪ 归组的日历条目(campaignEntries,无 campaignId 字段 → 全部归 NS_CAMPAIGN),去重
 * (pack-confirm 生成后条目落成 sched-<entryId> live 帖,同 id 只计一次)。两页计数与
 * campaign 详情 Calendar tab 从此同源。
 * 「proposed」条目还只是提案、不算已承诺的帖 —— 故不计入;approve 一条(proposed→approved)
 * 即成帖,campaign 列表/详情计数当场 +1(founder 走城验证路径)。
 */
export function postsForCampaign(campaignId: string): NsScheduledPost[] {
  const live = scheduledPosts().filter((p) => p.campaignId === campaignId);
  const liveIds = new Set(live.map((p) => p.id));
  const entryPosts: NsScheduledPost[] =
    campaignId === NS_CAMPAIGN.id
      ? campaignEntries()
          .filter((e) => e.status !== "proposed")
          .map((e) => ({
            id: `sched-${e.id}`,
            scheduledAt: `${e.date}T09:00:00+08:00`,
            platform: e.platform,
            caption: e.hook,
            media: "",
            status: e.status === "published" ? "published" : e.status === "scheduled" ? "scheduled" : "draft",
            campaignId,
          }))
      : [];
  return [...live, ...entryPosts.filter((p) => !liveIds.has(p.id))];
}
export function conversationsForCampaign(campaignId: string): NsConversation[] {
  return NS_CONVERSATIONS.filter((c) => c.campaignId === campaignId);
}

/* ── CRM 派生(单一源) ─────────────────────────────────────────────────────── */
export function contactsByLifecycle(stage: NsLifecycle): NsContact[] {
  return NS_CONTACTS.filter((c) => c.lifecycle === stage);
}
/** 久未下单的大客户(win-back 提示 / 大单提醒;dormant + 历史订单额 ≥ 门槛)。 */
export function dormantHighValue(minMyr = 1000): NsContact[] {
  return NS_CONTACTS.filter((c) => c.lifecycle === "dormant" && c.totalOrdersMyr >= minMyr);
}
/** 平均客单价(totalOrdersMyr / orderCount;CRM 档案 + 预测字段读它,无单则 0)。 */
export function avgOrderValue(contactId: string): number {
  const c = NS_CONTACTS.find((x) => x.id === contactId);
  if (!c || !c.orderCount || c.orderCount <= 0) return 0;
  return Math.round(c.totalOrdersMyr / c.orderCount);
}
/** 收件箱未答清单(等店主 / 超时;收件箱「需要你」计数读它)。 */
export function needsOwnerConversations(): NsConversation[] {
  return NS_CONVERSATIONS.filter((c) => c.state === "waiting-owner" || c.state === "overdue");
}

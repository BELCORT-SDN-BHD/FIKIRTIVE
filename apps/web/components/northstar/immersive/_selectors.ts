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
// [gate4/M2] conversationsView/contactsView/contactByIdView 同理:收件箱/CRM 的运行时改动
// (回复、合并、字段补丁)必须在首页读到 —— 静态 NS_CONVERSATIONS/NS_CONTACTS 只作 store 的
// 初始种子(_store.ts 用它们初始化 state),永不再被这里直接旁路读。
import { scheduledPosts, campaignEntries, conversationsView, contactsView, contactByIdView } from "./_store";

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
/** 久未下单的大客户(win-back 提示 / 大单提醒;dormant + 历史订单额 ≥ 门槛)。
 * [gate4/M2] 读 store live 的 contactsView(),不再直读静态 NS_CONTACTS —— CRM 里的合并/
 * 字段补丁/新建联系人从此在首页「久未下单」提醒里同步现身。 */
export function dormantHighValue(minMyr = 1000): NsContact[] {
  return contactsView().filter((c) => c.lifecycle === "dormant" && c.totalOrdersMyr >= minMyr);
}
/** 平均客单价(totalOrdersMyr / orderCount;CRM 档案 + 预测字段读它,无单则 0)。
 * [gate4/M2] 用 contactByIdView(同 store 的合并/补丁解析),不再直读静态 NS_CONTACTS。 */
export function avgOrderValue(contactId: string): number {
  const c = contactByIdView(contactId);
  if (!c || !c.orderCount || c.orderCount <= 0) return 0;
  return Math.round(c.totalOrdersMyr / c.orderCount);
}
/** 收件箱未答清单(等店主 / 超时;收件箱「需要你」计数读它)。
 * [gate4/M2] 读 store live 的 conversationsView(),不再直读静态 NS_CONVERSATIONS —— 收件箱
 * 里的回复/解决/新会话从此在首页「需要你」清单里同步现身。 */
export function needsOwnerConversations(): NsConversation[] {
  return conversationsView().filter((c) => c.state === "waiting-owner" || c.state === "overdue");
}

/* ── [wave-c Z1-home-global] 本周已确认订单(首页「生意状态」头卡:诚实读真实成交) ──
 * 老板开门第一问是「这周赚了几单」,不是「花了多少 credit」。全城唯一诚实的「已成交」
 * 信号 = 收件箱里被确认下来的订单。这里只从对话消息里读结构化的 RM 金额,刻意不碰跨区
 * deals 表 —— 那张表的金额是 lifetime 总额(dealAmountMyr),拿来当「本周」会注水、还会和
 * 收件箱里同客户的单笔报价打架(一店两数)。
 *
 * 判成交的键是「客户接受」,不是「Otto/店主说了 confirm」(参考金标准 REFERENCE-PROPOSAL-MERDEKA:
 * commercial truth = confirmed orders,买家点头才算)。一笔算数需要两件事都成立:
 *   (a) 有 Otto/店主给出的带 RM 金额的报价;
 *   (b) 这单被落实 —— 客户明确接受(confirm/approved/deal…),或 Otto/店主陈述式确认
 *       (Confirmed / booked / ready for…),但排除只是「Shall I confirm?」这种提议式反问。
 * 金额取报价里的 RM;仅计本周落定的(最近一条消息在本周窗口内),避免把十天前的旧单
 * (如 cv-09 客户 6/28 Approved 的 RM1,450)误算进「本周」。确定性:纯字符串比较,无 Date.now。 */
export interface NsOrdersThisWeek {
  revenueMyr: number;
  orderCount: number;
}
// 本周窗口起点(mock 的「现在」≈ 2026-07-07;本周 = 07-01 起,YYYY-MM-DD 字符串直接比较)。
const ORDERS_WEEK_START = "2026-07-01";
const QUOTE_RM_RE = /RM\s?([\d,]+)/; // 带价的报价
// 客户接受一份报价(买家点头 = commercial truth)。
const CUSTOMER_ACCEPT_RE = /\b(confirm|confirmed|approve|approved|deal|go ahead|sounds good)\b/i;
// Otto/店主陈述式确认(这单已定),而不是「shall I…?」式的提议反问。
const OWNER_SETTLED_RE = /\b(confirmed|booked|see you then|ready for|all set)\b/i;
const OWNER_PROPOSAL_RE = /\b(shall i|want me to|should i|do you want)\b/i;
// [gate4/M2] conversationsView() 是 store live 源(种子=NS_CONVERSATIONS + 收件箱运行时改动);
// 不再直读静态表,否则收件箱里新落定的成交永远算不进「本周」。
export function ordersThisWeek(): NsOrdersThisWeek {
  let revenueMyr = 0;
  let orderCount = 0;
  for (const c of conversationsView()) {
    // (a) 本对话里 Otto/店主给出的带价报价。
    const quote = c.messages.find(
      (m) => (m.from === "otto" || m.from === "owner") && QUOTE_RM_RE.test(m.text),
    );
    if (!quote) continue;
    const amount = Number(QUOTE_RM_RE.exec(quote.text)?.[1].replace(/,/g, "") ?? "0");
    if (amount <= 0) continue;
    // (b) 落实 = 客户接受,或 Otto/店主陈述式确认(排除提议反问)。
    const customerAccepted = c.messages.some(
      (m) => m.from === "customer" && CUSTOMER_ACCEPT_RE.test(m.text),
    );
    const ownerSettled = c.messages.some(
      (m) =>
        (m.from === "otto" || m.from === "owner") &&
        OWNER_SETTLED_RE.test(m.text) &&
        !OWNER_PROPOSAL_RE.test(m.text),
    );
    if (!customerAccepted && !ownerSettled) continue;
    // 只计本周落定的(最近一条消息在本周窗口内)。
    const latest = c.messages[c.messages.length - 1]?.at.slice(0, 10) ?? "";
    if (latest < ORDERS_WEEK_START) continue;
    revenueMyr += amount;
    orderCount += 1;
  }
  return { revenueMyr, orderCount };
}

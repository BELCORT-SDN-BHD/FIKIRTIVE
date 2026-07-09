/**
 * 北极星 · account-ops 组视图数据(全部派生自 _mock,不发明品牌事实)
 *
 * 连接口径 = schedule PLATFORMS + NS_CONTACTS 里出现的渠道;额度 = NS_BRAND + NS_CREDIT_LEDGER;
 * 团队店主 = NS_BRAND.owner;审批 = global NS_APPROVALS。结构常量(充值档位、规则/例程模板、
 * 受邀同事)是这一组的产品口径,不是新的品牌事实 —— 照 schedule/kit 派生视图模型的先例。
 *
 * 零后台 import;确定性(无 Date.now / 无 Math.random)。
 */

import { NS_BRAND } from "@/components/northstar/_mock";
import type { NsChannel } from "./kit";

/* 额度概览:单一实现在共享 selector(蓝图 §3.2),这里 re-export 保持 import 路径不变 */
export { creditSummary } from "../_selectors";

/* ── 连接(渠道账号) ────────────────────────────────────────────────────── */
export interface NsConnection {
  channel: NsChannel;
  status: "connected" | "action" | "disconnected";
  /** 连接态显示的健康备注;action 态显示要做什么 */
  note: string;
  connectedAt?: string;
}

export const NS_CONNECTIONS: NsConnection[] = [
  { channel: "instagram", status: "connected", note: "Publishing and insights on", connectedAt: "2026-05-02" },
  { channel: "facebook", status: "connected", note: "Publishing and insights on", connectedAt: "2026-05-02" },
  { channel: "whatsapp", status: "connected", note: "Otto answers new chats", connectedAt: "2026-06-11" },
  { channel: "tiktok", status: "action", note: "Token expires in 3 days — reconnect to keep posting" },
  { channel: "x", status: "disconnected", note: "Not connected yet" },
];

/* ── 充值档位(credits,对客花费不写 $;付款价用 MYR) ─────────────────── */
export interface NsTopUpPack {
  id: string;
  credits: number;
  priceMyr: number;
  /** 折算「大概能做什么」的白话,派生自常见生成成本 */
  roughly: string;
  best?: boolean;
}

export const NS_TOPUP_PACKS: NsTopUpPack[] = [
  { id: "tp-starter", credits: 600, priceMyr: 60, roughly: "About 15 videos or 50 images" },
  { id: "tp-studio", credits: 1200, priceMyr: 110, roughly: "About 30 videos or 100 images", best: true },
  { id: "tp-pro", credits: 3000, priceMyr: 260, roughly: "About 75 videos or 250 images" },
];

/* ── 通道费账道(红旗五 / harmony-05):WhatsApp 等平台按会话收的过路费,
 * 与生成 credits 是两套账。透明直传、零加价 —— MYR 实价,可对 Meta 价目核对。
 * 这里只是原型的用户面口径(会话数 × Meta 费率),不是新造品牌事实。 */
export type NsMetaFeeCategory = "Marketing" | "Utility" | "Service";

export interface NsChannelFeeRow {
  id: string;
  category: NsMetaFeeCategory;
  /** 人话一句:这类会话是什么 */
  desc: string;
  /** 本月这类会话数 */
  conversations: number;
  /** Meta 每会话费率(MYR,直传;0 = 服务窗口内免费) */
  rateMyr: number;
}

/** WhatsApp 会话费明细(本月,按 Meta 会话类目)。金额 = conversations × rateMyr。 */
export const NS_CHANNEL_FEE_LEDGER: NsChannelFeeRow[] = [
  { id: "cf-mkt", category: "Marketing", desc: "Promos and broadcasts you sent to customers", conversations: 214, rateMyr: 0.32 },
  { id: "cf-util", category: "Utility", desc: "Order updates and reminders", conversations: 156, rateMyr: 0.09 },
  { id: "cf-svc", category: "Service", desc: "Replies within 24h of a customer message", conversations: 320, rateMyr: 0 },
];

/** 通道费钱包(MYR 实价;仅此页可见,与 credits 物理隔离)。 */
export interface NsChannelFeeWallet {
  balanceMyr: number;
  autoReload: boolean;
}

export const NS_CHANNEL_FEE_WALLET: NsChannelFeeWallet = { balanceMyr: 84, autoReload: true };

/** Meta 官方 WhatsApp 价目(用户可自行核对"我们不加价")。 */
export const META_PRICING_URL = "https://developers.facebook.com/docs/whatsapp/pricing";

/* ── 自动化规则(when → then;派生自真实店内动作) ───────────────────────── */
export interface NsRule {
  id: string;
  name: string;
  when: string;
  then: string;
  enabled: boolean;
  runsThisWeek: number;
  /** true = 会花额度(coral 提示);false = 只做安排/回复 */
  costs: boolean;
  /** true = 命中次数由 store 里 Otto 自动应答的会话数派生(不写死),见 aiHandledCount */
  runsFromChats?: boolean;
}

export const NS_RULES: NsRule[] = [
  {
    id: "rule-01",
    name: "Answer order questions",
    when: "A new WhatsApp chat asks about pricing or pickup",
    then: "Otto drafts a reply and waits for your tap to send",
    enabled: true,
    runsThisWeek: 0,
    costs: false,
    runsFromChats: true,
  },
  {
    id: "rule-02",
    name: "Weekend teaser",
    when: "Every Thursday 4pm",
    then: "Otto drafts a weekend promo post for you to approve",
    enabled: true,
    runsThisWeek: 1,
    costs: true,
  },
  {
    id: "rule-03",
    name: "Sold-out follow up",
    when: "A post caption says sold out",
    then: "Otto pins a first comment with the next pre-order date",
    enabled: false,
    runsThisWeek: 0,
    costs: false,
  },
];

/* ── 例程(每日/每周的固定动作序列) ─────────────────────────────────────
 * 授权四件套(O-02+O-05,自动的手要有闸的钱包):每条例程带
 * ① 预算上限(budgetCapCredits + spentThisMonth,进度条)② 范围声明(scope chips,
 * 讲清它被允许碰什么)③ kill switch(即 enabled 开关,展开面里点名为「急停闸」)
 * ④ 事后摘要 / run 历史(runs,最近在前:做了什么 + 花了多少)。 */
export interface NsRoutineRun {
  /** 这次跑的人话时间(如「Today · 7:30 am」) */
  at: string;
  /** 一句白话:这次做了什么 */
  summary: string;
  /** 这次花掉的额度(0 = 没花钱) */
  spent: number;
}

export interface NsRoutine {
  id: string;
  name: string;
  cadence: string;
  steps: string[];
  enabled: boolean;
  nextRun: string;
  /** 范围声明:这条例程被允许碰的动作面(chips) */
  scope: string[];
  /** 本月额度上限(0 = 不花钱的例程) */
  budgetCapCredits: number;
  /** 本月已用额度 */
  spentThisMonth: number;
  /** 每次运行的事后摘要(最近在前;前 3 条即「最近 3 次 run」) */
  runs: NsRoutineRun[];
}

export const NS_ROUTINES: NsRoutine[] = [
  {
    id: "rtn-01",
    name: "Morning open",
    cadence: "Daily · 7:30 am",
    steps: ["Check overnight chats", "Post the day's fresh-bake story", "Flag anything needing you"],
    enabled: true,
    nextRun: "Tomorrow 7:30 am",
    scope: ["Read WhatsApp chats", "Post one story", "Flag for you"],
    budgetCapCredits: 200,
    spentThisMonth: 96,
    runs: [
      { at: "Today · 7:30 am", summary: "Posted the kaya-croissant story, flagged 2 chats for you", spent: 8 },
      { at: "Yesterday · 7:30 am", summary: "Posted the sourdough story, no chats needed you", spent: 8 },
      { at: "Mon · 7:30 am", summary: "Posted the weekend recap story", spent: 8 },
    ],
  },
  {
    id: "rtn-02",
    name: "Weekly plan",
    cadence: "Mondays · 9:00 am",
    steps: ["Read last week's numbers", "Draft the week's posts", "Line them up for approval"],
    enabled: true,
    nextRun: "Mon 13 Jul 9:00 am",
    scope: ["Read analytics", "Draft posts", "Send for approval"],
    budgetCapCredits: 400,
    spentThisMonth: 180,
    runs: [
      { at: "Mon 6 Jul · 9:00 am", summary: "Drafted 5 posts, sent them for your approval", spent: 60 },
      { at: "Mon 29 Jun · 9:00 am", summary: "Drafted 4 posts, sent them for your approval", spent: 48 },
    ],
  },
  {
    id: "rtn-03",
    name: "Campaign wind-down",
    cadence: "After a campaign ends",
    steps: ["Summarise results", "Save the winning posts to brand memory"],
    enabled: false,
    nextRun: "Paused",
    scope: ["Read campaign results", "Write to brand memory"],
    budgetCapCredits: 0,
    spentThisMonth: 0,
    runs: [
      { at: "Merdeka week · wrap", summary: "Summarised results, saved 3 winning posts to brand memory", spent: 0 },
    ],
  },
];

/* ── 团队成员(店主取自 NS_BRAND;同事为这一组口径) ─────────────────────
 * 双档席位(G-01):每个成员占一个席位 —— creator(创作席,全功能:生成/排期/创作)
 * 或 approver(审批席,只看 + 批,便宜到老板愿意把全店都拉进来)。席位与角色正交:
 * 一个只负责放行的老板可以是 Manager 角色 + 审批席。 */
export type NsSeatType = "creator" | "approver";

export interface NsMember {
  id: string;
  name: string;
  email: string;
  role: "Owner" | "Manager" | "Editor";
  seatType: NsSeatType;
  initials: string;
  /** pending = 已邀请未接受 */
  status: "active" | "pending";
  lastActive: string;
}

export const NS_MEMBERS: NsMember[] = [
  {
    id: "mb-owner",
    name: NS_BRAND.owner,
    email: NS_BRAND.email,
    role: "Owner",
    seatType: "creator",
    initials: NS_BRAND.owner
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    status: "active",
    lastActive: "Active now",
  },
  {
    id: "mb-02",
    name: "Farah Idris",
    email: "farah@rotibulan.my",
    role: "Manager",
    seatType: "approver",
    initials: "FI",
    status: "active",
    lastActive: "2h ago",
  },
  {
    id: "mb-03",
    name: "Danish Lim",
    email: "danish@rotibulan.my",
    role: "Editor",
    seatType: "creator",
    initials: "DL",
    status: "pending",
    lastActive: "Invited 2 days ago",
  },
];

export const ROLE_CAN: Record<NsMember["role"], string> = {
  Owner: "Everything, including billing and team",
  Manager: "Create, schedule, approve spend and posts",
  Editor: "Create and draft — spend and posts need approval",
};

/** 双档席位口径(G-01:审批席更便宜,好让老板把全员拉进来只为放行) */
export interface NsSeatTier {
  type: NsSeatType;
  label: string;
  priceMyr: number;
  can: string;
}

export const SEAT_TIERS: Record<NsSeatType, NsSeatTier> = {
  creator: {
    type: "creator",
    label: "Creator seat",
    priceMyr: 39,
    can: "Full studio — generate, edit, schedule, run campaigns",
  },
  approver: {
    type: "approver",
    label: "Approver seat",
    priceMyr: 9,
    can: "View and approve only — no spending, no publishing on their own",
  },
};

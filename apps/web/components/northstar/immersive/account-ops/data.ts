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

// STALL #65:会自己扣银行卡的动作默认关(安全 > 效率)。规则常驻可见 —— 老板一眼看到
// 「低于多少、充多少、从哪张卡」,再自己决定要不要开。
export const NS_CHANNEL_FEE_WALLET: NsChannelFeeWallet = { balanceMyr: 84, autoReload: false };

/** 自动充值规则(常驻显示;开关默认关,规则永远可见,不是黑箱)。 */
export const NS_CHANNEL_FEE_RELOAD = {
  thresholdMyr: 20,
  amountMyr: 60,
  source: "your saved Visa ···4242",
} as const;

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
  /** STALL/EFF gap5:有牙齿的那条默认亮起 + Recommended 标 + 结果导向的一句(冷启动=行业基准) */
  recommended?: boolean;
  /** 一行「换回了什么」,冷启动阶段标明是同类店铺基准、非本账号真数 */
  outcome?: string;
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
    // gap5:最有牙齿的一条默认亮起 + Recommended 标 + 结果导向(不再默认关、没人推销)。
    enabled: true,
    runsThisWeek: 0,
    costs: false,
    recommended: true,
    outcome: "Shops like yours turn about 1 in 5 sold-out posts into pre-orders — your own numbers replace this once it has run 20 times",
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
  /** 一句白话:这次做了什么(活动) */
  summary: string;
  /** 这次换回了什么(结果:观看/询问/订单)。gap1:run 历史记「赚了什么」不只「干了什么」。
   *  这些是本账号(Aisyah)的运行结果,非跨店基准,故可显具体数。 */
  outcome?: string;
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
      { at: "Today · 7:30 am", summary: "Posted the kaya-croissant story, flagged 2 chats for you", outcome: "340 views · 12 DMs · 3 pickup orders", spent: 8 },
      { at: "Yesterday · 7:30 am", summary: "Posted the sourdough story, no chats needed you", outcome: "210 views · 4 DMs", spent: 8 },
      { at: "Mon · 7:30 am", summary: "Posted the weekend recap story", outcome: "180 views · 2 DMs", spent: 8 },
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
      // gap3:「读数据→起草」的真反映 —— 上周表现真的驱动了这周排什么。
      { at: "Mon 6 Jul · 9:00 am", summary: "Read last week: Tue reels pulled 3× the DMs and durian sold out by noon — so I front-loaded 2 reels Tue/Thu and opened durian pre-orders Monday", outcome: "5 posts sent for approval · 4 approved", spent: 60 },
      { at: "Mon 29 Jun · 9:00 am", summary: "Read last week: weekend brunch posts drove the most orders — kept the batch weekend-heavy", outcome: "4 posts sent for approval · all approved", spent: 48 },
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
      { at: "Merdeka week · wrap", summary: "Summarised results, saved 3 winning posts to brand memory", outcome: "312 boxes sold (104% of goal) · 3 winners saved", spent: 0 },
    ],
  },
];

/* ── 自动化配方库(真目录)────────────────────────────────────────────────
 * EFFECTIVENESS gap2/5 + GOOSEWORKS §一·工具10:把「3+3 预设死 + 空白表单」升级成一排
 * 按结果分类、可一键安装的配方卡。每条配方带 client-onboarding 的机器可读 schema
 * (pattern / estCost / estOutcome / cadence)＋五件产品护栏:
 *   ① 资格条件(eligibility:这配方适合谁 / 什么时候有用)
 *   ② 真文案(sampleCopy:它真会发给客户的那句话,不是占位符)
 *   ③ 停发规则(stopRules:什么时候闭嘴 —— 防骚扰 / 防误发)
 *   ④ 守护栏(信任四件套:花费闸 budgetCap / 急停 kill switch / 范围 scope / 历史 outcome)
 *   ⑤ 成功指标(successMetric,冷启动=同类店铺基准,明确标注非本账号真数)
 * 铁律:coral 只属于 Otto;冷启动诚实 —— 未跑够次数前只显行业默认,不假装已学会你的账号。 */
export type NsRecipePattern =
  | "lifecycle-timing"
  | "win-back"
  | "campaign"
  | "sold-out-waitlist";

export interface NsRecipe {
  id: string;
  /** 人话名(sentence case) */
  title: string;
  /** 机器可读打法枚举(client-onboarding execution schema) */
  pattern: NsRecipePattern;
  /** 结果分类的一句话:装上它是为了赚回/救回什么 */
  goal: string;
  /** ① 资格条件:这配方适合谁、什么触发它有用 */
  eligibility: string;
  /** 一行机制:它到底做什么 */
  whatItDoes: string;
  /** ② 真文案:它真会替你发的那句(占位符 {…} 由真实字段填,店主可改) */
  sampleCopy: string;
  /** ③ 停发规则:什么时候停(防骚扰 / 防误发) */
  stopRules: string[];
  /** ④ 守护栏·范围:被允许碰什么(scope chips) */
  scope: string[];
  /** ④ 守护栏·花费闸:本月额度上限(0 = 不花额度) */
  budgetCapCredits: number;
  /** 机器可读成本预估(卡面一行) */
  estCostPerRun: string;
  /** ⑤ 成功指标(同类店铺基准;冷启动诚实标注) */
  successMetric: string;
  /** 节律(cadence) */
  cadence: string;
  /** true = Recommended(最有牙齿的一条,默认亮起) */
  recommended?: boolean;
  /** 默认已安装(种子;冷启动 seed for recipeInstalled) */
  defaultInstalled?: boolean;
  /** 已安装且跑过的最近一次结果(仅默认安装的示范;新装的显示「还没跑」) */
  lastRun?: { at: string; outcome: string; spent: number };
}

export const NS_RECIPES: NsRecipe[] = [
  {
    id: "rcp-soldout",
    title: "Sold-out → waitlist",
    pattern: "sold-out-waitlist",
    goal: "Recover lost buyers",
    recommended: true,
    defaultInstalled: true,
    eligibility: "Best for shops that sell out fast — when a product's gone, new askers usually just leave.",
    whatItDoes: "When a product sells out, Otto auto-replies new askers with a pre-order waitlist instead of losing them.",
    sampleCopy:
      "Hi {name}! Our {product} sold out for today 😅 I've put you on the waitlist for the next batch on {date} — want me to hold one for you?",
    stopRules: [
      "Stops the moment you restock",
      "One message per person — never nags",
      "Skips anyone on your do-not-disturb list",
    ],
    scope: ["Read new WhatsApp asks", "Reply with a waitlist offer", "Add to a pre-order list"],
    budgetCapCredits: 0,
    estCostPerRun: "No credits — replies only",
    successMetric: "Shops like yours recover about 1 in 5 lost buyers",
    cadence: "Runs whenever a post says sold out",
    lastRun: { at: "Yesterday · 2:10 pm", outcome: "6 askers waitlisted · 2 pre-orders", spent: 0 },
  },
  {
    id: "rcp-deposit",
    title: "Recover unpaid pre-orders",
    pattern: "lifecycle-timing",
    goal: "Get held orders paid",
    eligibility: "Best if you take pre-orders that sometimes sit unpaid — a gentle nudge saves the sale without chasing.",
    whatItDoes: "When a pre-order sits unpaid for 24 hours, Otto drafts one warm payment reminder for you to send.",
    sampleCopy:
      "Hi {name}! Your {product} order is still held for you — just RM {amount} to lock it in. Here's the pay link, and I'll set it aside for pickup on {date} 🥐",
    stopRules: [
      "At most 2 reminders, then it stops",
      "Stops the instant they pay or reply",
      "Never sends after your business hours",
    ],
    scope: ["Read unpaid pre-orders", "Draft a payment reminder", "Wait for your tap to send"],
    budgetCapCredits: 40,
    estCostPerRun: "About 2 credits a reminder",
    successMetric: "Similar bakeries recover about 1 in 3 unpaid holds",
    cadence: "Checks pre-orders every morning",
  },
  {
    id: "rcp-winback",
    title: "Win back quiet regulars",
    pattern: "win-back",
    goal: "Bring regulars back",
    eligibility: "Best if you have regulars with a rhythm — when a weekly buyer goes quiet past their usual, this reaches out.",
    whatItDoes: "When a regular goes silent past their normal cadence, Otto drafts a warm come-back note with their usual order.",
    sampleCopy:
      "Hi {name}! Your usual {product} slot is open again this week — want me to pencil you in for {day}? 🥐",
    stopRules: [
      "Only after they pass their own usual rhythm (×1.5)",
      "One message per quiet spell — never nags",
      "Skips anyone on your do-not-disturb list",
    ],
    scope: ["Read order history", "Spot who's overdue", "Draft a come-back note"],
    budgetCapCredits: 40,
    estCostPerRun: "About 2 credits a note",
    successMetric: "About 1 in 4 quiet regulars re-order within a week at shops like yours",
    cadence: "Checks for overdue regulars weekly",
  },
  {
    id: "rcp-festive",
    title: "Festive pre-order + waitlist",
    pattern: "campaign",
    goal: "Open a festival window",
    eligibility: "Best before a festival — opens a pre-order window, then waitlists extra demand once your batch cap is hit.",
    whatItDoes: "Opens a dated pre-order window for a festival, then auto-waitlists new orders once the batch is full.",
    sampleCopy:
      "Merdeka {product} pre-orders are open until {date} 🇲🇾 RM {amount} a box — reply YES and I'll hold yours. First {cap} boxes only.",
    stopRules: [
      "Closes on the cut-off date you set",
      "Switches to waitlist once the batch cap is reached",
      "One confirmation per order — no double-asks",
    ],
    scope: ["Post the pre-order opener", "Log replies as orders", "Waitlist once full"],
    budgetCapCredits: 120,
    estCostPerRun: "About 8 credits to open a window",
    successMetric: "Your last Raya window filled 104% of its goal — a festival play tends to repeat",
    cadence: "You start it before a festival",
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

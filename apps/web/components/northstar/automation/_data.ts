/**
 * 北极星原型 · 自动化区 — 区内派生示例数据(扩展层)
 *
 * 同一家店(Roti Bulan Bakery,KL)、MYR/credits、全确定性字面量,零后台 import。
 *
 * 两个对象面:
 *  ① 规则文件(O-09 人工面)—— 人看得懂、改得动的规则文本 + 启停开关 + 勿扰硬约束。
 *  ② Routine(O-02+O-05 授权模型)—— 用户签过字的「授权书」:范围声明 / 预算上限 /
 *     kill switch / 事后摘要 四件套全部可见,外加 run 历史与花费。
 *
 * 依据:PAGE-INVENTORY 九·自动化区;harmony-01 §四⑤(Routine 是授权对象)、
 *       数据模型行 6(Routine/RoutineRun)。
 */

/* ══════════════════════════════════════════════════════════════════════════
 * ① 规则文件(O-09 人工面)
 * ════════════════════════════════════════════════════════════════════════ */

export type RuleStatus = "on" | "off";

/** 规则文件里的一条可读子句。kind 决定图标与语气,text 是人话。 */
export interface RuleClause {
  /** trigger = 什么时候看;action = Otto 做什么;guard = 硬约束/永不越界 */
  kind: "trigger" | "action" | "guard";
  text: string;
}

export interface RuleFile {
  id: string;
  name: string;
  /** 一句话:这份规则替店家管什么 */
  summary: string;
  status: RuleStatus;
  /** 渠道范围(纯文字标签,不用品牌图标,对齐 campaign 口径) */
  channels: string[];
  clauses: RuleClause[];
  /** 最近一次触发(相对时间显示串);从未触发 = null */
  lastFiredAt: string | null;
  /** 近 7 天触发次数(展示用) */
  firedThisWeek: number;
  /** true = 碰勿扰名单 / 人工插手即停这类硬约束,UI 要给出提示 */
  hardConstraint: boolean;
}

export const RULE_FILES: RuleFile[] = [
  {
    id: "rule-01",
    name: "New order auto-reply",
    summary: "When a new WhatsApp order comes in, Otto confirms items and price, then waits for you.",
    status: "on",
    channels: ["WhatsApp"],
    clauses: [
      { kind: "trigger", text: "A new message on WhatsApp looks like an order." },
      { kind: "action", text: "Reply with the items, the total in ringgit, and ask to confirm." },
      { kind: "guard", text: "Never confirm the order itself. That waits for you." },
      { kind: "guard", text: "Skip anyone on the do-not-disturb list." },
    ],
    lastFiredAt: "20m ago",
    firedThisWeek: 34,
    hardConstraint: true,
  },
  {
    id: "rule-02",
    name: "After-hours holding reply",
    summary: "Outside business hours, Otto sends a warm holding note so no one feels ignored.",
    status: "on",
    channels: ["WhatsApp", "Instagram", "Facebook"],
    clauses: [
      { kind: "trigger", text: "A message arrives outside your business hours." },
      { kind: "action", text: "Send one holding note with your next open time." },
      { kind: "guard", text: "Only once per person per night. Never a second nudge." },
    ],
    lastFiredAt: "9h ago",
    firedThisWeek: 18,
    hardConstraint: false,
  },
  {
    id: "rule-03",
    name: "Halal question quick answer",
    summary: "Common halal and ingredient questions get a sourced answer from your knowledge file.",
    status: "on",
    channels: ["Instagram", "Facebook"],
    clauses: [
      { kind: "trigger", text: "Someone asks whether a bake is halal or lists allergens." },
      { kind: "action", text: "Answer from your ingredients knowledge file and cite it." },
      { kind: "guard", text: "If the file doesn't cover it, hand over to you instead of guessing." },
    ],
    lastFiredAt: "2h ago",
    firedThisWeek: 11,
    hardConstraint: false,
  },
  {
    id: "rule-04",
    name: "Wholesale enquiry routing",
    summary: "Bulk and catering enquiries get tagged and routed straight to you, no auto-reply.",
    status: "off",
    channels: ["WhatsApp", "Facebook"],
    clauses: [
      { kind: "trigger", text: "A message mentions bulk, catering, or 50 pieces or more." },
      { kind: "action", text: "Tag the chat wholesale and move it to the top of your inbox." },
      { kind: "guard", text: "Don't reply on your behalf. These are yours to price." },
    ],
    lastFiredAt: null,
    firedThisWeek: 0,
    hardConstraint: false,
  },
];

/* ── 营业时间对象(N-20 可纳入)——after-hours 规则读它 ─────────────────── */
export interface BusinessDay {
  day: string;
  /** null = 休息 */
  open: string | null;
  close: string | null;
}

export const BUSINESS_HOURS = {
  timezone: "Asia/Kuala_Lumpur",
  days: [
    { day: "Mon", open: "08:00", close: "18:00" },
    { day: "Tue", open: "08:00", close: "18:00" },
    { day: "Wed", open: "08:00", close: "18:00" },
    { day: "Thu", open: "08:00", close: "18:00" },
    { day: "Fri", open: "08:00", close: "18:00" },
    { day: "Sat", open: "09:00", close: "15:00" },
    { day: "Sun", open: null, close: null },
  ] as BusinessDay[],
};

/* ── 勿扰名单(硬约束的具体对象)—— 与 CRM 联系人同名同源感 ─────────────── */
export const DO_NOT_DISTURB = [
  { id: "dnd-01", name: "Jason Wong", reason: "Asked to only be contacted by you" },
  { id: "dnd-02", name: "Faridah Kassim", reason: "Opted out of automated replies" },
];

/* ══════════════════════════════════════════════════════════════════════════
 * ② Routine(O-02+O-05 授权模型)—— 四件套是字段,不是文档约定
 * ════════════════════════════════════════════════════════════════════════ */

export type RoutineStatus = "active" | "paused";

export interface RoutineRun {
  id: string;
  /** 相对时间显示串 */
  at: string;
  /** 这次跑出的东西,一句人话 */
  summary: string;
  /** 实际花费(credits) */
  spentCredits: number;
  outcome: "done" | "held" | "skipped";
  /** held = 产出等你批;deep-link 去处 */
  href?: string;
}

export interface Routine {
  id: string;
  name: string;
  /** 一句话:这份授权让 Otto 定时做什么 */
  purpose: string;
  status: RoutineStatus;
  /** 人话 cadence(不暴露 cron 串) */
  cadence: string;
  /** 下次运行(相对显示;paused = null) */
  nextRunAt: string | null;

  /* ── 四件套 ── */
  /** ① 范围声明:Otto 能碰什么、永不碰什么 */
  scope: { can: string[]; cannot: string[] };
  /** ② 预算上限(每次 + 每月),月内已用 */
  budget: { perRunCredits: number; perMonthCredits: number; usedThisMonthCredits: number };
  /** ③ kill switch —— 即停开关(active/paused 就是它的状态面) */
  /** ④ 事后摘要:每次跑完留一行 */
  runs: RoutineRun[];
}

export const ROUTINES: Routine[] = [
  {
    id: "routine-01",
    name: "Weekly content refresh",
    purpose: "Every Monday, draft the week's posts from your best-performing themes and hold them for your review.",
    status: "active",
    cadence: "Every Monday at 7:00am",
    nextRunAt: "in 3 days",
    scope: {
      can: [
        "Draft up to 5 posts a week",
        "Use your brand memory and past top posts",
        "Estimate credits before drafting",
      ],
      cannot: [
        "Publish anything without your approval",
        "Spend on video without asking",
        "Message customers",
      ],
    },
    budget: { perRunCredits: 60, perMonthCredits: 240, usedThisMonthCredits: 96 },
    runs: [
      { id: "rr-01", at: "3 days ago", summary: "Drafted 4 posts for the week, waiting for your review.", spentCredits: 48, outcome: "held", href: "/northstar/team/approvals" },
      { id: "rr-02", at: "10 days ago", summary: "Drafted 5 posts, you approved 4.", spentCredits: 60, outcome: "done" },
      { id: "rr-03", at: "17 days ago", summary: "Nothing new to say this week, skipped.", spentCredits: 0, outcome: "skipped" },
    ],
  },
  {
    id: "routine-02",
    name: "Daily inbox catch-up",
    purpose: "Each morning, summarise overnight messages and flag anything that needs you.",
    status: "active",
    cadence: "Every day at 8:30am",
    nextRunAt: "tomorrow, 8:30am",
    scope: {
      can: ["Read overnight messages", "Write one summary", "Flag urgent chats"],
      cannot: ["Reply to customers", "Change any automation rule", "Spend credits"],
    },
    budget: { perRunCredits: 4, perMonthCredits: 120, usedThisMonthCredits: 88 },
    runs: [
      { id: "rr-04", at: "this morning", summary: "12 messages overnight, 2 flagged for you.", spentCredits: 4, outcome: "done", href: "/northstar/inbox/shared" },
      { id: "rr-05", at: "yesterday", summary: "8 messages overnight, all handled by rules.", spentCredits: 4, outcome: "done" },
      { id: "rr-06", at: "2 days ago", summary: "15 messages overnight, 1 flagged for you.", spentCredits: 4, outcome: "done" },
    ],
  },
  {
    id: "routine-03",
    name: "Monthly trend research",
    purpose: "Once a month, pull fresh trends for the coming season and save a research note.",
    status: "paused",
    cadence: "First Monday of the month",
    nextRunAt: null,
    scope: {
      can: ["Run one deep research pass", "Save one trend note"],
      cannot: ["Draft or publish posts", "Start a campaign"],
    },
    budget: { perRunCredits: 30, perMonthCredits: 30, usedThisMonthCredits: 0 },
    runs: [
      { id: "rr-07", at: "last month", summary: "Saved a Merdeka gifting trend note.", spentCredits: 30, outcome: "done", href: "/northstar/campaign/trends" },
    ],
  },
];

/* ── 汇总(展示口径,确定性;真花费永远服务器算) ─────────────────────────── */
export const AUTOMATION_SUMMARY = {
  activeRoutines: ROUTINES.filter((r) => r.status === "active").length,
  activeRules: RULE_FILES.filter((r) => r.status === "on").length,
  spentThisMonthCredits: ROUTINES.reduce((s, r) => s + r.budget.usedThisMonthCredits, 0),
  monthlyCapCredits: ROUTINES.reduce((s, r) => s + r.budget.perMonthCredits, 0),
};

/* ── 演示用叙述条步骤 ─────────────────────────────────────────────────────── */
export const RULES_LAND_STEPS = ["Reading your rules…", "Checking do-not-disturb…"] as const;
export const ROUTINES_LAND_STEPS = ["Reading your routines…", "Checking budgets…"] as const;

/**
 * 北极星 · 沉浸式共享 store(the one circulatory system)
 *
 * 一个模块级可变单例 + useSyncExternalStore 订阅(pattern precedent:immersive-shell.tsx
 * 的 useReducedMotion)。各区(home / schedule / crm / account / otto)不再各自
 * fork useState from _mock —— 它们 read/append 这一个 store,动作在这里发生一次、
 * 到处生效。一条 append-only eventLog 把「Otto 刚做了什么」串成流,dock 与 home 都读它。
 *
 * 持久化:无(PROGRAM.md)。内存单例 —— client 端换路由存活,刷新即重置。这就是 spec。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto;数据只从 _mock / 区级视图派生,
 * 永不新造品牌事实;credits 永远是 credits。
 */

import * as React from "react";
import {
  NS_BRAND,
  NS_CREDIT_LEDGER,
  NS_SCHEDULED_POSTS,
  NS_CAMPAIGN_ENTRIES,
  NS_CONTACTS,
  NS_CONVERSATIONS,
  type NsCreditRow,
  type NsScheduledPost,
  type NsCampaignEntry,
  type NsContact,
  type NsConversation,
  type NsMessage,
} from "@/components/northstar/_mock";
import {
  NS_APPROVALS,
  NS_CHAT_THREADS,
  type NsApprovalRequest,
  type NsChatThread,
  type NsChatMessage,
} from "@/components/northstar/global/_data";
import {
  NS_CONNECTIONS,
  NS_RULES,
  NS_MEMBERS,
  NS_ROUTINES,
  type NsConnection,
  type NsRule,
  type NsMember,
  type NsRoutine,
} from "./account-ops/data";
import type { NsDealStage } from "./crm-inbox/data";

/** 成交阶段推进顺序(单一源,advanceDealStage 与 crm 页共用) */
const DEAL_STAGE_ORDER: NsDealStage[] = ["lead", "quote", "confirmed", "delivered"];

/* ── 事件流(append-only;at = 单调递增 seq) ──────────────────────────────── */
export type NsEventType =
  | "credits_spent"
  | "credits_topped_up"
  | "post_scheduled"
  | "campaign_entry_approved"
  | "approval_settled"
  | "channel_connected"
  | "channel_disconnected"
  | "conversation_resolved"
  | "conversation_replied"
  | "conversation_ai_toggled"
  | "deal_stage_changed"
  | "contact_created"
  | "automation_toggled"
  | "automation_rule_created"
  | "routine_toggled"
  | "routine_created"
  | "otto_working"
  | "otto_idle"
  | "ad_submitted"
  | "member_invited"
  | "cast_trained"
  | "approval_requested";

export interface NsEvent {
  type: NsEventType;
  payload: Record<string, unknown>;
  at: number;
  /** 人话一行(dock「Just now」条 / 通知直接显示这句;sentence case、英文 UI) */
  label: string;
}

/* ── Campaign 草稿(workbench 表单 → proposal-card 跨路由传值;客户端换路由存活) ── */
export interface NsCampaignDraft {
  goal: string;
  start: string;
  end: string;
  budgetCredits: number;
  platforms: string[];
}

/* ── Otto 上下文桥(宪法 7):当前在看什么,让「把这个改成 9:16」的「这个」可解析。
 * 各区在选中/进页时 setOttoContext(...);dock 展开显示「Looking at: …」并注入回复前缀。 */
export interface NsOttoContext {
  /** 当前视图的人话名(如 "Canvas"、"Merdeka week bakes")。 */
  view: string;
  /** 选中对象 id(可选;供 zone worker 把动作落到具体对象)。 */
  selectedId?: string;
  /** 选中对象的人话标签(chip 优先显示它,回退到 view)。 */
  selectedLabel?: string;
}

/* ── store 状态(全部从 _mock / 区级视图派生的可变镜像) ────────────────────── */
interface StoreState {
  creditBalance: number;
  creditLedger: NsCreditRow[];
  scheduledPosts: NsScheduledPost[];
  campaignEntries: NsCampaignEntry[];
  approvals: NsApprovalRequest[];
  connections: NsConnection[];
  contacts: NsContact[];
  conversations: NsConversation[];
  chatThreads: NsChatThread[];
  rules: NsRule[];
  members: NsMember[];
  routines: NsRoutine[];
  resolvedConversationIds: string[];
  submittedAdIds: string[];
  /** 人工插手 → 该会话 Otto 自动回复暂停(对话页横幅读它) */
  pausedAiConversationIds: string[];
  /** 成交阶段推进/回退的覆盖(金额仍走 dealAmountMyr,永不漂移) */
  dealStageOverrides: Record<string, NsDealStage>;
  /** 从收件箱/评论补建的联系人 id(CRM 列表打「New」chip) */
  inboxContactIds: string[];
  /** 每个联系人的「来自收件箱」时间线条目(contact-profile 读它) */
  contactEvents: Record<string, { at: number; label: string }[]>;
  ottoWorking: boolean;
  ottoLabel: string;
  eventLog: NsEvent[];
  campaignDraft: NsCampaignDraft | null;
  /** Otto 上下文桥:当前在看什么(null = 未设定,dock 不显示 chip)。 */
  ottoContext: NsOttoContext | null;
}

// 浅拷贝顶层数组做可变镜像:动作永不原地改 _mock 里的对象,只在本层 replace。
const state: StoreState = {
  creditBalance: NS_BRAND.creditBalance,
  creditLedger: [...NS_CREDIT_LEDGER],
  scheduledPosts: [...NS_SCHEDULED_POSTS],
  campaignEntries: [...NS_CAMPAIGN_ENTRIES],
  approvals: [...NS_APPROVALS],
  connections: [...NS_CONNECTIONS],
  contacts: [...NS_CONTACTS],
  conversations: [...NS_CONVERSATIONS],
  chatThreads: NS_CHAT_THREADS.map((t) => ({ ...t, messages: [...t.messages] })),
  rules: [...NS_RULES],
  members: [...NS_MEMBERS],
  routines: [...NS_ROUTINES],
  resolvedConversationIds: [],
  submittedAdIds: [],
  pausedAiConversationIds: [],
  dealStageOverrides: {},
  inboxContactIds: [],
  contactEvents: {},
  ottoWorking: false,
  ottoLabel: "Otto — idle",
  eventLog: [],
  campaignDraft: null,
  ottoContext: null,
};

/* ── 订阅机制(version tick:每次 notify 递增,useSyncExternalStore 读它触发重渲染) ── */
let version = 0;
let seq = 0;
const listeners = new Set<() => void>();

function notify() {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getVersion() {
  return version;
}

function logEvent(type: NsEventType, label: string, payload: Record<string, unknown> = {}) {
  seq += 1;
  state.eventLog = [...state.eventLog, { type, payload, at: seq, label }];
}

/** 给某联系人追加一条「来自收件箱」时间线条目(contact-profile 读它) */
function addContactEvent(contactId: string, label: string) {
  const prev = state.contactEvents[contactId] ?? [];
  state.contactEvents = { ...state.contactEvents, [contactId]: [...prev, { at: seq, label }] };
}

/* ── 动作(纯函数:改 store + append event + notify) ──────────────────────────
 * 每个动作只做一次、到处生效。金额/信号写进 eventLog,dock/home 立刻反映。 */

export function spendCredits(n: number, label: string, category: NsCreditRow["category"] = "Otto chat") {
  state.creditBalance = Math.max(0, state.creditBalance - n);
  state.creditLedger = [
    { id: `cl-live-${seq + 1}`, at: "", category, description: label, credits: -n },
    ...state.creditLedger,
  ];
  logEvent("credits_spent", `Spent ${n} credits · ${label}`, { n, label });
  notify();
}

export function topUp(n: number) {
  state.creditBalance += n;
  state.creditLedger = [
    { id: `cl-live-${seq + 1}`, at: "", category: "Top up", description: `Top up · ${n} credits`, credits: n },
    ...state.creditLedger,
  ];
  logEvent("credits_topped_up", `Topped up ${n.toLocaleString("en-MY")} credits`, { n });
  // 大额充值(≥3,000 credits)留一条老板确认条(记录/风控口径)。
  if (n >= 3000) {
    appendApproval({
      title: "Review a large top-up",
      detail: `${n.toLocaleString("en-MY")} credits were added to your balance`,
      impacts: [
        `${n.toLocaleString("en-MY")} credits are already in your balance`,
        "Approve to acknowledge, decline to flag for finance",
      ],
      kind: "schedule",
    });
  }
  notify();
}

export function schedulePost(post: NsScheduledPost) {
  const scheduled: NsScheduledPost = { ...post, status: "scheduled" };
  const idx = state.scheduledPosts.findIndex((p) => p.id === post.id);
  state.scheduledPosts =
    idx >= 0
      ? state.scheduledPosts.map((p) => (p.id === post.id ? scheduled : p))
      : [scheduled, ...state.scheduledPosts];
  logEvent("post_scheduled", `Scheduled a post for ${post.platform}`, { id: post.id, platform: post.platform });
  // 编辑席视角:新排的帖进审批队列等老板批(重排既有帖不重复推)。
  if (idx < 0) {
    appendApproval({
      title: "Review a scheduled post",
      detail: `An editor queued a ${post.platform} post for you to approve`,
      impacts: ["Publishes on schedule once you approve", "Decline keeps it as a draft to edit"],
      kind: "schedule",
    });
  }
  notify();
}

export function approveCampaignEntry(id: string) {
  const entry = state.campaignEntries.find((e) => e.id === id);
  if (!entry || entry.status === "approved") return;
  state.campaignEntries = state.campaignEntries.map((e) =>
    e.id === id ? { ...e, status: "approved" } : e,
  );
  logEvent("campaign_entry_approved", `Approved a campaign post · ${entry.hook}`, { id });
  // 大额条目(≥60 credits)需要一次生成花费的独立老板签字 → push 一条待批。
  if (entry.estCredits >= 60) {
    appendApproval({
      title: `Generate assets for “${entry.hook}”`,
      detail: `${entry.platform} · uses ${entry.estCredits} credits`,
      impacts: [
        `Creates the ${entry.format} in your Library`,
        `Uses ${entry.estCredits} credits when you approve`,
        "Nothing is posted until you schedule it",
      ],
      kind: "generation",
      credits: entry.estCredits,
    });
  }
  notify();
}

export function approveRequest(id: string, decision: "approve" | "decline") {
  const req = state.approvals.find((a) => a.id === id);
  if (!req) return;
  state.approvals = state.approvals.filter((a) => a.id !== id);
  logEvent(
    "approval_settled",
    decision === "approve" ? `Approved: ${req.title}` : `Declined: ${req.title}`,
    { id, decision },
  );
  // approve 一个花钱生成 → 真扣额度(闭环)
  if (decision === "approve" && req.kind === "generation" && req.credits) {
    spendCredits(req.credits, req.title, "Video");
    return; // spendCredits 已 notify
  }
  notify();
}

/* ── 审批环(G-11):其他区动作 push 新条目 → team-approvals / notifications / home
 * 卡零改动即活。approveRequest 消费,这里生产,「小编做→老板批」闭环真的能演一整圈。 */
export interface NsApprovalInput {
  title: string;
  detail: string;
  impacts: string[];
  kind: NsApprovalRequest["kind"];
  credits?: number;
  requestedAt?: string;
}

// 追加一条待批(不 notify;供内部动作在自己的 notify 前搭车),返回新 id。
function appendApproval(item: NsApprovalInput): string {
  const id = `ap-live-${seq + 1}`;
  const req: NsApprovalRequest = {
    id,
    title: item.title,
    detail: item.detail,
    impacts: item.impacts,
    kind: item.kind,
    credits: item.credits,
    requestedAt: item.requestedAt ?? "Just now",
  };
  state.approvals = [req, ...state.approvals];
  logEvent("approval_requested", `New approval · ${item.title}`, { id, kind: item.kind });
  return id;
}

/** 公开轨道:任意区把一条待批推进审批队列(独立调用时自己 notify)。 */
export function pushApproval(item: NsApprovalInput): string {
  const id = appendApproval(item);
  notify();
  return id;
}

export function connectChannel(id: string) {
  const conn = state.connections.find((c) => c.channel === id);
  if (!conn) return;
  state.connections = state.connections.map((c) =>
    c.channel === id ? { ...c, status: "connected", note: "Publishing and insights on" } : c,
  );
  logEvent("channel_connected", `Connected ${id}`, { id });
  notify();
}

export function disconnectChannel(id: string) {
  const conn = state.connections.find((c) => c.channel === id);
  if (!conn) return;
  state.connections = state.connections.map((c) =>
    c.channel === id ? { ...c, status: "disconnected", note: "Not connected yet", connectedAt: undefined } : c,
  );
  logEvent("channel_disconnected", `Disconnected ${id}`, { id });
  notify();
}

/** 从对话身份补建联系人(缺则 contact_created),再标记会话已解决。 */
export function resolveConversation(id: string) {
  const cv = state.conversations.find((c) => c.id === id);
  if (!cv) return;
  const hasContact = state.contacts.some((c) => c.id === cv.contactId);
  if (!hasContact) {
    const contact: NsContact = {
      id: cv.contactId,
      name: cv.subject || cv.contactId,
      channels: [cv.channel],
      lastSeen: cv.messages[cv.messages.length - 1]?.at.slice(0, 10) ?? "",
      tags: ["new"],
      doNotDisturb: false,
      totalOrdersMyr: 0,
    };
    state.contacts = [contact, ...state.contacts];
    if (!state.inboxContactIds.includes(contact.id)) {
      state.inboxContactIds = [...state.inboxContactIds, contact.id];
    }
    logEvent("contact_created", `Added ${contact.name} to contacts`, { id: contact.id });
    addContactEvent(contact.id, "Added from the inbox");
  }
  if (!state.resolvedConversationIds.includes(id)) {
    state.resolvedConversationIds = [...state.resolvedConversationIds, id];
  }
  state.conversations = state.conversations.map((c) => (c.id === id ? { ...c, unread: false } : c));
  logEvent("conversation_resolved", `Resolved ${cv.subject}`, { id });
  addContactEvent(cv.contactId, `Resolved from the inbox · ${cv.subject}`);
  notify();
}

/** 收件箱回复:append owner 消息 + 人工插手 → 该会话 Otto 自动暂停(横幅为真)。 */
export function sendConversationMessage(conversationId: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const cv = state.conversations.find((c) => c.id === conversationId);
  if (!cv) return;
  const message: NsMessage = { id: `m-live-${seq + 1}`, from: "owner", text: trimmed, at: "Just now" };
  state.conversations = state.conversations.map((c) =>
    c.id === conversationId ? { ...c, messages: [...c.messages, message], unread: false } : c,
  );
  if (!state.pausedAiConversationIds.includes(conversationId)) {
    state.pausedAiConversationIds = [...state.pausedAiConversationIds, conversationId];
  }
  logEvent("conversation_replied", `You replied · ${cv.subject}`, { id: conversationId });
  addContactEvent(cv.contactId, `You replied from the inbox · ${cv.subject}`);
  notify();
}

/** Otto 自动接管开关(dispatch automation 事件;暂停/恢复该会话的自动回复)。 */
export function setConversationAi(conversationId: string, paused: boolean) {
  const cv = state.conversations.find((c) => c.id === conversationId);
  if (!cv) return;
  const has = state.pausedAiConversationIds.includes(conversationId);
  if (paused && !has) state.pausedAiConversationIds = [...state.pausedAiConversationIds, conversationId];
  if (!paused && has) state.pausedAiConversationIds = state.pausedAiConversationIds.filter((x) => x !== conversationId);
  logEvent(
    "conversation_ai_toggled",
    paused ? `Paused Otto on ${cv.subject}` : `Otto is handling ${cv.subject} again`,
    { id: conversationId, paused },
  );
  notify();
}

/** 成交阶段推进/回退(写覆盖;金额仍走 dealAmountMyr,永不漂移)。 */
export function advanceDealStage(dealId: string, current: NsDealStage, dir: "forward" | "back", title: string) {
  const i = DEAL_STAGE_ORDER.indexOf(current);
  const nextIdx = dir === "forward" ? Math.min(i + 1, DEAL_STAGE_ORDER.length - 1) : Math.max(i - 1, 0);
  if (nextIdx === i) return;
  const stage = DEAL_STAGE_ORDER[nextIdx];
  state.dealStageOverrides = { ...state.dealStageOverrides, [dealId]: stage };
  logEvent("deal_stage_changed", `Moved ${title} to ${stage}`, { id: dealId, stage });
  notify();
}

/** 评论作者身份锚点:回复公开评论 → 若该 handle 无联系人则补建(CRM 打「New」chip)。 */
export function ensureContactFromComment(
  handle: string,
  channel: NsContact["channels"][number],
  lastSeen: string,
  note: string,
) {
  const id = `ct-cm-${handle}`;
  const exists = state.contacts.some((c) => c.id === id || c.name === `@${handle}`);
  if (exists) return;
  const contact: NsContact = {
    id,
    name: `@${handle}`,
    channels: [channel],
    lastSeen,
    tags: ["new"],
    doNotDisturb: false,
    totalOrdersMyr: 0,
  };
  state.contacts = [contact, ...state.contacts];
  state.inboxContactIds = [...state.inboxContactIds, id];
  logEvent("contact_created", `Added @${handle} to contacts`, { id });
  addContactEvent(id, note);
  notify();
}

export function toggleAutomationRule(id: string, on: boolean) {
  const rule = state.rules.find((r) => r.id === id);
  if (!rule) return;
  state.rules = state.rules.map((r) => (r.id === id ? { ...r, enabled: on } : r));
  logEvent("automation_toggled", `${on ? "Turned on" : "Turned off"} ${rule.name}`, { id, on });
  notify();
}

/** 新建一条 when → then 规则(automation/rules 的三字段弹窗写入)。新规则默认启用、本周 0 次、不花额度。 */
export function addRule(input: { name: string; when: string; then: string }): string {
  const id = `rule-live-${seq + 1}`;
  const rule: NsRule = {
    id,
    name: input.name,
    when: input.when,
    then: input.then,
    enabled: true,
    runsThisWeek: 0,
    costs: false,
  };
  state.rules = [rule, ...state.rules];
  logEvent("automation_rule_created", `Created rule · ${input.name}`, { id });
  notify();
  return id;
}

export function toggleRoutine(id: string, on: boolean) {
  const routine = state.routines.find((r) => r.id === id);
  if (!routine) return;
  state.routines = state.routines.map((r) => (r.id === id ? { ...r, enabled: on } : r));
  logEvent("routine_toggled", `${on ? "Turned on" : "Turned off"} ${routine.name}`, { id, on });
  notify();
}

/** 新建一条多步例程(automation/routines 的三字段弹窗写入)。触发即 cadence,动作即首步。 */
export function addRoutine(input: { name: string; cadence: string; step: string }): string {
  const id = `rtn-live-${seq + 1}`;
  const routine: NsRoutine = {
    id,
    name: input.name,
    cadence: input.cadence,
    steps: [input.step],
    enabled: true,
    nextRun: "Scheduled",
  };
  state.routines = [routine, ...state.routines];
  logEvent("routine_created", `Created routine · ${input.name}`, { id });
  notify();
  return id;
}

export function submitAd(payload: { id?: string; label?: string; platform?: string }) {
  const id = payload.id ?? `ad-live-${seq + 1}`;
  if (!state.submittedAdIds.includes(id)) state.submittedAdIds = [...state.submittedAdIds, id];
  const platform = payload.platform ?? "meta";
  logEvent(
    "ad_submitted",
    payload.label ? `Submitted ${payload.label} for review` : "Submitted an ad for review",
    { id, platform, label: payload.label ?? "New campaign" },
  );
  // 广告提交进审批队列等老板放行(广告待批)。
  appendApproval({
    title: `Approve ad · ${payload.label ?? "New campaign"}`,
    detail: `${platform} · submitted for your review`,
    impacts: ["Goes live on the channel once you approve", "Decline sends it back to drafts"],
    kind: "schedule",
  });
  notify();
}

/** 训练完成落到事件流(cast 页在 training → ready 的瞬间调它;分析区实时活动读它)。 */
export function castTrained(name: string) {
  logEvent("cast_trained", `Trained ${name} · face locked`, { name });
  notify();
}

/** 邀请同事:真 append 一条 pending Editor 到成员列表(team 页派生 pending chip / 计数)。 */
export function inviteMember(email: string) {
  const trimmed = email.trim();
  if (!trimmed) return;
  const local = trimmed.split("@")[0] || trimmed;
  const initials = local.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "??";
  const member: NsMember = {
    id: `mb-live-${seq + 1}`,
    name: local,
    email: trimmed,
    role: "Editor",
    initials,
    status: "pending",
    lastActive: "Invited just now",
  };
  state.members = [...state.members, member];
  logEvent("member_invited", `Invited ${trimmed} as an editor`, { email: trimmed });
  notify();
}

export function ottoWorking(on: boolean, label?: string) {
  state.ottoWorking = on;
  state.ottoLabel = on ? label ?? "Otto — working" : "Otto — idle";
  logEvent(on ? "otto_working" : "otto_idle", on ? label ?? "Otto is working" : "Otto finished", {});
  notify();
}

/* ── 聊天(dock 与 otto-chat 共读同一份 chatThreads → 「share one state」为真) ── */
export function appendChatMessage(threadId: string, message: NsChatMessage) {
  const idx = state.chatThreads.findIndex((t) => t.id === threadId);
  if (idx < 0) return;
  state.chatThreads = state.chatThreads.map((t) =>
    t.id === threadId ? { ...t, messages: [...t.messages, message] } : t,
  );
  notify();
}

/** Campaign 工作台交出的草稿(workbench 提交时写,proposal-card 读它真实呈现目标/日期/预算)。 */
export function setCampaignDraft(draft: NsCampaignDraft) {
  state.campaignDraft = draft;
  notify();
}

/** Otto 上下文桥:各区在选中对象/进页时告诉 Otto「现在在看什么」。传 null 清空。 */
export function setOttoContext(ctx: NsOttoContext | null) {
  state.ottoContext = ctx;
  notify();
}

/** 新开一个空 thread,返回它的 id(dock / otto-chat 的「New chat」共用)。 */
export function startChatThread(title = "New chat"): string {
  const id = `th-live-${seq + 1}`;
  state.chatThreads = [...state.chatThreads, { id, title, updatedAt: "Now", messages: [] }];
  notify();
  return id;
}

/* ── 选择器(跨区派生读的单一源;组件在 useStore() 下调用) ────────────────── */
export function balance(): number {
  return state.creditBalance;
}

/** 额度流水(种子 + 本次会话新增行,最新在前;credits 页读它,与 balance 同源) */
export function creditLedger(): NsCreditRow[] {
  return state.creditLedger;
}

/** 全部排期帖(排期区三视图的单一源:base + composer 新排 + campaign 生成的草稿)。 */
export function scheduledPosts(): NsScheduledPost[] {
  return state.scheduledPosts;
}

/** 未发出的排期帖(scheduled + draft),home「Up next」用。 */
export function upNext(): NsScheduledPost[] {
  return state.scheduledPosts.filter((p) => p.status === "scheduled" || p.status === "draft");
}

/** 全部 campaign 日历条目(campaign 区 + 排期区 campaign 归组的单一源;approve/生成后状态在这里变)。 */
export function campaignEntries(): NsCampaignEntry[] {
  return state.campaignEntries;
}

/** Campaign 工作台草稿(无则 null;proposal-card 读它,缺省回落 _mock 的 NS_CAMPAIGN)。 */
export function campaignDraft(): NsCampaignDraft | null {
  return state.campaignDraft;
}

export function pendingApprovals(): NsApprovalRequest[] {
  return state.approvals;
}

/** 当前 Otto 上下文(dock 展开时读它显示「Looking at: …」并注入回复前缀)。 */
export function ottoContext(): NsOttoContext | null {
  return state.ottoContext;
}

/** 最近 n 条事件,最新在前。 */
export function recentEvents(n: number): NsEvent[] {
  return state.eventLog.slice(-n).reverse();
}

export function chatThreads(): NsChatThread[] {
  return state.chatThreads;
}

export function connections(): NsConnection[] {
  return state.connections;
}

export function rules(): NsRule[] {
  return state.rules;
}

export function teamMembers(): NsMember[] {
  return state.members;
}

/* ── crm-inbox 跨区读(身份链:收件箱动作即刻现于 CRM) ────────────────────── */
export function conversationsView(): NsConversation[] {
  return state.conversations;
}

export function conversationByIdView(id: string): NsConversation | undefined {
  return state.conversations.find((c) => c.id === id);
}

export function contactsView(): NsContact[] {
  return state.contacts;
}

export function contactByIdView(id: string): NsContact | undefined {
  return state.contacts.find((c) => c.id === id);
}

export function conversationsForContactView(contactId: string): NsConversation[] {
  return state.conversations.filter((c) => c.contactId === contactId);
}

/** 该会话 Otto 自动回复是否被人工暂停(对话页横幅 / 开关读它)。 */
export function isAiPaused(conversationId: string): boolean {
  return state.pausedAiConversationIds.includes(conversationId);
}

/** 该会话是否已解决(对话页 Resolve 按钮态读它)。 */
export function isResolved(conversationId: string): boolean {
  return state.resolvedConversationIds.includes(conversationId);
}

/** deal 当前阶段(覆盖优先,否则回落静态种子)。 */
export function dealStageOf(dealId: string, fallback: NsDealStage): NsDealStage {
  return state.dealStageOverrides[dealId] ?? fallback;
}

/** 该联系人是否从收件箱/评论补建(CRM 打「New」chip)。 */
export function isInboxContact(id: string): boolean {
  return state.inboxContactIds.includes(id);
}

/** 该联系人的「来自收件箱」时间线条目(最早在前)。 */
export function contactEventsFor(id: string): { at: number; label: string }[] {
  return state.contactEvents[id] ?? [];
}

/** 待审广告(广告区 submit 落进事件流;performance/multi-platform 从这里派生「审核中」)。 */
export function adSubmissions(): NsEvent[] {
  return state.eventLog.filter((e) => e.type === "ad_submitted");
}

/** 分类消费(单一源:从 creditLedger 派生,取代手抄常量;分析区报表读它)。
 * 固定分类顺序保证确定性;只留有消费的分类。充值(正数)不计。 */
const SPEND_CATEGORY_ORDER: NsCreditRow["category"][] = ["Video", "Image", "Otto chat", "Search"];
export function creditSpendByCategory(): { label: string; credits: number }[] {
  return SPEND_CATEGORY_ORDER.map((cat) => ({
    label: cat,
    credits: state.creditLedger
      .filter((r) => r.category === cat && r.credits < 0)
      .reduce((s, r) => s + -r.credits, 0),
  })).filter((row) => row.credits > 0);
}

export function routines(): NsRoutine[] {
  return state.routines;
}

/** Otto 已自动应答的会话数(automation「Answer order questions」的 runsThisWeek 由它派生) */
export function aiHandledCount(): number {
  return state.conversations.filter((c) => c.aiHandled).length;
}

/* ── 订阅 hook(pattern precedent:useReducedMotion / useSyncExternalStore) ────
 * 返回 void:组件订阅后在渲染里调选择器读当前状态。version 变则重渲染。 */
export function useStore(): void {
  React.useSyncExternalStore(subscribe, getVersion, getVersion);
}

/** Otto 工作态(shell 注入 context / dock 徽点脉冲都读它)。 */
export function useOttoWorking(): { working: boolean; label: string } {
  useStore();
  return { working: state.ottoWorking, label: state.ottoLabel };
}

/* ── 演示种子(client-only,模块首次加载后触发一次)──────────────────────────
 * 让 founder 打开原型后不用先做动作,审批队列也会自动来两条,核心闭环总有得演。 */
if (typeof window !== "undefined") {
  window.setTimeout(() => {
    pushApproval({
      title: "Approve 2 replies Otto drafted",
      detail: "WhatsApp · order questions from 2 customers",
      impacts: ["Sends both replies once you approve", "Decline keeps them as drafts to edit"],
      kind: "schedule",
    });
  }, 30_000);
  window.setTimeout(() => {
    pushApproval({
      title: "Generate 2 weekend story videos",
      detail: "For Merdeka week bakes · entries 4 and 5",
      impacts: [
        "Creates 2 videos in your Library",
        "Uses 80 credits when you approve",
        "Nothing is posted until you schedule it",
      ],
      kind: "generation",
      credits: 80,
    });
  }, 90_000);
}

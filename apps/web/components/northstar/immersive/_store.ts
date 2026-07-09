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
  type NsConnection,
  type NsRule,
  type NsMember,
} from "./account-ops/data";

/* ── 事件流(append-only;at = 单调递增 seq) ──────────────────────────────── */
export type NsEventType =
  | "credits_spent"
  | "credits_topped_up"
  | "post_scheduled"
  | "campaign_entry_approved"
  | "approval_settled"
  | "channel_connected"
  | "conversation_resolved"
  | "contact_created"
  | "automation_toggled"
  | "otto_working"
  | "otto_idle"
  | "ad_submitted"
  | "member_invited";

export interface NsEvent {
  type: NsEventType;
  payload: Record<string, unknown>;
  at: number;
  /** 人话一行(dock「Just now」条 / 通知直接显示这句;sentence case、英文 UI) */
  label: string;
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
  resolvedConversationIds: string[];
  submittedAdIds: string[];
  ottoWorking: boolean;
  ottoLabel: string;
  eventLog: NsEvent[];
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
  resolvedConversationIds: [],
  submittedAdIds: [],
  ottoWorking: false,
  ottoLabel: "Otto — idle",
  eventLog: [],
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
  notify();
}

export function approveCampaignEntry(id: string) {
  const entry = state.campaignEntries.find((e) => e.id === id);
  if (!entry || entry.status === "approved") return;
  state.campaignEntries = state.campaignEntries.map((e) =>
    e.id === id ? { ...e, status: "approved" } : e,
  );
  logEvent("campaign_entry_approved", `Approved a campaign post · ${entry.hook}`, { id });
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

export function connectChannel(id: string) {
  const conn = state.connections.find((c) => c.channel === id);
  if (!conn) return;
  state.connections = state.connections.map((c) =>
    c.channel === id ? { ...c, status: "connected", note: "Publishing and insights on" } : c,
  );
  logEvent("channel_connected", `Connected ${id}`, { id });
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
      lastSeen: "",
      tags: ["new"],
      doNotDisturb: false,
      totalOrdersMyr: 0,
    };
    state.contacts = [contact, ...state.contacts];
    logEvent("contact_created", `Added ${contact.name} to contacts`, { id: contact.id });
  }
  if (!state.resolvedConversationIds.includes(id)) {
    state.resolvedConversationIds = [...state.resolvedConversationIds, id];
  }
  state.conversations = state.conversations.map((c) => (c.id === id ? { ...c, unread: false } : c));
  logEvent("conversation_resolved", `Resolved ${cv.subject}`, { id });
  notify();
}

export function toggleAutomationRule(id: string, on: boolean) {
  const rule = state.rules.find((r) => r.id === id);
  if (!rule) return;
  state.rules = state.rules.map((r) => (r.id === id ? { ...r, enabled: on } : r));
  logEvent("automation_toggled", `${on ? "Turned on" : "Turned off"} ${rule.name}`, { id, on });
  notify();
}

export function submitAd(payload: { id?: string; label?: string }) {
  const id = payload.id ?? `ad-live-${seq + 1}`;
  if (!state.submittedAdIds.includes(id)) state.submittedAdIds = [...state.submittedAdIds, id];
  logEvent("ad_submitted", payload.label ? `Submitted ad · ${payload.label}` : "Submitted an ad for review", {
    id,
  });
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

/** 未发出的排期帖(scheduled + draft),home「Up next」用。 */
export function upNext(): NsScheduledPost[] {
  return state.scheduledPosts.filter((p) => p.status === "scheduled" || p.status === "draft");
}

export function pendingApprovals(): NsApprovalRequest[] {
  return state.approvals;
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

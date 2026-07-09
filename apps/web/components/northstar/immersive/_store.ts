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
  NS_OTTO_STREAM,
  type NsCreditRow,
  type NsScheduledPost,
  type NsCampaignEntry,
  type NsContact,
  type NsConversation,
  type NsMessage,
  type NsOttoStreamMessage,
  type NsOttoStreamContext,
  type NsOttoZone,
} from "@/components/northstar/_mock";
import {
  NS_APPROVALS,
  type NsApprovalRequest,
  type NsChatThread,
  type NsChatMessage,
  type NsChatCardKind,
} from "@/components/northstar/global/_data";
import {
  NS_CONNECTIONS,
  NS_RULES,
  NS_MEMBERS,
  NS_ROUTINES,
  type NsConnection,
  type NsRule,
  type NsMember,
  type NsSeatType,
  type NsRoutine,
} from "./account-ops/data";
import type { NsDealStage, NsSegmentRule, NsKnowledgeEntry } from "./crm-inbox/data";

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
  | "member_updated"
  | "member_removed"
  | "cast_trained"
  | "approval_requested"
  | "contact_field_changed"
  | "contacts_merged"
  | "segment_created"
  | "segment_deleted"
  | "comment_to_dm"
  | "knowledge_added"
  | "business_hours_set"
  | "brand_preference_learned";

export interface NsEvent {
  type: NsEventType;
  payload: Record<string, unknown>;
  at: number;
  /** 人话一行(dock「Just now」条 / 通知直接显示这句;sentence case、英文 UI) */
  label: string;
}

/* ── D2 单流(F2 循环系统):Otto = 一条 append-only 消息流 ─────────────────────
 * 心智 = 你和某个员工的 WhatsApp 单聊:一条时间线,零线程管理。每条自动带 context
 * chip {zone, campaignId?, label, href?};dock 小窗 / `/otto` 全屏 / campaign 详情
 * 「对话」tab 都是这条流的**过滤视图**(streamFor),不是另一条对话。种子 = _mock 的
 * NS_OTTO_STREAM(62 条跨三周历史),live 发送 append 在尾部。 */
export interface NsStreamMsg extends NsOttoStreamMessage {
  /** 富卡(可选;live 发送 / 就地触点演示用) */
  card?: NsChatCardKind;
  /** 已完成的命名思考子步骤(可选) */
  substeps?: string[];
  error?: boolean;
}
/** 单流过滤器:按区 / 按 campaign 收窄同一条流(空 = 全流)。 */
export interface NsStreamFilter {
  zone?: NsOttoZone;
  campaignId?: string;
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

/* ── Otto 行为设置(账户 · Otto 行为面写它;dock 读它,行为可见地随设置变)。
 * 自主级别 = 逐次批 / routine 内自动;花费确认阈值 = 单笔 ≥ 此额度必先问;
 * 勿扰时段 = 该时段 Otto 不主动打扰(dock 收起态显示,不再冒「Just now」)。 */
/* ── Otto 学到的偏好(连接器 O-04):asset-viewer / library 的赞/踩落进这里,
 * brand-memory「Otto 学到的偏好」区读它显示新条目(带来源)。审批(赞/踩)→ 学习
 * 回灌的一整圈,是这条循环系统里资产区自己的那段血管。 */
export type NsBrandFeedback = "like" | "dislike";
export interface NsBrandPreference {
  /** 稳定 id(同一资产同一来源只留一条,方向翻转即替换) */
  id: string;
  feedback: NsBrandFeedback;
  /** 被赞/踩的资产人话名(来源行显示它) */
  assetTitle: string;
  /** 来源面(如 "Asset viewer" / "Library";来源行显示它) */
  source: string;
  /** Otto 学到的偏好一句话(sentence case、英文 UI) */
  note: string;
  at: number;
}

export type NsOttoAutonomy = "review-each" | "auto-in-routines";
export interface NsOttoBehavior {
  /** 逐次批(默认,最稳)/ routine 内自动(仅你设过的例程里免逐次批) */
  autonomy: NsOttoAutonomy;
  /** 单笔花费 ≥ 此额度(credits)时,Otto 一定先问再花;0 = 任何花费都先问 */
  spendConfirmThreshold: number;
  /** 勿扰时段:该时段内 Otto 只做不打扰,不冒主动提示 */
  quietHours: { enabled: boolean; from: string; to: string };
}

/* ── 自建分群(人话 → 规则编译后存这里;分群页列表读它、可删) ─────────────── */
export interface NsCustomSegment {
  id: string;
  name: string;
  /** 店主输入的人话描述(编译成 rules 的原句;列表副标题显示它) */
  phrase: string;
  rules: NsSegmentRule[];
}

/* ── 营业时间(收件箱离时自动回复;时段 + away 文案,店主可改) ────────────────
 * 派生用途:非营业时段进来的对话在收件箱打「After hours」标 + 对话页演示 away 气泡。 */
export interface NsBusinessHours {
  enabled: boolean;
  /** 24h HH:MM,零填充,字符串比较即可判时段(确定性,无 Date.now)。 */
  open: string;
  close: string;
  /** 闭店时段自动回复文案(away message)。 */
  awayMessage: string;
}

/** 知识反向回路:人工改写 Otto 草稿后存进知识库的新条目(带来源对话链接)。 */
export interface NsKnowledgeAddition extends NsKnowledgeEntry {
  /** 来源对话 id(知识库页「From a conversation」链接回它)。 */
  sourceConversationId?: string;
  /** 来源人话标签(对话标题;chip 显示)。 */
  sourceLabel?: string;
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
  /** D2 单流:一条 append-only Otto 消息流(dock / /otto / campaign-tab 的单一源)。 */
  ottoStream: NsStreamMsg[];
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
  /** 联系人字段补丁(勿扰/标签编辑 + 合并累加;contactsView/contactByIdView 叠加它) */
  contactPatches: Record<string, Partial<NsContact>>;
  /** 每个联系人的字段变更留痕(档案「变更历史」折叠区读它,最早在前) */
  contactChanges: Record<string, { at: number; label: string }[]>;
  /** 已被合并进别人的联系人 id(从列表隐藏;对其引用回落到主联系人) */
  mergedContactIds: string[];
  /** 从属联系人 id → 主联系人 id(对话归属 + 档案引用重定向) */
  mergedInto: Record<string, string>;
  /** 店主自建分群(人话编译成规则后存这里) */
  customSegments: NsCustomSegment[];
  ottoWorking: boolean;
  ottoLabel: string;
  eventLog: NsEvent[];
  campaignDraft: NsCampaignDraft | null;
  /** Otto 上下文桥:当前在看什么(null = 未设定,dock 不显示 chip)。 */
  ottoContext: NsOttoContext | null;
  /** Otto 行为设置(账户 · Otto 行为面写它;dock 读它反映当前作风)。 */
  ottoBehavior: NsOttoBehavior;
  /** 营业时间设置(离时自动回复;收件箱设置卡读/写它)。 */
  businessHours: NsBusinessHours;
  /** 评论 → 私信:commentId → 生成的对话 id(评论页显示「In DM」链接,不重复转)。 */
  commentThreads: Record<string, string>;
  /** 对话预填草稿:conversationId → 待填文案(Comment-to-DM 生成的 DM 草稿,对话页 seed 一次)。 */
  conversationDrafts: Record<string, string>;
  /** 知识反向回路:人工存进知识库的新条目(知识库页 = 种子 KNOWLEDGE + 这些)。 */
  addedKnowledge: NsKnowledgeAddition[];
  /** 已庆祝过的一次性开店里程碑 key(GM-02/03/05;克制:每个 key 只 toast 一次)。 */
  seenMilestones: string[];
  /** Otto 从赞/踩学到的品牌偏好(brand-memory「Otto 学到的偏好」区读它)。 */
  brandPreferences: NsBrandPreference[];
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
  // D2 单流种子:F1 世界圣经的 62 条 Otto 历史(旧→新),live 发送 append 尾部。
  ottoStream: [...NS_OTTO_STREAM],
  rules: [...NS_RULES],
  members: [...NS_MEMBERS],
  routines: [...NS_ROUTINES],
  resolvedConversationIds: [],
  submittedAdIds: [],
  pausedAiConversationIds: [],
  dealStageOverrides: {},
  inboxContactIds: [],
  contactEvents: {},
  contactPatches: {},
  contactChanges: {},
  mergedContactIds: [],
  mergedInto: {},
  customSegments: [],
  ottoWorking: false,
  ottoLabel: "Otto — idle",
  eventLog: [],
  campaignDraft: null,
  ottoContext: null,
  // 默认最稳:逐次批 + 单笔 ≥50 credits 先问 + 勿扰关(founder 打开设置即可改，dock 立刻反映)。
  ottoBehavior: {
    autonomy: "review-each",
    spendConfirmThreshold: 50,
    quietHours: { enabled: false, from: "22:00", to: "07:00" },
  },
  businessHours: {
    enabled: true,
    open: "09:00",
    close: "18:00",
    awayMessage:
      "Thanks for messaging! We're closed right now (open 9am–6pm daily). Otto will reply first thing — or leave your order and we'll confirm when we open 🥐",
  },
  commentThreads: {},
  conversationDrafts: {},
  addedKnowledge: [],
  seenMilestones: [],
  brandPreferences: [],
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

/** 给某联系人追加一条字段变更留痕(档案「变更历史」读它;seq 已由外层 logEvent 递增) */
function logContactChange(contactId: string, label: string) {
  const prev = state.contactChanges[contactId] ?? [];
  state.contactChanges = { ...state.contactChanges, [contactId]: [...prev, { at: seq, label }] };
}

/** 叠加字段补丁的联系人视图(勿扰/标签/合并累加都走这层)。 */
function applyContactPatch(c: NsContact): NsContact {
  const patch = state.contactPatches[c.id];
  return patch ? { ...c, ...patch } : c;
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

/** 存草稿(composer「Save draft」):落进同一份 scheduledPosts,状态 draft(不入审批队列)。
 * queue 分组「Drafts」读它;home「Up next」的 upNext() 也含 draft。真写库,非死按钮。 */
export function saveDraft(post: NsScheduledPost) {
  const draft: NsScheduledPost = { ...post, status: "draft" };
  const idx = state.scheduledPosts.findIndex((p) => p.id === post.id);
  state.scheduledPosts =
    idx >= 0
      ? state.scheduledPosts.map((p) => (p.id === post.id ? draft : p))
      : [draft, ...state.scheduledPosts];
  logEvent("post_scheduled", `Saved a draft for ${post.platform}`, { id: post.id, platform: post.platform, draft: true });
  notify();
}

/** 日历拖动改期:把一条帖/一条 campaign 条目改到新日期,写回共享 store(跨页持久,
 * 刷新前不丢)。只改日期,保留时间与状态 —— 拖 draft 不会变 scheduled。 */
export function movePostDate(id: string, date: string) {
  const sIdx = state.scheduledPosts.findIndex((p) => p.id === id);
  if (sIdx >= 0) {
    const platform = state.scheduledPosts[sIdx].platform;
    state.scheduledPosts = state.scheduledPosts.map((p) =>
      p.id === id ? { ...p, scheduledAt: `${date}T${p.scheduledAt.slice(11)}` } : p,
    );
    logEvent("post_scheduled", `Moved a ${platform} post to ${date}`, { id, date, moved: true });
    notify();
    return;
  }
  const cIdx = state.campaignEntries.findIndex((e) => e.id === id);
  if (cIdx >= 0) {
    state.campaignEntries = state.campaignEntries.map((e) => (e.id === id ? { ...e, date } : e));
    logEvent("post_scheduled", `Moved a campaign post to ${date}`, { id, date, moved: true });
    notify();
  }
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

/* ── CRM 联系人字段编辑(勿扰 / 标签)——每次改动都留痕(档案「变更历史」)。 ──── */

/** 勿扰(consent)开关:写补丁 + 留痕 + 事件流。勿扰者在群发/排期受众选择器里禁用。 */
export function setContactDnd(id: string, on: boolean) {
  const c = contactByIdView(id);
  if (!c || c.doNotDisturb === on) return;
  state.contactPatches = {
    ...state.contactPatches,
    [c.id]: { ...state.contactPatches[c.id], doNotDisturb: on },
  };
  const label = on ? "Turned on do not disturb" : "Turned off do not disturb";
  logEvent("contact_field_changed", `${label} · ${c.name}`, { id: c.id, field: "doNotDisturb", on });
  logContactChange(c.id, label);
  notify();
}

/** 加一个标签(小写去重)。 */
export function addContactTag(id: string, tag: string) {
  const t = tag.trim().toLowerCase();
  if (!t) return;
  const c = contactByIdView(id);
  if (!c || c.tags.includes(t)) return;
  state.contactPatches = {
    ...state.contactPatches,
    [c.id]: { ...state.contactPatches[c.id], tags: [...c.tags, t] },
  };
  logEvent("contact_field_changed", `Tagged ${c.name} “${t}”`, { id: c.id, field: "tags", tag: t });
  logContactChange(c.id, `Added tag “${t}”`);
  notify();
}

/** 去掉一个标签。 */
export function removeContactTag(id: string, tag: string) {
  const c = contactByIdView(id);
  if (!c || !c.tags.includes(tag)) return;
  state.contactPatches = {
    ...state.contactPatches,
    [c.id]: { ...state.contactPatches[c.id], tags: c.tags.filter((x) => x !== tag) },
  };
  logEvent("contact_field_changed", `Removed “${tag}” from ${c.name}`, { id: c.id, field: "tags", tag });
  logContactChange(c.id, `Removed tag “${tag}”`);
  notify();
}

/** 合并两个联系人:并渠道/标签、累加订单额、取最近 lastSeen、勿扰取并集;从属方隐藏,
 * 其对话/引用重定向到主联系人。判决核心「同一人的另一渠道」差异化卖点的原型体现。 */
export function mergeContacts(primaryId: string, secondaryId: string) {
  if (primaryId === secondaryId) return;
  const primary = contactByIdView(primaryId);
  const secondary = contactByIdView(secondaryId);
  if (!primary || !secondary) return;
  const channels = Array.from(new Set([...primary.channels, ...secondary.channels]));
  const tags = Array.from(new Set([...primary.tags, ...secondary.tags]));
  state.contactPatches = {
    ...state.contactPatches,
    [primaryId]: {
      ...state.contactPatches[primaryId],
      channels,
      tags,
      totalOrdersMyr: primary.totalOrdersMyr + secondary.totalOrdersMyr,
      lastSeen: primary.lastSeen >= secondary.lastSeen ? primary.lastSeen : secondary.lastSeen,
      doNotDisturb: primary.doNotDisturb || secondary.doNotDisturb,
    },
  };
  if (!state.mergedContactIds.includes(secondaryId)) {
    state.mergedContactIds = [...state.mergedContactIds, secondaryId];
  }
  state.mergedInto = { ...state.mergedInto, [secondaryId]: primaryId };
  logEvent("contacts_merged", `Merged ${secondary.name} into ${primary.name}`, { primaryId, secondaryId });
  logContactChange(
    primaryId,
    `Merged ${secondary.name} in · +${secondary.channels.length} channel${secondary.channels.length > 1 ? "s" : ""}, +RM${secondary.totalOrdersMyr.toLocaleString("en-MY")} orders`,
  );
  notify();
}

/* ── 自建分群:人话编译成的规则存这里(可用可删) ───────────────────────────── */
export function addCustomSegment(input: { name: string; phrase: string; rules: NsSegmentRule[] }): string {
  const id = `seg-live-${seq + 1}`;
  state.customSegments = [{ id, name: input.name, phrase: input.phrase, rules: input.rules }, ...state.customSegments];
  logEvent("segment_created", `Created segment · ${input.name}`, { id });
  notify();
  return id;
}

/** Comment-to-DM(蓝图第六章增长钩):把一条公开评论转成私信对话草稿。
 * 补建评论作者为联系人 → 新建一条对话(评论正文当客户首条)→ 存 DM 草稿(Otto 建议)→
 * 返回对话 id 供页面跳转。幂等:同一评论已转过则回落既有对话,不重复建。 */
export function startDmFromComment(input: {
  commentId: string;
  handle: string;
  channel: NsContact["channels"][number];
  postCaption: string;
  commentText: string;
  suggested: string;
  at: string;
}): string {
  const existing = state.commentThreads[input.commentId];
  if (existing) return existing;
  const contactId = `ct-cm-${input.handle}`;
  const hasContact = state.contacts.some((c) => c.id === contactId || c.name === `@${input.handle}`);
  if (!hasContact) {
    const contact: NsContact = {
      id: contactId,
      name: `@${input.handle}`,
      channels: [input.channel],
      lastSeen: input.at.slice(0, 10),
      tags: ["new"],
      doNotDisturb: false,
      totalOrdersMyr: 0,
    };
    state.contacts = [contact, ...state.contacts];
    state.inboxContactIds = [...state.inboxContactIds, contactId];
    logEvent("contact_created", `Added @${input.handle} to contacts`, { id: contactId });
  }
  const cvId = `cv-dm-${seq + 1}`;
  const conversation: NsConversation = {
    id: cvId,
    contactId,
    channel: input.channel,
    subject: `DM · ${input.postCaption}`,
    unread: false,
    aiHandled: false,
    messages: [
      { id: `m-dm-${seq + 1}`, from: "customer", text: input.commentText, at: "Just now" },
    ],
  };
  state.conversations = [conversation, ...state.conversations];
  state.commentThreads = { ...state.commentThreads, [input.commentId]: cvId };
  // 人工插手态:DM 从人工发起,Otto 自动回复默认暂停(横幅为真)。
  state.pausedAiConversationIds = [...state.pausedAiConversationIds, cvId];
  state.conversationDrafts = { ...state.conversationDrafts, [cvId]: input.suggested };
  logEvent("comment_to_dm", `Moved @${input.handle}'s comment to a DM`, { commentId: input.commentId, cvId });
  addContactEvent(contactId, `Moved a public comment to a private DM`);
  notify();
  return cvId;
}

/** 营业时间设置(离时自动回复):店主改时段/away 文案,收件箱与对话页即时反映。 */
export function setBusinessHours(patch: Partial<NsBusinessHours>) {
  state.businessHours = { ...state.businessHours, ...patch };
  logEvent("business_hours_set", "Updated business hours", { ...patch });
  notify();
}

/** 知识反向回路:人工把改写后的答案存进知识库(带来源对话链接)。返回新条目 id。 */
export function addKnowledgeEntry(input: {
  question: string;
  answer: string;
  category?: NsKnowledgeEntry["category"];
  sourceConversationId?: string;
  sourceLabel?: string;
}): string {
  const id = `kb-live-${seq + 1}`;
  const entry: NsKnowledgeAddition = {
    id,
    question: input.question.trim(),
    answer: input.answer.trim(),
    category: input.category ?? "Products",
    usedThisWeek: 0,
    sourceConversationId: input.sourceConversationId,
    sourceLabel: input.sourceLabel,
  };
  state.addedKnowledge = [entry, ...state.addedKnowledge];
  logEvent("knowledge_added", `Saved a new answer to Knowledge · ${entry.question}`, { id });
  notify();
  return id;
}

export function removeCustomSegment(id: string) {
  const seg = state.customSegments.find((s) => s.id === id);
  if (!seg) return;
  state.customSegments = state.customSegments.filter((s) => s.id !== id);
  logEvent("segment_deleted", `Deleted segment · ${seg.name}`, { id });
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

/** 新建一条多步例程(automation/routines 的向导写入)。触发即 cadence,动作即首步,
 * 并带上授权四件套的两件可配项:范围声明 + 本月预算上限(O-02+O-05)。 */
export function addRoutine(input: {
  name: string;
  cadence: string;
  step: string;
  scope?: string[];
  budgetCapCredits?: number;
}): string {
  const id = `rtn-live-${seq + 1}`;
  const routine: NsRoutine = {
    id,
    name: input.name,
    cadence: input.cadence,
    steps: [input.step],
    enabled: true,
    nextRun: "Scheduled",
    scope: input.scope && input.scope.length ? input.scope : [input.step],
    budgetCapCredits: input.budgetCapCredits ?? 0,
    spentThisMonth: 0,
    runs: [],
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

/** 连接器 O-04:赞/踩一个资产 → Otto 学到一条品牌偏好(brand-memory 现新条目)。
 * feedback=null(取消赞/踩)则撤掉该资产从该来源学到的那条;同资产同来源永不重复。 */
export function setBrandPreference(input: {
  assetId: string;
  assetTitle: string;
  source: string;
  feedback: NsBrandFeedback | null;
}) {
  const rest = state.brandPreferences.filter(
    (p) => !(p.assetTitle === input.assetTitle && p.source === input.source),
  );
  if (input.feedback === null) {
    if (rest.length === state.brandPreferences.length) return; // 无变化
    state.brandPreferences = rest;
    logEvent("brand_preference_learned", `Otto unlearned a preference · ${input.assetTitle}`, {
      assetId: input.assetId,
    });
    notify();
    return;
  }
  const note =
    input.feedback === "like"
      ? `Do more like “${input.assetTitle}”.`
      : `Ease off directions like “${input.assetTitle}”.`;
  const pref: NsBrandPreference = {
    id: `bp-${input.source}-${input.assetId}`,
    feedback: input.feedback,
    assetTitle: input.assetTitle,
    source: input.source,
    note,
    at: seq + 1,
  };
  state.brandPreferences = [pref, ...rest];
  logEvent("brand_preference_learned", `Otto learned · ${note}`, {
    assetId: input.assetId,
    feedback: input.feedback,
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
    seatType: "creator",
    initials,
    status: "pending",
    lastActive: "Invited just now",
  };
  state.members = [...state.members, member];
  logEvent("member_invited", `Invited ${trimmed} as an editor`, { email: trimmed });
  notify();
}

/** 改成员角色(Manage 弹窗;Owner 不可改) */
export function setMemberRole(id: string, role: NsMember["role"]) {
  const m = state.members.find((x) => x.id === id);
  if (!m || m.role === "Owner") return;
  state.members = state.members.map((x) => (x.id === id ? { ...x, role } : x));
  logEvent("member_updated", `Changed ${m.name}'s role to ${role.toLowerCase()}`, { id, role });
  notify();
}

/** 改成员席位档(creator 创作席 / approver 审批席;Owner 恒为 creator) */
export function setMemberSeat(id: string, seatType: NsSeatType) {
  const m = state.members.find((x) => x.id === id);
  if (!m || m.role === "Owner") return;
  state.members = state.members.map((x) => (x.id === id ? { ...x, seatType } : x));
  logEvent("member_updated", `Moved ${m.name} to the ${seatType} seat`, { id, seatType });
  notify();
}

/** 移出团队(Manage 弹窗;Owner 不可移) */
export function removeMember(id: string) {
  const m = state.members.find((x) => x.id === id);
  if (!m || m.role === "Owner") return;
  state.members = state.members.filter((x) => x.id !== id);
  logEvent("member_removed", `Removed ${m.name} from the team`, { id });
  notify();
}

export function ottoWorking(on: boolean, label?: string) {
  state.ottoWorking = on;
  state.ottoLabel = on ? label ?? "Otto — working" : "Otto — idle";
  logEvent(on ? "otto_working" : "otto_idle", on ? label ?? "Otto is working" : "Otto finished", {});
  notify();
}

/* ── 聊天(D2 兼容层:旧的 thread API 现在都落进同一条 ottoStream) ─────────────
 * dock / otto-chat / 就地触点共读同一条流 → 「share one state」为真。threadId 在单流
 * 模型里已无意义,兼容签名保留但忽略(所有消息进同一条流)。 */
export function appendChatMessage(_threadId: string, message: NsChatMessage) {
  appendToStream({
    role: message.role === "user" ? "owner" : "otto",
    text: message.text ?? "",
    card: message.card,
    substeps: message.substeps,
    error: message.error,
  });
}

/** 就地 AI 触点统一入口(O-12 / 宪法 7):任意区的就地「问 Otto」按钮调它 —— 请求与回复
 * 落进共享 dock/otto-chat 的同一根线程(chatThreads[0]),不再各页开匿名小 AI。
 * 传 context 顺带点亮上下文桥。组件随后调 openOtto() 把 dock 展开给店主看见这轮对话。 */
export function askOttoInline(prompt: string, reply: string, context?: NsOttoContext) {
  if (context) state.ottoContext = context;
  // D2:就地触点 append 进同一条 ottoStream(dock / /otto 立刻可见);context chip
  // 由当前 ottoContext 派生(zone + label),让这轮往来知道发生在哪个现场。
  appendToStream({ role: "owner", text: prompt });
  appendToStream({ role: "otto", text: reply });
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

/** Otto 行为设置:账户 · Otto 行为面写它(浅合并,quietHours 整体替换)。dock 立即反映。 */
export function setOttoBehavior(patch: Partial<NsOttoBehavior>) {
  state.ottoBehavior = { ...state.ottoBehavior, ...patch };
  notify();
}

/** 开店里程碑(GM-02/03/05):标记一个一次性里程碑已庆祝过(幂等;克制:每 key 只 toast 一次)。 */
export function markMilestone(key: string) {
  if (state.seenMilestones.includes(key)) return;
  state.seenMilestones = [...state.seenMilestones, key];
  notify();
}

/** 该里程碑是否已庆祝过(home 里程碑 toast 的一次性守卫;跨路由存活,重挂载不重放)。 */
export function hasMilestone(key: string): boolean {
  return state.seenMilestones.includes(key);
}

/** D2 兼容:单流模型里没有「多线程」。保留签名(gallery otto-chat 仍调它),返回
 * 唯一的流 id —— 「New chat」= 回到这条连续的流,而不是新开一条要管理的线程。 */
export function startChatThread(_title = "New chat"): string {
  return OTTO_STREAM_THREAD_ID;
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

/** 当前 Otto 行为设置(dock 读它反映作风;Otto 行为面读它回显控件)。 */
export function ottoBehavior(): NsOttoBehavior {
  return state.ottoBehavior;
}

/** Otto 从赞/踩学到的品牌偏好(最新在前;brand-memory「Otto 学到的偏好」区读它)。 */
export function brandPreferences(): NsBrandPreference[] {
  return state.brandPreferences;
}

/** 最近 n 条事件,最新在前。 */
export function recentEvents(n: number): NsEvent[] {
  return state.eventLog.slice(-n).reverse();
}

/** D2 兼容:把单流包成「一条线程」交给旧的 thread-shaped 消费者(gallery otto-chat)。
 * 单一源仍是 ottoStream —— 这里只是把 owner→user 的角色映射回 NsChatMessage 形状。 */
export function chatThreads(): NsChatThread[] {
  return [
    {
      id: OTTO_STREAM_THREAD_ID,
      title: "Otto",
      updatedAt: "Now",
      messages: state.ottoStream.map((m) => ({
        id: m.id,
        role: m.role === "owner" ? ("user" as const) : ("otto" as const),
        text: m.text,
        card: m.card,
        substeps: m.substeps,
        error: m.error,
      })),
    },
  ];
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
  return state.contacts
    .filter((c) => !state.mergedContactIds.includes(c.id))
    .map(applyContactPatch);
}

export function contactByIdView(id: string): NsContact | undefined {
  const resolvedId = state.mergedInto[id] ?? id;
  const c = state.contacts.find((x) => x.id === resolvedId);
  return c ? applyContactPatch(c) : undefined;
}

export function conversationsForContactView(contactId: string): NsConversation[] {
  return state.conversations.filter(
    (c) => (state.mergedInto[c.contactId] ?? c.contactId) === contactId,
  );
}

/** 店主自建分群(分群页列表读它)。 */
export function customSegments(): NsCustomSegment[] {
  return state.customSegments;
}

/** 该联系人的字段变更留痕(最早在前;档案「变更历史」读它)。 */
export function contactChangesFor(id: string): { at: number; label: string }[] {
  return state.contactChanges[id] ?? [];
}

/** 可合并的重复候选:除自己、除已合并者之外的联系人(合并流程选人读它)。 */
export function mergeCandidatesView(id: string): NsContact[] {
  return contactsView().filter((c) => c.id !== id);
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

/** 营业时间设置(收件箱设置卡 / 对话页 away 演示读它)。 */
export function businessHoursView(): NsBusinessHours {
  return state.businessHours;
}

/** 某评论是否已转为私信(评论页显示「In DM」链接,回落对话 id)。 */
export function commentThreadFor(commentId: string): string | undefined {
  return state.commentThreads[commentId];
}

/** 某对话的待填草稿(Comment-to-DM 生成;对话页首次挂载 seed 到输入框)。 */
export function conversationDraftFor(conversationId: string): string | undefined {
  return state.conversationDrafts[conversationId];
}

/** 人工存进知识库的新条目(知识库页 = 种子 KNOWLEDGE + 这些)。 */
export function addedKnowledgeView(): NsKnowledgeAddition[] {
  return state.addedKnowledge;
}

/** 一条对话是否在非营业时段进来的(取首条客户消息的 HH:MM,与时段字符串比较)。
 * away 关或无 ISO 时间戳(实时消息)→ false。确定性,无 Date.now。 */
export function isAfterHoursConversation(conversation: NsConversation): boolean {
  const bh = state.businessHours;
  if (!bh.enabled) return false;
  const firstCustomer = conversation.messages.find((m) => m.from === "customer");
  const at = firstCustomer?.at ?? "";
  if (!at.includes("T")) return false;
  const hhmm = at.slice(11, 16); // "08:12"
  if (hhmm.length !== 5) return false;
  return hhmm < bh.open || hhmm >= bh.close;
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

/* ═══════════════════════════════════════════════════════════════════════════
 * [F2 循环系统] D2 单流 API —— 全城 10 个 zone worker 直接可用
 *
 * 一条 append-only Otto 消息流(state.ottoStream)是唯一源;dock 小窗 / `/otto` 全屏 /
 * campaign 详情「对话」tab 都是它的**过滤视图**。zones 用法:
 *   - 读全流:            streamFor()            // 无过滤 = 整条
 *   - 读某 campaign:     streamFor({ campaignId }) 或 threadForContext(campaignId)
 *   - 读某区往来:        streamFor({ zone: "Inbox" })
 *   - dock 小窗末尾几条: streamTail(n)
 *   - append 一条:      appendToStream({ role, text, context? })
 * 铁律不变:纯 client、零后台 import;coral 只属于 Otto;数据只从 _mock 派生。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 单流唯一 thread id(兼容层 chatThreads()/startChatThread() 用;单流里没有第二条)。 */
export const OTTO_STREAM_THREAD_ID = "otto-stream";

// live append 的单调计数(种子 id 为 os-NN,live 为 os-live-NN,互不撞)。
let streamSeq = 0;

/** 就地触点的 NsOttoContext(view/selectedLabel)映射到单流 context 的区。默认 Studio。 */
const VIEW_ZONE: Record<string, NsOttoZone> = {
  Home: "Home",
  Studio: "Studio",
  Canvas: "Canvas",
  Campaign: "Campaign",
  Campaigns: "Campaign",
  Schedule: "Schedule",
  Inbox: "Inbox",
  CRM: "CRM",
  Contacts: "CRM",
  Analytics: "Analytics",
  Assets: "Assets",
  Library: "Assets",
  Settings: "Settings",
  Connections: "Settings",
};

/** 从当前 ottoContext 派生一条 live 消息的 context chip(dock 发送时 zone 未知走这里)。 */
function streamContextFromOtto(): NsOttoStreamContext {
  const ctx = state.ottoContext;
  const label = ctx?.selectedLabel ?? ctx?.view ?? "Otto";
  const zone = (ctx && VIEW_ZONE[ctx.view]) ?? "Studio";
  return { zone, label };
}

/** 单流唯一 append 入口:任意区把一条消息落进同一条流(dock / /otto / 过滤视图立刻反映)。
 * 不传 context 则从当前 ottoContext 派生。返回新消息 id。 */
export function appendToStream(input: {
  role: "owner" | "otto";
  text: string;
  context?: NsOttoStreamContext;
  card?: NsChatCardKind;
  substeps?: string[];
  error?: boolean;
}): string {
  streamSeq += 1;
  const msg: NsStreamMsg = {
    id: `os-live-${streamSeq}`,
    role: input.role,
    text: input.text,
    at: "Just now",
    context: input.context ?? streamContextFromOtto(),
    card: input.card,
    substeps: input.substeps,
    error: input.error,
  };
  state.ottoStream = [...state.ottoStream, msg];
  notify();
  return msg.id;
}

/** 单流过滤视图(D2 核心):同一条流,按 zone / campaign 收窄。无 filter = 整条流。 */
export function streamFor(filter?: NsStreamFilter): NsStreamMsg[] {
  let s = state.ottoStream;
  if (filter?.zone) s = s.filter((m) => m.context.zone === filter.zone);
  if (filter?.campaignId) s = s.filter((m) => m.context.campaignId === filter.campaignId);
  return s;
}

/** campaign 详情「对话」tab 用:这条全局流按该 campaign 过滤后的视图(= streamFor 的别名)。
 * 不传 campaignId 则回落全流。语义:找旧对话 = 去那件事的页面看,而不是管理线程。 */
export function threadForContext(campaignId?: string): NsStreamMsg[] {
  return streamFor(campaignId ? { campaignId } : undefined);
}

/** dock 小窗显示末尾 n 条(与 /otto 全屏同源,只是窗口大小不同)。 */
export function streamTail(n: number): NsStreamMsg[] {
  return state.ottoStream.slice(Math.max(0, state.ottoStream.length - n));
}

/** 整条 Otto 流(/otto 全屏读它;live append 实时反映)。 */
export function ottoStreamView(): NsStreamMsg[] {
  return state.ottoStream;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * [Z2 Studio·画布] D1 升格:Studio 画布产物「挂进 campaign」
 *
 * D1 唯一「事」容器 = Campaign;Studio 是自由创作台。任何 Studio 产物(canvas 对象 /
 * asset-viewer 里的 take)可一键**升格挂进 campaign** —— 升格不是搬家:产物仍在 Studio,
 * 只是也归到那件事名下。零花费($0)。落一条真记录 + 一条带 campaign context 的 Otto 单流
 * 确认(dock/otto 立刻可见)+ 一条 home/dock 事件。幂等:同产物挂同 campaign 不重复。
 *
 * 铁律不变:纯 client、零后台 import;coral 只属于 Otto;不新造品牌事实(campaign 来自
 * _mock 的 NS_CAMPAIGNS)。本段仅在文件尾追加,未改动任何既有代码。
 * ═══════════════════════════════════════════════════════════════════════════ */
export interface NsPromotedAsset {
  id: string;
  /** 被升格的产物 id(canvas 对象 id / 资产 id) */
  assetId: string;
  title: string;
  kind: "image" | "video";
  /** 缩略图(NS_IMAGES 真图;campaign 详情「内容」tab 可显示) */
  thumb: string;
  campaignId: string;
  campaignName: string;
  at: number;
}

// 模块级镜像(与 state 顶层数组同规矩:append-only,notify 驱动重渲染)。
let promotedAssets: NsPromotedAsset[] = [];

/** 把一个 Studio 产物升格挂进某 campaign(一键、$0)。返回记录 id(幂等回落既有)。 */
export function promoteToCampaign(input: {
  assetId: string;
  title: string;
  kind: "image" | "video";
  thumb: string;
  campaignId: string;
  campaignName: string;
}): string {
  const dup = promotedAssets.find(
    (p) => p.assetId === input.assetId && p.campaignId === input.campaignId,
  );
  if (dup) return dup.id;
  seq += 1;
  const id = `pc-live-${seq}`;
  promotedAssets = [{ id, ...input, at: seq }, ...promotedAssets];
  // home/dock 事件流(recentEvents 读它显示「Just now」条);升格 = 归档动作,不扣额度。
  logEvent("campaign_entry_approved", `Added “${input.title}” to ${input.campaignName}`, {
    assetId: input.assetId,
    campaignId: input.campaignId,
    promoted: true,
  });
  // D2 单流:留一条带该 campaign context 的 Otto 确认(dock/otto/campaign「对话」tab 可见)。
  appendToStream({
    role: "otto",
    text: `Added “${input.title}” to ${input.campaignName}. It still lives in your Studio — now it’s part of that campaign too.`,
    context: { zone: "Campaign", campaignId: input.campaignId, label: input.campaignName },
  });
  // appendToStream 已 notify()。
  return id;
}

/** 升格记录视图(不传 campaignId = 全部;campaign 详情按 id 过滤)。最新在前。 */
export function promotedAssetsView(campaignId?: string): NsPromotedAsset[] {
  return campaignId ? promotedAssets.filter((p) => p.campaignId === campaignId) : promotedAssets;
}

/** 某产物已挂进哪些 campaign 名(canvas 卡显示「In Merdeka week bakes」;空 = 未升格)。 */
export function promotedCampaignsOf(assetId: string): string[] {
  return promotedAssets.filter((p) => p.assetId === assetId).map((p) => p.campaignName);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * [Z3 Studio 量产间] ideas slice + gen 记账助手 —— 文件尾追加,零改动上文。
 *
 * 想法清单是本区自留(其它区不改写它),但 campaign 侧会把落选备胎"落进"这里、
 * home/canvas 从这里读,所以它必须进单例循环系统(而不是页面 useState 持有 mock 副本)。
 * 复用主 store 的 notify()/getVersion:组件 useStore() 即可订阅、live 反映。
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface NsStudioIdea {
  id: string;
  text: string;
  source: "you" | "otto";
  addedAt: string;
  converted: boolean;
  /** campaign 备选点子自动落入 → 标注来源 campaign(缝 5/9 同数据) */
  campaign?: string;
}

const Z3_IDEA_SEED: NsStudioIdea[] = [
  { id: "id-1", text: "Film the 6am croissant fold as a slow reel", source: "you", addedAt: "6 Jul", converted: false },
  { id: "id-2", text: "Merdeka box unboxing from a customer's desk", source: "otto", addedAt: "6 Jul", converted: false },
  { id: "id-3", text: "Pandan cake cross-section macro for the menu", source: "you", addedAt: "5 Jul", converted: true },
  { id: "id-4", text: "Ask regulars which retired bake to bring back", source: "otto", addedAt: "4 Jul", converted: false },
  { id: "id-5", text: "Kopi pairing chart: which brew with which bake", source: "otto", addedAt: "3 Jul", converted: false },
];

/** campaign 备选点子(Otto 策划时的落选备胎,首次进 ideas 页时"落卡")。 */
export const Z3_IDEA_DROPS: NsStudioIdea[] = [
  { id: "id-c1", text: "Office pre-order bundle teaser: one box on every desk", source: "otto", addedAt: "7 Jul", converted: false, campaign: "Merdeka week bakes" },
  { id: "id-c2", text: "Morning timelapse: flag up, ovens on, first batch out", source: "otto", addedAt: "7 Jul", converted: false, campaign: "Merdeka week bakes" },
];

let z3Ideas: NsStudioIdea[] | null = null;
let z3IdeaSeq = 0;

function z3EnsureIdeas(): NsStudioIdea[] {
  if (z3Ideas === null) z3Ideas = [...Z3_IDEA_SEED];
  return z3Ideas;
}

/** 想法清单(单一源;ideas 页 + home「Up next」+ canvas 转创作都读它)。 */
export function studioIdeas(): NsStudioIdea[] {
  return z3EnsureIdeas();
}

/** 记一条想法(店主手记;Enter 提交)。返回新 id。 */
export function addStudioIdea(text: string): string {
  z3IdeaSeq += 1;
  const idea: NsStudioIdea = {
    id: `id-live-${z3IdeaSeq}`,
    text,
    source: "you",
    addedAt: "Just now",
    converted: false,
  };
  z3Ideas = [idea, ...z3EnsureIdeas()];
  notify();
  return idea.id;
}

/** 一键转创作(标记 converted;$0,生成在 canvas 才花钱)。Otto 单流留痕。 */
export function convertStudioIdea(id: string) {
  const list = z3EnsureIdeas();
  const idea = list.find((i) => i.id === id);
  z3Ideas = list.map((i) => (i.id === id ? { ...i, converted: true } : i));
  if (idea) {
    appendToStream({
      role: "otto",
      text: `Opened “${idea.text}” on the canvas. Nothing spent yet — generation asks first.`,
      context: { zone: "Studio", label: "Ideas" },
    });
  }
  notify();
}

/** 删除一条想法(ideas 页 Undo 用 restoreStudioIdea 回填)。 */
export function removeStudioIdea(id: string) {
  z3Ideas = z3EnsureIdeas().filter((i) => i.id !== id);
  notify();
}

/** 回填一条被删的想法(Undo)。 */
export function restoreStudioIdea(idea: NsStudioIdea) {
  z3Ideas = [idea, ...z3EnsureIdeas()];
  notify();
}

/** campaign 备选备胎落卡(ideas 页首访一次;Otto 叙述条走完调用)。 */
export function dropCampaignIdeas() {
  const list = z3EnsureIdeas();
  const have = new Set(list.map((i) => i.id));
  const fresh = Z3_IDEA_DROPS.filter((d) => !have.has(d.id));
  if (fresh.length === 0) return;
  z3Ideas = [...fresh, ...list];
  notify();
}

/** 出片间/分镜的生成记账 + Otto 单流留痕(spend 已由 spendCredits 入账,这里补一条流)。
 * 一处接线,factory/storyboard 完工都落一条 Otto「刚做了什么」进单流(dock/otto 立刻反映)。 */
export function studioLogGen(text: string, label: string) {
  appendToStream({ role: "otto", text, context: { zone: "Studio", label } });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * [campaign-spine] Z4 Campaign 脊梁 —— 文件尾追加(O-12 同一动作层 + D2 对话落流)
 *
 * workbench 四项表单与 Otto 殊途同归都落到 proposeCampaign:存草稿(proposal-card 读)+
 * 在单流落一轮 Campaign context 的往来(D2:这件事的对话自动长在它身上)。detail「对话」
 * tab 的 composer 走 sendCampaignMessage,同一条流按 campaignId 过滤即得该视图。
 * 铁律不变:纯 client、零后台 import;coral 只属于 Otto;数据只从 _mock 派生。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** O-12:workbench/Otto 同一动作层。存草稿 + 在单流落一轮往来(找旧对话 = 去那件事的页面看)。 */
export function proposeCampaign(draft: NsCampaignDraft): void {
  state.campaignDraft = draft;
  const platforms = draft.platforms.length;
  appendToStream({
    role: "owner",
    text: `Plan a campaign — ${draft.goal}`,
    context: { zone: "Campaign", label: "New campaign", campaignId: "camp-merdeka-01" },
  });
  appendToStream({
    role: "otto",
    text: `On it — I'll draft a full plan for "${draft.goal}" across ${platforms} platform${platforms > 1 ? "s" : ""}, kept inside ${draft.budgetCredits} credits. Every post stays a draft until you approve.`,
    context: {
      zone: "Campaign",
      label: "New campaign",
      campaignId: "camp-merdeka-01",
      href: "/northstar-immersive/campaign/proposal-card",
    },
  });
}

/** detail「对话」tab composer:owner 消息落进同一条流,带该 campaign 的 context chip。 */
export function sendCampaignMessage(campaignId: string, label: string, text: string): void {
  const t = text.trim();
  if (!t) return;
  appendToStream({ role: "owner", text: t, context: { zone: "Campaign", label, campaignId } });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 排期区(Z5)· Wave B 附加状态（文件尾追加；自带惰性单例 + 复用 notify）
 * ENDGAME 铁律:一切状态经 _store.ts。这些是排期区独有的原型对象（槽位/频道组/
 * hashtag 组/常青清单/帖标签UTM/提醒发布标记），不属于 _mock 世界圣经，故由区级
 * seed 注入（seedScheduleExtras），品牌事实仍留在区的 data.ts，状态与 notify 留这里。
 * ══════════════════════════════════════════════════════════════════════════ */

export interface NsPostingSlot {
  id: string;
  /** 0=Mon … 6=Sun */
  day: number;
  /** HH:mm */
  time: string;
  channel: NsScheduledPost["platform"];
}
export interface NsChannelGroup {
  id: string;
  name: string;
  channels: NsScheduledPost["platform"][];
}
export interface NsHashtagGroup {
  id: string;
  name: string;
  tags: string[];
}
export interface NsEvergreenList {
  id: string;
  name: string;
  cadenceDays: number;
  items: string[];
  active: boolean;
}
export interface NsPostMeta {
  tags?: string[];
  utm?: string;
  altText?: string;
  reminder?: boolean;
}
interface ScheduleExtras {
  slots: NsPostingSlot[];
  channelGroups: NsChannelGroup[];
  hashtagGroups: NsHashtagGroup[];
  evergreen: NsEvergreenList[];
  postMeta: Record<string, NsPostMeta>;
  remindered: string[];
}

let scheduleExtras: ScheduleExtras | null = null;

/** 惰性 seed（第一次进任意排期页时注入；幂等）。种子来自区的 data.ts，非 store 造。 */
export function seedScheduleExtras(seed: () => Omit<ScheduleExtras, "postMeta" | "remindered">) {
  if (scheduleExtras) return;
  const base = seed();
  scheduleExtras = { ...base, postMeta: {}, remindered: [] };
}
function extras(): ScheduleExtras {
  return scheduleExtras ?? { slots: [], channelGroups: [], hashtagGroups: [], evergreen: [], postMeta: {}, remindered: [] };
}

/* ── 队列槽位（Posting Slots · [wave-b] 槽位配置） ─────────────────────────── */
export function postingSlots(): NsPostingSlot[] {
  return extras().slots;
}
export function addPostingSlot(day: number, time: string, channel: NsScheduledPost["platform"]) {
  const e = extras();
  const id = `slot-${day}-${time}-${channel}`;
  if (e.slots.some((s) => s.id === id)) return;
  e.slots = [...e.slots, { id, day, time, channel }].sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
  logEvent("post_scheduled", `Added a posting slot ${time} for ${channel}`, { slot: id });
  notify();
}
export function removePostingSlot(id: string) {
  const e = extras();
  e.slots = e.slots.filter((s) => s.id !== id);
  notify();
}

/* ── 频道组（Channel Groups · [wave-b] 常用频道组合） ─────────────────────── */
export function channelGroups(): NsChannelGroup[] {
  return extras().channelGroups;
}
export function addChannelGroup(name: string, channels: NsScheduledPost["platform"][]) {
  const e = extras();
  e.channelGroups = [...e.channelGroups, { id: `cg-${seq + 1}-${Date.now()}`, name, channels }];
  logEvent("post_scheduled", `Saved channel group ${name}`, { group: name });
  notify();
}
export function removeChannelGroup(id: string) {
  const e = extras();
  e.channelGroups = e.channelGroups.filter((g) => g.id !== id);
  notify();
}

/* ── Hashtag 组（[wave-b] hashtag 组管理） ────────────────────────────────── */
export function hashtagGroups(): NsHashtagGroup[] {
  return extras().hashtagGroups;
}
export function addHashtagGroup(name: string, tags: string[]) {
  const e = extras();
  e.hashtagGroups = [...e.hashtagGroups, { id: `hg-${seq + 1}-${Date.now()}`, name, tags }];
  logEvent("post_scheduled", `Saved hashtag group ${name}`, { group: name });
  notify();
}
export function removeHashtagGroup(id: string) {
  const e = extras();
  e.hashtagGroups = e.hashtagGroups.filter((g) => g.id !== id);
  notify();
}

/* ── 常青循环清单（[wave-b] Evergreen recycling） ─────────────────────────── */
export function evergreenLists(): NsEvergreenList[] {
  return extras().evergreen;
}
export function addEvergreenList(name: string, cadenceDays: number, items: string[]) {
  const e = extras();
  e.evergreen = [...e.evergreen, { id: `ev-${seq + 1}-${Date.now()}`, name, cadenceDays, items, active: true }];
  logEvent("routine_created", `Started evergreen list ${name}`, { list: name });
  notify();
}
export function toggleEvergreenList(id: string, on: boolean) {
  const e = extras();
  e.evergreen = e.evergreen.map((l) => (l.id === id ? { ...l, active: on } : l));
  notify();
}

/* ── 帖级标签 / UTM / alt / 提醒发布（[wave-b] tags+UTM / alt / reminder） ─── */
export function postMetaFor(id: string): NsPostMeta {
  return extras().postMeta[id] ?? {};
}
export function setPostMeta(id: string, patch: Partial<NsPostMeta>) {
  const e = extras();
  e.postMeta = { ...e.postMeta, [id]: { ...(e.postMeta[id] ?? {}), ...patch } };
  notify();
}
export function isRemindered(id: string): boolean {
  return extras().remindered.includes(id);
}
export function markRemindered(id: string) {
  const e = extras();
  if (e.remindered.includes(id)) return;
  e.remindered = [...e.remindered, id];
  logEvent("post_scheduled", `Marked a post as manually published`, { id, reminder: true });
  notify();
}

/* ── 队列内改时间（[wave-b] move-to-top/bottom;movePostDate 只改日期，这里改时刻） ── */
export function setPostTime(id: string, time: string) {
  const sIdx = state.scheduledPosts.findIndex((p) => p.id === id);
  if (sIdx < 0) return;
  const platform = state.scheduledPosts[sIdx].platform;
  state.scheduledPosts = state.scheduledPosts.map((p) =>
    p.id === id ? { ...p, scheduledAt: `${p.scheduledAt.slice(0, 11)}${time}:00${p.scheduledAt.slice(19)}` } : p,
  );
  logEvent("post_scheduled", `Reordered a ${platform} post to ${time}`, { id, time, moved: true });
  notify();
}

/* ── 草稿→请求审批（[wave-b] Drafts & Approvals tab） ─────────────────────── */
export function requestPostApproval(post: NsScheduledPost, note?: string) {
  saveDraft(post); // 落成草稿（真写库，queue「Drafts」可见）
  pushApproval({
    title: "Review a scheduled post",
    detail: note?.trim()
      ? `An editor asks: ${note.trim()}`
      : `An editor drafted a ${post.platform} post and wants your approval`,
    impacts: ["Publishes on schedule once you approve", "Send back keeps it as a draft to edit"],
    kind: "schedule",
  });
}

/* ── 批量导入（[wave-b] Bulk CSV import）→ 逐条真写草稿（复用 saveDraft） ─── */
export function bulkImportDrafts(rows: NsScheduledPost[]) {
  rows.forEach((r) => saveDraft(r));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * [收件箱 + 生命周期区 · Z6 · 尾部追加] Inbox lifecycle Wave B state
 *
 * ENDGAME §二 Z6:WHATPASS 二章 63 条的可变状态层。全部是模块级 `let` 镜像 + 纯函数
 * 动作(改镜像 + notify;必要时借用现有 logEvent / appendOwnerMessage)。只在文件尾追加,
 * 不改中段。种子静态口径在 crm-inbox/lifecycle-data.ts,这里只存「店主改过什么」的覆盖。
 * 铁律不变:纯 client、零后台;coral 只属于 Otto;数据只从 _mock / 区级视图派生。
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface NsBroadcastRun {
  id: string;
  templateName: string;
  segmentName: string;
  total: number;
  failed: number;
  resent: number;
  followUpKeyword?: string;
  at: string;
}

const ilState = {
  /** WABA 模板送审状态覆盖(种子在 lifecycle-data;submit 演出成 pending) */
  templateStatus: {} as Record<string, "approved" | "pending" | "rejected" | "draft">,
  flowPublished: {} as Record<string, boolean>,
  broadcasts: [] as NsBroadcastRun[],
  recipeOn: {} as Record<string, boolean>,
  keywordRuleOn: {} as Record<string, boolean>,
  commentHookOn: {} as Record<string, boolean>,
  guardrailOn: {} as Record<string, boolean>,
  dataSourceConnected: {} as Record<string, boolean>,
  satisfaction: {} as Record<string, number>,
  assignments: {} as Record<string, string>,
  internalNotes: {} as Record<string, { at: number; author: string; text: string }[]>,
  ticketStatus: {} as Record<string, "open" | "followup" | "resolved">,
  escalatedIds: [] as string[],
  kbPatchDecisions: {} as Record<string, "approved" | "rejected">,
  maskPhone: false,
  autoCloseIdle: true,
  emailChannelOn: false,
  reviewsOn: false,
  weeklyCap: 3,
  abTest: false,
};

/** 收件箱专用:给一条对话追加一条 owner 消息(商品卡/收款链接/弃购提醒共用;可带图)。 */
function appendOwnerMessage(conversationId: string, text: string, imageUrl?: string) {
  const cv = state.conversations.find((c) => c.id === conversationId);
  if (!cv) return;
  const message: NsMessage = { id: `m-live-${seq + 1}`, from: "owner", text, at: "Just now", imageUrl };
  state.conversations = state.conversations.map((c) =>
    c.id === conversationId ? { ...c, messages: [...c.messages, message], unread: false } : c,
  );
  seq += 1;
}

/* ── 动作 ─────────────────────────────────────────────────────────────────── */

/** [wave-b] WABA 模板送审:草稿 → 送审(pending),模板库即刻显示送审中。 */
export function submitTemplate(id: string) {
  ilState.templateStatus = { ...ilState.templateStatus, [id]: "pending" };
  logEvent("automation_rule_created", "Sent a WhatsApp template for review", { id });
  notify();
}

/** [wave-b] WhatsApp Flow 表单发布/收回。 */
export function toggleFlowPublished(id: string, on: boolean) {
  ilState.flowPublished = { ...ilState.flowPublished, [id]: on };
  notify();
}

/** [wave-b] 分群群发:失败数确定性派生(号码质量透传),生成一条送达报表行。 */
export function sendBroadcast(input: { templateName: string; segmentName: string; total: number; followUpKeyword?: string }) {
  const failed = Math.min(3, Math.floor(input.total / 12));
  const run: NsBroadcastRun = {
    id: `bc-${seq + 1}`,
    templateName: input.templateName,
    segmentName: input.segmentName,
    total: input.total,
    failed,
    resent: 0,
    followUpKeyword: input.followUpKeyword,
    at: "Just now",
  };
  ilState.broadcasts = [run, ...ilState.broadcasts];
  logEvent("conversation_replied", `Broadcast sent to ${input.segmentName} · ${input.total} people`, { id: run.id });
  notify();
}

/** [wave-b] 失败重发:把该批 failed 归零、resent 累加。 */
export function resendFailed(runId: string) {
  ilState.broadcasts = ilState.broadcasts.map((b) =>
    b.id === runId ? { ...b, resent: b.resent + b.failed, failed: 0 } : b,
  );
  notify();
}

/** [wave-b] 生命周期配方开关(启用不花钱;每次真花仍走审批)。 */
export function toggleRecipe(id: string, on: boolean) {
  ilState.recipeOn = { ...ilState.recipeOn, [id]: on };
  logEvent("automation_toggled", on ? "Turned on a lifecycle recipe" : "Turned off a lifecycle recipe", { id, on });
  notify();
}

export function toggleKeywordRule(id: string, on: boolean) { ilState.keywordRuleOn = { ...ilState.keywordRuleOn, [id]: on }; notify(); }
export function toggleCommentHook(id: string, on: boolean) { ilState.commentHookOn = { ...ilState.commentHookOn, [id]: on }; notify(); }
export function toggleGuardrail(id: string, on: boolean) { ilState.guardrailOn = { ...ilState.guardrailOn, [id]: on }; notify(); }
export function toggleEmailChannel(on: boolean) { ilState.emailChannelOn = on; notify(); }
export function toggleReviews(on: boolean) { ilState.reviewsOn = on; notify(); }
export function toggleMaskPhone(on: boolean) { ilState.maskPhone = on; notify(); }
export function toggleAutoCloseIdle(on: boolean) { ilState.autoCloseIdle = on; notify(); }
export function setWeeklyCap(n: number) { ilState.weeklyCap = Math.max(1, n); notify(); }
export function toggleAbTest(on: boolean) { ilState.abTest = on; notify(); }

/** [wave-b] 触发数据源连接(订单/行为事件;连上后依赖它的配方解灰)。 */
export function connectDataSource(id: string) {
  ilState.dataSourceConnected = { ...ilState.dataSourceConnected, [id]: true };
  logEvent("channel_connected", "Connected an order data source", { id });
  notify();
}

/** [wave-b] 会话满意度(店主模拟客户 1–5 分回填;挂对话档案)。 */
export function setSatisfaction(conversationId: string, score: number) {
  ilState.satisfaction = { ...ilState.satisfaction, [conversationId]: score };
  const cv = state.conversations.find((c) => c.id === conversationId);
  if (cv) addContactEvent(cv.contactId, `Rated this chat ${score}/5`);
  notify();
}

/** [wave-b] 会话认领/指派(谁在接:你 / Otto / 队友)。 */
export function assignConversation(conversationId: string, who: string) {
  ilState.assignments = { ...ilState.assignments, [conversationId]: who };
  logEvent("conversation_replied", `Assigned a chat to ${who}`, { id: conversationId, who });
  notify();
}

/** [wave-b] 内部备注(私密,不发给客户)。 */
export function addInternalNote(conversationId: string, author: string, text: string) {
  const t = text.trim();
  if (!t) return;
  const prev = ilState.internalNotes[conversationId] ?? [];
  ilState.internalNotes = { ...ilState.internalNotes, [conversationId]: [...prev, { at: seq + 1, author, text: t }] };
  seq += 1;
  notify();
}

/** [wave-b] 三态工单:处理中 / 待跟进 / 已解决(resolved 复用 resolveConversation)。 */
export function setTicketStatus(conversationId: string, status: "open" | "followup" | "resolved") {
  ilState.ticketStatus = { ...ilState.ticketStatus, [conversationId]: status };
  if (status === "resolved") {
    resolveConversation(conversationId);
    return; // resolveConversation 已 notify
  }
  notify();
}

/** [wave-b] 转人工升级:标记 + 暂停该会话 Otto(护栏落地:AI 不硬撑)。 */
export function escalateConversation(conversationId: string) {
  if (!ilState.escalatedIds.includes(conversationId)) {
    ilState.escalatedIds = [...ilState.escalatedIds, conversationId];
  }
  setConversationAi(conversationId, true); // 已 notify
}

/** [wave-b] 自愈知识库:审批一条 Otto 起草的知识补丁(approve → 真进知识库)。 */
export function decideKbPatch(patch: { id: string; question: string; answer: string; category: NsKnowledgeEntry["category"]; sourceLabel: string; sourceConversationId: string }, decision: "approved" | "rejected") {
  ilState.kbPatchDecisions = { ...ilState.kbPatchDecisions, [patch.id]: decision };
  if (decision === "approved") {
    addKnowledgeEntry({
      question: patch.question,
      answer: patch.answer,
      category: patch.category,
      sourceConversationId: patch.sourceConversationId,
      sourceLabel: patch.sourceLabel,
    }); // 已 notify
    return;
  }
  notify();
}

/** [wave-b] 聊天内商务:发一张商品卡(真图 + 名称价格),append 进对话。 */
export function sendCatalogCard(conversationId: string, card: { name: string; priceMyr: number; image: string }) {
  appendOwnerMessage(conversationId, `${card.name} — RM${card.priceMyr.toLocaleString("en-MY")}. Reply to reserve 🛒`, card.image);
  logEvent("conversation_replied", `Sent a product card · ${card.name}`, { id: conversationId });
  notify();
}

/** [wave-b] 聊天内收款链接(跳商家自己账户;原型不经 FIKIRTIVE 钱路)。 */
export function sendPayLink(conversationId: string, amountMyr: number) {
  appendOwnerMessage(conversationId, `Here's your secure payment link for RM${amountMyr.toLocaleString("en-MY")} → pay.rotibulan.my/${(seq + 1).toString(36)}`);
  logEvent("conversation_replied", `Sent a payment link · RM${amountMyr}`, { id: conversationId });
  notify();
}

/** [wave-b] 弃购挽回:发一条温和的「还想要吗」提醒。 */
export function sendAbandonedNudge(conversationId: string, item: string) {
  appendOwnerMessage(conversationId, `Still thinking about the ${item}? I can hold one for you till end of day — just say the word 🙂`);
  logEvent("conversation_replied", `Sent an abandoned-cart nudge · ${item}`, { id: conversationId });
  notify();
}

/* ── 选择器(种子来自 lifecycle-data;这里只叠加店主覆盖) ──────────────────────── */
export function templateStatusFor(id: string, seed: "approved" | "pending" | "rejected" | "draft"): "approved" | "pending" | "rejected" | "draft" {
  return ilState.templateStatus[id] ?? seed;
}
export function isFlowPublished(id: string, seed: boolean): boolean {
  return ilState.flowPublished[id] ?? seed;
}
export function broadcastsView(): NsBroadcastRun[] { return ilState.broadcasts; }
export function isRecipeOn(id: string, seed: boolean): boolean { return ilState.recipeOn[id] ?? seed; }
export function isKeywordRuleOn(id: string, seed: boolean): boolean { return ilState.keywordRuleOn[id] ?? seed; }
export function isCommentHookOn(id: string, seed: boolean): boolean { return ilState.commentHookOn[id] ?? seed; }
export function isGuardrailOn(id: string, seed: boolean): boolean { return ilState.guardrailOn[id] ?? seed; }
export function isDataSourceConnected(id: string, seed: boolean): boolean { return ilState.dataSourceConnected[id] ?? seed; }
export function satisfactionFor(conversationId: string): number | undefined { return ilState.satisfaction[conversationId]; }
export function assignmentFor(conversationId: string, fallback: string): string { return ilState.assignments[conversationId] ?? fallback; }
export function internalNotesFor(conversationId: string): { at: number; author: string; text: string }[] { return ilState.internalNotes[conversationId] ?? []; }
export function ticketStatusFor(conversationId: string, seed: "open" | "followup" | "resolved"): "open" | "followup" | "resolved" {
  if (state.resolvedConversationIds.includes(conversationId)) return "resolved";
  return ilState.ticketStatus[conversationId] ?? seed;
}
export function isEscalated(conversationId: string): boolean { return ilState.escalatedIds.includes(conversationId); }
export function isMaskPhone(): boolean { return ilState.maskPhone; }
export function isAutoCloseIdle(): boolean { return ilState.autoCloseIdle; }
export function isEmailChannelOn(): boolean { return ilState.emailChannelOn; }
export function isReviewsOn(): boolean { return ilState.reviewsOn; }
export function kbPatchDecision(id: string): "approved" | "rejected" | undefined { return ilState.kbPatchDecisions[id]; }
export function recipeSendSettings(): { weeklyCap: number; abTest: boolean } { return { weeklyCap: ilState.weeklyCap, abTest: ilState.abTest }; }

/** [wave-b] 客服/AI 绩效小面板(全部派生自会话镜像,不写死)。 */
export function inboxPerformance(): { open: number; ottoAnswered: number; resolved: number; resolutionRate: number } {
  const all = state.conversations;
  const ottoAnswered = all.filter((c) => c.aiHandled).length;
  const resolved = all.filter((c) => state.resolvedConversationIds.includes(c.id) || c.state === "resolved").length;
  const open = all.length - resolved;
  const resolutionRate = all.length ? Math.round((resolved / all.length) * 100) : 0;
  return { open, ottoAnswered, resolved, resolutionRate };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * [endgame CRM · Z7] CRM 区状态切片 —— 文件尾追加(注明区名 CRM;不改文件中段)
 *
 * 自定义字段 / 待办任务 / 报价单 / 大单门槛 / CSV 导入 + 来源建档,是 CRM 区独有的
 * 可变状态。放在这一块独立切片(crmState)里,复用上面同一套 notify/subscribe/seq/
 * logEvent/addContactEvent/logContactChange —— 组件在 useStore() 下调本节的选择器,
 * 任何动作 notify() 后全城即时反映。ES import 提升,置于文件尾合法且不动中段。
 *
 * 铁律不变:纯 client、零后台 import;coral 只属于 Otto;金额只从 totalOrdersMyr 派生。
 * ═══════════════════════════════════════════════════════════════════════════ */

import { nsImage, type NsHeat, type NsLifecycle } from "@/components/northstar/_mock";

/* ── 类型 ─────────────────────────────────────────────────────────────────── */
export type NsCustomFieldType = "text" | "number" | "date" | "select";
/** [wave-b] 自定义字段:每行行业要记的客户属性不一样(保单到期日 / 上次疗程日期…)。 */
export interface NsCustomField {
  id: string;
  label: string;
  type: NsCustomFieldType;
  value: string;
}
/** [wave-b] 待办任务:「明天记得跟进这个客户」设个提醒。 */
export interface NsCrmTodo {
  id: string;
  contactId: string;
  title: string;
  due: string; // ISO date（可空串 = 无到期）
  done: boolean;
  at: number;
}
export interface NsQuoteLine {
  productId: string;
  name: string;
  qty: number;
  priceMyr: number;
}
/** [wave-b] 极简报价单 + 收款链接(资金不经 FIKIRTIVE,链接跳商家自己账户)。 */
export interface NsQuote {
  id: string;
  contactId: string;
  lines: NsQuoteLine[];
  note: string;
  status: "sent" | "paid";
  payLink: string;
  at: number;
}

interface CrmSlice {
  customFields: Record<string, NsCustomField[]>;
  todos: NsCrmTodo[];
  quotes: NsQuote[];
  /** [wave-b] 大单提醒门槛(金额超此值的成交主动提醒;老板可调) */
  bigDealThreshold: number;
  /** [wave-b] 进线自动建档:CSV 导入 / 广告表单补建的联系人 id(来源标注读它) */
  leadContactIds: string[];
}

const crmState: CrmSlice = {
  customFields: {},
  todos: [],
  quotes: [],
  bigDealThreshold: 1000,
  leadContactIds: [],
};

let crmSeq = 0;

/* ── 自定义字段(变更进档案「变更历史」——复用 logContactChange 单一留痕管道) ──── */
export function addContactField(contactId: string, label: string, type: NsCustomFieldType, value: string) {
  const l = label.trim();
  if (!l) return;
  crmSeq += 1;
  seq += 1;
  const field: NsCustomField = { id: `cf-${crmSeq}`, label: l, type, value: value.trim() };
  crmState.customFields[contactId] = [...(crmState.customFields[contactId] ?? []), field];
  logContactChange(contactId, `Added field “${l}”${field.value ? ` · ${field.value}` : ""}`);
  logEvent("contact_field_changed", `Added field “${l}” to a contact`, { contactId, field: l });
  notify();
}

export function updateContactField(contactId: string, fieldId: string, value: string) {
  const fields = crmState.customFields[contactId];
  if (!fields) return;
  const f = fields.find((x) => x.id === fieldId);
  if (!f || f.value === value.trim()) return;
  crmState.customFields[contactId] = fields.map((x) => (x.id === fieldId ? { ...x, value: value.trim() } : x));
  seq += 1;
  logContactChange(contactId, `Updated “${f.label}” to ${value.trim() || "—"}`);
  notify();
}

export function removeContactField(contactId: string, fieldId: string) {
  const fields = crmState.customFields[contactId];
  if (!fields) return;
  const f = fields.find((x) => x.id === fieldId);
  if (!f) return;
  crmState.customFields[contactId] = fields.filter((x) => x.id !== fieldId);
  seq += 1;
  logContactChange(contactId, `Removed field “${f.label}”`);
  notify();
}

export function contactFieldsFor(id: string): NsCustomField[] {
  return crmState.customFields[id] ?? [];
}

/* ── 待办任务(挂联系人;到期展示;完成勾选) ────────────────────────────────── */
export function addContactTodo(contactId: string, title: string, due: string) {
  const t = title.trim();
  if (!t) return;
  crmSeq += 1;
  seq += 1;
  const todo: NsCrmTodo = { id: `todo-${crmSeq}`, contactId, title: t, due: due.trim(), done: false, at: seq };
  crmState.todos = [todo, ...crmState.todos];
  addContactEvent(contactId, `Added a task · ${t}`);
  notify();
}

export function toggleContactTodo(id: string) {
  const todo = crmState.todos.find((x) => x.id === id);
  if (!todo) return;
  crmState.todos = crmState.todos.map((x) => (x.id === id ? { ...x, done: !x.done } : x));
  notify();
}

export function contactTodosFor(id: string): NsCrmTodo[] {
  return crmState.todos.filter((t) => t.contactId === id);
}

export function allOpenTodos(): NsCrmTodo[] {
  return crmState.todos.filter((t) => !t.done);
}

/* ── 报价单 + 收款链接(接商家自己的收款渠道;资金不经 FIKIRTIVE) ──────────────── */
export function createQuote(input: { contactId: string; lines: NsQuoteLine[]; note: string }): string {
  const total = input.lines.reduce((s, l) => s + l.priceMyr * l.qty, 0);
  crmSeq += 1;
  seq += 1;
  const id = `q-${crmSeq}`;
  const quote: NsQuote = {
    id,
    contactId: input.contactId,
    lines: input.lines,
    note: input.note.trim(),
    status: "sent",
    payLink: `https://pay.rotibulan.my/q/${id}`,
    at: seq,
  };
  crmState.quotes = [quote, ...crmState.quotes];
  addContactEvent(input.contactId, `Sent a quote · RM${total.toLocaleString("en-MY")}`);
  logEvent("contact_field_changed", `Sent a quote to a contact · RM${total.toLocaleString("en-MY")}`, {
    contactId: input.contactId,
    total,
  });
  notify();
  return id;
}

export function markQuotePaid(id: string) {
  const q = crmState.quotes.find((x) => x.id === id);
  if (!q || q.status === "paid") return;
  crmState.quotes = crmState.quotes.map((x) => (x.id === id ? { ...x, status: "paid" } : x));
  const total = q.lines.reduce((s, l) => s + l.priceMyr * l.qty, 0);
  addContactEvent(q.contactId, `Payment received · RM${total.toLocaleString("en-MY")}`);
  notify();
}

export function quotesFor(id: string): NsQuote[] {
  return crmState.quotes.filter((q) => q.contactId === id);
}

/* ── 大单提醒门槛 ───────────────────────────────────────────────────────────── */
export function setBigDealThreshold(n: number) {
  const v = Math.max(0, Math.round(n));
  if (crmState.bigDealThreshold === v) return;
  crmState.bigDealThreshold = v;
  notify();
}

export function bigDealThresholdValue(): number {
  return crmState.bigDealThreshold;
}

/* ── 进线自动建档 + 来源标注(CSV 导入 / 广告表单)——头像取 NS_IMAGES ────────────
 * 查重:名字与现有联系人首词相同即视作可能重复,由调用方在预览里决定是否跳过。 */
export function importContacts(
  rows: { name: string; phone?: string; channel: NsContact["channels"][number]; tags?: string[]; source?: string }[],
): { added: number; skipped: number } {
  const existing = contactsView();
  let added = 0;
  let skipped = 0;
  const fresh: NsContact[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    const dup = existing.some((c) => c.name.replace(/^@/, "").toLowerCase() === name.toLowerCase());
    if (dup) {
      skipped += 1;
      continue;
    }
    crmSeq += 1;
    seq += 1;
    const id = `ct-imp-${crmSeq}`;
    const contact: NsContact = {
      id,
      name,
      channels: [row.channel],
      lastSeen: "2026-07-08",
      tags: row.tags && row.tags.length ? row.tags : ["new"],
      doNotDisturb: false,
      totalOrdersMyr: 0,
      avatar: nsImage("portrait", 23 + crmSeq),
      lifecycle: "new" as NsLifecycle,
      heat: "warm" as NsHeat,
      source: row.source ?? "Imported list",
      phone: row.phone?.trim() || undefined,
    };
    fresh.push(contact);
    if (!crmState.leadContactIds.includes(id)) crmState.leadContactIds.push(id);
    state.inboxContactIds = [...state.inboxContactIds, id];
    addContactEvent(id, `Imported from a spreadsheet · ${row.source ?? "customer list"}`);
    added += 1;
  }
  if (fresh.length) {
    state.contacts = [...fresh, ...state.contacts];
    logEvent("contact_created", `Imported ${added} contact${added === 1 ? "" : "s"}`, { added, skipped });
  }
  notify();
  return { added, skipped };
}

/** 广告/表单单条进线自动建档(来源标注):CTWA 点击 → 一条带来源的新客户记录。 */
export function captureLeadContact(input: {
  name: string;
  channel: NsContact["channels"][number];
  source: string;
}): string {
  crmSeq += 1;
  seq += 1;
  const id = `ct-lead-${crmSeq}`;
  const contact: NsContact = {
    id,
    name: input.name.trim(),
    channels: [input.channel],
    lastSeen: "2026-07-08",
    tags: ["new"],
    doNotDisturb: false,
    totalOrdersMyr: 0,
    avatar: nsImage("portrait", 27 + crmSeq),
    lifecycle: "new",
    heat: "warm",
    source: input.source,
  };
  state.contacts = [contact, ...state.contacts];
  state.inboxContactIds = [...state.inboxContactIds, id];
  if (!crmState.leadContactIds.includes(id)) crmState.leadContactIds.push(id);
  logEvent("contact_created", `New lead auto-added · ${contact.name}`, { id, source: input.source });
  addContactEvent(id, `Auto-added from ${input.source}`);
  notify();
  return id;
}

export function isLeadContact(id: string): boolean {
  return crmState.leadContactIds.includes(id);
}

"use client";

/**
 * 对话 —— 一条客服线程的全文。气泡分 customer / owner / otto 三方(§N3 色);
 * 顶部把客户连回档案(conversation → contact-profile),底部 Otto 起草区可「一键采用」
 * 到输入框(§8a coral sweep 收尾)。?id= 选线程,缺省第一条。
 *
 * 血管:消息流 / 联系人 / Otto 接管态全部读共享 store。Send 真发(append 到
 * store.conversations、清空输入、滚到底);人工发送即暂停该会话的自动回复,顶部横幅为真;
 * Otto auto-reply 开关 dispatch automation 事件(setConversationAi)。
 *
 * O-06 答案溯源:Otto 的建议回复从知识库匹配(matchKnowledge)——命中则挂可点「依据」chip
 * 连回知识库那一条;未命中则显示「无把握,请人工」,不捏造。
 * 知识反向回路:人工改写草稿 / 亲手答掉无依据的问题后,弹「存进知识库?」chip →
 * 新条目落 store,知识库页出现(带来源对话链接)。
 * 营业时间:非营业时段进来的对话顶部演示 away 自动回复气泡(读 businessHoursView)。
 */

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, BookOpen, Check, CreditCard, Languages, Moon, ShieldAlert, ShoppingBag, Send, Sparkles, StickyNote, User, Users, Wand2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/northstar/_shared";
import {
  CRM_INBOX_BASE as BASE,
  ChannelTag,
  fmtStamp,
  Initials,
  INBOX_CHANNELS,
  useSweep,
} from "./kit";
import { matchKnowledge } from "./data";
import { OttoAssist } from "../otto-assist";
import {
  SNIPPETS,
  CATALOG_CARDS,
  TONES,
  applyTone,
  draftReplyFor,
  translateDraft,
  detectLanguage,
  escalationSignal,
  type NsTone,
} from "./lifecycle-data";
import {
  useStore,
  askOttoInline,
  conversationByIdView,
  contactByIdView,
  conversationsView,
  isAiPaused,
  isResolved,
  resolveConversation,
  sendConversationMessage,
  setConversationAi,
  businessHoursView,
  conversationDraftFor,
  addKnowledgeEntry,
  isAfterHoursConversation,
  teamMembers,
  assignmentFor,
  assignConversation,
  internalNotesFor,
  addInternalNote,
  ticketStatusFor,
  setTicketStatus,
  isEscalated,
  escalateConversation,
  satisfactionFor,
  setSatisfaction,
  sendCatalogCard,
  sendPayLink,
  sendAbandonedNudge,
  isMaskPhone,
} from "../_store";

/** 号码遮罩(防飞单):保留前 3 位与后 2 位,中间打点。 */
function maskNumber(phone: string): string {
  const total = (phone.match(/\d/g) ?? []).length;
  let seen = 0;
  return phone.replace(/\d/g, (d) => {
    seen += 1;
    return seen <= 3 || seen > total - 2 ? d : "•";
  });
}

function Bubble({ from, text, at, imageUrl }: { from: "customer" | "owner" | "otto"; text: string; at: string; imageUrl?: string }) {
  const mine = from === "owner" || from === "otto";
  // 实时发出的消息 at = "Just now"(非 ISO);种子消息才走 fmtStamp
  const stamp = at.includes("T") ? fmtStamp(at) : at;
  return (
    <div className={"flex flex-col gap-1 " + (mine ? "items-end" : "items-start")}>
      <div
        className={
          "max-w-[76%] overflow-hidden rounded-[16px] text-sm leading-5 " +
          (from === "customer"
            ? "bg-secondary text-foreground"
            : from === "owner"
              ? "bg-primary text-primary-foreground"
              : "border border-border bg-card text-foreground")
        }
      >
        {/* 图片消息(真图,取自 NS_IMAGES;固定 4:3 容器防布局跳动) */}
        {imageUrl && (
          <div className="aspect-[4/3] w-[220px] max-w-full bg-secondary">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="Shared in chat" className="h-full w-full object-cover" loading="lazy" />
          </div>
        )}
        <div className="px-3.5 py-2.5">
          {from === "otto" && (
            <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
              <Sparkles className="size-3" strokeWidth={2} />
              Otto
            </span>
          )}
          {text}
        </div>
      </div>
      <span className="px-1 text-[11px] text-muted-foreground">{stamp}</span>
    </div>
  );
}

export function InboxConversation() {
  const params = useSearchParams();
  useStore(); // 订阅共享 store:消息流 / 接管态变化即时反映
  const conversations = conversationsView();
  const id = params.get("id") ?? conversations[0]?.id ?? "";
  const conversation = conversationByIdView(id) ?? conversations[0];
  const sweep = useSweep();
  const composerSweep = useSweep();
  const [draft, setDraft] = React.useState("");
  const endRef = React.useRef<HTMLDivElement>(null);
  const count = conversation?.messages.length ?? 0;

  // 采用了哪条 Otto 草稿(用于「人工改写后弹存进知识库」判定;null = 未采用)
  const [adopted, setAdopted] = React.useState<string | null>(null);
  // 存进知识库的待办 chip(人工改写 / 亲手答无依据问题后出现)
  const [teach, setTeach] = React.useState<{ question: string; answer: string } | null>(null);
  // 已存进知识库(显示「Saved → Knowledge」链接)
  const [savedId, setSavedId] = React.useState<string | null>(null);
  // 坐席辅助 / 商务面板局部 UI 态(纯 UI,不持 mock 副本)
  const [assistOpen, setAssistOpen] = React.useState<null | "snippets" | "catalog">(null);
  const [showNotes, setShowNotes] = React.useState(false);
  const [noteDraft, setNoteDraft] = React.useState("");
  const [tone, setTone] = React.useState<NsTone>("casual");

  // Comment-to-DM 生成的草稿:首次进这条对话时 seed 到输入框一次
  const seededFor = React.useRef<string>("");
  const seedDraft = conversation ? conversationDraftFor(conversation.id) : undefined;
  React.useEffect(() => {
    if (!conversation) return;
    if (seededFor.current !== conversation.id && seedDraft) {
      setDraft(seedDraft);
      seededFor.current = conversation.id;
    }
  }, [conversation, seedDraft]);

  // 新消息 append 后滚到底
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  if (!conversation) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-16">
        <EmptyState title="Conversation not found" body="This thread may have been closed." />
      </div>
    );
  }

  const contact = contactByIdView(conversation.contactId);
  const paused = isAiPaused(conversation.id);
  const resolved = isResolved(conversation.id);
  const bh = businessHoursView();
  const afterHours = isAfterHoursConversation(conversation);

  const lastMsg = conversation.messages[conversation.messages.length - 1];
  const awaitingReply = lastMsg?.from === "customer";
  // O-06:建议回复的依据 —— 从最近一条客户消息匹配知识库(命中才建议)
  const source = awaitingReply ? matchKnowledge(lastMsg.text) : undefined;

  // [wave-b] 连续轮次/置信度双闸 + 三类人在环升级信号(护栏落地:AI 不硬撑)
  const escalation = escalationSignal(conversation);
  const escalated = isEscalated(conversation.id);
  // [wave-b] 会话认领/指派(默认:Otto 在管 → Otto,否则你)
  const defaultAssignee = conversation.aiHandled && !paused ? "Otto" : "You";
  const assignee = assignmentFor(conversation.id, defaultAssignee);
  const team = teamMembers();
  const assignChoices = ["You", "Otto", ...team.map((m) => m.name)];
  // [wave-b] 三态工单
  const seedStatus: "open" | "followup" | "resolved" = resolved ? "resolved" : conversation.state === "overdue" ? "followup" : "open";
  const ticketStatus = ticketStatusFor(conversation.id, seedStatus);
  const notes = internalNotesFor(conversation.id);
  const csat = satisfactionFor(conversation.id);
  const masked = isMaskPhone();
  // [wave-b] 自动语言检测(Manglish/马来/英)
  const detectedLang = awaitingReply ? detectLanguage(lastMsg.text) : undefined;

  function send() {
    const sent = draft.trim();
    if (!sent) return;
    // 存进知识库判定要在 send 改变消息流之前算(用当前 lastMsg)
    const teachQuestion = awaitingReply ? lastMsg.text : null;
    const editedDraft = adopted !== null && sent !== adopted.trim();
    const filledGap = adopted === null && awaitingReply && !source;
    sendConversationMessage(conversation.id, sent);
    setDraft("");
    if (teachQuestion && (editedDraft || filledGap)) {
      setTeach({ question: teachQuestion, answer: sent });
      setSavedId(null);
    }
    setAdopted(null);
  }

  // §O7 Otto 帮我(composer):意图产出回填输入框(只填草稿,发送仍要坐席亲手点)。
  // 记为 adopted → 坐席改写后发送会触发「存进知识库?」回路,与 Write 按钮同源。
  const onComposerApply = (apply: { patch: Record<string, unknown> }) => {
    const next = apply.patch.draft;
    if (typeof next === "string") {
      setDraft(next);
      setAdopted(next);
      composerSweep.fire();
    }
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-16">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" asChild>
          <Link href={`${BASE}/inbox/shared`}>
            <ArrowLeft strokeWidth={2} />
            Inbox
          </Link>
        </Button>
        <div className="flex-1" />
        {/* [wave-b] 会话认领/指派(谁在接) */}
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Users className="size-3.5" strokeWidth={2} />
          <select
            value={assignee}
            onChange={(e) => assignConversation(conversation.id, e.target.value)}
            className="h-8 rounded-[8px] border border-border bg-card px-2 text-xs font-semibold text-foreground"
            aria-label="Assign this chat"
          >
            {assignChoices.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Otto auto-reply
          <Switch
            checked={!paused}
            onCheckedChange={(on) => setConversationAi(conversation.id, !on)}
            aria-label="Let Otto reply automatically on this thread"
          />
        </label>
      </div>

      {/* [wave-b] 三态工单(处理中 / 待跟进 / 已解决)+ 内部备注入口 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5">
          {([
            { id: "open", label: "Open" },
            { id: "followup", label: "Follow up" },
            { id: "resolved", label: "Resolved" },
          ] as const).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setTicketStatus(conversation.id, s.id)}
              aria-current={ticketStatus === s.id ? "true" : undefined}
              className={
                "flex h-[30px] items-center rounded-[8px] px-3 text-xs font-semibold transition-colors duration-[120ms] " +
                (ticketStatus === s.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              {s.label}
            </button>
          ))}
        </div>
        {conversation.waitingFor && ticketStatus !== "resolved" && (
          <Badge variant={conversation.state === "overdue" ? "warning" : "outline"}>
            Waiting {conversation.waitingFor}
          </Badge>
        )}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setShowNotes((v) => !v)}>
          <StickyNote strokeWidth={2} />
          Notes{notes.length > 0 ? ` (${notes.length})` : ""}
        </Button>
      </div>

      {/* [wave-b] 内部协作:私密备注(不发给客户) */}
      {showNotes && (
        <div className="mt-3 rounded-[16px] border border-dashed border-border bg-secondary/40 p-3">
          <p className="mb-2 text-[11px] font-semibold text-muted-foreground">Private notes — only your team sees these</p>
          {notes.length > 0 && (
            <div className="mb-2 flex flex-col gap-1.5">
              {notes.map((n) => (
                <div key={n.at} className="rounded-[10px] bg-card px-3 py-2 text-[13px] leading-[18px] text-foreground">
                  <span className="mr-1.5 text-[11px] font-semibold text-muted-foreground">{n.author}</span>
                  {n.text}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Add a note or @mention a teammate…"
              className="h-9"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addInternalNote(conversation.id, "You", noteDraft);
                  setNoteDraft("");
                }
              }}
            />
            <Button size="sm" variant="secondary" disabled={!noteDraft.trim()} onClick={() => { addInternalNote(conversation.id, "You", noteDraft); setNoteDraft(""); }}>
              Add
            </Button>
          </div>
        </div>
      )}

      {/* 线程头:客户 → 档案 */}
      <div className="mt-4 flex items-center gap-3 rounded-[16px] border border-border bg-card px-4 py-3">
        {contact && <Initials name={contact.name} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{contact?.name ?? conversation.subject}</p>
            <ChannelTag channel={conversation.channel} />
            {conversation.aiHandled && <Badge variant="success">Otto answered</Badge>}
            {afterHours && (
              <Badge variant="outline">
                <Moon className="size-3" strokeWidth={2} />
                After hours
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {conversation.subject} · {INBOX_CHANNELS[conversation.channel].label}
            {contact?.phone && (
              <>
                {" · "}
                <span className="font-mono">{masked ? maskNumber(contact.phone) : contact.phone}</span>
              </>
            )}
          </p>
        </div>
        {contact && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`${BASE}/crm/contact-profile?id=${contact.id}`}>
              <User strokeWidth={2} />
              View contact
            </Link>
          </Button>
        )}
      </div>

      {/* 营业时间:非营业时段进来 → 演示 Otto 已自动发出的 away 回复 */}
      {afterHours && (
        <div className="mt-3 rounded-[16px] border border-dashed border-border bg-secondary/40 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <Moon className="size-3.5" strokeWidth={2} />
            Came in outside your hours ({bh.open}–{bh.close}) — Otto auto-replied
          </div>
          <div className="mt-2">
            <Bubble from="otto" text={bh.awayMessage} at="Sent automatically" />
          </div>
          <Link
            href={`${BASE}/inbox/shared`}
            className="mt-1 inline-block px-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:underline"
          >
            Change your hours or away message
          </Link>
        </div>
      )}

      {/* [wave-b] 升级信号:双闸 / 三类人在环 —— Otto 主动交回人类,不硬撑装懂 */}
      {escalation.tripped && !paused && !escalated && (
        <div className="mt-3 flex items-start gap-2.5 rounded-[16px] border border-warning-soft-foreground/25 bg-warning-soft/40 p-3.5">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning-soft-foreground" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Otto flagged this for a human</p>
            <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{escalation.reason}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => escalateConversation(conversation.id)}>
            Take over
          </Button>
        </div>
      )}
      {escalated && (
        <div className="mt-3 flex items-center gap-2 rounded-[12px] border border-border bg-secondary/60 px-4 py-2.5">
          <ShieldAlert className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          <p className="min-w-0 flex-1 text-xs leading-4 text-foreground">Escalated to you — Otto is standing by, not replying automatically.</p>
        </div>
      )}

      {/* 人工插手 → 自动停(横幅为真) */}
      {paused && (
        <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-border bg-secondary/60 px-4 py-2.5">
          <p className="min-w-0 flex-1 text-xs leading-4 text-foreground">
            You stepped in — Otto paused automatic replies on this thread.
          </p>
          <Button variant="ghost" size="sm" onClick={() => setConversationAi(conversation.id, false)}>
            Let Otto resume
          </Button>
        </div>
      )}

      {/* 消息流 */}
      <div className="mt-4 flex flex-col gap-3">
        {conversation.messages.map((m) => (
          <Bubble key={m.id} from={m.from} text={m.text} at={m.at} imageUrl={m.imageUrl} />
        ))}
        <div ref={endRef} />
      </div>

      {/* Otto 起草 + 采用(O-06:命中知识库才建议,并挂可点依据;未命中显示无把握) */}
      {awaitingReply &&
        (source ? (
          <div className="mt-6 rounded-[16px] border border-border bg-card p-3" style={sweep.style}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <Sparkles className="size-3.5" strokeWidth={2} />
              Otto suggests a reply
            </div>
            <p className="mt-1.5 text-sm leading-5 text-foreground">{source.answer}</p>
            {/* 依据 chip:点开知识库对应那一条(O-06 溯源可点验证) */}
            <Link
              href={`${BASE}/inbox/knowledge?highlight=${source.id}`}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <BookOpen className="size-3" strokeWidth={2} />
              Based on “{source.question}”
            </Link>
            <div className="mt-2.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDraft(source.answer);
                  setAdopted(source.answer);
                  sweep.fire();
                  // 就地 Otto 统一(O-12):这条建议进共享 dock/otto-chat 同一线程 + 点亮上下文桥,
                  // 不再是每个对话各开一个匿名小 AI。
                  askOttoInline(
                    `Draft a reply to ${contact?.name ?? "this customer"} in the inbox.`,
                    source.answer,
                    {
                      view: "Inbox",
                      selectedId: conversation.id,
                      selectedLabel: contact?.name ? `Chat with ${contact.name}` : "Inbox thread",
                    },
                  );
                }}
              >
                Use this draft
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex items-start gap-2.5 rounded-[16px] border border-border bg-secondary/40 p-3.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Otto isn’t sure about this one</p>
              <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
                Nothing in your Knowledge matches this question, so Otto won’t guess. Best to reply in your own words —
                you can teach Otto the answer afterwards.
              </p>
            </div>
          </div>
        ))}

      {/* 知识反向回路:人工改写草稿 / 亲手答无依据问题后 → 存进知识库? */}
      {teach && !savedId && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[16px] border border-border bg-card px-4 py-3" style={sweep.style}>
          <BookOpen className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          <p className="min-w-0 flex-1 text-sm text-foreground">
            Save your answer to Knowledge so Otto can answer this next time?
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const newId = addKnowledgeEntry({
                question: teach.question,
                answer: teach.answer,
                category: source?.category,
                sourceConversationId: conversation.id,
                sourceLabel: conversation.subject,
              });
              setSavedId(newId);
              sweep.fire();
            }}
          >
            Save to Knowledge
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setTeach(null)}>
            Not now
          </Button>
        </div>
      )}
      {savedId && (
        <div className="mt-4 flex items-center gap-2 rounded-[16px] border border-border bg-secondary/40 px-4 py-3">
          <Check className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          <p className="min-w-0 flex-1 text-sm text-foreground">Saved. Otto can use this answer now.</p>
          <Button size="sm" variant="ghost" asChild>
            <Link href={`${BASE}/inbox/knowledge?highlight=${savedId}`}>View in Knowledge</Link>
          </Button>
        </div>
      )}

      {/* [wave-b] 会话后满意度小问:已解决 → 一条评分请求(店主可模拟客户回填) */}
      {resolved && (
        <div className="mt-4 rounded-[16px] border border-border bg-secondary/40 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <Sparkles className="size-3.5" strokeWidth={2} />
            Otto sent a quick rating request when you resolved this
          </div>
          {csat ? (
            <p className="mt-2 text-sm text-foreground">{contact?.name?.split(" ")[0] ?? "The customer"} rated this chat <span className="font-semibold">{csat}/5</span> 💛</p>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Preview their reply:</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setSatisfaction(conversation.id, n)}
                  className="flex size-8 items-center justify-center rounded-full border border-border text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label={`Rate ${n} of 5`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* [wave-b] 聊天内商务:商品目录卡 grid(点即发真图商品卡) */}
      {assistOpen === "catalog" && (
        <div className="mt-4 rounded-[16px] border border-border bg-card p-3">
          <p className="mb-2 text-[11px] font-semibold text-muted-foreground">Send a product card</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CATALOG_CARDS.map((c) => (
              <button
                key={c.productId}
                type="button"
                onClick={() => { sendCatalogCard(conversation.id, c); setAssistOpen(null); }}
                className="overflow-hidden rounded-[12px] border border-border text-left transition-colors hover:bg-accent"
              >
                <div className="aspect-[4/3] w-full bg-secondary">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.image} alt={c.name} className="h-full w-full object-cover" loading="lazy" />
                </div>
                <div className="px-2 py-1.5">
                  <p className="truncate text-[12px] font-semibold text-foreground">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground">RM{c.priceMyr.toLocaleString("en-MY")}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* [wave-b] 快捷话术库:点即插入草稿 */}
      {assistOpen === "snippets" && (
        <div className="mt-4 rounded-[16px] border border-border bg-card p-2">
          <p className="px-2 pt-1 pb-2 text-[11px] font-semibold text-muted-foreground">Quick replies — tap to insert</p>
          {SNIPPETS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { setDraft((d) => (d ? `${d} ${s.text}` : s.text)); setAssistOpen(null); }}
              className="flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-accent"
            >
              <code className="rounded-[6px] bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-secondary-foreground">{s.shortcut}</code>
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{s.text}</span>
            </button>
          ))}
        </div>
      )}

      {/* 输入框:Send 真发(append 到 store、清空、滚到底) */}
      <div className="mt-4 rounded-[16px] border border-border bg-card p-2" style={composerSweep.style}>
        {/* [wave-b] 坐席辅助工具条:帮写 / 翻译 / 三档语气 / 话术 / 商品 / 收款 / 弃购提醒 */}
        <div className="flex flex-wrap items-center gap-1 px-1 pb-2">
          {/* [wave-c] §O7 Otto 帮我:醒目入口(旧 Write 只是个小魔杖,读不出「帮我写」)。
              带上下文=这条对话+客户名,意图 chip 零打字起草,Apply 回填输入框。 */}
          <OttoAssist
            zone="Inbox"
            entityId={conversation.id}
            entityLabel={contact?.name}
            formState={{ awaitingReply, lastCustomerMessage: awaitingReply ? lastMsg.text : undefined, detectedLang }}
            label="Ask Otto to write"
            className="ns-pressable bg-card"
            intents={[
              {
                id: "reply-friendly",
                label: "Write a friendly reply",
                prompt: `Draft a friendly reply to ${contact?.name?.split(" ")[0] ?? "this customer"}.`,
                reply: "Here's a warm reply you can send as-is or tweak:",
                apply: {
                  summary: "Fill the reply box with a friendly draft",
                  patch: { draft: draftReplyFor(awaitingReply ? lastMsg.text : "") },
                },
              },
              {
                id: "reply-price",
                label: "Quote a price",
                prompt: "Draft a reply that quotes the price and asks how many they'd like.",
                reply: "A price reply lands best with the number and a next step. Set the real item and price:",
                apply: {
                  summary: "Fill the reply box with a price quote",
                  patch: { draft: `Thanks for asking! [Item] is RM[price] each. Let me know how many you'd like and I'll confirm your order.` },
                },
              },
              {
                id: "reply-confirm",
                label: "Confirm the order",
                prompt: "Draft a reply that confirms the order and pickup.",
                reply: "Here's an order confirmation — fill in the item and pickup time:",
                apply: {
                  summary: "Fill the reply box with an order confirmation",
                  patch: { draft: `Order confirmed! I've noted [items]. Ready by [time] — pay on pickup, or I can send a payment link, whichever's easier.` },
                },
              },
            ]}
            onApply={onComposerApply}
          />
          <div className="mx-1 h-4 w-px bg-border" />
          <ToolbarButton icon={Wand2} label="Write" onClick={() => { const t = draftReplyFor(awaitingReply ? lastMsg.text : ""); setDraft(t); setAdopted(t); }} />
          <ToolbarButton icon={Languages} label="Translate" onClick={() => setDraft((d) => translateDraft(d || (awaitingReply ? lastMsg.text : "")))} disabled={!draft.trim() && !awaitingReply} />
          <ToolbarButton icon={Zap} label="Snippets" onClick={() => setAssistOpen((v) => (v === "snippets" ? null : "snippets"))} />
          <ToolbarButton icon={ShoppingBag} label="Product" onClick={() => setAssistOpen((v) => (v === "catalog" ? null : "catalog"))} />
          <ToolbarButton icon={CreditCard} label="Pay link" onClick={() => sendPayLink(conversation.id, contact?.predictedNextMyr ?? 50)} />
          <div className="mx-1 h-4 w-px bg-border" />
          {/* 三档语气 */}
          <div className="inline-flex items-center gap-0.5 rounded-[8px] border border-border p-0.5">
            {TONES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setTone(t.id); setDraft((d) => (d.trim() ? applyTone(d, t.id) : d)); }}
                aria-current={tone === t.id ? "true" : undefined}
                className={"rounded-[6px] px-2 py-1 text-[11px] font-semibold transition-colors " + (tone === t.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>
          {detectedLang && (
            <span className="ml-auto rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[11px] text-muted-foreground">Detected: {detectedLang}</span>
          )}
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // [wave-c] #38 修零提示卡点:Cmd/Ctrl+↵ 与 Shift+↵(项目 §10 约定)都发送;
            // 裸 Enter 故意留作换行——客服回复框宁可不误发(安全 > 效率)。
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey || e.shiftKey)) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={`Reply to ${contact?.name?.split(" ")[0] ?? "customer"}…`}
          className="min-h-[64px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center gap-2 px-1 pb-1">
          {/* [wave-b] 弃购挽回:一键温和提醒 */}
          <Button size="sm" variant="ghost" onClick={() => sendAbandonedNudge(conversation.id, "your order")}>
            Send a nudge
          </Button>
          <div className="flex-1" />
          {/* [wave-c] #38 明说怎么发:WhatsApp 肌肉记忆是 Enter=发,这里 Enter=换行,零提示必卡人 */}
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            Enter for a new line · ⌘↵ or Shift+↵ to send
          </span>
          <Button size="sm" className="ns-pressable" disabled={!draft.trim()} onClick={send}>
            <Send strokeWidth={2} />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 坐席辅助工具条按钮(§F 图标+文案 chip)。 */
function ToolbarButton({ icon: Icon, label, onClick, disabled }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
    >
      <Icon className="size-3.5" strokeWidth={2} />
      {label}
    </button>
  );
}

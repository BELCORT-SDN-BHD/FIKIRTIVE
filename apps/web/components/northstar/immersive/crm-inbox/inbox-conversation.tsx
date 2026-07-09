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
import { AlertTriangle, ArrowLeft, BookOpen, Check, Moon, Send, Sparkles, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
} from "../_store";

function Bubble({ from, text, at }: { from: "customer" | "owner" | "otto"; text: string; at: string }) {
  const mine = from === "owner" || from === "otto";
  // 实时发出的消息 at = "Just now"(非 ISO);种子消息才走 fmtStamp
  const stamp = at.includes("T") ? fmtStamp(at) : at;
  return (
    <div className={"flex flex-col gap-1 " + (mine ? "items-end" : "items-start")}>
      <div
        className={
          "max-w-[76%] rounded-[16px] px-3.5 py-2.5 text-sm leading-5 " +
          (from === "customer"
            ? "bg-secondary text-foreground"
            : from === "owner"
              ? "bg-primary text-primary-foreground"
              : "border border-border bg-card text-foreground")
        }
      >
        {from === "otto" && (
          <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
            <Sparkles className="size-3" strokeWidth={2} />
            Otto
          </span>
        )}
        {text}
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
  const [draft, setDraft] = React.useState("");
  const endRef = React.useRef<HTMLDivElement>(null);
  const count = conversation?.messages.length ?? 0;

  // 采用了哪条 Otto 草稿(用于「人工改写后弹存进知识库」判定;null = 未采用)
  const [adopted, setAdopted] = React.useState<string | null>(null);
  // 存进知识库的待办 chip(人工改写 / 亲手答无依据问题后出现)
  const [teach, setTeach] = React.useState<{ question: string; answer: string } | null>(null);
  // 已存进知识库(显示「Saved → Knowledge」链接)
  const [savedId, setSavedId] = React.useState<string | null>(null);

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

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-16">
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" asChild>
          <Link href={`${BASE}/inbox/shared`}>
            <ArrowLeft strokeWidth={2} />
            Inbox
          </Link>
        </Button>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Otto auto-reply
          <Switch
            checked={!paused}
            onCheckedChange={(on) => setConversationAi(conversation.id, !on)}
            aria-label="Let Otto reply automatically on this thread"
          />
        </label>
        <Button
          variant={resolved ? "ghost" : "secondary"}
          size="sm"
          disabled={resolved}
          onClick={() => resolveConversation(conversation.id)}
        >
          <Check strokeWidth={2} />
          {resolved ? "Resolved" : "Resolve"}
        </Button>
      </div>

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
          <Bubble key={m.id} from={m.from} text={m.text} at={m.at} />
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

      {/* 输入框:Send 真发(append 到 store、清空、滚到底) */}
      <div className="mt-4 rounded-[16px] border border-border bg-card p-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={`Reply to ${contact?.name?.split(" ")[0] ?? "customer"}…`}
          className="min-h-[64px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-end gap-2 px-1 pb-1">
          <Button size="sm" disabled={!draft.trim()} onClick={send}>
            <Send strokeWidth={2} />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

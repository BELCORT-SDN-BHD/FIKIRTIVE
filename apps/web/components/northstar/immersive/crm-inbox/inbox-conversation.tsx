"use client";

/**
 * 对话 —— 一条客服线程的全文。气泡分 customer / owner / otto 三方(§N3 色);
 * 顶部把客户连回档案(conversation → contact-profile),底部 Otto 起草区可「一键采用」
 * 到输入框(§8a coral sweep 收尾)。?id= 选线程,缺省第一条。
 *
 * 血管:消息流 / 联系人 / Otto 接管态全部读共享 store。Send 真发(append 到
 * store.conversations、清空输入、滚到底);人工发送即暂停该会话的自动回复,顶部横幅为真;
 * Otto auto-reply 开关 dispatch automation 事件(setConversationAi)。
 */

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Send, Sparkles, User } from "lucide-react";
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
import {
  useStore,
  conversationByIdView,
  contactByIdView,
  conversationsView,
  isAiPaused,
  isResolved,
  resolveConversation,
  sendConversationMessage,
  setConversationAi,
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
  const lastCustomer = [...conversation.messages].reverse().find((m) => m.from === "customer");
  // Otto 起草的建议回复,取自最近一条客户消息的语气(演示态,不落后台)
  const suggestion = conversation.aiHandled
    ? "Confirmed! I've booked 20 kaya butter croissants for Friday 9am pickup, RM170 total. See you then 🥐"
    : "Yes, everything is halal certified. Would you like me to reserve a pandan gula melaka cake for you?";

  function send() {
    if (!draft.trim()) return;
    sendConversationMessage(conversation.id, draft);
    setDraft("");
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

      {/* Otto 起草 + 采用 */}
      <div className="mt-6 rounded-[16px] border border-border bg-card p-3" style={sweep.style}>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <Sparkles className="size-3.5" strokeWidth={2} />
          Otto suggests a reply
        </div>
        <p className="mt-1.5 text-sm leading-5 text-foreground">{suggestion}</p>
        <div className="mt-2.5 flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDraft(suggestion);
              sweep.fire();
            }}
          >
            Use this draft
          </Button>
          {lastCustomer && (
            <span className="text-[11px] text-muted-foreground">In reply to “{lastCustomer.text.slice(0, 40)}{lastCustomer.text.length > 40 ? "…" : ""}”</span>
          )}
        </div>
      </div>

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

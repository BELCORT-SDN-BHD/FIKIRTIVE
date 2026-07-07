"use client";

/**
 * 对话 —— 一条客服线程的全文。气泡分 customer / owner / otto 三方(§N3 色);
 * 顶部把客户连回档案(conversation → contact-profile),底部 Otto 起草区可「一键采用」
 * 到输入框(§8a coral sweep 收尾)。?id= 选线程,缺省第一条。
 */

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Send, Sparkles, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { CONVERSATIONS, contactById, conversationById } from "./data";

function Bubble({ from, text, at }: { from: "customer" | "owner" | "otto"; text: string; at: string }) {
  const mine = from === "owner" || from === "otto";
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
      <span className="px-1 text-[11px] text-muted-foreground">{fmtStamp(at)}</span>
    </div>
  );
}

export function InboxConversation() {
  const params = useSearchParams();
  const id = params.get("id") ?? CONVERSATIONS[0]?.id ?? "";
  const conversation = conversationById(id) ?? CONVERSATIONS[0];
  const sweep = useSweep();
  const [draft, setDraft] = React.useState("");

  if (!conversation) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-16">
        <EmptyState title="Conversation not found" body="This thread may have been closed." />
      </div>
    );
  }

  const contact = contactById(conversation.contactId);
  const lastCustomer = [...conversation.messages].reverse().find((m) => m.from === "customer");
  // Otto 起草的建议回复,取自最近一条客户消息的语气(演示态,不落后台)
  const suggestion = conversation.aiHandled
    ? "Confirmed! I've booked 20 kaya butter croissants for Friday 9am pickup, RM170 total. See you then 🥐"
    : "Yes, everything is halal certified. Would you like me to reserve a pandan gula melaka cake for you?";

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

      {/* 消息流 */}
      <div className="mt-4 flex flex-col gap-3">
        {conversation.messages.map((m) => (
          <Bubble key={m.id} from={m.from} text={m.text} at={m.at} />
        ))}
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

      {/* 输入框(演示态:不真发) */}
      <div className="mt-4 rounded-[16px] border border-border bg-card p-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Reply to ${contact?.name?.split(" ")[0] ?? "customer"}…`}
          className="min-h-[64px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-end gap-2 px-1 pb-1">
          <Button size="sm" disabled={!draft.trim()}>
            <Send strokeWidth={2} />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

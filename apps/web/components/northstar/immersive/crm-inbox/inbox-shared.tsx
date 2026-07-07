"use client";

/**
 * 收件箱客服区 —— 所有渠道的对话汇总成一条流。unread / Otto-handled 用 §N3 状态色;
 * 每一行点开对话(shared → conversation),对话里再连到客户档案,收件箱与 CRM 连成流。
 * 过滤器(全部 / 未读 / Otto 已答)是纯 client 状态,不发明数据。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import {
  CRM_INBOX_BASE as BASE,
  ChannelTag,
  InboxNav,
  Card,
  fmtStamp,
  Initials,
} from "./kit";
import { CONVERSATIONS, contactById } from "./data";

type Filter = "all" | "unread" | "otto";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "otto", label: "Otto handled" },
];

export function InboxShared() {
  const [filter, setFilter] = React.useState<Filter>("all");

  const shown = CONVERSATIONS.filter((cv) => {
    if (filter === "unread") return cv.unread;
    if (filter === "otto") return cv.aiHandled;
    return true;
  });

  const unreadCount = CONVERSATIONS.filter((c) => c.unread).length;
  const ottoCount = CONVERSATIONS.filter((c) => c.aiHandled).length;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Shared inbox"
        subtitle="Every channel in one thread. Otto drafts; you tap to send."
        actions={<InboxNav />}
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Open threads" value={String(CONVERSATIONS.length)} />
        <StatCard label="Unread" value={String(unreadCount)} />
        <StatCard label="Otto handled" value={String(ottoCount)} />
      </div>

      <div className="mt-6 inline-flex items-center gap-0.5 self-start rounded-[10px] border border-border bg-card p-0.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-current={filter === f.id ? "true" : undefined}
            className={
              "flex h-[30px] items-center rounded-[8px] px-3 text-xs font-semibold transition-colors duration-[120ms] " +
              (filter === f.id
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card className="mt-4 overflow-hidden">
        {shown.length > 0 ? (
          shown.map((cv) => {
            const contact = contactById(cv.contactId);
            const last = cv.messages[cv.messages.length - 1];
            return (
              <Link
                key={cv.id}
                href={`${BASE}/inbox/conversation?id=${cv.id}`}
                className="group flex items-center gap-3 border-t border-border px-4 py-3 transition-colors first:border-t-0 hover:bg-accent"
              >
                {contact && <Initials name={contact.name} />}
                <ChannelTag channel={cv.channel} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{contact?.name ?? cv.subject}</p>
                    {cv.unread && <Badge variant="warning">Unread</Badge>}
                    {cv.aiHandled && <Badge variant="success">Otto answered</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{last?.text}</p>
                </div>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{last ? fmtStamp(last.at) : ""}</span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} />
              </Link>
            );
          })
        ) : (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <span className="flex size-11 items-center justify-center rounded-[14px] bg-secondary">
              <Inbox className="size-5 text-muted-foreground" strokeWidth={2} />
            </span>
            <p className="text-sm font-semibold text-foreground">Nothing here</p>
            <p className="text-xs text-muted-foreground">No threads match this filter.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

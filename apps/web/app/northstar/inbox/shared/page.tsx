/* @nsPage district="收件箱客服区" page="shared" status="draft"
   sources="红旗五判决;P2-1/P2-2;harmony-01 #8" approvedAt="" pr="" */
"use client";

/**
 * 共享收件箱 — WhatsApp-first 多渠道收件箱(团队共用)。
 * 清单元素:会话列表 · 受理人(人或 Otto)· 渠道徽标 · 未答优先。
 * 未答优先 = 默认排序把「最后一条是客户、无人回」的会话顶到最上,并给未答计数与专属筛选。
 * Otto 正在敲回复的行(ottoLive)显示 live 云标记 + 一行现在进行时,店主一眼看见「Otto 在接」。
 * 三态齐全(§D4)· coral 只属于 Otto · 纯展示零后台。
 */

import * as React from "react";
import Link from "next/link";
import { Inbox, Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, MockNote, PageHeader } from "@/components/northstar/_shared";
import {
  AssigneeChip,
  ChannelTag,
  ContactAvatar,
  ConversationRowsSkeleton,
  DemoStateBar,
  ErrorPanel,
  fmtWhen,
  type DemoState,
} from "@/components/northstar/inbox/kit";
import { IB_CONVERSATIONS, type IbConversation } from "@/components/northstar/inbox/mock-inbox";

type Filter = "unanswered" | "all" | "mine" | "otto";

function lastMessage(c: IbConversation) {
  return c.messages[c.messages.length - 1];
}

/** 未答优先排序:needsReply 顶上,其次未读,其次时间倒序 */
function sortInbox(list: IbConversation[]): IbConversation[] {
  return [...list].sort((a, b) => {
    if (a.needsReply !== b.needsReply) return a.needsReply ? -1 : 1;
    if (a.unread !== b.unread) return a.unread ? -1 : 1;
    const am = lastMessage(a);
    const bm = lastMessage(b);
    return `${bm.day}T${bm.time}`.localeCompare(`${am.day}T${am.time}`);
  });
}

function previewText(c: IbConversation): string {
  const m = lastMessage(c);
  if (m.media) return "Photo";
  if (m.from === "note") return m.text;
  const who = m.from === "customer" ? "" : m.from === "otto" ? "Otto: " : "You: ";
  return `${who}${m.text}`;
}

function ConversationRow({ c }: { c: IbConversation }) {
  const m = lastMessage(c);
  return (
    <Link
      href="/northstar/inbox/conversation"
      className="group flex items-start gap-3 border-t border-border px-3 py-3 transition-colors first:border-t-0 hover:bg-accent"
    >
      <div className="relative shrink-0">
        <ContactAvatar initials={c.initials} />
        {c.unread && (
          <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-info ring-2 ring-card" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate text-[14px] leading-5", c.unread ? "font-semibold text-foreground" : "font-medium text-foreground")}>
            {c.contactName}
          </span>
          <ChannelTag channel={c.channel} />
          {c.needsReply && (
            <span className="inline-flex h-5 items-center rounded-full bg-warning-soft px-2 text-[10px] font-semibold tracking-[0.02em] text-warning-soft-foreground">
              Needs reply
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {fmtWhen(m.day, m.time)}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          {c.ottoLive ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground">
              <OttoAvatar size={16} mood="thinking" />
              <span className="truncate">Otto is typing a reply…</span>
            </span>
          ) : (
            <span className={cn("truncate text-[13px] leading-[18px]", c.unread ? "text-foreground" : "text-muted-foreground")}>
              {previewText(c)}
            </span>
          )}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <AssigneeChip assignee={c.assignee} live={c.ottoLive} />
          {c.tags.map((t) => (
            <span key={t} className="inline-flex h-5 items-center rounded-full bg-secondary px-2 text-[10px] font-medium text-muted-foreground">
              {t}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("data");
  const [filter, setFilter] = React.useState<Filter>("unanswered");

  const sorted = React.useMemo(() => sortInbox(IB_CONVERSATIONS), []);
  const unansweredCount = sorted.filter((c) => c.needsReply).length;

  const visible = React.useMemo(() => {
    switch (filter) {
      case "unanswered":
        return sorted.filter((c) => c.needsReply);
      case "mine":
        return sorted.filter((c) => c.assignee === "owner");
      case "otto":
        return sorted.filter((c) => c.assignee === "otto");
      default:
        return sorted;
    }
  }, [filter, sorted]);

  const filters: { key: Filter; label: string; count?: number }[] = [
    { key: "unanswered", label: "Needs reply", count: unansweredCount },
    { key: "all", label: "All", count: sorted.length },
    { key: "otto", label: "Otto is handling", count: sorted.filter((c) => c.assignee === "otto").length },
    { key: "mine", label: "Mine" },
  ];

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Inbox"
        subtitle="Every conversation your shop is having, in one shared place."
        meta={[`${unansweredCount} need reply`]}
        actions={
          <Button variant="secondary" size="sm">
            <SlidersHorizontal strokeWidth={2} />
            Filters
          </Button>
        }
      />

      {/* 搜索(占位:原型不接后台) */}
      <div className="mt-4 flex h-10 items-center gap-2 rounded-[12px] border border-border bg-card px-3 text-muted-foreground">
        <Search className="size-4" strokeWidth={2} />
        <span className="text-[13px]">Search people, messages, or tags</span>
      </div>

      {/* 未答优先筛选行 */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors",
              filter === f.key
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {f.label}
            {f.count !== undefined && <span className="text-muted-foreground/70 tabular-nums">{f.count}</span>}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-[18px] border border-border bg-card px-1">
        {demo === "loading" && (
          <div className="px-2 py-1">
            <ConversationRowsSkeleton rows={5} />
          </div>
        )}

        {demo === "error" && <ErrorPanel text="Couldn't load your inbox." onRetry={() => setDemo("data")} />}

        {demo === "empty" && (
          <EmptyState
            icon={Inbox}
            title="Inbox zero"
            body="No open conversations right now. New messages from WhatsApp, Instagram, and Facebook land here."
          />
        )}

        {demo === "data" &&
          (visible.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Nothing here"
              body="No conversations match this filter."
              action={
                <Button variant="secondary" size="sm" onClick={() => setFilter("all")}>
                  Show all
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col">
              {visible.map((c) => (
                <ConversationRow key={c.id} c={c} />
              ))}
            </div>
          ))}
      </div>

      {demo === "data" && filter === "unanswered" && unansweredCount > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <OttoAvatar size={16} mood="idle" />
          Otto handles routine questions on its own. These are the ones it left for a person.
        </p>
      )}

      <DemoStateBar value={demo} onChange={(v) => setDemo(v as DemoState)} />
      <MockNote path="/northstar/inbox/shared" />
    </div>
  );
}

"use client";

/**
 * 收件箱客服区 —— 所有渠道的对话汇总成一条流。unread / Otto-handled 用 §N3 状态色;
 * 每一行点开对话(shared → conversation),对话里再连到客户档案,收件箱与 CRM 连成流。
 * 过滤器(全部 / 未读 / Otto 已答)是纯 client 状态,不发明数据。
 *
 * 营业时间自动回复:顶部设置卡(时段 + 离时 away 文案 + 实时气泡演示)读/写共享 store;
 * 非营业时段进来的对话在列表里自动打「After hours」标(isAfterHoursConversation)。
 */

import * as React from "react";
import Link from "next/link";
import { AlarmClock, ArrowRight, Clock, Inbox, Moon, Sparkles, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import {
  CRM_INBOX_BASE as BASE,
  ChannelTag,
  InboxNav,
  Card,
  CardHeader,
  fmtStamp,
  Initials,
} from "./kit";
import { KEYWORD_RULES } from "./lifecycle-data";
import {
  useStore,
  conversationsView,
  contactByIdView,
  businessHoursView,
  setBusinessHours,
  isAfterHoursConversation,
  assignmentFor,
  inboxPerformance,
  isKeywordRuleOn,
  toggleKeywordRule,
  isAutoCloseIdle,
  toggleAutoCloseIdle,
} from "../_store";

type Filter = "all" | "unread" | "otto" | "overdue";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "otto", label: "Otto handled" },
  { id: "overdue", label: "Needs follow-up" },
];

/** Otto 一键入口(零学习曲线三查):一句写好的 away 文案,点了真填进去。 */
const OTTO_AWAY_DRAFT =
  "Thanks for your message! We’re closed right now — our hours are 9am to 6pm daily. Otto will get back to you first thing, or drop your order here and we’ll confirm as soon as we open 🥐";

function BusinessHoursCard() {
  const bh = businessHoursView();
  const [open, setOpen] = React.useState(false);

  return (
    <Card className="mt-6 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-secondary">
          <Clock className="size-4 text-muted-foreground" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Business hours &amp; after-hours reply</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {bh.enabled ? `Open ${bh.open}–${bh.close} · auto-reply on when you're closed` : "After-hours auto-reply is off"}
          </p>
        </div>
        <Switch
          checked={bh.enabled}
          onCheckedChange={(on) => setBusinessHours({ enabled: on })}
          aria-label="Turn the after-hours auto-reply on or off"
        />
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? "Done" : "Edit"}
        </Button>
      </div>

      {open && (
        <div className="border-t border-border px-4 py-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Opens
              <Input
                type="time"
                value={bh.open}
                onChange={(e) => setBusinessHours({ open: e.target.value })}
                className="h-9 w-[130px]"
                disabled={!bh.enabled}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Closes
              <Input
                type="time"
                value={bh.close}
                onChange={(e) => setBusinessHours({ close: e.target.value })}
                className="h-9 w-[130px]"
                disabled={!bh.enabled}
              />
            </label>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="away-message">
                Away message (sent automatically when you’re closed)
              </label>
              <Button
                variant="secondary"
                size="sm"
                disabled={!bh.enabled}
                onClick={() => setBusinessHours({ awayMessage: OTTO_AWAY_DRAFT })}
              >
                <Sparkles strokeWidth={2} />
                Ask Otto to write it
              </Button>
            </div>
            <Textarea
              id="away-message"
              value={bh.awayMessage}
              onChange={(e) => setBusinessHours({ awayMessage: e.target.value })}
              className="mt-1.5 min-h-[76px] resize-none"
              disabled={!bh.enabled}
            />
          </div>

          {/* 实时气泡演示:客户在闭店时段会收到这条 */}
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">Customers see</p>
            <div className="flex flex-col gap-1">
              <div className="max-w-[86%] rounded-[16px] border border-border bg-card px-3.5 py-2.5 text-sm leading-5 text-foreground">
                <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                  <Sparkles className="size-3" strokeWidth={2} />
                  Otto
                </span>
                {bh.awayMessage || "Add an away message above to preview it here."}
              </div>
              <span className="px-1 text-[11px] text-muted-foreground">Sent automatically after hours</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/** [wave-b] 关键词/规则自动回复(触发词→回复,file-system 风格)。 */
function InstantReplyCard() {
  const [open, setOpen] = React.useState(false);
  const onCount = KEYWORD_RULES.filter((r) => isKeywordRuleOn(r.id, r.defaultOn)).length;
  return (
    <Card className="mt-4 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-secondary">
          <Zap className="size-4 text-muted-foreground" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Instant replies</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{onCount} of {KEYWORD_RULES.length} keyword rules on — common questions answer themselves</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>{open ? "Done" : "Edit"}</Button>
      </div>
      {open && (
        <div className="border-t border-border">
          {KEYWORD_RULES.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">When they say “{r.keyword}”</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{r.reply}</p>
              </div>
              <Switch checked={isKeywordRuleOn(r.id, r.defaultOn)} onCheckedChange={(on) => toggleKeywordRule(r.id, on)} aria-label={`Auto-reply for ${r.keyword}`} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** [wave-b] 不活跃会话自动关闭 + AI 摘要。 */
function AutoCloseCard() {
  const on = isAutoCloseIdle();
  return (
    <Card className="mt-4 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-secondary">
          <AlarmClock className="size-4 text-muted-foreground" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Auto-close idle chats</p>
          <p className="mt-0.5 text-xs text-muted-foreground">After 3 quiet days Otto sums up the thread and archives it — nothing piles up.</p>
        </div>
        <Switch checked={on} onCheckedChange={toggleAutoCloseIdle} aria-label="Auto-close idle chats" />
      </div>
    </Card>
  );
}

export function InboxShared() {
  const [filter, setFilter] = React.useState<Filter>("all");
  useStore(); // 订阅共享 store:已读/联系人/营业时间变化即时反映
  const conversations = conversationsView();
  const perf = inboxPerformance();

  const shown = conversations.filter((cv) => {
    if (filter === "unread") return cv.unread;
    if (filter === "otto") return cv.aiHandled;
    if (filter === "overdue") return cv.state === "overdue";
    return true;
  });

  const unreadCount = conversations.filter((c) => c.unread).length;
  const ottoCount = conversations.filter((c) => c.aiHandled).length;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Shared inbox"
        subtitle="Every channel in one thread. Otto drafts; you tap to send."
        actions={<InboxNav />}
      />

      {/* [wave-b] 客服/AI 绩效小面板(派生自会话镜像,不写死) */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open threads" value={String(perf.open)} />
        <StatCard label="Unread" value={String(unreadCount)} />
        <StatCard label="Otto handled" value={String(ottoCount)} />
        <StatCard label="Resolution rate" value={`${perf.resolutionRate}%`} />
      </div>

      <BusinessHoursCard />
      <InstantReplyCard />
      <AutoCloseCard />

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
            const contact = contactByIdView(cv.contactId);
            const last = cv.messages[cv.messages.length - 1];
            const afterHours = isAfterHoursConversation(cv);
            const overdue = cv.state === "overdue";
            // [wave-b] 谁在接:你 / Otto / 队友
            const answering = assignmentFor(cv.id, cv.aiHandled ? "Otto" : "You");
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
                    {overdue && <Badge variant="warning">Overdue {cv.waitingFor ?? ""}</Badge>}
                    {afterHours && (
                      <Badge variant="outline">
                        <Moon className="size-3" strokeWidth={2} />
                        After hours
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{last?.text}</p>
                </div>
                {/* [wave-b] 谁在接的头像列(点名缺口补齐) */}
                <span className="hidden shrink-0 items-center gap-1.5 sm:flex" title={`${answering} is on this`}>
                  {answering === "Otto" ? (
                    <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                      <Sparkles className="size-3" strokeWidth={2} />
                    </span>
                  ) : (
                    <Initials name={answering} className="size-6 text-[10px]" />
                  )}
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{last ? (last.at.includes("T") ? fmtStamp(last.at) : last.at) : ""}</span>
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

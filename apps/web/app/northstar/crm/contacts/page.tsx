/* @nsPage district="CRM 区" page="contacts" status="draft"
   sources="harmony-01 #7;蓝图第六章·CRM 区;红旗三" approvedAt="" pr="" */
"use client";

/**
 * 联系人列表 — 客户唯一档案总览(联系人主要从对话 / 广告自动进来)。
 * 清单元素:列表 / 筛选 · 渠道身份徽标(WA/IG/FB)· 勿扰标记可见(判决 7-9)。
 * §D4 form A hairline 行;§D1 answers-first 四张 stat 卡;§D3 数据卡。
 * Otto 落新联系人演示(§O3/§O4 CRM 默认 dock-only,coral 只在 Otto 真的落人时 sweep 一次)。
 * 每表自带 loading / empty / error(§D1⑤);筛选空态 1 句(§V4)。
 */

import * as React from "react";
import Link from "next/link";
import { Search, UserPlus, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, MockNote, OttoNarrationBar, PageHeader, StatCard } from "@/components/northstar/_shared";
import {
  ChannelRow,
  ContactAvatar,
  ContactRowsSkeleton,
  ConsentBadge,
  DemoStateBar,
  DndTag,
  ErrorPanel,
  fmtMyr,
  relDays,
  useSweep,
  type CrmDemoState,
} from "@/components/northstar/crm/kit";
import {
  CRM_CONTACTS,
  CRM_INCOMING_CONTACT,
  type CrmChannel,
  type CrmContact,
} from "@/components/northstar/crm/mock-crm";

const CHANNEL_FILTERS: { key: CrmChannel; label: string }[] = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
];

type QuickFilter = "all" | "dnd" | "awaiting";

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "all", label: "All contacts" },
  { key: "awaiting", label: "Awaiting opt-in" },
  { key: "dnd", label: "Do not disturb" },
];

/* Otto 落新联系人叙述步骤(§V6 present-participle,2-4 词) */
const LAND_STEPS = [
  "Reading new WhatsApp chat",
  "Matching against contacts",
  "Creating contact",
] as const;

function ContactRow({ contact, landed }: { contact: CrmContact; landed?: boolean }) {
  const { style, fire } = useSweep();

  // 新落的联系人:挂载即 sweep 一次(§O4 live-activity,≤650ms 后自清)
  React.useEffect(() => {
    if (landed) fire();
  }, [landed, fire]);

  return (
    <Link
      href={`/northstar/crm/contact-profile?id=${contact.id}`}
      className={cn(
        "flex items-center gap-3 rounded-[10px] border-t border-border px-2 py-3 first:border-t-0 hover:bg-accent",
        landed && "fade-rise",
      )}
      style={style}
    >
      <ContactAvatar name={contact.name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{contact.name}</p>
          {contact.doNotDisturb && <DndTag />}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <ChannelRow channels={contact.channels} />
          <span className="truncate text-xs text-muted-foreground">
            {contact.tags.length ? contact.tags.join(" · ") : "No tags"} · seen {relDays(contact.lastSeen)}
          </span>
        </div>
      </div>
      <span className="hidden w-24 shrink-0 text-right text-sm font-semibold text-foreground tabular-nums sm:block">
        {fmtMyr(contact.totalOrdersMyr)}
      </span>
      <ConsentBadge state={contact.consent.marketing} />
    </Link>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<CrmDemoState>("data");
  const [query, setQuery] = React.useState("");
  const [channel, setChannel] = React.useState<CrmChannel | null>(null);
  const [quick, setQuick] = React.useState<QuickFilter>("all");
  const [contacts, setContacts] = React.useState<CrmContact[]>(CRM_CONTACTS);
  const [landing, setLanding] = React.useState(false);
  const [landedId, setLandedId] = React.useState<string | null>(null);

  const alreadyLanded = contacts.some((c) => c.id === CRM_INCOMING_CONTACT.id);

  // Otto 落新联系人:narration 走完 → 把 CRM_INCOMING_CONTACT 插到列表最前(演示自动进来)
  const runLanding = () => {
    if (landing || alreadyLanded) return;
    setLanding(true);
  };
  const onLanded = () => {
    setContacts((prev) => [CRM_INCOMING_CONTACT, ...prev]);
    setLandedId(CRM_INCOMING_CONTACT.id);
    setLanding(false);
  };

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (channel && !c.channels.includes(channel)) return false;
      if (quick === "dnd" && !c.doNotDisturb) return false;
      if (quick === "awaiting" && c.consent.marketing !== "pending") return false;
      if (q) {
        const hay = `${c.name} ${c.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [contacts, query, channel, quick]);

  const dndCount = contacts.filter((c) => c.doNotDisturb).length;
  const awaitingCount = contacts.filter((c) => c.consent.marketing === "pending").length;
  const newThisMonth = contacts.filter((c) => c.tags.includes("new")).length;

  const isFiltered = query.trim() !== "" || channel !== null || quick !== "all";
  const clearFilters = () => {
    setQuery("");
    setChannel(null);
    setQuick("all");
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1080px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Contacts"
        subtitle="One profile per customer. New contacts arrive on their own from chats and ads."
        actions={
          <Button size="sm" variant="secondary" onClick={runLanding} disabled={landing || alreadyLanded}>
            <UserPlus strokeWidth={2} />
            Add contact
          </Button>
        }
      />

      {/* answers first — 四张 stat 卡(§D1) */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="All contacts" value={String(contacts.length)} />
        <StatCard
          label="New this month"
          value={String(newThisMonth)}
          delta={{ dir: "up", text: "from chats and ads" }}
        />
        <StatCard label="Awaiting opt-in" value={String(awaitingCount)} />
        <StatCard label="Do not disturb" value={String(dndCount)} />
      </div>

      {/* Otto 落新联系人 narration(§8c 一屏一条,走完自动插行) */}
      {landing && (
        <OttoNarrationBar
          key="crm-land"
          steps={LAND_STEPS}
          stepMs={900}
          counter
          onSettle={onLanded}
          className="mt-4 self-start"
        />
      )}

      {/* 工具行:搜索 + 渠道筛选 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={2}
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or tag"
            className="h-9 pl-10 text-sm"
            aria-label="Search contacts"
          />
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5">
          {CHANNEL_FILTERS.map((c) => {
            const active = channel === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setChannel(active ? null : c.key)}
                className={cn(
                  "h-[30px] rounded-[8px] px-3 text-xs font-semibold",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 快捷筛选 chips */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {QUICK_FILTERS.map((f) => {
          const active = quick === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setQuick(f.key)}
              className={cn(
                "inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold",
                active
                  ? "border-transparent bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          );
        })}
        {isFiltered && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" strokeWidth={2} />
            Clear
          </button>
        )}
      </div>

      {/* 列表面板 — 每表自带四态(§D1⑤) */}
      <div className="mt-4 rounded-[18px] border border-border bg-card p-2 sm:p-3">
        {demo === "loading" && <ContactRowsSkeleton rows={5} />}

        {demo === "error" && <ErrorPanel text="Couldn't load your contacts." onRetry={() => setDemo("data")} />}

        {demo === "empty" && (
          <EmptyState
            icon={Users}
            title="No contacts yet"
            body="Contacts arrive on their own when someone messages you or replies to an ad. You can also add one by hand."
            action={
              <Button size="sm" variant="secondary" onClick={runLanding} disabled={landing || alreadyLanded}>
                Add contact
              </Button>
            }
          />
        )}

        {demo === "data" && filtered.length === 0 && (
          <p className="py-14 text-center text-sm text-muted-foreground">Nothing matches this filter.</p>
        )}

        {demo === "data" && filtered.length > 0 && (
          <>
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                {isFiltered ? `${filtered.length} of ${contacts.length}` : `${contacts.length} contacts`}
              </span>
              <span className="hidden font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase sm:inline">
                Total orders
              </span>
            </div>
            {filtered.map((c) => (
              <ContactRow key={c.id} contact={c} landed={c.id === landedId} />
            ))}
          </>
        )}
      </div>

      <DemoStateBar value={demo} onChange={setDemo} />
      <MockNote path="/northstar/crm/contacts" />
    </div>
  );
}

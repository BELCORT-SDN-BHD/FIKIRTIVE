/* @nsPage district="CRM 区" page="contact-profile" status="draft"
   sources="harmony-01 §四②;N-22/N-23;判决 7-9;红旗三" approvedAt="" pr="" */
"use client";

/**
 * 联系人档案 — 单个客户的全景页(master-detail)。
 * 清单元素:多渠道身份合并(Identity 表,不靠猜)· 时间线 · consent / 勿扰字段 ·
 *   字段变更留痕(复用 ActionEvent)· 首触 campaign。
 * §D4 时间线用 hairline;consent / 勿扰用 §F7 switch(立即生效,勿扰是硬约束提示);
 * 身份合并面板每条标注来源与合并审计;右轨订单 / 首触归因 stat。
 * 左轨联系人切换 = 自包含(§L master-detail);deep-link ?id= 用 Suspense 读一次。
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BellOff,
  GitMerge,
  Megaphone,
  MessageSquare,
  Package,
  PencilLine,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { MockNote, PageHeader } from "@/components/northstar/_shared";
import {
  ChannelTag,
  ContactAvatar,
  ConsentBadge,
  DndTag,
  fmtDate,
  fmtMyr,
  relDays,
} from "@/components/northstar/crm/kit";
import {
  CRM_CHANNELS,
  CRM_CONTACTS,
  crmContact,
  type CrmContact,
  type CrmEvent,
  type CrmEventKind,
} from "@/components/northstar/crm/mock-crm";

/* ── 时间线事件类型 → 图标 + 语气(colour = state,只有 field-change/consent 携带语义) ── */
const EVENT_META: Record<CrmEventKind, { icon: typeof MessageSquare; label: string }> = {
  message: { icon: MessageSquare, label: "Message" },
  order: { icon: Package, label: "Order" },
  "field-change": { icon: PencilLine, label: "Change" },
  merge: { icon: GitMerge, label: "Merge" },
  consent: { icon: ShieldCheck, label: "Consent" },
  campaign: { icon: Megaphone, label: "First touch" },
};

const BY_LABEL: Record<NonNullable<CrmEvent["by"]>, string> = {
  owner: "You",
  otto: "Otto",
  system: "System",
};

function TimelineItem({ event, last }: { event: CrmEvent; last: boolean }) {
  const meta = EVENT_META[event.kind];
  const Icon = meta.icon;
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {/* 竖线 */}
      {!last && <span aria-hidden className="absolute top-8 left-[15px] h-[calc(100%-1rem)] w-px bg-border" />}
      <span className="relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card">
        <Icon className="size-4 text-muted-foreground" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-foreground">{meta.label}</span>
          {event.channel && <ChannelTag channel={event.channel} />}
          {event.by && (
            <span className="text-xs font-medium text-muted-foreground">by {BY_LABEL[event.by]}</span>
          )}
          <span className="ml-auto font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground tabular-nums">
            {event.at}
          </span>
        </div>
        <p className="mt-1 text-sm leading-[20px] text-foreground">{event.text}</p>
        {event.change && (
          <div className="mt-1.5 inline-flex flex-wrap items-center gap-1.5 rounded-[10px] bg-secondary/70 px-2.5 py-1.5 text-xs">
            <span className="font-medium text-muted-foreground">{event.change.field}</span>
            <span className="font-mono text-muted-foreground line-through">{event.change.from}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-mono font-semibold text-foreground">{event.change.to}</span>
          </div>
        )}
      </div>
    </li>
  );
}

function IdentityPanel({ contact }: { contact: CrmContact }) {
  return (
    <section className="rounded-[18px] border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Identities</h2>
        <span className="inline-flex items-center gap-1 font-mono text-[11px] leading-[14px] font-medium tracking-[0.04em] text-muted-foreground">
          <ShieldCheck className="size-3" strokeWidth={2} />
          merged by ID, not guessed
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {contact.identities.map((id) => {
          const label = id.channel === "email" ? "Email" : CRM_CHANNELS[id.channel].label;
          return (
            <div
              key={`${id.channel}-${id.externalId}`}
              className="flex items-start gap-3 rounded-[12px] border border-border p-3"
            >
              <ChannelTag channel={id.channel} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{id.externalId}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {label} · added {fmtDate(id.addedAt)}
                </p>
                {id.mergedFrom && (
                  <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-secondary/70 px-2 py-0.5 text-[11px] leading-[16px] text-muted-foreground">
                    <GitMerge className="size-3" strokeWidth={2} />
                    {id.mergedFrom}
                  </p>
                )}
              </div>
              {id.firstTouchCampaign && (
                <span className="hidden shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] leading-[16px] text-muted-foreground sm:inline-flex">
                  <Megaphone className="size-3" strokeWidth={2} />
                  first touch
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Detail({ contact }: { contact: CrmContact }) {
  // consent / 勿扰是本地演示状态(§F7 switch 立即生效);勿扰是硬约束(判决 7-9)。
  // 切换联系人时由父级 <Detail key={contact.id}> 整体重挂载重置,无需 effect。
  const [dnd, setDnd] = React.useState(contact.doNotDisturb);
  const [marketingOn, setMarketingOn] = React.useState(contact.consent.marketing === "granted");

  const firstTouch = contact.identities.find((i) => i.firstTouchCampaign)?.firstTouchCampaign;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      {/* 身份头卡 */}
      <section className="rounded-[18px] border border-border bg-card p-5">
        <div className="flex items-start gap-4">
          <ContactAvatar name={contact.name} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-[-0.02em] text-foreground">{contact.name}</h1>
              {dnd && <DndTag />}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {contact.identities.length} {contact.identities.length === 1 ? "identity" : "identities"} · seen{" "}
              {relDays(contact.lastSeen)}
            </p>
            {contact.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {contact.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex h-6 items-center rounded-full bg-secondary px-2.5 text-xs font-medium text-secondary-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Button size="sm" variant="secondary" asChild>
            <Link href="/northstar/inbox/conversation">
              <MessageSquare strokeWidth={2} />
              Message
            </Link>
          </Button>
        </div>

        {contact.note && (
          <p className="mt-4 rounded-[12px] bg-secondary/70 p-3 text-sm leading-[20px] text-foreground">
            {contact.note}
          </p>
        )}

        {/* 三格摘要:订单值 / 订单数 / 首触归因 */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-[12px] border border-border p-3">
            <div className="text-xs font-medium text-muted-foreground">Total orders</div>
            <div className="mt-1 text-lg font-bold text-foreground tabular-nums">{fmtMyr(contact.totalOrdersMyr)}</div>
          </div>
          <div className="rounded-[12px] border border-border p-3">
            <div className="text-xs font-medium text-muted-foreground">Orders placed</div>
            <div className="mt-1 text-lg font-bold text-foreground tabular-nums">{contact.ordersCount}</div>
          </div>
          <div className="rounded-[12px] border border-border p-3">
            <div className="text-xs font-medium text-muted-foreground">First touch</div>
            <div className="mt-1 flex items-center gap-1 text-sm font-semibold text-foreground">
              <Megaphone className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
              <span className="truncate">{firstTouch ?? "—"}</span>
            </div>
          </div>
        </div>
      </section>

      <IdentityPanel contact={contact} />

      {/* consent / 勿扰 — 硬约束(判决 7-9);§F7 switch 立即生效 */}
      <section className="rounded-[18px] border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Consent and do not disturb</h2>
          <ConsentBadge state={contact.consent.marketing} />
        </div>

        <label className="mt-3 flex items-center gap-3 rounded-[12px] border border-border p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Marketing messages</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Opt-in source: {contact.consent.source} · {fmtDate(contact.consent.at)}
            </p>
          </div>
          <Switch
            checked={marketingOn}
            onCheckedChange={setMarketingOn}
            disabled={contact.consent.marketing === "declined"}
            aria-label="Marketing messages"
          />
        </label>

        <label className="mt-2 flex items-center gap-3 rounded-[12px] border border-border p-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-error-soft">
            <BellOff className="size-4 text-error-soft-foreground" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Do not disturb</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              When on, Otto and every broadcast skip this contact. This rule can never be overridden.
            </p>
          </div>
          <Switch checked={dnd} onCheckedChange={setDnd} aria-label="Do not disturb" />
        </label>

        {(dnd || contact.consent.marketing === "declined") && (
          <p className="mt-2 flex items-start gap-2 rounded-[10px] bg-error-soft px-3 py-2 text-[13px] leading-[18px] text-error-soft-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
            Automations and broadcasts will skip {contact.name.split(" ")[0]} while this is on.
          </p>
        )}
      </section>

      {/* 时间线(§D4 hairline;字段变更留痕复用 ActionEvent) */}
      <section className="rounded-[18px] border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-foreground">Timeline</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Conversations, orders, and every field change, newest first.
        </p>
        <ol className="mt-4">
          {contact.events.map((ev, i) => (
            <TimelineItem key={ev.id} event={ev} last={i === contact.events.length - 1} />
          ))}
        </ol>
      </section>
    </div>
  );
}

function ContactSwitcher({
  contacts,
  selectedId,
  onSelect,
}: {
  contacts: CrmContact[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = React.useState("");
  const list = React.useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(query));
  }, [contacts, q]);

  return (
    <aside className="hidden w-64 shrink-0 flex-col lg:flex">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={2}
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a contact"
          className="h-9 pl-9 text-sm"
          aria-label="Find a contact"
        />
      </div>
      <div className="mt-2 flex flex-col gap-0.5 overflow-y-auto rounded-[14px] border border-border bg-card p-1.5">
        {list.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nothing matches this filter.</p>
        ) : (
          list.map((c) => {
            const active = c.id === selectedId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-[10px] px-2 py-2 text-left",
                  active ? "bg-secondary" : "hover:bg-accent",
                )}
              >
                <ContactAvatar name={c.name} size={30} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{c.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {c.tags[0] ?? "No tags"} · {relDays(c.lastSeen)}
                  </p>
                </div>
                {c.doNotDisturb && <BellOff className="size-3.5 shrink-0 text-error-soft-foreground" strokeWidth={2} />}
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

/** deep-link ?id= 读一次(Suspense 内);无参 → 默认第一位 */
function useInitialId(): string {
  const [id] = React.useState(() => {
    if (typeof window === "undefined") return CRM_CONTACTS[0].id;
    const param = new URLSearchParams(window.location.search).get("id");
    return param && CRM_CONTACTS.some((c) => c.id === param) ? param : CRM_CONTACTS[0].id;
  });
  return id;
}

export default function Page() {
  const initialId = useInitialId();
  const [selectedId, setSelectedId] = React.useState(initialId);
  const contact = crmContact(selectedId);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1180px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Contact profile"
        actions={
          <Button size="sm" variant="ghost" asChild>
            <Link href="/northstar/crm/contacts">
              <ArrowLeft strokeWidth={2} />
              All contacts
            </Link>
          </Button>
        }
      />

      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Sparkles className="size-3.5 text-muted-foreground" strokeWidth={2} />
        Everything Otto and your team know about one customer, from every channel.
      </p>

      <div className="mt-5 flex gap-6">
        <ContactSwitcher contacts={CRM_CONTACTS} selectedId={selectedId} onSelect={setSelectedId} />
        <Detail key={contact.id} contact={contact} />
      </div>

      <MockNote path="/northstar/crm/contact-profile" />
    </div>
  );
}

"use client";

/**
 * 联系人 —— 客户名册。每一行是一个真去处:整行点开客户档案(contact-profile),
 * 档案里再连回他们的对话与成交。§D4 hairline 行 + §N3 状态色 + 搜索过滤。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import {
  CRM_INBOX_BASE as BASE,
  ChannelTag,
  CrmNav,
  Card,
  fmtDate,
  fmtMyr,
  Initials,
  type NsInboxChannel,
} from "./kit";
import { CONTACTS } from "./data";

function ContactRow({ contact }: { contact: (typeof CONTACTS)[number] }) {
  return (
    <Link
      href={`${BASE}/crm/contact-profile?id=${contact.id}`}
      className="group flex items-center gap-3 border-t border-border px-4 py-3 transition-colors first:border-t-0 hover:bg-accent"
    >
      <Initials name={contact.name} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{contact.name}</p>
          {contact.doNotDisturb && <Badge variant="outline">Do not disturb</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {contact.tags.map((t) => (
            <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="hidden items-center gap-1 sm:flex">
        {contact.channels.map((c) => (
          <ChannelTag key={c} channel={c as NsInboxChannel} />
        ))}
      </div>
      <div className="w-28 shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-foreground">{fmtMyr(contact.totalOrdersMyr)}</p>
        <p className="text-xs text-muted-foreground">Seen {fmtDate(contact.lastSeen)}</p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} />
    </Link>
  );
}

export function CrmContacts() {
  const [query, setQuery] = React.useState("");
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CONTACTS;
    return CONTACTS.filter(
      (c) => c.name.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [query]);

  const totalLtv = CONTACTS.reduce((sum, c) => sum + c.totalOrdersMyr, 0);
  const onWhatsapp = CONTACTS.filter((c) => c.channels.includes("whatsapp")).length;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Contacts"
        subtitle="Everyone who's messaged or ordered. Tap a row to open their profile."
        actions={<CrmNav />}
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Contacts" value={String(CONTACTS.length)} />
        <StatCard label="Lifetime orders" value={fmtMyr(totalLtv)} />
        <StatCard label="On WhatsApp" value={String(onWhatsapp)} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="size-4 text-muted-foreground" strokeWidth={2} />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or tag"
            className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
          <span className="shrink-0 text-xs text-muted-foreground">{filtered.length} shown</span>
        </div>
        {filtered.length > 0 ? (
          filtered.map((c) => <ContactRow key={c.id} contact={c} />)
        ) : (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <span className="flex size-11 items-center justify-center rounded-[14px] bg-secondary">
              <Users className="size-5 text-muted-foreground" strokeWidth={2} />
            </span>
            <p className="text-sm font-semibold text-foreground">No contacts match</p>
            <p className="text-xs text-muted-foreground">Try a different name or tag.</p>
          </div>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Group contacts into{" "}
        <Link href={`${BASE}/crm/segments`} className="font-semibold text-foreground hover:underline">
          segments
        </Link>{" "}
        or track orders in{" "}
        <Link href={`${BASE}/crm/deals`} className="font-semibold text-foreground hover:underline">
          deals
        </Link>
        .
      </p>
    </div>
  );
}

"use client";

/**
 * 客户档案 —— 一个客户的全貌。上半是身份 + 生涯价值,下半把他们的对话与成交
 * 连起来(profile → conversation、profile → deals)。?id= 选人,缺省取第一个。
 * 这是 contacts 行点开的去处,也是 conversation 里「查看客户」的落点。
 */

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, MessageSquare, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, StatCard, EmptyState } from "@/components/northstar/_shared";
import {
  CRM_INBOX_BASE as BASE,
  ChannelTag,
  Card,
  CardHeader,
  fmtDate,
  fmtMyr,
  Initials,
  type NsInboxChannel,
} from "./kit";
import {
  CONTACTS,
  contactById,
  conversationsForContact,
  dealsForContact,
  DEAL_STAGES,
} from "./data";

function StageBadge({ stage }: { stage: (typeof DEAL_STAGES)[number]["id"] }) {
  if (stage === "delivered") return <Badge variant="success">Delivered</Badge>;
  if (stage === "confirmed") return <Badge variant="success">Confirmed</Badge>;
  if (stage === "quote") return <Badge variant="warning">Quote sent</Badge>;
  return <Badge variant="outline">Lead</Badge>;
}

export function CrmContactProfile() {
  const params = useSearchParams();
  const id = params.get("id") ?? CONTACTS[0]?.id ?? "";
  const contact = contactById(id) ?? CONTACTS[0];

  if (!contact) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
        <EmptyState title="Contact not found" body="This contact may have been removed." />
      </div>
    );
  }

  const conversations = conversationsForContact(contact.id);
  const deals = dealsForContact(contact.id);
  const delivered = deals.filter((d) => d.stage === "delivered").reduce((s, d) => s + d.amountMyr, 0);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Contact"
        actions={
          <Button variant="secondary" size="sm" asChild>
            <Link href={`${BASE}/crm/contacts`}>
              <ArrowLeft strokeWidth={2} />
              All contacts
            </Link>
          </Button>
        }
      />

      <Card className="mt-6 p-5">
        <div className="flex items-start gap-4">
          <Initials name={contact.name} className="size-14 text-lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold tracking-[-0.02em] text-foreground">{contact.name}</h2>
              {contact.doNotDisturb && <Badge variant="outline">Do not disturb</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {contact.channels.map((c) => (
                <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                  <ChannelTag channel={c as NsInboxChannel} className="h-4 w-5" />
                  {c === "whatsapp" ? "WhatsApp" : c === "instagram" ? "Instagram" : "Facebook"}
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {contact.tags.map((t) => (
                <span key={t} className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Lifetime orders" value={fmtMyr(contact.totalOrdersMyr)} />
        <StatCard label="Delivered value" value={fmtMyr(delivered)} />
        <StatCard label="Last seen" value={fmtDate(contact.lastSeen)} />
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <Card>
          <CardHeader
            title="Conversations"
            desc={conversations.length ? `${conversations.length} thread${conversations.length > 1 ? "s" : ""} with ${contact.name.split(" ")[0]}` : undefined}
          />
          {conversations.length > 0 ? (
            conversations.map((cv) => {
              const last = cv.messages[cv.messages.length - 1];
              return (
                <Link
                  key={cv.id}
                  href={`${BASE}/inbox/conversation?id=${cv.id}`}
                  className="group flex items-center gap-3 border-t border-border px-4 py-3 transition-colors first:border-t-0 hover:bg-accent"
                >
                  <ChannelTag channel={cv.channel} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{cv.subject}</p>
                      {cv.unread && <Badge variant="warning">Unread</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{last?.text}</p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} />
                </Link>
              );
            })
          ) : (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <MessageSquare className="size-5 text-muted-foreground" strokeWidth={2} />
              <p className="text-sm text-muted-foreground">No conversations yet.</p>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Deals"
            desc={deals.length ? `${deals.length} order${deals.length > 1 ? "s" : ""} tracked` : undefined}
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href={`${BASE}/crm/deals`}>
                  All deals
                  <ArrowRight strokeWidth={2} />
                </Link>
              </Button>
            }
          />
          {deals.length > 0 ? (
            deals.map((d) => (
              <div key={d.id} className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{d.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Updated {fmtDate(d.updatedAt)}</p>
                </div>
                <StageBadge stage={d.stage} />
                <p className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">{fmtMyr(d.amountMyr)}</p>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Receipt className="size-5 text-muted-foreground" strokeWidth={2} />
              <p className="text-sm text-muted-foreground">No deals yet.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

"use client";

/**
 * 成交 —— 订单 pipeline,按阶段分组(lead → quote → confirmed → delivered)。
 * 每张成交卡连回客户档案(deal → contact-profile),形成 CRM 的闭环。
 * 顶部三张数据卡派生自成交总额;阶段列用 §D4 hairline 卡承载。
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, CrmNav, Card, fmtDate, fmtMyr, Initials } from "./kit";
import { DEALS, DEAL_STAGES, contactById, type NsDeal } from "./data";

function DealCard({ deal }: { deal: NsDeal }) {
  const contact = contactById(deal.contactId);
  return (
    <Link
      href={`${BASE}/crm/contact-profile?id=${deal.contactId}`}
      className="group block border-t border-border px-3 py-3 transition-colors first:border-t-0 hover:bg-accent"
    >
      <p className="text-sm font-medium leading-5 text-foreground">{deal.title}</p>
      <div className="mt-2 flex items-center gap-2">
        {contact && <Initials name={contact.name} className="size-6 text-[10px]" />}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{contact?.name ?? "—"}</span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{fmtMyr(deal.amountMyr)}</span>
      </div>
      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        <span>Updated {fmtDate(deal.updatedAt)}</span>
        <ArrowRight className="ml-auto size-3.5 opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} />
      </div>
    </Link>
  );
}

export function CrmDeals() {
  const openValue = DEALS.filter((d) => d.stage !== "delivered").reduce((s, d) => s + d.amountMyr, 0);
  const wonValue = DEALS.filter((d) => d.stage === "delivered").reduce((s, d) => s + d.amountMyr, 0);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1040px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Deals"
        subtitle="Every order Otto is tracking, from first hello to delivered."
        actions={<CrmNav />}
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Open deals" value={String(DEALS.filter((d) => d.stage !== "delivered").length)} />
        <StatCard label="Open value" value={fmtMyr(openValue)} />
        <StatCard label="Delivered value" value={fmtMyr(wonValue)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {DEAL_STAGES.map((stage) => {
          const deals = DEALS.filter((d) => d.stage === stage.id);
          const value = deals.reduce((s, d) => s + d.amountMyr, 0);
          return (
            <Card key={stage.id} className="flex flex-col overflow-hidden">
              <div className="border-b border-border px-3 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{stage.label}</h2>
                  <Badge variant="outline">{deals.length}</Badge>
                  <span className="ml-auto text-xs font-semibold tabular-nums text-muted-foreground">{fmtMyr(value)}</span>
                </div>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{stage.hint}</p>
              </div>
              {deals.length > 0 ? (
                deals.map((d) => <DealCard key={d.id} deal={d} />)
              ) : (
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">Nothing here yet.</p>
              )}
            </Card>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Tap any deal to open the{" "}
        <Link href={`${BASE}/crm/contacts`} className="font-semibold text-foreground hover:underline">
          contact
        </Link>{" "}
        behind it.
      </p>
    </div>
  );
}

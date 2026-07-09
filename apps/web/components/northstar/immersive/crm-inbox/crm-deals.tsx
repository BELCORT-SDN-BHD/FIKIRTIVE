"use client";

/**
 * 成交 —— 订单 pipeline,按阶段分组(lead → quote → confirmed → delivered)。
 * 每张成交卡连回客户档案(deal → contact-profile),形成 CRM 的闭环。
 * 卡片底部一对推进/回退控件写共享 store(advanceDealStage);阶段分组与三张数据卡
 * 都读 dealStageOf 的实时阶段。金额永远走 dealAmountMyr,不随阶段漂移。
 */

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, CrmNav, Card, fmtDate, fmtMyr, Initials } from "./kit";
import { DEALS, DEAL_STAGES, contactById, type NsDeal, type NsDealStage } from "./data";
import { useStore, dealStageOf, advanceDealStage } from "../_store";

const STAGE_IDS: NsDealStage[] = DEAL_STAGES.map((s) => s.id);

function DealCard({ deal, stage }: { deal: NsDeal; stage: NsDealStage }) {
  const contact = contactById(deal.contactId);
  const i = STAGE_IDS.indexOf(stage);
  return (
    <div className="border-t border-border px-3 py-3 first:border-t-0">
      <Link href={`${BASE}/crm/contact-profile?id=${deal.contactId}`} className="group block hover:opacity-90">
        <p className="text-sm font-medium leading-5 text-foreground">{deal.title}</p>
        <div className="mt-2 flex items-center gap-2">
          {contact && <Initials name={contact.name} className="size-6 text-[10px]" />}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{contact?.name ?? "—"}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{fmtMyr(deal.amountMyr)}</span>
        </div>
      </Link>
      <div className="mt-2 flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={i <= 0}
          onClick={() => advanceDealStage(deal.id, stage, "back", deal.title)}
          aria-label={`Move ${deal.title} back a stage`}
        >
          <ChevronLeft strokeWidth={2} />
        </Button>
        <span className="min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground">
          Updated {fmtDate(deal.updatedAt)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={i >= STAGE_IDS.length - 1}
          onClick={() => advanceDealStage(deal.id, stage, "forward", deal.title)}
          aria-label={`Advance ${deal.title} a stage`}
        >
          <ChevronRight strokeWidth={2} />
        </Button>
      </div>
    </div>
  );
}

export function CrmDeals() {
  useStore(); // 订阅共享 store:阶段推进即时反映到分组与数据卡
  const staged = DEALS.map((d) => ({ deal: d, stage: dealStageOf(d.id, d.stage) }));
  const openValue = staged.filter((s) => s.stage !== "delivered").reduce((sum, s) => sum + s.deal.amountMyr, 0);
  const wonValue = staged.filter((s) => s.stage === "delivered").reduce((sum, s) => sum + s.deal.amountMyr, 0);
  const openCount = staged.filter((s) => s.stage !== "delivered").length;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1040px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Deals"
        subtitle="Every order Otto is tracking, from first hello to delivered."
        actions={<CrmNav />}
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Open deals" value={String(openCount)} />
        <StatCard label="Open value" value={fmtMyr(openValue)} />
        <StatCard label="Delivered value" value={fmtMyr(wonValue)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {DEAL_STAGES.map((stage) => {
          const inStage = staged.filter((s) => s.stage === stage.id);
          const value = inStage.reduce((sum, s) => sum + s.deal.amountMyr, 0);
          return (
            <Card key={stage.id} className="flex flex-col overflow-hidden">
              <div className="border-b border-border px-3 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{stage.label}</h2>
                  <Badge variant="outline">{inStage.length}</Badge>
                  <span className="ml-auto text-xs font-semibold tabular-nums text-muted-foreground">{fmtMyr(value)}</span>
                </div>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{stage.hint}</p>
              </div>
              {inStage.length > 0 ? (
                inStage.map((s) => <DealCard key={s.deal.id} deal={s.deal} stage={s.stage} />)
              ) : (
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">Nothing here yet.</p>
              )}
            </Card>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Use the arrows to move a deal along, or tap it to open the{" "}
        <Link href={`${BASE}/crm/contacts`} className="font-semibold text-foreground hover:underline">
          contact
        </Link>{" "}
        behind it.
      </p>
    </div>
  );
}

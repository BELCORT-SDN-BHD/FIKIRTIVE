"use client";

/**
 * 成交 —— 订单 pipeline(Z7 endgame)。阶段可推进(写共享 store),金额永远走
 * dealAmountMyr(同客户在 contacts / profile / deals 一致,永不漂移)。
 *
 * WHATPASS 一·B 落点(每条 [wave-b]):
 *  · 多条管道:新客开发 / 老客复购 两张看板切换                [wave-b] 多管道
 *  · 简版预测:顶部一行「预计本月成交额」(阶段概率加权)      [wave-b] 简版预测一行数字
 *  · 大单提醒:金额超门槛的开口成交主动提醒 + 门槛可调          [wave-b] 大单提醒
 *  · 简版折扣审批:成交卡「申请折扣」→ 老板审批队列              [wave-b] 简版折扣审批
 *  · Lead→Deal 转化一行数字                                    [wave-b] Lead 转化
 */

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, TicketPercent } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, CrmNav, Card, fmtDate, fmtMyr } from "./kit";
import { ContactAvatar } from "./crm-kit";
import { DEAL_STAGES, contactById, type NsDeal, type NsDealStage } from "./data";
import {
  ALL_DEALS,
  PIPELINES,
  dealPipeline,
  expectedRevenue,
  type NsPipeline,
} from "./crm-data";
import {
  useStore,
  dealStageOf,
  advanceDealStage,
  bigDealThresholdValue,
  setBigDealThreshold,
  pushApproval,
  contactsView,
} from "../_store";

const STAGE_IDS: NsDealStage[] = DEAL_STAGES.map((s) => s.id);

function DealCard({
  deal,
  stage,
  big,
  onDiscount,
  discounted,
}: {
  deal: NsDeal;
  stage: NsDealStage;
  big: boolean;
  onDiscount: () => void;
  discounted: boolean;
}) {
  const contact = contactById(deal.contactId);
  const i = STAGE_IDS.indexOf(stage);
  return (
    <div className="border-t border-border px-3 py-3 first:border-t-0">
      <Link href={`${BASE}/crm/contact-profile?id=${deal.contactId}`} className="group block hover:opacity-90">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-foreground">{deal.title}</p>
          {big && (
            <span title="Above your big-deal threshold">
              <Badge variant="warning">Big</Badge>
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          {contact && <ContactAvatar contact={contact} className="size-6" />}
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
      {stage !== "delivered" && (
        <button
          type="button"
          onClick={onDiscount}
          disabled={discounted}
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
        >
          <TicketPercent className="size-3" strokeWidth={2} />
          {discounted ? "Discount sent for approval" : "Request a discount"}
        </button>
      )}
    </div>
  );
}

export function CrmDeals() {
  useStore(); // 订阅共享 store:阶段推进 / 门槛调整即时反映
  const [pipeline, setPipeline] = React.useState<NsPipeline["id"]>("new");
  const [discounted, setDiscounted] = React.useState<Set<string>>(new Set());
  const threshold = bigDealThresholdValue();
  const contacts = contactsView();

  const staged = ALL_DEALS
    .filter((d) => dealPipeline(d) === pipeline)
    .map((d) => ({ deal: d, stage: dealStageOf(d.id, d.stage) }));

  const openStaged = staged.filter((s) => s.stage !== "delivered");
  const openValue = openStaged.reduce((sum, s) => sum + s.deal.amountMyr, 0);
  const wonValue = staged.filter((s) => s.stage === "delivered").reduce((sum, s) => sum + s.deal.amountMyr, 0);
  const expected = expectedRevenue(staged.map((s) => ({ stage: s.stage, amountMyr: s.deal.amountMyr })));
  const bigDeals = openStaged.filter((s) => s.deal.amountMyr >= threshold);

  // Lead→Deal 转化(一行数字):新客生命周期数 → 开口成交数。
  const newLeads = contacts.filter((c) => c.lifecycle === "new" || c.lifecycle === "lead").length;

  const requestDiscount = (deal: NsDeal) => {
    setDiscounted((prev) => new Set(prev).add(deal.id));
    pushApproval({
      title: `Approve a discount · ${deal.title}`,
      detail: `${contactById(deal.contactId)?.name ?? "A customer"} · ${fmtMyr(deal.amountMyr)}`,
      impacts: ["Lets the editor offer a lower price", "Decline keeps the standard price"],
      kind: "schedule",
    });
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Deals"
        subtitle="Every order Otto is tracking, from first hello to delivered."
        actions={<CrmNav />}
      />

      {/* 多管道切换 */}
      <div className="mt-6 inline-flex items-center gap-0.5 self-start rounded-[10px] border border-border bg-card p-0.5">
        {PIPELINES.map((p) => {
          const active = p.id === pipeline;
          const count = ALL_DEALS.filter((d) => dealPipeline(d) === p.id).length;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPipeline(p.id)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex h-[30px] items-center gap-1.5 rounded-[8px] px-3 text-xs font-semibold transition-colors",
                active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {p.label}
              <Badge variant={active ? "default" : "outline"}>{count}</Badge>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{PIPELINES.find((p) => p.id === pipeline)?.hint}</p>

      {/* §D3 四张数据卡 */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open deals" value={String(openStaged.length)} />
        <StatCard label="Open value" value={fmtMyr(openValue)} />
        <StatCard label="Expected this month" value={fmtMyr(expected)} delta={{ dir: "flat", text: "Stage-weighted" }} />
        <StatCard label="Delivered value" value={fmtMyr(wonValue)} />
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {newLeads} new lead{newLeads === 1 ? "" : "s"} in your book · {openStaged.length} open in this pipeline.
      </p>

      {/* 大单提醒 + 门槛设置 */}
      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <AlertTriangle className="size-4 shrink-0 text-warning-soft-foreground" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Big-deal alerts</p>
            <p className="text-xs text-muted-foreground">
              {bigDeals.length > 0
                ? `${bigDeals.length} open deal${bigDeals.length === 1 ? "" : "s"} over ${fmtMyr(threshold)} — don't let them slip.`
                : `No open deals over ${fmtMyr(threshold)} right now.`}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Alert over RM
            <Input
              type="number"
              value={String(threshold)}
              onChange={(e) => setBigDealThreshold(Number(e.target.value) || 0)}
              className="h-8 w-24"
            />
          </label>
        </div>
        {bigDeals.map((s) => (
          <Link
            key={s.deal.id}
            href={`${BASE}/crm/contact-profile?id=${s.deal.contactId}`}
            className="flex items-center gap-3 border-t border-border px-4 py-2.5 hover:bg-accent"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{s.deal.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{DEAL_STAGES.find((x) => x.id === s.stage)?.label}</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{fmtMyr(s.deal.amountMyr)}</span>
          </Link>
        ))}
      </Card>

      {/* 看板 */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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
                inStage.map((s) => (
                  <DealCard
                    key={s.deal.id}
                    deal={s.deal}
                    stage={s.stage}
                    big={s.stage !== "delivered" && s.deal.amountMyr >= threshold}
                    onDiscount={() => requestDiscount(s.deal)}
                    discounted={discounted.has(s.deal.id)}
                  />
                ))
              ) : (
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">Nothing here yet.</p>
              )}
            </Card>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Use the arrows to move a deal along, or tap it to open the{" "}
        <Link href={`${BASE}/crm/contacts`} className="font-semibold text-foreground hover:underline">contact</Link>{" "}
        behind it.
      </p>
    </div>
  );
}

/* @nsPage district="CRM 区" page="deals" status="draft"
   sources="harmony-01 #12;P3-2" approvedAt="" pr="" */
"use client";

/**
 * Deal 看板 — SMB-lite 交易管道(respond.io 级)。
 * 清单元素:可配阶段看板(PipelineConfig)· 金额 / 币种 · 拖动流转。
 * §D3 每列列头带合计 · §D4 卡片 form B · HTML5 drag&drop 本地状态改阶段(§8a sweep 落位)。
 * 点开任一 deal = 只读详情 dialog(§FB5 S)· 空态两型(§V4)· 每态自带(§D1⑤)。
 * 金额是订单值不是 credits(§V5 credits 只在花钱面;CRM 金额直接显示 RM)。
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  KanbanSquare,
  Plus,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, MockNote, PageHeader, StatCard } from "@/components/northstar/_shared";
import {
  ChannelRow,
  ContactAvatar,
  DemoStateBar,
  ErrorPanel,
  Skeleton,
  fmtDate,
  fmtMyr,
  useReducedMotion,
  useSweep,
  type CrmDemoState,
} from "@/components/northstar/crm/kit";
import {
  CRM_DEALS,
  CRM_PIPELINE,
  crmContact,
  type CrmDeal,
  type CrmStage,
} from "@/components/northstar/crm/mock-crm";

/* 阶段口径:视觉状态色(colour = state,§2)— 最后一列 = 成交(success) */
const STAGE_ACCENT: Record<string, string> = {
  "st-1": "bg-muted-foreground/40",
  "st-2": "bg-info-soft-foreground/60",
  "st-3": "bg-warning-soft-foreground/70",
  "st-4": "bg-success-soft-foreground/70",
};

function DealCard({
  deal,
  onOpen,
  onDragStart,
  swept,
}: {
  deal: CrmDeal;
  onOpen: (d: CrmDeal) => void;
  onDragStart: (id: string) => void;
  swept?: boolean;
}) {
  const reduced = useReducedMotion();
  const { style, fire } = useSweep();
  const contact = crmContact(deal.contactId);

  React.useEffect(() => {
    if (swept) fire();
  }, [swept, fire]);

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", deal.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(deal.id);
      }}
      onClick={() => onOpen(deal)}
      className={cn(
        "flex w-full cursor-grab flex-col gap-2 rounded-[12px] border border-border bg-card p-3 text-left shadow-[var(--shadow-xs)] hover:bg-accent active:cursor-grabbing",
        swept && !reduced && "fade-rise",
      )}
      style={style}
    >
      <p className="line-clamp-2 text-[13px] leading-[18px] font-semibold text-foreground">{deal.name}</p>
      <div className="flex items-center gap-2">
        <ContactAvatar name={contact.name} size={22} />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{contact.name}</span>
        <ChannelRow channels={contact.channels} />
      </div>
      <div className="flex items-center justify-between border-t border-border pt-2">
        <span className="text-sm font-bold text-foreground tabular-nums">{fmtMyr(deal.amountMyr)}</span>
        <span className="inline-flex items-center gap-1 font-mono text-[11px] leading-[14px] font-medium text-muted-foreground tabular-nums">
          <CalendarClock className="size-3" strokeWidth={2} />
          {fmtDate(deal.expected)}
        </span>
      </div>
    </button>
  );
}

function Column({
  stage,
  deals,
  isDropTarget,
  onOpen,
  onDragStart,
  dropHandlers,
  sweptId,
}: {
  stage: CrmStage;
  deals: CrmDeal[];
  isDropTarget: boolean;
  onOpen: (d: CrmDeal) => void;
  onDragStart: (id: string) => void;
  dropHandlers: (stageId: string) => Record<string, unknown>;
  sweptId: string | null;
}) {
  const total = deals.reduce((sum, d) => sum + d.amountMyr, 0);
  return (
    <div
      {...dropHandlers(stage.id)}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-[16px] border border-border bg-secondary/40 transition-colors",
        isDropTarget && "border-foreground/30 bg-accent",
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className={cn("size-2 shrink-0 rounded-full", STAGE_ACCENT[stage.id])} aria-hidden />
        <span className="text-sm font-semibold text-foreground">{stage.name}</span>
        <span className="ml-auto rounded-full bg-card px-2 py-0.5 text-[11px] font-semibold text-muted-foreground tabular-nums">
          {deals.length}
        </span>
      </div>
      <div className="px-3 pb-2">
        <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground tabular-nums">
          {fmtMyr(total)}
        </span>
      </div>
      <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
        {deals.length === 0 ? (
          <p className="pt-6 text-center text-[11px] leading-4 text-muted-foreground/70">
            Drag a deal here
          </p>
        ) : (
          deals.map((d) => (
            <DealCard
              key={d.id}
              deal={d}
              onOpen={onOpen}
              onDragStart={onDragStart}
              swept={d.id === sweptId}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<CrmDemoState>("data");
  const [deals, setDeals] = React.useState<CrmDeal[]>(CRM_DEALS);
  const [detail, setDetail] = React.useState<CrmDeal | null>(null);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  const [sweptId, setSweptId] = React.useState<string | null>(null);
  const draggingId = React.useRef<string | null>(null);

  const byStage = React.useMemo(() => {
    const map = new Map<string, CrmDeal[]>();
    for (const s of CRM_PIPELINE) map.set(s.id, []);
    for (const d of deals) map.get(d.stageId)?.push(d);
    return map;
  }, [deals]);

  const moveDeal = (id: string, stageId: string) => {
    setDeals((prev) =>
      prev.map((d) => (d.id === id && d.stageId !== stageId ? { ...d, stageId, daysInStage: 0 } : d)),
    );
    setSweptId(id);
  };

  const dropHandlers = (stageId: string) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTarget(stageId);
    },
    onDragLeave: () => setDropTarget((cur) => (cur === stageId ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const id = e.dataTransfer.getData("text/plain") || draggingId.current;
      if (id) moveDeal(id, stageId);
      draggingId.current = null;
    },
  });

  const openValue = deals
    .filter((d) => d.stageId !== "st-4")
    .reduce((sum, d) => sum + d.amountMyr, 0);
  const wonValue = deals.filter((d) => d.stageId === "st-4").reduce((sum, d) => sum + d.amountMyr, 0);
  const detailContact = detail ? crmContact(detail.contactId) : null;
  const detailStage = detail ? CRM_PIPELINE.find((s) => s.id === detail.stageId) : null;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Deals"
        subtitle="Your bigger orders, from first enquiry to fulfilled. Drag a card to move it along."
        actions={
          <>
            <Button size="sm" variant="ghost">
              <Settings2 strokeWidth={2} />
              Edit stages
            </Button>
            <Button size="sm">
              <Plus strokeWidth={2} />
              New deal
            </Button>
          </>
        }
      />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open deals" value={String(deals.filter((d) => d.stageId !== "st-4").length)} />
        <StatCard label="Open value" value={fmtMyr(openValue)} />
        <StatCard label="Fulfilled this month" value={String(deals.filter((d) => d.stageId === "st-4").length)} />
        <StatCard label="Fulfilled value" value={fmtMyr(wonValue)} delta={{ dir: "up", text: "closed and delivered" }} />
      </div>

      {demo === "loading" && (
        <div className="mt-5 flex gap-3 overflow-x-auto pb-2">
          {CRM_PIPELINE.map((s, i) => (
            <div key={s.id} className="flex w-72 shrink-0 flex-col rounded-[16px] border border-border bg-secondary/40 p-2">
              <Skeleton className="mx-1 mt-1 h-4 w-1/2" shimmer={i === 0} />
              <div className="mt-3 flex flex-col gap-2">
                <Skeleton className="h-24 w-full" shimmer={i === 1} />
                <Skeleton className="h-24 w-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {demo === "error" && (
        <ErrorPanel text="Couldn't load your deals." onRetry={() => setDemo("data")} className="mt-6" />
      )}

      {demo === "empty" && (
        <EmptyState
          icon={KanbanSquare}
          title="No deals yet"
          body="Track a bigger order here, from first enquiry to fulfilled. Add your first deal to start."
          action={
            <Button size="sm">
              <Plus strokeWidth={2} />
              New deal
            </Button>
          }
          className="mt-6"
        />
      )}

      {demo === "data" && (
        <div className="mt-5 flex gap-3 overflow-x-auto pb-2">
          {CRM_PIPELINE.map((stage) => (
            <Column
              key={stage.id}
              stage={stage}
              deals={byStage.get(stage.id) ?? []}
              isDropTarget={dropTarget === stage.id}
              onOpen={setDetail}
              onDragStart={(id) => (draggingId.current = id)}
              dropHandlers={dropHandlers}
              sweptId={sweptId}
            />
          ))}
        </div>
      )}

      {/* 只读详情(§FB5 S) */}
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          {detail && detailContact && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl leading-[26px] font-semibold tracking-[-0.017em]">
                  {detail.name}
                </DialogTitle>
                <DialogDescription>
                  {detailStage?.name} · expected {fmtDate(detail.expected)}
                </DialogDescription>
              </DialogHeader>

              <div className="flex items-center gap-3 rounded-[14px] bg-secondary/60 p-3">
                <ContactAvatar name={detailContact.name} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{detailContact.name}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <ChannelRow channels={detailContact.channels} />
                    <span className="text-xs text-muted-foreground">{detailContact.tags.join(" · ") || "No tags"}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[12px] border border-border p-3">
                  <div className="text-xs font-medium text-muted-foreground">Deal value</div>
                  <div className="mt-1 text-lg font-bold text-foreground tabular-nums">{fmtMyr(detail.amountMyr)}</div>
                </div>
                <div className="rounded-[12px] border border-border p-3">
                  <div className="text-xs font-medium text-muted-foreground">Days in stage</div>
                  <div className="mt-1 text-lg font-bold text-foreground tabular-nums">{detail.daysInStage}</div>
                </div>
              </div>

              <DialogFooter className="flex-row justify-end gap-3">
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/northstar/crm/contact-profile?id=${detail.contactId}`}>
                    Open contact
                    <ArrowRight strokeWidth={2} />
                  </Link>
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setDetail(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <DemoStateBar value={demo} onChange={setDemo} />
      <MockNote path="/northstar/crm/deals" />
    </div>
  );
}

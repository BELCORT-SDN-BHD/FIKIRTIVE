"use client";

/**
 * Credits 与消费明细(Credits & spend)
 * 分类消费明细,可展开单笔(计费透明)。铁律①:只显示 credits,永不显示 $。
 * 布局:§L2 Detail 型单列 880(混合:摘要卡 + 分类清单)。
 * 三态齐全(§设计审六条):header 永在场,状态活在 body。
 * §O3:住户服务中心无 inline Otto avatar — dock only(money 决定读作用户的)。
 * §D4 表 A:hairline list rows;数字右对齐 tabular-nums;缺失 = —。
 */

import * as React from "react";
import Link from "next/link";
import {
  ChevronRight,
  Coins,
  Image as ImageIcon,
  MessageSquare,
  Search as SearchIcon,
  Video,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState, MockNote, PageHeader } from "@/components/northstar/_shared";
import { DemoStateBar, ErrorPanel, Skeleton, type DemoState } from "./_bits";
import {
  CREDIT_BALANCE,
  CREDIT_GROUPS,
  CREDIT_PERIOD,
  CREDIT_SPENT_PERIOD,
  type CreditCategory,
  type CreditGroup,
  fmtDateTime,
  formatCredits,
} from "./_data";

const CATEGORY_ICON: Record<CreditCategory, LucideIcon> = {
  Video,
  Image: ImageIcon,
  "Otto chat": MessageSquare,
  Search: SearchIcon,
  "Top up": Wallet,
};

/** 一笔金额的展示:消费红字下沉,充值中性,永远显示 credits */
function CreditAmount({ credits, className }: { credits: number; className?: string }) {
  const spend = credits < 0;
  return (
    <span
      className={cn(
        "shrink-0 text-sm font-semibold tabular-nums",
        spend ? "text-foreground" : "text-success-soft-foreground",
        className,
      )}
    >
      {spend ? "−" : "+"}
      {formatCredits(Math.abs(credits))}
    </span>
  );
}

function CategoryRow({ group }: { group: CreditGroup }) {
  const [open, setOpen] = React.useState(false);
  const Icon = CATEGORY_ICON[group.category];
  const panelId = `credit-cat-${group.category.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 py-3.5 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary">
          <Icon className="size-4 text-muted-foreground" strokeWidth={2} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-foreground">{group.category}</span>
          <span className="text-xs text-muted-foreground">
            {group.lines.length} {group.lines.length === 1 ? "item" : "items"} this period
          </span>
        </span>
        <CreditAmount credits={group.netCredits} />
        <ChevronRight
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-90",
          )}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div id={panelId} className="pb-2 pl-12">
          {group.lines.map((line) => (
            <div
              key={line.id}
              className="flex items-start gap-3 border-t border-border/70 py-3 first:border-t-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="truncate text-[13px] leading-[18px] font-medium text-foreground">
                  {line.title}
                </p>
                <p className="text-xs text-muted-foreground">{line.detail}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-[11px] leading-[14px] font-medium text-muted-foreground">
                    {fmtDateTime(line.at)}
                  </span>
                  {line.surface && (
                    <>
                      <span aria-hidden className="text-muted-foreground/60">
                        ·
                      </span>
                      <Link
                        href={line.surface.href}
                        className="text-[11px] leading-[14px] font-semibold text-foreground underline-offset-2 hover:underline"
                      >
                        {line.surface.label}
                      </Link>
                    </>
                  )}
                </div>
              </div>
              <span className="pt-0.5">
                <span className="text-[13px] font-semibold tabular-nums text-foreground">
                  {line.credits < 0 ? "−" : "+"}
                  {formatCredits(Math.abs(line.credits))}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CreditsPage() {
  const [demo, setDemo] = React.useState<DemoState>("normal");

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Credits and spend"
        subtitle="Every credit Otto spends, grouped by what it made. Shown in credits, never dollars."
        meta={[CREDIT_PERIOD]}
        actions={
          <Button size="sm" asChild>
            <Link href="/northstar/account/top-up">Top up</Link>
          </Button>
        }
      />

      {/* 摘要:余额 + 本期消费(§D3 stat 卡的紧凑双联;credits 硬币 = 允许的 coral mark) */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-[14px] border border-border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Coins aria-hidden className="size-3.5 text-brand" strokeWidth={2} />
            Your balance
          </div>
          <div className="mt-1 text-[26px] leading-8 font-bold tracking-[-0.02em] tabular-nums text-foreground">
            {formatCredits(CREDIT_BALANCE)}
          </div>
          <div className="mt-1 text-xs font-medium text-muted-foreground">credits</div>
        </div>
        <div className="rounded-[14px] border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">Spent this period</div>
          <div className="mt-1 text-[26px] leading-8 font-bold tracking-[-0.02em] tabular-nums text-foreground">
            {formatCredits(CREDIT_SPENT_PERIOD)}
          </div>
          <div className="mt-1 text-xs font-medium text-muted-foreground">{CREDIT_PERIOD}</div>
        </div>
      </div>

      {/* 分类清单(§D4 表 A;状态活在 body) */}
      <section aria-label="Spend by category" className="mt-8 flex flex-1 flex-col">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-foreground">By category</h2>
          <p className="text-xs text-muted-foreground">Tap a row to see each item</p>
        </div>

        <div className="mt-2 rounded-[14px] border border-border bg-card px-4">
          {demo === "loading" && (
            <div className="py-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-t border-border py-3.5 first:border-t-0"
                >
                  <Skeleton shimmer={i < 3} className="size-9 rounded-full" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Skeleton shimmer={i < 3} className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-4 w-14" />
                </div>
              ))}
            </div>
          )}

          {demo === "empty" && (
            <EmptyState
              icon={Coins}
              title="No spend yet this period"
              body="When Otto makes something, it shows up here by category. Top up to get started."
              action={
                <Button size="sm" asChild>
                  <Link href="/northstar/account/top-up">Top up</Link>
                </Button>
              }
              className="py-14"
            />
          )}

          {demo === "error" && (
            <div className="py-3">
              <ErrorPanel
                message="Couldn't load your spend. Try again."
                onRetry={() => setDemo("normal")}
              />
            </div>
          )}

          {demo === "normal" &&
            CREDIT_GROUPS.map((group) => <CategoryRow key={group.category} group={group} />)}
        </div>

        {demo === "normal" && (
          <p className="mt-3 text-xs text-muted-foreground">
            Otto turns spend the moment work finishes. You approve every charge before it runs.
          </p>
        )}
      </section>

      <MockNote path="/northstar/account/credits" />
      <DemoStateBar state={demo} onChange={setDemo} />
    </div>
  );
}

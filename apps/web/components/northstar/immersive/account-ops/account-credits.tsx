"use client";

/**
 * 额度 —— 余额 + 本周花费 + 流水。credits 永远是 credits(§V5),对客花费不写 $。
 * 每行可展开成一张明细卡:类型 / 时间 / 关联对象链接 / 花费前后余额(founder 拍板"要")。
 * 交叉链接:主 CTA「Top up」→ account/top-up;明细里的关联对象 → 对应产物/活动页。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { type NsCreditRow } from "@/components/northstar/_mock";
import { balance, creditLedger, creditSpendByCategory, useStore } from "../_store";
import { ACCOUNT_OPS_BASE as BASE, AccountNav, Card, CardHeader, fmtStamp } from "./kit";

/** 每类花费的关联对象落点 + 人话链接文案(明细卡里「去看那笔花在哪」)。 */
const CATEGORY_LINK: Record<NsCreditRow["category"], { href: string; label: string }> = {
  "Otto chat": { href: `${BASE}/otto`, label: "Open Otto chat" },
  Image: { href: `${BASE}/assets/library`, label: "View in library" },
  Video: { href: `${BASE}/assets/library`, label: "View in library" },
  Search: { href: `${BASE}/campaign/trends`, label: "Open trends" },
  "Top up": { href: `${BASE}/account/top-up`, label: "View top-ups" },
};

/** 一行明细里的一个「标签 · 值」小块。 */
function DetailCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">{label}</p>
      <p className="mt-0.5 text-[13px] leading-[18px] font-medium text-foreground tabular-nums">{children}</p>
    </div>
  );
}

function LedgerRow({
  row,
  balanceAfter,
  open,
  onToggle,
}: {
  row: NsCreditRow;
  balanceAfter: number;
  open: boolean;
  onToggle: () => void;
}) {
  const spent = row.credits < 0;
  const balanceBefore = balanceAfter - row.credits;
  const link = CATEGORY_LINK[row.category];
  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-[120ms] hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <Badge variant={spent ? "outline" : "success"}>{row.category}</Badge>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{row.description}</p>
          <p className="mt-0.5 font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground tabular-nums">
            {row.at ? fmtStamp(row.at) : "Just now"}
          </p>
        </div>
        <span
          className={
            "shrink-0 text-sm font-semibold tabular-nums " +
            (spent ? "text-foreground" : "text-success-soft-foreground")
          }
        >
          {spent ? "" : "+"}
          {row.credits} credits
        </span>
        <ChevronDown
          className={
            "size-4 shrink-0 text-muted-foreground transition-transform duration-[160ms] " +
            (open ? "rotate-180" : "")
          }
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="border-t border-dashed border-border bg-secondary/40 px-4 py-3.5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <DetailCell label="Type">{spent ? "Credit spend" : "Top up"}</DetailCell>
            <DetailCell label="When">{row.at ? fmtStamp(row.at) : "Just now"}</DetailCell>
            <DetailCell label="Balance before">{balanceBefore.toLocaleString("en-MY")}</DetailCell>
            <DetailCell label="Balance after">{balanceAfter.toLocaleString("en-MY")}</DetailCell>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="min-w-0 truncate text-xs text-muted-foreground">{row.description}</p>
            <Button variant="ghost" size="sm" asChild className="shrink-0">
              <Link href={link.href}>
                {link.label}
                <ArrowUpRight strokeWidth={2} />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AccountCredits() {
  useStore();
  const ledger = creditLedger();
  const currentBalance = balance();
  const byCategory = creditSpendByCategory();
  const categoryTotal = byCategory.reduce((s, r) => s + r.credits, 0);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const c = {
    balance: currentBalance,
    spentThisWeek: ledger.filter((r) => r.credits < 0).reduce((s, r) => s + -r.credits, 0),
    toppedUp: ledger.filter((r) => r.credits > 0).reduce((s, r) => s + r.credits, 0),
  };

  // 逐行「花费后余额」:最新行(index 0)之后 = 当前余额,往下依次减去上一行的变动。
  let runningAfter = currentBalance;
  const rowsWithBalance = ledger.map((row) => {
    const balanceAfter = runningAfter;
    runningAfter = balanceAfter - row.credits;
    return { row, balanceAfter };
  });

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Credits"
        subtitle="One wallet for every generation. Top up any time."
        actions={
          <>
            <AccountNav />
            <Button size="sm" asChild>
              <Link href={`${BASE}/account/top-up`}>
                <Plus strokeWidth={2} />
                Top up
              </Link>
            </Button>
          </>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Balance" value={`${c.balance.toLocaleString("en-MY")} credits`} delta={{ dir: "flat", text: "Enough for ~30 videos" }} />
        <StatCard label="Spent this week" value={`${c.spentThisWeek} credits`} delta={{ dir: "flat", text: "Across chat, image and video" }} />
        <StatCard label="Last top up" value={`${c.toppedUp} credits`} delta={{ dir: "up", text: "5 Jul" }} />
      </div>

      {/* 低额提示条:统一走 top-up(§V5 credits 文案,不写 $) */}
      <Link
        href={`${BASE}/account/top-up`}
        className="mt-4 flex items-center gap-3 rounded-[18px] border border-border bg-secondary/60 px-4 py-3.5 transition-colors duration-[120ms] hover:bg-secondary"
      >
        <span aria-hidden className="size-3.5 shrink-0 rounded-full bg-brand" />
        <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-foreground">
          A busy Merdeka week runs about 200 credits. Top up now so nothing pauses mid-campaign.
        </p>
        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
      </Link>

      {/* 滚存规则卡(G-03 滚存上限制;人话,不写死数字口径,以 costing 为准) */}
      <div className="mt-4 rounded-[18px] border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <RefreshCw className="size-4 text-muted-foreground" strokeWidth={2} />
          <h3 className="text-sm font-semibold text-foreground">How credits roll over</h3>
        </div>
        <ul className="mt-2 space-y-1.5">
          <li className="flex items-start gap-2 text-[13px] leading-[18px] text-muted-foreground">
            <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground" />
            <span>Unused credits carry into next month, up to one month&apos;s worth of your plan.</span>
          </li>
          <li className="flex items-start gap-2 text-[13px] leading-[18px] text-muted-foreground">
            <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground" />
            <span>Anything above that cap doesn&apos;t stack forever — we&apos;ll warn you before a single credit would be lost.</span>
          </li>
          <li className="flex items-start gap-2 text-[13px] leading-[18px] text-muted-foreground">
            <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground" />
            <span>Top-up packs you buy stay in your balance and count toward the same cap.</span>
          </li>
        </ul>
      </div>

      {/* 分类明细:credits 花在哪(单一源 creditSpendByCategory,与流水同源;每类深链去看那批产物) */}
      {byCategory.length > 0 && (
        <div className="mt-8">
          <Card>
            <CardHeader title="Where credits went" desc="This month's spend, grouped by what Otto made." />
            {byCategory.map((cat) => {
              const link = CATEGORY_LINK[cat.label as NsCreditRow["category"]];
              const pct = categoryTotal > 0 ? Math.round((cat.credits / categoryTotal) * 100) : 0;
              return (
                <div key={cat.label} className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
                  <Badge variant="outline">{cat.label}</Badge>
                  <div className="min-w-0 flex-1">
                    <div
                      role="progressbar"
                      aria-valuenow={cat.credits}
                      aria-valuemin={0}
                      aria-valuemax={categoryTotal}
                      aria-label={`${cat.label} spend`}
                      className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
                    >
                      <div className="h-full rounded-full bg-foreground transition-[width] duration-300" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-foreground tabular-nums">{cat.credits} credits</span>
                  <Button variant="ghost" size="sm" asChild className="shrink-0">
                    <Link href={link.href} aria-label={`${link.label} for ${cat.label}`}>
                      <ArrowUpRight strokeWidth={2} />
                    </Link>
                  </Button>
                </div>
              );
            })}
          </Card>
        </div>
      )}

      <div className="mt-8">
        <Card>
          <CardHeader
            title="Recent activity"
            desc="Every credit in and out. Tap a row to see where it went."
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href={`${BASE}/account/channel-wallet`}>Channel fees</Link>
              </Button>
            }
          />
          {rowsWithBalance.map(({ row, balanceAfter }) => (
            <LedgerRow
              key={row.id}
              row={row}
              balanceAfter={balanceAfter}
              open={openId === row.id}
              onToggle={() => setOpenId((cur) => (cur === row.id ? null : row.id))}
            />
          ))}
        </Card>
      </div>
    </div>
  );
}

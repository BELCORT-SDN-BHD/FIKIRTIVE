"use client";

/**
 * 额度 —— 余额 + 本周花费 + 流水。credits 永远是 credits(§V5),对客花费不写 $。
 * 交叉链接:主 CTA「Top up」→ account/top-up;流水行的活动 → 对应产物/活动页。
 */

import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { type NsCreditRow } from "@/components/northstar/_mock";
import { balance, creditLedger, useStore } from "../_store";
import { ACCOUNT_OPS_BASE as BASE, AccountNav, Card, CardHeader, fmtStamp } from "./kit";

const CATEGORY_HREF: Record<NsCreditRow["category"], string> = {
  "Otto chat": `${BASE}/otto`,
  Image: `${BASE}/assets/library`,
  Video: `${BASE}/assets/library`,
  Search: `${BASE}/campaign/trends`,
  "Top up": `${BASE}/account/top-up`,
};

function LedgerRow({ row }: { row: NsCreditRow }) {
  const spent = row.credits < 0;
  return (
    <Link
      href={CATEGORY_HREF[row.category]}
      className="flex items-center gap-3 border-t border-border px-4 py-3 transition-colors duration-[120ms] first:border-t-0 hover:bg-accent"
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
    </Link>
  );
}

export function AccountCredits() {
  useStore();
  const ledger = creditLedger();
  const c = {
    balance: balance(),
    spentThisWeek: ledger.filter((r) => r.credits < 0).reduce((s, r) => s + -r.credits, 0),
    toppedUp: ledger.filter((r) => r.credits > 0).reduce((s, r) => s + r.credits, 0),
  };
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

      <div className="mt-8">
        <Card>
          <CardHeader
            title="Recent activity"
            desc="Every credit in and out."
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href={`${BASE}/account/channel-wallet`}>Channel wallet</Link>
              </Button>
            }
          />
          {ledger.map((row) => (
            <LedgerRow key={row.id} row={row} />
          ))}
        </Card>
      </div>
    </div>
  );
}

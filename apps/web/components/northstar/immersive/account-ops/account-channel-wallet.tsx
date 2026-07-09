"use client";

/**
 * 通道费(红旗五 / harmony-05)—— WhatsApp 等平台按会话收的过路费,单独一条账道。
 * 透明直传、零加价:MYR 实价,可对 Meta 价目核对。与生成 credits 是两码事,页顶讲清楚。
 * §D3 数据卡 + §D4 hairline 行 + §F7 即时开关。仅此页可见,RM 本地状态即真值。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { Switch } from "@/components/ui/switch";
import { ACCOUNT_OPS_BASE as BASE, AccountNav, Card, CardHeader } from "./kit";
import { useStore, channelWallet, channelWalletAddFunds, channelWalletSetAutoReload } from "../_store";
import {
  META_PRICING_URL,
  NS_CHANNEL_FEE_LEDGER,
  type NsChannelFeeRow,
} from "./data";

const ADD_FUND_AMOUNTS = [30, 60, 120];

function rowAmount(row: NsChannelFeeRow): number {
  return Math.round(row.conversations * row.rateMyr * 100) / 100;
}

function FeeRow({ row }: { row: NsChannelFeeRow }) {
  const amount = rowAmount(row);
  const free = row.rateMyr === 0;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3.5 first:border-t-0">
      <Badge variant={free ? "success" : "outline"}>{row.category}</Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{row.desc}</p>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {row.conversations.toLocaleString("en-MY")} conversations
          {free ? " · free within 24h" : ` · RM ${row.rateMyr.toFixed(2)} each at Meta's rate`}
        </p>
      </div>
      <p className="shrink-0 text-sm font-semibold text-foreground tabular-nums">
        {free ? "Free" : `RM ${amount.toFixed(2)}`}
      </p>
    </div>
  );
}

export function AccountChannelWallet() {
  useStore();
  // 通道费是垫付给平台的过路费(MYR),与生成 credits 两套账、独立 slice(永不并入
  // creditBalance);升格进共享 store 单源后跨页存活(修掉「Add funds 后离页回滚」)。
  const { balanceMyr, autoReload } = channelWallet();
  const [adding, setAdding] = React.useState(false);
  const [fundsAmount, setFundsAmount] = React.useState(ADD_FUND_AMOUNTS[1]);

  const monthSpend =
    Math.round(NS_CHANNEL_FEE_LEDGER.reduce((s, r) => s + rowAmount(r), 0) * 100) / 100;
  const totalConversations = NS_CHANNEL_FEE_LEDGER.reduce((s, r) => s + r.conversations, 0);
  const low = balanceMyr < monthSpend;

  const openAddFunds = () => {
    setFundsAmount(ADD_FUND_AMOUNTS[1]);
    setAdding(true);
  };
  const confirmAddFunds = () => {
    channelWalletAddFunds(fundsAmount);
    setAdding(false);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Channel fees"
        subtitle="What WhatsApp charges to send messages — passed straight through, no markup."
        actions={<AccountNav />}
      />

      {/* 两条账道分账道说明(红旗五人话):credits = 我们的服务;通道费 = 代收过路费 */}
      <div className="mt-6 rounded-[18px] border border-border bg-secondary/60 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-[14px] border border-border bg-card p-3.5">
            <p className="text-xs font-semibold text-foreground">Credits — our service</p>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              What you spend on Otto making posts, images and videos. One shared wallet.
            </p>
            <Link
              href={`${BASE}/account/credits`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:underline"
            >
              Open credits
              <ArrowRight className="size-3.5" strokeWidth={2} />
            </Link>
          </div>
          <div className="rounded-[14px] border border-border bg-card p-3.5">
            <p className="text-xs font-semibold text-foreground">Channel fees — a toll we collect for you</p>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              WhatsApp charges per conversation. We pay Meta and pass the exact cost to you — nothing added.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Fee balance"
          value={`RM ${balanceMyr}`}
          delta={low ? { dir: "down", text: "Low — below this month's fees" } : { dir: "flat", text: "Covers this month" }}
        />
        <StatCard label="Fees this month" value={`RM ${monthSpend.toFixed(2)}`} delta={{ dir: "flat", text: "Paid to Meta, at cost" }} />
        <StatCard label="Conversations" value={totalConversations.toLocaleString("en-MY")} delta={{ dir: "flat", text: "This month, all types" }} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[18px] border border-border bg-card px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Auto reload when low</span>
          <Switch checked={autoReload} onCheckedChange={channelWalletSetAutoReload} aria-label="Auto reload channel fees" />
        </div>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={openAddFunds}>
          Add funds
        </Button>
      </div>

      <div className="mt-8">
        <Card>
          <CardHeader
            title="By conversation type"
            desc="Meta prices WhatsApp by conversation category. This is what you were charged."
          />
          {NS_CHANNEL_FEE_LEDGER.map((row) => (
            <FeeRow key={row.id} row={row} />
          ))}
        </Card>
      </div>

      {/* 不加价声明 + Meta 价目链接(透明可验证 = 卖点) */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[18px] border border-border bg-card px-4 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success-soft">
          <ShieldCheck className="size-5 text-success-soft-foreground" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">We don&apos;t add a cent</p>
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
            You pay Meta&apos;s exact rate. Check it against their published price list any time.
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild className="shrink-0">
          <a href={META_PRICING_URL} target="_blank" rel="noreferrer">
            Meta price list
            <ExternalLink strokeWidth={2} />
          </a>
        </Button>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Only WhatsApp charges per conversation today. Connect it in{" "}
        <Link href={`${BASE}/account/connections`} className="font-semibold text-foreground hover:underline">
          connections
        </Link>
        .
      </p>

      <Dialog open={adding} onOpenChange={(open) => !open && setAdding(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add fee funds</DialogTitle>
            <DialogDescription>
              This tops up your channel-fee balance in ringgit to cover WhatsApp charges. It does not touch your generation credits.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {ADD_FUND_AMOUNTS.map((amt) => (
              <button
                key={amt}
                type="button"
                aria-pressed={fundsAmount === amt}
                onClick={() => setFundsAmount(amt)}
                className={
                  "rounded-[12px] border px-3 py-3 text-sm font-semibold tabular-nums transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-ring " +
                  (fundsAmount === amt
                    ? "border-primary bg-secondary text-foreground ring-[3px] ring-ring/40"
                    : "border-border bg-card text-foreground hover:bg-accent")
                }
              >
                RM {amt}
              </button>
            ))}
          </div>
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirmAddFunds}>
              Add RM {fundsAmount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

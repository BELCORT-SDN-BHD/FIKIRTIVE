"use client";

/**
 * 渠道钱包 —— 每个投放渠道的广告余额、本月花费、自动续费。
 * 这里是「投放钱」(RM),和生成额度(credits)是两码事 —— 页面顶部把这点讲清楚,
 * 并把生成额度指回 credits。§D3 数据卡 + §D4 hairline 行 + §F7 即时开关。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
import { ACCOUNT_OPS_BASE as BASE, AccountNav, Card, CardHeader, ChannelTag, CHANNELS } from "./kit";
import { NS_CHANNEL_WALLETS, type NsChannelWallet } from "./data";

const ADD_FUND_AMOUNTS = [50, 100, 200];

function WalletRow({
  wallet,
  onToggle,
  onAddFunds,
}: {
  wallet: NsChannelWallet;
  onToggle: (v: boolean) => void;
  onAddFunds: () => void;
}) {
  const meta = CHANNELS[wallet.channel];
  const low = wallet.balanceMyr < wallet.monthSpendMyr;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3.5 first:border-t-0">
      <ChannelTag channel={wallet.channel} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{meta.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          Spent this month RM {wallet.monthSpendMyr}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-foreground tabular-nums">RM {wallet.balanceMyr}</p>
        {low && <Badge variant="warning" className="mt-0.5">Low</Badge>}
      </div>
      <div className="flex items-center gap-2 pl-2">
        <span className="text-xs text-muted-foreground">Auto reload</span>
        <Switch checked={wallet.autoReload} onCheckedChange={onToggle} aria-label={`Auto reload ${meta.label}`} />
      </div>
      <Button variant="secondary" size="sm" onClick={onAddFunds}>Add funds</Button>
    </div>
  );
}

export function AccountChannelWallet() {
  // 渠道钱包是投放钱(RM),与生成 credits 是两套账;仅此页可见,本地状态即真值。
  const [wallets, setWallets] = React.useState<NsChannelWallet[]>(() => NS_CHANNEL_WALLETS.map((w) => ({ ...w })));
  const [fundsTarget, setFundsTarget] = React.useState<NsChannelWallet["channel"] | null>(null);
  const [fundsAmount, setFundsAmount] = React.useState(ADD_FUND_AMOUNTS[1]);

  const toggleReload = (channel: NsChannelWallet["channel"], v: boolean) =>
    setWallets((ws) => ws.map((w) => (w.channel === channel ? { ...w, autoReload: v } : w)));

  const openAddFunds = (channel: NsChannelWallet["channel"]) => {
    setFundsAmount(ADD_FUND_AMOUNTS[1]);
    setFundsTarget(channel);
  };

  const confirmAddFunds = () => {
    if (!fundsTarget) return;
    setWallets((ws) => ws.map((w) => (w.channel === fundsTarget ? { ...w, balanceMyr: w.balanceMyr + fundsAmount } : w)));
    setFundsTarget(null);
  };

  const fundsMeta = fundsTarget ? CHANNELS[fundsTarget] : null;
  const totalBalance = wallets.reduce((s, w) => s + w.balanceMyr, 0);
  const totalSpend = wallets.reduce((s, w) => s + w.monthSpendMyr, 0);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Channel wallet"
        subtitle="Ad spend for each channel, kept separate from your generation credits."
        actions={<AccountNav />}
      />

      {/* 区分说明:投放钱 vs 生成额度 */}
      <Link
        href={`${BASE}/account/credits`}
        className="mt-6 flex items-center gap-3 rounded-[18px] border border-border bg-secondary/60 px-4 py-3.5 transition-colors duration-[120ms] hover:bg-secondary"
      >
        <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-foreground">
          This wallet pays the ad platforms in ringgit. Making posts and videos uses credits, which are a separate shared wallet.
        </p>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-foreground">
          Open credits
          <ArrowRight className="size-4" strokeWidth={2} />
        </span>
      </Link>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard label="Total ad balance" value={`RM ${totalBalance}`} delta={{ dir: "flat", text: "Across 3 channels" }} />
        <StatCard label="Spent this month" value={`RM ${totalSpend}`} delta={{ dir: "up", text: "▲ 12% vs last month" }} />
      </div>

      <div className="mt-8">
        <Card>
          <CardHeader
            title="By channel"
            desc="Top up per channel or let auto reload keep them funded."
          />
          {wallets.map((w) => (
            <WalletRow
              key={w.channel}
              wallet={w}
              onToggle={(v) => toggleReload(w.channel, v)}
              onAddFunds={() => openAddFunds(w.channel)}
            />
          ))}
        </Card>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Not seeing a channel? Link it first in{" "}
        <Link href={`${BASE}/account/connections`} className="font-semibold text-foreground hover:underline">
          connections
        </Link>
        .
      </p>

      <Dialog open={fundsTarget !== null} onOpenChange={(open) => !open && setFundsTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add funds to {fundsMeta?.label}</DialogTitle>
            <DialogDescription>
              This tops up the ad-spend wallet for {fundsMeta?.label} in ringgit. It does not touch your generation credits.
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
            <Button variant="secondary" size="sm" onClick={() => setFundsTarget(null)}>
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

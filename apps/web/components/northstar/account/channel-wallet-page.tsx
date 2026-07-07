"use client";

/**
 * 通道费钱包页(Channel-fee wallet)— 第二账道(宪法 5 / harmony-05 / 红旗五判决)
 * 通道费 = 真法币 MYR 直传平台(Meta/X 广告代收),永不混入 credits。
 * 与 credits 分行列示;顶部一条常驻说明把两条账道的边界讲清楚。
 * §O3:此页无 inline Otto avatar — dock only(钱是用户的决定)。
 * money-in(宪法 7 豁免):充值走 MYR;支付 = INK 按钮(人类花钱)。
 * 布局:§L2 Detail 型单列 880。三态齐全。
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  Coins,
  CreditCard,
  Info,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
import { MockNote, PageHeader } from "@/components/northstar/_shared";
import { DemoStateBar, ErrorPanel, Skeleton, SweepIn, type DemoState } from "./_bits";
import {
  WALLET_BALANCE_MYR,
  WALLET_LOW_THRESHOLD_MYR,
  WALLET_TOPUP_AMOUNTS_MYR,
  WALLET_TXNS,
  type WalletTxn,
  fmtDateTime,
  fmtMyr,
} from "./_data";

type Phase = "idle" | "confirm" | "paying" | "done";

function TxnRow({ txn }: { txn: WalletTxn }) {
  const inbound = txn.amountMyr > 0;
  return (
    <div className="flex items-center gap-3 border-t border-border py-3.5 first:border-t-0">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          inbound ? "bg-success-soft" : "bg-secondary",
        )}
      >
        {inbound ? (
          <Wallet className="size-4 text-success-soft-foreground" strokeWidth={2} />
        ) : (
          <ArrowUpRight className="size-4 text-muted-foreground" strokeWidth={2} />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{txn.title}</p>
          {txn.channel && <Badge variant="outline">{txn.channel}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">{txn.detail}</p>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-[11px] leading-[14px] font-medium text-muted-foreground">
            {fmtDateTime(txn.at)}
          </span>
          {txn.ref && (
            <>
              <span aria-hidden className="text-muted-foreground/60">
                ·
              </span>
              <Link
                href={txn.ref.href}
                className="text-[11px] leading-[14px] font-semibold text-foreground underline-offset-2 hover:underline"
              >
                {txn.ref.label}
              </Link>
            </>
          )}
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          inbound ? "text-success-soft-foreground" : "text-foreground",
        )}
      >
        {inbound ? "+" : "−"}
        {fmtMyr(Math.abs(txn.amountMyr))}
      </span>
    </div>
  );
}

export function ChannelWalletPage() {
  const [demo, setDemo] = React.useState<DemoState>("normal");
  const [balance, setBalance] = React.useState<number>(WALLET_BALANCE_MYR);
  const [amount, setAmount] = React.useState<number>(WALLET_TOPUP_AMOUNTS_MYR[1]);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [txns, setTxns] = React.useState<WalletTxn[]>(WALLET_TXNS);
  const [landedId, setLandedId] = React.useState<string | null>(null);
  const payTimer = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (payTimer.current) window.clearTimeout(payTimer.current);
    },
    [],
  );

  const low = balance < WALLET_LOW_THRESHOLD_MYR;

  const startPay = () => {
    setPhase("paying");
    payTimer.current = window.setTimeout(() => {
      const id = `wt-new-${amount}`;
      setBalance((b) => b + amount);
      setTxns((prev) => [
        {
          id,
          at: "2026-07-07T18:00:00+08:00",
          kind: "top_up",
          title: "Wallet top up",
          detail: "Paid · card ending 4242",
          amountMyr: amount,
        },
        ...prev,
      ]);
      setLandedId(id);
      setPhase("done");
    }, 1500);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Channel-fee wallet"
        subtitle="Ad money you pass straight to Meta and X. Kept separate from your credits, always."
      />

      {/* 两条账道的边界(§FB4 info banner 位;常驻说明,非可忽略) */}
      <div className="mt-4 flex items-start gap-3 rounded-[14px] bg-info-soft px-4 py-3">
        <Info className="mt-0.5 size-4 shrink-0 text-info-soft-foreground" strokeWidth={2} />
        <p className="text-[13px] leading-[18px] font-medium text-info-soft-foreground">
          This wallet is real money in ringgit for ads. It never mixes with credits, and Otto never
          spends it without your say-so.{" "}
          <Link href="/northstar/account/credits" className="font-semibold underline underline-offset-2">
            See your credits
          </Link>
          .
        </p>
      </div>

      {low && demo === "normal" && (
        <div role="alert" className="mt-3 flex items-center gap-3 rounded-[14px] bg-warning-soft px-4 py-3">
          <p className="min-w-0 flex-1 text-[13px] leading-[18px] font-medium text-warning-soft-foreground">
            Your wallet is running low. Top up so boosted posts don&apos;t pause.
          </p>
          <Button variant="secondary" size="sm" onClick={() => setPhase("confirm")}>
            Top up
          </Button>
        </div>
      )}

      {/* 余额 + 充值(§D3 双联;wallet 用中性,非 credits 硬币) */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="flex flex-col rounded-[14px] border border-border bg-card p-5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Wallet aria-hidden className="size-3.5" strokeWidth={2} />
            Wallet balance
          </div>
          <div className="mt-1 text-[28px] leading-9 font-bold tracking-[-0.02em] tabular-nums text-foreground">
            {fmtMyr(balance)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Coins aria-hidden className="size-3 text-brand" strokeWidth={2} />
            Credits are separate
          </div>
          {phase === "done" && landedId && (
            <SweepIn className="mt-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-success-soft-foreground">
                <Check className="size-3.5" strokeWidth={2} />
                {fmtMyr(amount)} added
              </p>
            </SweepIn>
          )}
        </div>

        <div className="flex flex-col rounded-[14px] border border-border bg-card p-5">
          <p className="text-sm font-semibold text-foreground">Top up your wallet</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Choose an amount in ringgit.</p>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {WALLET_TOPUP_AMOUNTS_MYR.map((a) => {
              const active = a === amount;
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAmount(a)}
                  className={cn(
                    "h-11 rounded-[12px] border text-sm font-semibold tabular-nums outline-none transition-[border-color,background-color] duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    active
                      ? "border-foreground bg-secondary text-foreground"
                      : "border-border text-muted-foreground hover:border-[color-mix(in_oklab,var(--foreground)_15%,var(--border))] hover:text-foreground",
                  )}
                >
                  {a}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
            <span className="text-[13px] text-muted-foreground">You pay now</span>
            <span className="text-sm font-bold tabular-nums text-foreground">{fmtMyr(amount)}</span>
          </div>
          <Button size="default" className="mt-3 w-full" onClick={() => setPhase("confirm")}>
            Top up {fmtMyr(amount)}
          </Button>
        </div>
      </div>

      {/* 直传明细(§D4 表 A;和 credits 分行:这条只有 RM) */}
      <section aria-label="Wallet activity" className="mt-8 flex flex-1 flex-col">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-foreground">Wallet activity</h2>
          <p className="text-xs text-muted-foreground">Ringgit only</p>
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
                    <Skeleton shimmer={i < 3} className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          )}

          {demo === "empty" && (
            <div className="py-14 text-center">
              <p className="text-lg font-semibold text-foreground">No wallet activity yet</p>
              <p className="mx-auto mt-1 max-w-[420px] text-sm text-muted-foreground">
                Top up, then boost a post. Every ringgit passed to Meta or X shows here.
              </p>
            </div>
          )}

          {demo === "error" && (
            <div className="py-3">
              <ErrorPanel
                message="Couldn't load your wallet activity. Try again."
                onRetry={() => setDemo("normal")}
              />
            </div>
          )}

          {demo === "normal" &&
            txns.map((t) =>
              t.id === landedId ? (
                <SweepIn key={t.id}>
                  <TxnRow txn={t} />
                </SweepIn>
              ) : (
                <TxnRow key={t.id} txn={t} />
              ),
            )}
        </div>
        {demo === "normal" && (
          <p className="mt-3 text-xs text-muted-foreground">
            Pass-throughs go straight to the platform at their rate. We don&apos;t take a cut of ad spend.
          </p>
        )}
      </section>

      {/* 确认充值(§FB5;MYR verbatim) */}
      <Dialog
        open={phase === "confirm" || phase === "paying"}
        onOpenChange={(o) => {
          if (!o && phase !== "paying") setPhase("idle");
        }}
      >
        <DialogContent className="max-w-[min(440px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Top up wallet</DialogTitle>
            <DialogDescription>This adds ringgit to your ad wallet. It&apos;s not credits.</DialogDescription>
          </DialogHeader>
          <div className="rounded-[14px] bg-secondary/70 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Wallet top up</span>
              <span className="text-sm font-bold tabular-nums text-foreground">{fmtMyr(amount)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
              <span className="text-[13px] text-muted-foreground">New balance</span>
              <span className="text-[13px] font-semibold tabular-nums text-foreground">
                {fmtMyr(balance + amount)}
              </span>
            </div>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CreditCard aria-hidden className="size-3.5" strokeWidth={2} />
            Card ending 4242 · via Stripe
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPhase("idle")} disabled={phase === "paying"}>
              Cancel
            </Button>
            <Button onClick={startPay} disabled={phase === "paying"}>
              {phase === "paying" ? "Processing…" : `Pay ${fmtMyr(amount)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MockNote path="/northstar/account/channel-wallet" />
      <DemoStateBar state={demo} onChange={setDemo} />
    </div>
  );
}

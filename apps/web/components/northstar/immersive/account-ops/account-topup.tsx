"use client";

/**
 * 充值 —— 选档 → 确认 → 到账。credits 是 credits(§V5),付款价才用 RM;买额度是人的动作,
 * 用 INK 主按钮(§F7 paid flip confirm before),不是 coral(coral 只属于 Otto)。
 * 交叉链接:到账后可回 credits 看流水,或直接去 canvas 开始花。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
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
import { PageHeader } from "@/components/northstar/_shared";
import { balance, topUp, useStore } from "../_store";
import { ACCOUNT_OPS_BASE as BASE, AccountNav } from "./kit";
import { NS_CHANNEL_FEE_RELOAD, NS_TOPUP_PACKS, type NsTopUpPack } from "./data";

function PackCard({
  pack,
  selected,
  onSelect,
}: {
  pack: NsTopUpPack;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "flex flex-col items-start gap-1 rounded-[18px] border bg-card p-5 text-left transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-ring " +
        (selected ? "border-primary ring-[3px] ring-ring/40" : "border-border hover:bg-accent")
      }
    >
      <div className="flex w-full items-center gap-2">
        <span className="text-[26px] leading-8 font-bold tracking-[-0.02em] text-foreground tabular-nums">
          {pack.credits.toLocaleString("en-MY")}
        </span>
        <span className="text-sm font-medium text-muted-foreground">credits</span>
        {pack.best && <Badge variant="success" className="ml-auto">Best value</Badge>}
      </div>
      <p className="text-sm font-semibold text-foreground tabular-nums">RM {pack.priceMyr}</p>
      <p className="text-xs text-muted-foreground">{pack.roughly}</p>
    </button>
  );
}

export function AccountTopUp() {
  useStore();
  const [selectedId, setSelectedId] = React.useState(NS_TOPUP_PACKS.find((p) => p.best)?.id ?? NS_TOPUP_PACKS[0].id);
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [doneCredits, setDoneCredits] = React.useState<number | null>(null);
  // STALL #64:整条充值流程原本零失败处理。演示一次失败态(卡被拒 / FPX 超时),
  // 让「没扣到钱 + 再试」这条安全网看得见——首次尝试落在失败态,Try again 即成功。
  const failedOnceRef = React.useRef(false);

  const pack = NS_TOPUP_PACKS.find((p) => p.id === selectedId)!;
  const currentBalance = balance();

  const confirm = () => {
    setPending(true);
    setFailed(false);
    window.setTimeout(() => {
      if (!failedOnceRef.current) {
        // 首次:演示付款失败——余额一分没动,给人话 + 出路。
        failedOnceRef.current = true;
        setPending(false);
        setFailed(true);
        return;
      }
      // 一次写入,处处生效:导航栏余额 / credits 流水 / home 卡片同源跳动
      topUp(pack.credits);
      setDoneCredits(pack.credits);
      setPending(false);
      setConfirming(false);
    }, 700);
  };

  if (doneCredits !== null) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
        <PageHeader title="Top up" subtitle="One wallet for every generation." actions={<AccountNav />} />
        <div className="mt-10 flex flex-col items-center gap-4 rounded-[18px] border border-border bg-card px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-success-soft">
            <Check className="size-6 text-success-soft-foreground" strokeWidth={2.5} />
          </span>
          <p className="text-lg font-semibold text-foreground">{doneCredits.toLocaleString("en-MY")} credits added</p>
          <p className="max-w-[420px] text-sm text-muted-foreground">
            Your balance is now {currentBalance.toLocaleString("en-MY")} credits. Nothing publishes or generates until you approve it.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <Button size="sm" asChild>
              <Link href={`${BASE}/create/canvas`}>
                Start creating
                <ArrowRight strokeWidth={2} />
              </Link>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link href={`${BASE}/account/credits`}>View activity</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Top up"
        subtitle="Pick a pack. Credits land instantly and roll over month to month."
        actions={<AccountNav />}
      />

      <div className="mt-6 flex items-center gap-2 rounded-[18px] border border-border bg-secondary/60 px-4 py-3">
        <span aria-hidden className="size-3.5 shrink-0 rounded-full bg-brand" />
        <p className="text-[13px] leading-[18px] text-foreground">
          Current balance {currentBalance.toLocaleString("en-MY")} credits.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {NS_TOPUP_PACKS.map((p) => (
          <PackCard key={p.id} pack={p} selected={p.id === selectedId} onSelect={() => setSelectedId(p.id)} />
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-[18px] border border-border bg-card px-4 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground tabular-nums">
            {pack.credits.toLocaleString("en-MY")} credits · RM {pack.priceMyr}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{pack.roughly}</p>
        </div>
        <Button className="ml-auto" size="sm" onClick={() => setConfirming(true)}>
          Continue to payment
        </Button>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Card and FPX supported. WhatsApp conversation fees are a separate wallet in{" "}
        <Link href={`${BASE}/account/channel-wallet`} className="font-semibold text-foreground hover:underline">
          channel fees
        </Link>
        .
      </p>

      <Dialog open={confirming} onOpenChange={(open) => { if (!open && !pending) { setConfirming(false); setFailed(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{failed ? "Payment didn't go through" : "Confirm top up"}</DialogTitle>
            <DialogDescription>
              {failed
                ? "Your card was declined or the bank timed out. Nothing was charged."
                : `${pack.credits.toLocaleString("en-MY")} credits for RM ${pack.priceMyr}. Credits land instantly and roll over month to month.`}
            </DialogDescription>
          </DialogHeader>

          {failed ? (
            // STALL #64:失败态 —— 一句人话(没扣到钱 + 余额没动)+ 两条出路(再试 / 换付款方式)。
            <div role="alert" className="rounded-[14px] border border-error-soft bg-error-soft/40 p-3 text-[13px] leading-[18px] text-error-soft-foreground">
              No money was taken and your balance is still {currentBalance.toLocaleString("en-MY")} credits. Try again, or
              use a different card or FPX bank.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="rounded-[14px] bg-secondary/70 p-3 text-[13px] leading-[18px] text-foreground">
                New balance will be {(currentBalance + pack.credits).toLocaleString("en-MY")} credits.
              </div>
              {/* 付款来源透明:老板一眼知道扣哪张卡(#63 相邻的诚实垫底) */}
              <p className="text-xs text-muted-foreground">Paying with {NS_CHANNEL_FEE_RELOAD.source}.</p>
            </div>
          )}

          <DialogFooter className="flex-row justify-end gap-3">
            {failed ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => { setFailed(false); setConfirming(false); }}>
                  Change payment method
                </Button>
                <Button size="sm" onClick={confirm}>
                  Try again
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
                <Button size="sm" disabled={pending} onClick={confirm}>
                  {pending ? "Processing…" : `Pay RM ${pack.priceMyr}`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

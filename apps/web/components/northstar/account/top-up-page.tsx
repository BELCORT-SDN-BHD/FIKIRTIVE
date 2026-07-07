"use client";

/**
 * 充值 / 购买页(Top up)
 * money-in(宪法 7 豁免):价格用当地法币 MYR,买到的是 credits(铁律①)。
 * Otto 永不代办充值(§O3:此页无 Otto avatar — dock only)。
 * 布局:§L2 Detail 型单列 880。
 * 支付:选包 → 确认对话框(§FB5 dialog · 金额 verbatim)→ 模拟 Stripe → 落地成功态。
 * 三态齐全;coral 预算:credits 硬币是唯一 mark,支付按钮走 INK(人类花钱决定)。
 */

import * as React from "react";
import Link from "next/link";
import { Check, Coins, CreditCard, ShieldCheck, Sparkles } from "lucide-react";
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
import { SweepIn } from "./_bits";
import {
  CREDIT_BALANCE,
  CREDIT_GUIDE,
  PLAN_TIERS,
  ROLLOVER_NOTE,
  TOP_UP_PACKS,
  fmtMyr,
  formatCredits,
} from "./_data";

type Phase = "idle" | "confirm" | "paying" | "done";

export function TopUpPage() {
  const [selected, setSelected] = React.useState<string>("pack-baker");
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [balance, setBalance] = React.useState<number>(CREDIT_BALANCE);
  const [lastAdded, setLastAdded] = React.useState<number>(0);
  const payTimer = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (payTimer.current) window.clearTimeout(payTimer.current);
    },
    [],
  );

  const pack = TOP_UP_PACKS.find((p) => p.id === selected) ?? TOP_UP_PACKS[0];
  const totalCredits = pack.credits + pack.bonusCredits;

  const startPay = () => {
    setPhase("paying");
    payTimer.current = window.setTimeout(() => {
      setBalance((b) => b + totalCredits);
      setLastAdded(totalCredits);
      setPhase("done");
    }, 1600);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Top up"
        subtitle="Pay in ringgit, spend in credits. Credits are Otto's fuel for images, videos and chat."
        actions={
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground">
            <Coins aria-hidden className="size-3.5 text-brand" strokeWidth={2} />
            <span className="tabular-nums">{formatCredits(balance)}</span> credits
          </span>
        }
      />

      {/* 充值成功落地(人类动作 → 降落 only) */}
      {phase === "done" && (
        <SweepIn className="mt-6">
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-[14px] bg-success-soft px-4 py-3"
          >
            <Check className="size-4 shrink-0 text-success-soft-foreground" strokeWidth={2} />
            <p className="min-w-0 flex-1 text-[13px] leading-[18px] font-medium text-success-soft-foreground">
              Top up complete. {formatCredits(lastAdded)} credits added to your balance.
            </p>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/northstar/account/credits">View spend</Link>
            </Button>
          </div>
        </SweepIn>
      )}

      {/* 充值包(§L2 grid;popular 卡 = 唯一 statement,soft 边不抢 coral 预算) */}
      <section aria-label="Top-up packs" className="mt-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {TOP_UP_PACKS.map((p) => {
            const active = p.id === selected;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSelected(p.id)}
                className={cn(
                  "relative flex flex-col rounded-[16px] border bg-card p-5 text-left outline-none transition-[border-color,box-shadow] duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  active
                    ? "border-foreground shadow-[var(--shadow-sm)]"
                    : "border-border hover:border-[color-mix(in_oklab,var(--foreground)_15%,var(--border))]",
                )}
              >
                {p.popular && (
                  <Badge variant="default" className="absolute right-4 top-4 gap-1">
                    <Sparkles className="size-3" strokeWidth={2} />
                    Popular
                  </Badge>
                )}
                <p className="text-sm font-semibold text-foreground">{p.name}</p>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-[28px] leading-8 font-bold tracking-[-0.02em] tabular-nums text-foreground">
                    {formatCredits(p.credits)}
                  </span>
                  <span className="text-sm font-medium text-muted-foreground">credits</span>
                </div>
                {p.bonusCredits > 0 && (
                  <p className="mt-1 text-xs font-semibold text-success-soft-foreground tabular-nums">
                    + {formatCredits(p.bonusCredits)} bonus credits
                  </p>
                )}
                <p className="mt-3 min-h-[36px] text-xs leading-[18px] text-muted-foreground">
                  {p.blurb}
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                  <span className="text-sm font-semibold text-foreground tabular-nums">
                    {fmtMyr(p.priceMyr)}
                  </span>
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full border",
                      active ? "border-foreground bg-foreground" : "border-border",
                    )}
                  >
                    {active && <Check className="size-3 text-background" strokeWidth={3} />}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* 结账条(选中包 → INK 支付按钮;金额 verbatim 就在按钮上) */}
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-[14px] border border-border bg-card px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {pack.name} · {formatCredits(totalCredits)} credits
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {pack.bonusCredits > 0
                ? `${formatCredits(pack.credits)} + ${formatCredits(pack.bonusCredits)} bonus. `
                : ""}
              No charge until you confirm.
            </p>
          </div>
          <Button size="default" onClick={() => setPhase("confirm")}>
            Top up {fmtMyr(pack.priceMyr)}
          </Button>
        </div>

        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck aria-hidden className="size-3.5" strokeWidth={2} />
          Payments are handled by Stripe. We never store your card.
        </p>
      </section>

      {/* 说明:够用吗 + 滚存 */}
      <section aria-label="How far credits go" className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-[14px] border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">How far credits go</h2>
          <dl className="mt-3 flex flex-col gap-2.5">
            {CREDIT_GUIDE.map((g) => (
              <div key={g.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-[13px] text-muted-foreground">{g.label}</dt>
                <dd className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
                  {g.est}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Estimates. Otto shows the exact cost before it spends.
          </p>
        </div>
        <div className="rounded-[14px] border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Good to know</h2>
          <p className="mt-3 text-[13px] leading-[20px] text-muted-foreground">{ROLLOVER_NOTE}</p>
          <p className="mt-2 text-[13px] leading-[20px] text-muted-foreground">
            Otto never tops up on its own. Every purchase is your decision.
          </p>
        </div>
      </section>

      {/* 订阅层占位(席位双档,未建) */}
      <section aria-label="Plans" className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-foreground">Plans</h2>
          <span className="text-xs text-muted-foreground">Coming soon</span>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PLAN_TIERS.map((tier) => (
            <div
              key={tier.id}
              className={cn(
                "flex flex-col rounded-[14px] border bg-card p-5",
                tier.current ? "border-foreground" : "border-border",
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">{tier.name}</p>
                {tier.current ? (
                  <Badge variant="success">Current</Badge>
                ) : (
                  <Badge variant="outline">Soon</Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{tier.seats}</p>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-xl font-bold tabular-nums text-foreground">
                  {tier.priceMyr === 0 ? "Free" : fmtMyr(tier.priceMyr)}
                </span>
                {tier.priceMyr > 0 && <span className="text-xs text-muted-foreground">/ month</span>}
              </div>
              <ul className="mt-3 flex flex-col gap-1.5">
                {tier.perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 text-[13px] text-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                    {perk}
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <Button variant="secondary" size="sm" disabled={tier.current} className="w-full">
                  {tier.current ? "Your plan" : "Notify me"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 确认支付对话框(§FB5;金额 verbatim;§FB6 money rule) */}
      <Dialog
        open={phase === "confirm" || phase === "paying"}
        onOpenChange={(o) => {
          if (!o && phase !== "paying") setPhase("idle");
        }}
      >
        <DialogContent className="max-w-[min(440px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Confirm top up</DialogTitle>
            <DialogDescription>You&apos;ll be charged in ringgit. Your balance grows in credits.</DialogDescription>
          </DialogHeader>
          <div className="rounded-[14px] bg-secondary/70 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Pack</span>
              <span className="text-[13px] font-semibold text-foreground">{pack.name}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Credits added</span>
              <span className="text-[13px] font-semibold tabular-nums text-foreground">
                {formatCredits(totalCredits)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
              <span className="text-[13px] font-medium text-foreground">You pay now</span>
              <span className="text-sm font-bold tabular-nums text-foreground">
                {fmtMyr(pack.priceMyr)}
              </span>
            </div>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CreditCard aria-hidden className="size-3.5" strokeWidth={2} />
            Card ending 4242 · via Stripe
          </p>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setPhase("idle")}
              disabled={phase === "paying"}
            >
              Cancel
            </Button>
            <Button onClick={startPay} disabled={phase === "paying"}>
              {phase === "paying" ? "Processing…" : `Pay ${fmtMyr(pack.priceMyr)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MockNote path="/northstar/account/top-up" />
    </div>
  );
}

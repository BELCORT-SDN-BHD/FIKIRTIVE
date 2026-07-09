"use client";

/**
 * 广告表现页(§L List;880;P0·live·revamp)—— 原生重建 + Wave C 钱化(Z8-analytics-ads-aeo)。
 *
 * §五契约:money KPI(spend/orders/cost-per-order/return)+ 三段 verdict 列(Scale/Optimize/
 * Pause);点行展开 = Otto 诊断(叙述条 2 步→skeleton→coral-soft 诊断卡,带 KB/Meta 来源引用,
 * O-10 不捏造)+ 钱化面(每单花多少、Efficiency Index、本期净利、样本门槛);verdict 主动作分档:
 * 赢家=加预算 · 亏钱=零成本暂停 · 其余=修一版(走 O-10 诊断→创作链)。performance 是本区唯一
 * Otto 在场页,走满 §8 三态。冷启动诚实:净利用行业默认烘焙成本估算,明标可在 Settings 填真实成本。
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { BookOpen, ChevronDown, ExternalLink, Megaphone, Sparkles, TrendingUp, PauseCircle, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, OttoNarrationBar } from "@/components/northstar/_shared";
import { metaKbEntry } from "@/components/northstar/ads/meta-kb";
import {
  LandIn,
  NsSkeleton,
  ProvenancePill,
  fmtCount,
  fmtMoney,
} from "@/components/northstar/analytics/zone-kit";
import {
  NS_AD_ACCOUNT,
  NS_ADS,
  NS_VERDICT_META,
  accountMoney,
  adMoneyFor,
  type NsAd,
  type NsAdCitation,
  type NsAdMoney,
  type NsAdVerdict,
} from "@/components/northstar/ads/mock-ads";
import { adSubmissions, useStore } from "@/components/northstar/immersive/_store";
import { useImmersive } from "@/components/northstar/immersive/_context";
import { OttoAssist } from "../otto-assist";
import { AdsNav, PinnedHeader, StateWall, ZoneBody } from "./kit";

type Demo = "ready" | "loading" | "empty" | "error";

const DIAGNOSE_STEPS = ["Reading this ad's numbers…", "Checking the money math…"] as const;

/* verdict 视觉:语义色(coral 只属于 Otto,verdict 是状态不是 Otto 的声音) */
const VERDICT_STYLE: Record<NsAdVerdict, { badge: string; icon: typeof TrendingUp }> = {
  scale: { badge: "bg-success-soft text-success-soft-foreground", icon: TrendingUp },
  optimize: { badge: "bg-secondary text-foreground", icon: Wrench },
  pause: { badge: "bg-error-soft text-error-soft-foreground", icon: PauseCircle },
};

function VerdictBadge({ verdict }: { verdict: NsAdVerdict }) {
  const s = VERDICT_STYLE[verdict];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", s.badge)}>
      <Icon className="size-3" strokeWidth={2.5} />
      {NS_VERDICT_META[verdict].label}
    </span>
  );
}

function CitationChip({ citation }: { citation: NsAdCitation }) {
  const entry = citation.knowledgeId ? metaKbEntry(citation.knowledgeId) : undefined;
  if (!entry) {
    return (
      <span
        className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground"
        title={citation.label}
      >
        {citation.source ?? citation.label}
      </span>
    );
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="ns-pressable inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] leading-[14px] font-medium tracking-[0.01em] text-foreground transition-colors duration-[120ms] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <BookOpen className="size-3 shrink-0 text-muted-foreground" strokeWidth={2} />
          <span className="min-w-0 truncate">{citation.label}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">Meta official</Badge>
            <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
              {entry.domain}
            </span>
          </div>
          <DialogTitle className="mt-2 text-base leading-[1.4]">{citation.label}</DialogTitle>
          <DialogDescription className="sr-only">Verified Meta advertising guidance behind this citation</DialogDescription>
        </DialogHeader>
        <p className="text-sm leading-[1.55] text-foreground">{entry.claim}</p>
        {entry.detail && <p className="text-[13px] leading-[1.5] text-muted-foreground">{entry.detail}</p>}
        {entry.benchmark && (
          <p className="rounded-[10px] bg-secondary px-3 py-2 text-[13px] leading-[1.5] font-medium text-foreground">{entry.benchmark}</p>
        )}
        <a
          href={entry.source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 flex items-start gap-2 rounded-[12px] border border-border bg-card px-3 py-2.5 text-left transition-colors duration-[120ms] hover:bg-accent"
        >
          <ExternalLink className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] leading-[18px] font-semibold text-foreground">{entry.source.title}</span>
            <span className="block text-[11px] leading-4 text-muted-foreground">facebook.com · retrieved {entry.source.retrievedAt}</span>
          </span>
        </a>
      </DialogContent>
    </Dialog>
  );
}

/** 一格钱化读数(标签 + 值 + 可选副行)。 */
function MoneyCell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-[10px] border border-border bg-background p-3">
      <div className="text-[11px] leading-4 font-medium text-muted-foreground" title={label}>{label}</div>
      <div
        className={cn(
          "mt-0.5 text-base font-bold tabular-nums",
          tone === "up" ? "text-success-soft-foreground" : tone === "down" ? "text-error-soft-foreground" : "text-foreground",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] leading-4 text-muted-foreground">{sub}</div>}
    </div>
  );
}

function MetricCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="w-[76px] shrink-0 text-right" title={hint}>
      <div className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground uppercase">{label}</div>
      <div className="text-sm font-semibold text-foreground tabular-nums">{value}</div>
    </div>
  );
}

function AdRow({
  ad,
  money,
  open,
  diagnosing,
  isPaused,
  onToggle,
  onDiagnosed,
  onPause,
}: {
  ad: NsAd;
  money: NsAdMoney;
  open: boolean;
  diagnosing: boolean;
  isPaused: boolean;
  onToggle: () => void;
  onDiagnosed: () => void;
  onPause: (ad: NsAd) => void;
}) {
  const cur = NS_AD_ACCOUNT.currencyPrefix;
  const netTone = money.netMarginMyr === null ? undefined : money.netMarginMyr >= 0 ? "up" : "down";
  const netValue =
    money.netMarginMyr === null
      ? "—"
      : `${money.netMarginMyr >= 0 ? "+" : "−"}${fmtMoney(cur, Math.abs(money.netMarginMyr))}`;

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-[120ms] hover:bg-accent"
      >
        <Image
          src={ad.thumb}
          alt=""
          width={56}
          height={56}
          unoptimized
          className="size-14 shrink-0 rounded-[10px] border border-border object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("min-w-0 truncate text-sm font-semibold", isPaused ? "text-muted-foreground line-through" : "text-foreground")}>{ad.name}</span>
            {isPaused ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                <PauseCircle className="size-3" strokeWidth={2.5} />
                Paused
              </span>
            ) : (
              <VerdictBadge verdict={money.verdict} />
            )}
          </div>
          {/* 钱话先行:每单花多少 / 净利,而不是 CTR 缩写 */}
          <div className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{money.moneyLine}</div>
          <div className="mt-0.5 font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground">
            {ad.format} · {ad.daysRunning} days
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-3 md:flex">
          <MetricCell label="Spend" value={fmtMoney(cur, ad.spendMyr)} />
          <MetricCell label={money.isEnquiry ? "Chats" : "Orders"} value={String(ad.results)} hint={money.isEnquiry ? "Order enquiries — not sales yet" : "Purchases"} />
          <MetricCell
            label={money.isEnquiry ? "Per chat" : "Per order"}
            value={fmtMoney(cur, money.costPerResultMyr)}
            hint="What each result cost you in ad spend"
          />
        </div>
        <ChevronDown
          className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-[150ms]", open && "rotate-180")}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="px-4 pb-4">
          {diagnosing ? (
            <div>
              <OttoNarrationBar key={ad.id} steps={DIAGNOSE_STEPS} stepMs={1000} onSettle={onDiagnosed} className="w-fit" />
              <NsSkeleton className="mt-3 h-32 rounded-[14px]" />
            </div>
          ) : (
            <LandIn>
              {/* ① 钱化面 —— verdict 的账本(数字全可指回本条 ad) */}
              <div className="rounded-[14px] border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <VerdictBadge verdict={money.verdict} />
                  <span className="text-sm font-semibold text-foreground">{money.moneyLine}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2.5">
                  <MoneyCell
                    label={money.isEnquiry ? "Cost per chat" : "Cost per order"}
                    value={fmtMoney(cur, money.costPerResultMyr)}
                    sub={money.isEnquiry ? undefined : `sells ${fmtMoney(cur, money.unitPriceMyr)}`}
                  />
                  <MoneyCell
                    label="Efficiency index"
                    value={money.isEnquiry ? "—" : `${money.efficiencyIndex.toFixed(1)}×`}
                    sub={money.isEnquiry ? "enquiries" : money.efficiencyIndex >= 1 ? "above its budget share" : "below its budget share"}
                  />
                  <MoneyCell label="Net this period" value={netValue} sub={money.isEnquiry ? "no sales yet" : undefined} tone={netTone} />
                </div>
                <p className="mt-2.5 text-[12px] leading-[16px] text-muted-foreground">{money.sampleNote}</p>
              </div>

              {/* ② Otto 诊断卡 —— 本屏唯一 coral statement(一次只开一张) */}
              <div className="mt-3 rounded-[14px] border border-brand-soft bg-brand-soft/40 p-4">
                <div className="flex items-start gap-3">
                  <OttoAvatar size={22} mood="helpful" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-[1.5] text-foreground">{ad.diagnosis.summary}</p>
                    <ul className="mt-2 flex flex-col gap-1">
                      {ad.diagnosis.evidence.map((e) => (
                        <li key={e} className="text-[13px] leading-[18px] text-muted-foreground">· {e}</li>
                      ))}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {ad.diagnosis.citations.map((c) => (
                        <CitationChip key={c.label} citation={c} />
                      ))}
                    </div>
                    {/* ③ verdict 主动作分档:加预算 / 暂停(0 成本) / 修一版 */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {money.verdict === "scale" ? (
                        <>
                          <Button asChild variant="brand" size="sm" className="ns-pressable">
                            <Link href="/northstar-immersive/ads/builder">
                              <TrendingUp />
                              {money.actionLabel}
                            </Link>
                          </Button>
                          <span className="text-xs text-muted-foreground">Verified winner — raise its daily budget in the builder.</span>
                        </>
                      ) : money.verdict === "pause" ? (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="ns-pressable"
                            disabled={isPaused}
                            onClick={() => onPause(ad)}
                          >
                            <PauseCircle />
                            {isPaused ? "Paused" : money.actionLabel}
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            {isPaused ? "Stopped — no more spend on this ad." : "Stops the spend now. Costs nothing."}
                          </span>
                        </>
                      ) : (
                        <>
                          <Button asChild variant="brand" size="sm" className="ns-pressable">
                            <Link href={`/northstar-immersive/create/canvas?from=ad&adId=${ad.id}`}>
                              <Sparkles />
                              {money.actionLabel}
                            </Link>
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            Opens in canvas. Nothing generates until you confirm the cost.
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </LandIn>
          )}
        </div>
      )}
    </div>
  );
}

function VerdictSection({
  title,
  hint,
  ads,
  openId,
  diagnosed,
  paused,
  toggle,
  markDiagnosed,
  onPause,
}: {
  title: string;
  hint: string;
  ads: { ad: NsAd; money: NsAdMoney }[];
  openId: string | null;
  diagnosed: Set<string>;
  paused: Set<string>;
  toggle: (id: string) => void;
  markDiagnosed: (id: string) => void;
  onPause: (ad: NsAd) => void;
}) {
  if (ads.length === 0) return null;
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-card">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {ads.map(({ ad, money }) => (
        <AdRow
          key={ad.id}
          ad={ad}
          money={money}
          open={openId === ad.id}
          diagnosing={openId === ad.id && !diagnosed.has(ad.id)}
          isPaused={paused.has(ad.id)}
          onToggle={() => toggle(ad.id)}
          onDiagnosed={() => markDiagnosed(ad.id)}
          onPause={onPause}
        />
      ))}
    </section>
  );
}

export default function AdsPerformance() {
  const inside = useImmersive()?.insideImmersive ?? false;
  const [demo, setDemo] = React.useState<Demo>("ready");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [diagnosed, setDiagnosed] = React.useState<Set<string>>(new Set());
  const [paused, setPaused] = React.useState<Set<string>>(new Set());

  useStore();
  const pending = adSubmissions();

  const cur = NS_AD_ACCOUNT.currencyPrefix;
  const acct = accountMoney(NS_ADS);
  const rows = NS_ADS.map((ad) => ({ ad, money: adMoneyFor(ad, NS_ADS) }));
  const scale = rows.filter((r) => r.money.verdict === "scale");
  const optimize = rows.filter((r) => r.money.verdict === "optimize");
  const pause = rows.filter((r) => r.money.verdict === "pause");

  function toggle(id: string) {
    setOpenId((cur) => (cur === id ? null : id));
  }
  function markDiagnosed(id: string) {
    setDiagnosed((prev) => new Set(prev).add(id));
  }
  function onPause(ad: NsAd) {
    setPaused((prev) => new Set(prev).add(ad.id));
    toast("Ad paused", { description: `${ad.name} stopped spending. No cost to pause. (prototype)` });
  }

  // 钱化 KPI(答案先行:花了多少 → 换回多少,不再报裸曝光)
  const kpis = [
    { label: "Ad spend", value: fmtMoney(cur, acct.totalSpendMyr), sub: `${NS_ADS.length} ads` },
    { label: "Orders", value: String(acct.orders), sub: `+ ${acct.enquiries} enquiries` },
    { label: "Cost per order", value: fmtMoney(cur, acct.costPerOrderMyr), sub: "selling ads only" },
    { label: "Return", value: `${acct.returnMultiple.toFixed(1)}×`, sub: `${fmtMoney(cur, acct.revenueMyr)} in sales` },
  ];

  return (
    <>
      <PinnedHeader
        title="Ad performance"
        meta={
          <span className="inline-flex h-7 items-center rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground">
            9 Jun to 6 Jul
          </span>
        }
        nav={<AdsNav />}
        provenance={<ProvenancePill text="via Meta · read-only" />}
        actions={
          <OttoAssist
            zone="Analytics"
            entityLabel="Ad performance"
            label="Ask Otto"
            formState={{ orders: acct.orders, spend: acct.totalSpendMyr, wasteMyr: Math.round(acct.wasteMyr) }}
            intents={[
              {
                id: "which-scale",
                label: "Which should I put more money behind?",
                prompt: "Which of my ads should I scale up right now, and how much more budget?",
                reply:
                  "Your Merdeka unboxing reel is the clear one — RM3.61 a box, 2.1× efficiency. I'd lift its daily budget by half and watch cost-per-order for 3 days before going further.",
              },
              {
                id: "which-pause",
                label: "What's leaking money?",
                prompt: "Which ads are losing money and should I pause?",
                reply: `Three ads are in the red — about ${fmtMoney(cur, acct.wasteMyr)} this period. The Kopi tiramisu ad is the worst: RM32 to sell an RM18 dessert. Pausing all three costs nothing and stops the bleed.`,
              },
              {
                id: "read-one",
                label: "Explain one ad to me",
                prompt: "Walk me through the numbers on my worst ad in plain words.",
                reply:
                  "Open any ad row and I'll show the money read: what each order cost, whether it's above or below its budget share, and whether there's enough data to trust it yet.",
              },
            ]}
          />
        }
      />

      <ZoneBody>
        {/* 待审(广告构建器提交的草稿):顶部 chip + pending 行,无数字(还没跑) */}
        {pending.length > 0 && (
          <section className="mt-5 rounded-[var(--radius-card)] border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 px-4 pt-4 pb-2">
              <h2 className="text-sm font-semibold text-foreground">Submitted for approval</h2>
              <Badge variant="warning">
                {pending.length} pending {pending.length === 1 ? "review" : "reviews"}
              </Badge>
            </div>
            {pending.map((e) => (
              <div key={e.at} className="flex items-center gap-3 border-t border-border px-4 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-secondary">
                  <Megaphone className="size-[18px] text-muted-foreground" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">{String(e.payload.label ?? "New campaign")}</div>
                  <div className="text-xs text-muted-foreground">Waiting for approval. Stays paused until then.</div>
                </div>
                <Badge variant="warning">In review</Badge>
              </div>
            ))}
          </section>
        )}

        {demo === "error" && (
          <StateWall
            title="Couldn't reach Meta just now"
            body="Your connection is fine. Try again in a moment."
            action={
              <Button variant="ghost" size="sm" onClick={() => setDemo("ready")}>
                Retry
              </Button>
            }
          />
        )}

        {demo === "empty" && (
          <div className="mt-5 rounded-[var(--radius-card)] border border-border bg-card">
            <EmptyState
              icon={Megaphone}
              title="No ads ran in this period"
              body="Launch a draft from the ad builder or ask Otto to plan one."
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link href="/northstar-immersive/ads/builder">Open ad builder</Link>
                </Button>
              }
            />
          </div>
        )}

        {demo === "loading" && (
          <div className="mt-5">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <NsSkeleton className="h-[88px] rounded-[14px]" shimmer={false} />
              <NsSkeleton className="h-[88px] rounded-[14px]" shimmer={false} />
              <NsSkeleton className="h-[88px] rounded-[14px]" shimmer={false} />
              <NsSkeleton className="h-[88px] rounded-[14px]" shimmer={false} />
            </div>
            <div className="mt-3.5 rounded-[var(--radius-card)] border border-border bg-card p-4">
              <NsSkeleton className="h-[72px]" />
              <NsSkeleton className="mt-3 h-[72px]" />
              <NsSkeleton className="mt-3 h-[72px]" />
            </div>
          </div>
        )}

        {demo === "ready" && (
          <div className="mt-5 flex flex-col gap-3.5">
            {/* 账户钱化 KPI(答案先行) */}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {kpis.map((k) => (
                <div key={k.label} className="rounded-[14px] border border-border bg-card p-4">
                  <div className="text-xs font-medium text-muted-foreground">{k.label}</div>
                  <div className="mt-1 text-[26px] leading-8 font-bold tracking-[-0.02em] text-foreground tabular-nums">{k.value}</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{k.sub}</div>
                </div>
              ))}
            </div>

            {/* 浪费硬钱数 —— 亏钱广告的净亏总和,配零成本止血入口 */}
            {acct.pauseCount > 0 && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[12px] border border-error-soft bg-error-soft/40 px-4 py-3">
                <PauseCircle className="size-4 shrink-0 text-error-soft-foreground" strokeWidth={2} />
                <p className="min-w-0 flex-1 basis-64 text-[13px] leading-[18px] text-foreground">
                  About <span className="font-semibold">{fmtMoney(cur, acct.wasteMyr)}</span> of your{" "}
                  {fmtMoney(cur, acct.totalSpendMyr)} went to {acct.pauseCount} ads that cost more than they earned
                  ({Math.round(acct.wastePct)}% of spend). Pausing them stops the bleed at zero cost.
                </p>
              </div>
            )}

            {/* 冷启动诚实:净利用行业默认烘焙成本估算 */}
            <p className="text-xs text-muted-foreground">
              Money read splits your ads by verdict. Net counts sale value minus baking cost minus ad spend —
              baking costs use industry defaults for now;{" "}
              <Link href="/northstar-immersive/account/settings" className="ns-human-text font-semibold underline-offset-2 hover:underline">
                add yours in Settings
              </Link>{" "}
              to sharpen it.
            </p>

            {/* 三段 verdict 列(Scale / Optimize / Pause) */}
            <VerdictSection
              title="Scale — verified winners, put more behind them"
              hint={`${scale.length} ${scale.length === 1 ? "ad is" : "ads are"} earning well above their budget share`}
              ads={scale}
              openId={openId}
              diagnosed={diagnosed}
              paused={paused}
              toggle={toggle}
              markDiagnosed={markDiagnosed}
              onPause={onPause}
            />
            <VerdictSection
              title="Optimize — earning, but worth a fix"
              hint={`${optimize.length} ${optimize.length === 1 ? "ad" : "ads"} — tap any row for Otto's read and how to fix it`}
              ads={optimize}
              openId={openId}
              diagnosed={diagnosed}
              paused={paused}
              toggle={toggle}
              markDiagnosed={markDiagnosed}
              onPause={onPause}
            />
            <VerdictSection
              title="Pause — losing money, stop the bleed"
              hint={`${pause.length} ${pause.length === 1 ? "ad costs" : "ads cost"} more than they bring back — tap a row to see why`}
              ads={pause}
              openId={openId}
              diagnosed={diagnosed}
              paused={paused}
              toggle={toggle}
              markDiagnosed={markDiagnosed}
              onPause={onPause}
            />

            <p className="text-[11px] leading-4 text-muted-foreground">
              Impressions {fmtCount(NS_AD_ACCOUNT.kpis.impressions)} · clicks {fmtCount(NS_AD_ACCOUNT.kpis.clicks)} ·
              account CTR {NS_AD_ACCOUNT.avgCtr.toFixed(1)}% · CPC {fmtMoney(cur, NS_AD_ACCOUNT.avgCpcMyr)}. CTR = share
              of viewers who clicked; CPC = cost of each click.
            </p>
          </div>
        )}

        {/* 页内三态演示(沉浸式壳内隐藏) */}
        {!inside && (
          <div className="mt-3 flex flex-wrap items-center gap-1">
            <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground/70">演示</span>
            {(["ready", "loading", "empty", "error"] as Demo[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setDemo(s)}
                className={cn(
                  "h-6 rounded-full px-2.5 font-mono text-[10px] tracking-[0.06em] transition-colors",
                  demo === s ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </ZoneBody>
    </>
  );
}

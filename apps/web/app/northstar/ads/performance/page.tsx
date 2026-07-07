/* @nsPage district="广告区" page="performance" status="draft"
   sources="区划图·广告区/分析区(#128);O-10 判决" approvedAt="" pr="" */
"use client";

/**
 * 广告表现页 — 逐条 ad 表现与 Otto 诊断(不捏造,带 KB 引用)。
 *
 * 依据:PAGE-INVENTORY 五·广告区行 1 + O-10 判决(诊断 → 创作链复刻接线)。
 * 元素:per-ad 面板(账户自身均值分赢家 / 输家)、Otto 诊断卡(证据可回指数字、
 * 引用带来源)、诊断 → 创作链按钮。展开诊断 = Otto 工作:叙述条 → 卡片落地(§8b/c);
 * 同屏最多一张诊断卡打开(coral budget §O4:statement ≤1)。
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronDown, Megaphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, MockNote, OttoNarrationBar, PageHeader } from "@/components/northstar/_shared";
import {
  DemoStateBar,
  LandIn,
  NsSkeleton,
  ProvenancePill,
  fmtCount,
  fmtMoney,
  type NsDemoState,
} from "@/components/northstar/analytics/zone-kit";
import { NS_AD_ACCOUNT, NS_ADS, type NsAd } from "@/components/northstar/ads/mock-ads";

const DIAGNOSE_STEPS = ["Reading this ad's numbers…", "Checking your creative playbook…"] as const;

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-[76px] shrink-0 text-right">
      <div className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </div>
      <div className="text-sm font-semibold text-foreground tabular-nums">{value}</div>
    </div>
  );
}

function AdRow({
  ad,
  open,
  diagnosing,
  onToggle,
  onDiagnosed,
}: {
  ad: NsAd;
  open: boolean;
  diagnosing: boolean;
  onToggle: () => void;
  onDiagnosed: () => void;
}) {
  const winner = ad.ctr >= NS_AD_ACCOUNT.avgCtr;
  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-[120ms] hover:bg-accent"
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
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">{ad.name}</span>
            <Badge variant={winner ? "success" : "destructive"}>
              {winner ? "Above average" : "Below average"}
            </Badge>
          </div>
          <div className="mt-0.5 font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground">
            {ad.format} · {ad.daysRunning} days
          </div>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <MetricCell label="Spend" value={fmtMoney(NS_AD_ACCOUNT.currencyPrefix, ad.spendMyr)} />
          <MetricCell label="CTR" value={`${ad.ctr.toFixed(1)}%`} />
          <MetricCell label="CPC" value={fmtMoney(NS_AD_ACCOUNT.currencyPrefix, ad.cpcMyr)} />
          <MetricCell label="Results" value={String(ad.results)} />
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-[150ms]",
            open && "rotate-180",
          )}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="px-4 pb-4">
          {/* 小屏补指标(桌面在行内) */}
          <div className="mb-3 flex flex-wrap gap-3 md:hidden">
            <MetricCell label="Spend" value={fmtMoney(NS_AD_ACCOUNT.currencyPrefix, ad.spendMyr)} />
            <MetricCell label="CTR" value={`${ad.ctr.toFixed(1)}%`} />
            <MetricCell label="CPC" value={fmtMoney(NS_AD_ACCOUNT.currencyPrefix, ad.cpcMyr)} />
            <MetricCell label="Results" value={String(ad.results)} />
          </div>

          {diagnosing ? (
            <div>
              <OttoNarrationBar
                key={ad.id}
                steps={DIAGNOSE_STEPS}
                stepMs={1000}
                onSettle={onDiagnosed}
                className="w-fit"
              />
              {/* 先占位后落地(§8b) */}
              <NsSkeleton className="mt-3 h-32 rounded-[14px]" />
            </div>
          ) : (
            <LandIn>
              {/* Otto 诊断卡 — 本屏唯一 coral statement(一次只开一张) */}
              <div className="rounded-[14px] border border-brand-soft bg-brand-soft/40 p-4">
                <div className="flex items-start gap-3">
                  <OttoAvatar size={22} mood="helpful" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-[1.5] text-foreground">{ad.diagnosis.summary}</p>
                    <ul className="mt-2 flex flex-col gap-1">
                      {ad.diagnosis.evidence.map((e) => (
                        <li key={e} className="text-[13px] leading-[18px] text-muted-foreground">
                          · {e}
                        </li>
                      ))}
                    </ul>
                    {/* 引用带来源(不捏造):KB / Meta insights */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {ad.diagnosis.citations.map((c) => (
                        <span
                          key={c.label}
                          className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground"
                          title={c.label}
                        >
                          {c.source}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {/* O-10 诊断 → 创作链(按下开 Otto 工作 → brand;先到画布,花钱前必有确认) */}
                      <Button asChild variant="brand" size="sm">
                        <Link href="/northstar/create/canvas">
                          <Sparkles />
                          {ad.diagnosis.action}
                        </Link>
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Opens in canvas. Nothing generates until you confirm the cost.
                      </span>
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

export default function Page() {
  const [demo, setDemo] = React.useState<NsDemoState>("ready");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [diagnosed, setDiagnosed] = React.useState<Set<string>>(new Set());

  const winners = NS_ADS.filter((a) => a.ctr >= NS_AD_ACCOUNT.avgCtr);
  const laggards = NS_ADS.filter((a) => a.ctr < NS_AD_ACCOUNT.avgCtr);

  function toggle(id: string) {
    setOpenId((cur) => (cur === id ? null : id));
  }

  function markDiagnosed(id: string) {
    setDiagnosed((prev) => new Set(prev).add(id));
  }

  const kpis = [
    { label: "Ad spend", value: fmtMoney(NS_AD_ACCOUNT.currencyPrefix, NS_AD_ACCOUNT.kpis.spendMyr) },
    { label: "Impressions", value: fmtCount(NS_AD_ACCOUNT.kpis.impressions) },
    { label: "Clicks", value: fmtCount(NS_AD_ACCOUNT.kpis.clicks) },
    { label: "Results", value: String(NS_AD_ACCOUNT.kpis.results) },
  ];

  return (
    <div className="mx-auto w-full max-w-[880px] px-6 pt-6 pb-24">
      {/* 页头永远渲染(§D1⑤) */}
      <PageHeader title="Ad performance" meta={["9 Jun to 6 Jul"]} />
      <div className="mt-2">
        <ProvenancePill text="via Meta · read-only" />
      </div>

      {demo === "error" && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card px-6 py-14 text-center">
          <div className="text-[24px] leading-[30px] font-bold tracking-[-0.02em] text-foreground">
            Couldn&apos;t reach Meta just now
          </div>
          <p className="max-w-[360px] text-[13px] leading-[18px] text-muted-foreground">
            Your connection is fine. Try again in a moment.
          </p>
          <Button variant="ghost" size="sm" onClick={() => setDemo("ready")}>
            Retry
          </Button>
        </div>
      )}

      {demo === "empty" && (
        <div className="mt-6 rounded-[var(--radius-card)] border border-border bg-card">
          <EmptyState
            icon={Megaphone}
            title="No ads ran in this period"
            body="Launch a draft from the ad builder or ask Otto to plan one."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/northstar/ads/builder">Open ad builder</Link>
              </Button>
            }
          />
        </div>
      )}

      {demo === "loading" && (
        <div className="mt-4">
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
        <div className="mt-4">
          {/* 账户 KPI(答案先行) */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-[14px] border border-border bg-card p-4">
                <div className="text-xs font-medium text-muted-foreground">{k.label}</div>
                <div className="mt-1 text-[26px] leading-8 font-bold tracking-[-0.02em] text-foreground tabular-nums">
                  {k.value}
                </div>
              </div>
            ))}
          </div>

          {/* 分界口径:账户自身均值(不是行业均值) */}
          <p className="mt-3 text-xs text-muted-foreground">
            Split by your own account average this period: CTR {NS_AD_ACCOUNT.avgCtr.toFixed(1)}% ·
            CPC {fmtMoney(NS_AD_ACCOUNT.currencyPrefix, NS_AD_ACCOUNT.avgCpcMyr)}.
          </p>

          {/* 赢家(§D4 form A:hairline 行,面板内满血宽) */}
          <section className="mt-3.5 rounded-[var(--radius-card)] border border-border bg-card">
            <div className="px-4 pt-4 pb-2">
              <h2 className="text-sm font-semibold text-foreground">Doing well</h2>
              <p className="text-xs text-muted-foreground">
                {winners.length} ads above your account average
              </p>
            </div>
            {winners.map((ad) => (
              <AdRow
                key={ad.id}
                ad={ad}
                open={openId === ad.id}
                diagnosing={openId === ad.id && !diagnosed.has(ad.id)}
                onToggle={() => toggle(ad.id)}
                onDiagnosed={() => markDiagnosed(ad.id)}
              />
            ))}
          </section>

          {/* 输家 */}
          <section className="mt-3.5 rounded-[var(--radius-card)] border border-border bg-card">
            <div className="px-4 pt-4 pb-2">
              <h2 className="text-sm font-semibold text-foreground">Needs attention</h2>
              <p className="text-xs text-muted-foreground">
                {laggards.length} ads below your account average
              </p>
            </div>
            {laggards.map((ad) => (
              <AdRow
                key={ad.id}
                ad={ad}
                open={openId === ad.id}
                diagnosing={openId === ad.id && !diagnosed.has(ad.id)}
                onToggle={() => toggle(ad.id)}
                onDiagnosed={() => markDiagnosed(ad.id)}
              />
            ))}
          </section>
        </div>
      )}

      <MockNote path="/northstar/ads/performance" />
      <DemoStateBar value={demo} onChange={setDemo} />
    </div>
  );
}

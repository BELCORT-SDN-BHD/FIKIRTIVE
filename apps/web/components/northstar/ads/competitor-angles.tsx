"use client";

/**
 * 同行广告透视 —— 共享正文(画廊页 + 沉浸式组件同一份正文,只差外壳页头)。
 * GOOSEWORKS-MAP §二 B1:搜同城同类 → 广告卡瀑布(真图)→ 按 hook 聚类 → 「借这个角度」进创作。
 *
 * 三条方法(在数据层算好,这里只渲染):
 *  ① 按 hook 角度聚类(我们对开场白的判读,照实标注,不冒充 Meta 标签);
 *  ② 用「跑了多久」当唯一诚实赢家信号(Ad Library 不公开花费/触达 —— 长跑 = 一直在付费);
 *  ③ 白空间 = 同城同行没人打的角度 = 你的机会(Otto 一条 coral statement 点出来)。
 *
 * 双声部(§2 修正案):搜索框 = 人手交互 → 焦点环自动蓝;「借这个角度」= 人手主动作(blue)。
 * coral 只留给 Otto 的白空间判读(§O 一屏一条 statement)+ Otto 帮我小云标记。
 * 手感(§5a):阅读卡片保持平;可点控件 .ns-pressable 凸起。
 * 零后台 import;图片只走 NS_IMAGES;发/花永不由此触发(借角度只开画布,花钱前必确认)。
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Clock,
  ExternalLink,
  Layers,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { SweepBox } from "@/components/northstar/analytics/zone-kit";
import { useInsideImmersive } from "@/components/northstar/immersive/_context";
import { OttoAssist } from "@/components/northstar/immersive/otto-assist";
import {
  NS_COMPETITOR_SEARCH,
  clusterByHook,
  competitorOverview,
  longestRunning,
  whiteSpaceAngle,
  type NsCompetitorAd,
  type NsHookCluster,
} from "./competitor-ads";

/** 「跑了多久」赢家信号的分档(纯展示口径:久 = 更被验证)。 */
function runTone(days: number): { label: string; cls: string } {
  if (days >= 30) return { label: "Long-runner", cls: "bg-success-soft text-success-soft-foreground" };
  if (days >= 14) return { label: "Holding", cls: "bg-secondary text-foreground" };
  return { label: "New", cls: "bg-info-soft text-info-soft-foreground" };
}

function AdCard({ ad, base }: { ad: NsCompetitorAd; base: string }) {
  const tone = runTone(ad.daysRunning);
  return (
    // 阅读卡片保持平(§5a 法一);内部可点控件才凸。
    <figure className="flex flex-col overflow-hidden rounded-[14px] border border-border bg-card">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        <Image src={ad.thumb} alt="" fill unoptimized sizes="(max-width:640px) 100vw, 320px" className="object-cover" />
        <span
          className={cn(
            "absolute top-2 left-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-[var(--shadow-xs)]",
            tone.cls,
          )}
        >
          <Clock className="size-3" strokeWidth={2.2} />
          {ad.daysRunning}d
        </span>
      </div>
      <figcaption className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{ad.advertiser}</span>
          <span className="shrink-0 font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
            {ad.format}
          </span>
        </div>
        <p className="line-clamp-3 text-[13px] leading-[18px] text-muted-foreground">{ad.primaryText}</p>
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
          <span className="text-[11px] text-muted-foreground">{ad.platforms.join(" · ")}</span>
          <span className="text-[11px] text-muted-foreground">·</span>
          <span className={cn("text-[11px] font-medium", tone.cls.includes("success") ? "text-success-soft-foreground" : "text-muted-foreground")}>
            {tone.label}
          </span>
        </div>
        <div className="flex items-center gap-1 pt-0.5">
          {/* 借这个角度 = 人手主动作(blue human voice);只开画布,花钱前必确认(O-10) */}
          <Button asChild variant="secondary" size="sm" className="ns-pressable h-8 flex-1">
            <Link href={`${base}/create/canvas`}>
              Borrow this angle
              <ArrowRight strokeWidth={2} />
            </Link>
          </Button>
          {/* 深链回真 Ad Library(可自证);人手可点 → 焦点环自动蓝 */}
          <a
            href={ad.libraryUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${ad.advertiser} in Meta Ad Library`}
            className="ns-pressable inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-border bg-card text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <ExternalLink className="size-4" strokeWidth={2} />
          </a>
        </div>
      </figcaption>
    </figure>
  );
}

function ClusterSection({ cluster, base }: { cluster: NsHookCluster; base: string }) {
  return (
    <section>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h3 className="text-sm font-semibold text-foreground">{cluster.angle.label}</h3>
        <Badge variant="default">
          {cluster.count} {cluster.count === 1 ? "ad" : "ads"} · {cluster.advertisers}{" "}
          {cluster.advertisers === 1 ? "advertiser" : "advertisers"}
        </Badge>
        {cluster.longestDays >= 30 && (
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success-soft-foreground">
            <TrendingUp className="size-3.5" strokeWidth={2} />
            Best runner {cluster.longestDays}d
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{cluster.angle.gist}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {cluster.ads.map((ad) => (
          <AdCard key={ad.id} ad={ad} base={base} />
        ))}
      </div>
    </section>
  );
}

export function CompetitorAngles({ base }: { base: string }) {
  const inside = useInsideImmersive();
  const [query, setQuery] = React.useState<string>(NS_COMPETITOR_SEARCH.query);
  const [submitted, setSubmitted] = React.useState<string>(NS_COMPETITOR_SEARCH.query);
  const [focusAngle, setFocusAngle] = React.useState<string | null>(null);
  const [sweepKey, setSweepKey] = React.useState(0);
  const whiteRef = React.useRef<HTMLDivElement>(null);

  const clusters = React.useMemo(() => clusterByHook(), []);
  const overview = React.useMemo(() => competitorOverview(), []);
  const open = React.useMemo(() => whiteSpaceAngle(clusters), [clusters]);
  const longest = React.useMemo(() => longestRunning(), []);
  const filled = clusters.filter((c) => c.count > 0);

  const hasResults = submitted.trim().length > 0;

  function focusOpenAngle() {
    if (!open) return;
    setFocusAngle(open.id);
    setSweepKey((k) => k + 1);
    // 滚到白空间卡(§8e:意图落地看得见)
    window.requestAnimationFrame(() => whiteRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── 搜索行(人手交互;焦点环自动蓝)+ Otto 帮我(仅壳内)── */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(query);
          }}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-border bg-card px-3 focus-within:ring-[3px] focus-within:ring-ring/40">
            <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search a business type and area"
              placeholder="Business type and area — e.g. Bakeries · Kuala Lumpur"
              className="min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Button type="submit" variant="secondary" size="default" className="ns-pressable shrink-0">
            Search
          </Button>
        </form>
        {inside && open && (
          <OttoAssist
            zone="Analytics"
            entityLabel="Competitor ads"
            label="Ask Otto"
            formState={{ query: submitted, openAngle: open.label }}
            intents={[
              {
                id: "find-white-space",
                label: "Show me the angle nobody's running",
                prompt: "Which ad angle is my competition not using around here?",
                reply: `In this batch, everyone leans on treats, curiosity, social proof and seasonal urgency — but nobody near you is running the "${open.label}" angle. That's your open lane. I've highlighted it below.`,
                apply: { summary: `Highlight the open angle · ${open.label}`, patch: { focusAngle: open.id } },
              },
              {
                id: "draft-open-angle",
                label: `Draft 3 hooks in the "${open.label}" angle`,
                prompt: `Draft 3 hook options in the "${open.label}" angle for my bakery.`,
                reply: `I'll set up 3 hook drafts in the "${open.label}" angle on your canvas — you'll see them there. Nothing renders or spends until you confirm the cost.`,
                landsOn: { surface: `${base}/create/canvas`, label: `${open.label} hook drafts` },
              },
            ]}
            onApply={(a) => {
              if (a.patch.focusAngle) focusOpenAngle();
            }}
          />
        )}
      </div>

      {!hasResults ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-[14px] bg-secondary">
            <Search className="size-5 text-muted-foreground" strokeWidth={2} />
          </span>
          <p className="text-lg font-semibold text-foreground">See who&apos;s advertising near you</p>
          <p className="max-w-[420px] text-sm text-muted-foreground">
            Type a business type and area to pull the ads your competition is running right now.
          </p>
        </div>
      ) : (
        <>
          {/* ── 概览(答案先行)── */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-foreground">
              <span className="font-semibold tabular-nums">{overview.adCount}</span> live ads from{" "}
              <span className="font-semibold tabular-nums">{overview.advertiserCount}</span> advertisers in{" "}
              <span className="font-semibold">{NS_COMPETITOR_SEARCH.location}</span>, grouped into{" "}
              <span className="font-semibold tabular-nums">{overview.usedAngles}</span> of{" "}
              <span className="tabular-nums">{overview.totalAngles}</span> angles.
            </span>
          </div>

          {/* ── 赢家信号说明(诚实:Ad Library 不给花费/触达,只有跑了多久)── 中性,不占 coral ── */}
          <div className="flex items-start gap-2.5 rounded-[12px] border border-border bg-secondary/50 px-4 py-3">
            <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
            <p className="text-[13px] leading-[18px] text-muted-foreground">
              Meta doesn&apos;t publish spend or reach for these ads — only when each one started. So the honest signal is{" "}
              <span className="font-medium text-foreground">how long an ad has run</span>: one live for weeks is one the
              advertiser keeps paying for.{" "}
              {longest && (
                <>
                  The longest here is{" "}
                  <span className="font-medium text-foreground">
                    {longest.advertiser}&apos;s at {longest.daysRunning} days
                  </span>
                  .{" "}
                </>
              )}
              A long-runner is the market voting with money — not a guarantee, so read it, don&apos;t just copy it.
            </p>
          </div>

          {/* ── 白空间(Otto 的一条 coral statement:同行没人打的角度 = 你的机会)── */}
          {open && (
            <SweepBox fireKey={sweepKey}>
              <div
                ref={whiteRef}
                className={cn(
                  "rounded-[var(--radius-card)] border border-brand-soft bg-brand-soft/40 p-4",
                  focusAngle === open.id && "ring-2 ring-brand",
                )}
              >
                <div className="flex items-start gap-3">
                  <OttoAvatar size={22} mood="helpful" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-[1.5] text-foreground">
                      Everyone in this batch is fighting over the same four angles. Nobody near you is running the{" "}
                      <span className="font-semibold">&ldquo;{open.label}&rdquo;</span> angle — {open.gist.toLowerCase()}{" "}
                      That&apos;s an open lane, and you already have the footage for it.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button asChild variant="brand" size="sm">
                        <Link href={`${base}/create/canvas`}>
                          <Sparkles />
                          Be the first — draft this angle
                        </Link>
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Opens in canvas. Nothing generates until you confirm the cost.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </SweepBox>
          )}

          {/* ── 广告卡瀑布,按 hook 角度聚类 ── */}
          <div className="flex flex-col gap-6">
            {filled.map((cluster) => (
              <ClusterSection key={cluster.angle.id} cluster={cluster} base={base} />
            ))}
          </div>

          {/* ── 聚类诚实注:角度是我们对开场白的判读 ── */}
          <p className="flex items-start gap-2 text-[12px] leading-[16px] text-muted-foreground">
            <Layers className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
            Angles are our read of each ad&apos;s opening line — a grouping to help you spot patterns, not a label Meta
            assigns. The open angle is relative to this batch, not the whole market.
          </p>

          {/* ── 合法性注记(页脚)── */}
          <div className="flex items-start gap-2.5 rounded-[12px] border border-border bg-card px-4 py-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
            <p className="text-[12px] leading-[17px] text-muted-foreground">
              These are public ads from{" "}
              <a
                href="https://www.facebook.com/ads/library/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
              >
                Meta&apos;s Ad Library
              </a>{" "}
              — the official transparency tool Meta runs, which the EU Digital Services Act requires. Anyone can browse it.
              We read only what&apos;s public: the creative, the advertiser, when each ad started, and where it runs. No
              spend, no reach, no personal data.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

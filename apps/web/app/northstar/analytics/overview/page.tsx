/* @nsPage district="分析区" page="overview" status="draft"
   sources="区划图·分析区(#116/#117);宪法 11(设计基准)" approvedAt="" pr="" */
"use client";

/**
 * 分析总览 — 真实 KPI 一屏看懂(全城设计基准 gold standard 屏)。
 *
 * 依据:PAGE-INVENTORY 三·分析区行 1 + design-rules §D(金标准七性质)+ §O3
 * (Analytics:insight banner 32 + connect 空态 40;mood 只许 idle·helpful)。
 * 元素:ad-account KPI ×4、reach 图、OTTO insight、平台切换器(Meta live;
 * TikTok/Shopee/Google/WhatsApp 占位)、organic 扩展(断电等钥匙)。
 * 三态齐全:页底「演示」切换器可看 加载/空/错误/未连接。零后台,数据全 mock。
 */

import * as React from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { MockNote, PageHeader } from "@/components/northstar/_shared";
import { NS_ANALYTICS } from "@/components/northstar/_mock";
import {
  DemoStateBar,
  NsSkeleton,
  Panel,
  ProvenancePill,
  fmtCount,
  type NsDemoState,
} from "@/components/northstar/analytics/zone-kit";
import { NsLineChart } from "@/components/northstar/analytics/line-chart";

/* ── 平台切换器(Meta live;其余占位) ── */
const PLATFORMS = [
  { id: "meta", label: "Meta", soon: false },
  { id: "tiktok", label: "TikTok", soon: true },
  { id: "shopee", label: "Shopee", soon: true },
  { id: "google", label: "Google", soon: true },
  { id: "whatsapp", label: "WhatsApp", soon: true },
] as const;

const RANGES = [
  { key: "7d", label: "Last 7 days" },
  { key: "28d", label: "Last 28 days" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

interface Kpi {
  label: string;
  value: string;
  delta?: { dir: "up" | "down" | "flat"; text: string };
}

function sum(points: readonly { value: number }[]): number {
  return points.reduce((acc, p) => acc + p.value, 0);
}

function kpisFor(range: RangeKey): Kpi[] {
  if (range === "28d") return NS_ANALYTICS.kpis as unknown as Kpi[];
  const reach7 = sum(NS_ANALYTICS.reach.slice(-7));
  const eng7 = sum(NS_ANALYTICS.engagement.slice(-7));
  return [
    { label: "Reach", value: fmtCount(reach7), delta: { dir: "up", text: "▲ 9%" } },
    { label: "Engagement", value: fmtCount(eng7), delta: { dir: "up", text: "▲ 4%" } },
    { label: "Link clicks", value: "296", delta: { dir: "down", text: "▼ 2%" } },
    { label: "New followers", value: "118", delta: { dir: "flat", text: "· flat" } },
  ];
}

/* ── KPI 卡(金标准:delta 语义色 + muted 基准后缀;§D3) ── */
function KpiCard({ kpi, empty }: { kpi: Kpi; empty?: boolean }) {
  return (
    <div className="rounded-[14px] border border-border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{kpi.label}</div>
      <div className="mt-1 text-[26px] leading-8 font-bold tracking-[-0.02em] text-foreground tabular-nums">
        {empty ? "—" : kpi.value}
      </div>
      {!empty && kpi.delta && (
        <div
          className={cn(
            "mt-1 text-xs font-semibold",
            kpi.delta.dir === "up" && "text-success-soft-foreground",
            kpi.delta.dir === "down" && "text-error-soft-foreground",
            kpi.delta.dir === "flat" && "text-muted-foreground",
          )}
        >
          {kpi.delta.text}
          <span className="font-medium text-muted-foreground"> vs prev. period</span>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<NsDemoState>("ready");
  const [platform, setPlatform] = React.useState<string>("meta");
  const [range, setRange] = React.useState<RangeKey>("28d");
  const [refreshing, setRefreshing] = React.useState(false);

  const isMeta = platform === "meta";
  const selected = PLATFORMS.find((p) => p.id === platform);
  const series = range === "7d" ? NS_ANALYTICS.reach.slice(-7) : NS_ANALYTICS.reach;
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? "";

  // §D1⑥:换区间不空屏 — 旧数据 0.6 透明度,新数据原地落位
  function onRangeChange(next: string) {
    setRange(next as RangeKey);
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 600);
  }

  return (
    <div className="mx-auto w-full max-w-[880px] px-6 pt-6 pb-24">
      {/* 页头永远渲染(§D1⑤):空/错/未连接墙都住 body */}
      <PageHeader
        title="Analytics"
        actions={
          <>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger size="sm" aria-label="Platform" className="rounded-[10px] bg-card font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                    {p.soon ? " (soon)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isMeta && demo === "ready" && (
              <Select value={range} onValueChange={onRangeChange}>
                <SelectTrigger size="sm" aria-label="Date range" className="rounded-[10px] bg-card font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGES.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        }
      />
      <div className="mt-2">
        <ProvenancePill text="via Meta · read-only" />
      </div>

      {/* 占位平台:coming soon 面板(切平台不打请求,回 Meta 数据仍在) */}
      {!isMeta && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card px-6 py-14 text-center">
          <OttoAvatar size={40} mood="idle" />
          <div className="text-[24px] leading-[30px] font-bold tracking-[-0.02em] text-foreground">
            {selected?.label} analytics is coming soon
          </div>
          <p className="max-w-[360px] text-[13px] leading-[18px] text-muted-foreground">
            We&apos;ll light this up here once {selected?.label} is connected. Same place, same view.
          </p>
        </div>
      )}

      {/* 未连接墙(§O3 connect 空态 40;按钮 = 人的动作 = INK) */}
      {isMeta && demo === "disconnected" && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card px-6 py-14 text-center">
          <OttoAvatar size={40} mood="idle" />
          <div className="text-[24px] leading-[30px] font-bold tracking-[-0.02em] text-foreground">
            Connect Meta to see your numbers
          </div>
          <p className="max-w-[360px] text-[13px] leading-[18px] text-muted-foreground">
            Analytics reads your reach, spend and results straight from Meta. Read-only.
          </p>
          <Button asChild size="sm" className="mt-1">
            <Link href="/northstar/account/connections">Connect Meta</Link>
          </Button>
        </div>
      )}

      {/* 瞬时错误:连接没坏,给 Retry 不给 Reconnect */}
      {isMeta && demo === "error" && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card px-6 py-14 text-center">
          <div className="text-[24px] leading-[30px] font-bold tracking-[-0.02em] text-foreground">
            Couldn&apos;t reach Meta just now
          </div>
          <p className="max-w-[360px] text-[13px] leading-[18px] text-muted-foreground">
            Usually a temporary hiccup on Meta&apos;s side. Your connection is fine. Try again in a
            moment.
          </p>
          <Button variant="ghost" size="sm" onClick={() => setDemo("ready")}>
            Retry
          </Button>
        </div>
      )}

      {/* 加载:骨架占位(≤3 块 shimmer,其余 static;§FB7) */}
      {isMeta && demo === "loading" && (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <NsSkeleton className="h-[104px] rounded-[14px]" />
            <NsSkeleton className="h-[104px] rounded-[14px]" />
            <NsSkeleton className="h-[104px] rounded-[14px]" shimmer={false} />
            <NsSkeleton className="h-[104px] rounded-[14px]" shimmer={false} />
          </div>
          <NsSkeleton className="mt-3.5 h-16 rounded-[var(--radius-card)]" shimmer={false} />
          <NsSkeleton className="mt-3.5 h-60 rounded-[var(--radius-card)]" />
        </div>
      )}

      {isMeta && (demo === "ready" || demo === "empty") && (
        <div className={cn("mt-4 transition-opacity", refreshing && "opacity-60")}>
          {/* ad-account KPI ×4(答案先行,§D1①) */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {kpisFor(range).map((k) => (
              <KpiCard key={k.label} kpi={k} empty={demo === "empty"} />
            ))}
          </div>
          {demo === "empty" && (
            <p className="mt-2 text-xs text-muted-foreground">No activity in this period yet.</p>
          )}

          {/* OTTO insight banner(本屏唯一 coral statement;§O4) */}
          {demo === "ready" && (
            <div className="mt-3.5 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-brand-soft bg-brand-soft/50 px-4 py-3.5">
              <OttoAvatar size={32} mood="helpful" />
              <span className="min-w-0 flex-1 basis-52 text-sm leading-[1.45] text-brand-soft-foreground">
                {NS_ANALYTICS.insight}
              </span>
              {/* 按下 = 进 Otto 创作链(prefill only,不自动花钱) */}
              <Button asChild variant="brand" size="sm">
                <Link href="/northstar/create/canvas">
                  <Sparkles />
                  Make more like it
                </Link>
              </Button>
            </div>
          )}

          {/* Reach 图(一图一问;空态 = 平基线,面板不藏;§D5) */}
          <Panel title="Reach over time" basis={`${rangeLabel} · daily reach`} className="mt-3.5">
            <NsLineChart series={series} flat={demo === "empty"} />
          </Panel>

          {/* organic 扩展 — 断电等钥匙(诚实缺口,§D1④) */}
          <Panel
            title="Organic posts"
            className="mt-3.5"
            actions={<Badge variant="info">Waiting on Meta approval</Badge>}
          >
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              Per-post organic performance needs one more Meta permission. It lights up here
              automatically once approved. Nothing for you to do.
            </p>
          </Panel>
        </div>
      )}

      <MockNote path="/northstar/analytics/overview" />
      <DemoStateBar
        value={demo}
        onChange={setDemo}
        states={["ready", "loading", "empty", "error", "disconnected"]}
      />
    </div>
  );
}

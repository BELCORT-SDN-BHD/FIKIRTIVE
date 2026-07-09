"use client";

/**
 * 分析总览(§D 金标准 · 全城优先级最高的一页)—— 原生重建。
 *
 * §D 七性质:①答案先行 4 KPI ②一图一问 Reach ③处处出处 ④诚实缺口 ⑤态住 body、
 * pinned header 永远渲染 ⑥换区间旧数 opacity-60 不空屏 ⑦coral 是 Otto 的声音(insight
 * banner 一处 statement + chart peak dots)。§D6 若发光即说谎 —— 全 app 最静的读面:
 * Otto 只许 idle/helpful,永不 thinking、永不审批 mood。
 *
 * WHATPASS 六章候选(每条 [wave-b]):Campaign Dashboard / 自然语言问数据 / 同行对标 /
 * 竞品对标 / 归因口径切换 / 每 campaign ROI / 首触归因(最轻) / 跨渠道延伸 / 异常播报 /
 * 横向对比 / 自动回复精简报表 / 角色化预设 / 历史快照 / Web 流量(最轻)。
 */

import * as React from "react";
import Link from "next/link";
import { MessageSquare, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { NS_ANALYTICS, NS_CAMPAIGNS } from "@/components/northstar/_mock";
import {
  NsSkeleton,
  Panel,
  ProvenancePill,
  fmtCount,
  fmtMoney,
} from "@/components/northstar/analytics/zone-kit";
import { NsLineChart } from "@/components/northstar/analytics/line-chart";
import { NS_AD_ACCOUNT } from "@/components/northstar/ads/mock-ads";
import {
  aiHandledCount,
  conversationsView,
  recentEvents,
  useStore,
} from "@/components/northstar/immersive/_store";
import { useImmersive } from "@/components/northstar/immersive/_context";
import { AnalyticsNav, PinnedHeader, StateWall, ZoneBody } from "./kit";

/* ── 平台切换器(Meta live;其余占位;§D1 跨渠道延伸 [wave-b] 广告 Insights 面板延伸) ── */
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

type Demo = "ready" | "loading" | "empty" | "error" | "disconnected";
type ViewPreset = "creator" | "owner";
type Attribution = "last" | "first";

interface Kpi {
  label: string;
  value: string;
  delta?: { dir: "up" | "down" | "flat"; text: string };
}

function sum(points: readonly { value: number }[]): number {
  return points.reduce((acc, p) => acc + p.value, 0);
}

/* 创作者视角(内容口径)/ 老板视角(生意口径)—— [wave-b] 角色化预设 Dashboard */
function creatorKpis(range: RangeKey): Kpi[] {
  if (range === "28d") return NS_ANALYTICS.kpis as unknown as Kpi[];
  return [
    { label: "Reach", value: fmtCount(sum(NS_ANALYTICS.reach.slice(-7))), delta: { dir: "up", text: "▲ 9%" } },
    { label: "Engagement", value: fmtCount(sum(NS_ANALYTICS.engagement.slice(-7))), delta: { dir: "up", text: "▲ 4%" } },
    { label: "Link clicks", value: "296", delta: { dir: "down", text: "▼ 2%" } },
    { label: "New followers", value: "118", delta: { dir: "flat", text: "· flat" } },
  ];
}

function ownerKpis(): Kpi[] {
  return [
    { label: "Ad spend", value: fmtMoney(NS_AD_ACCOUNT.currencyPrefix, NS_AD_ACCOUNT.kpis.spendMyr) },
    { label: "Orders", value: String(NS_AD_ACCOUNT.kpis.results), delta: { dir: "up", text: "▲ 12%" } },
    { label: "Cost per order", value: fmtMoney(NS_AD_ACCOUNT.currencyPrefix, NS_AD_ACCOUNT.kpis.spendMyr / NS_AD_ACCOUNT.kpis.results) },
    { label: "Reach", value: NS_ANALYTICS.kpis[0]!.value, delta: { dir: "up", text: "▲ 18%" } },
  ];
}

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
          {kpi.delta.dir !== "flat" && <span className="font-medium text-muted-foreground"> vs prev. period</span>}
        </div>
      )}
    </div>
  );
}

/* ── 同行对标评级(§D 无 coral;评级色走语义) —— [wave-b] 同行对标 Benchmark ── */
type Grade = "Excellent" | "Good" | "Fair" | "Poor";
const GRADE_STYLE: Record<Grade, string> = {
  Excellent: "text-success-soft-foreground",
  Good: "text-success-soft-foreground",
  Fair: "text-muted-foreground",
  Poor: "text-error-soft-foreground",
};
const BENCHMARKS: { metric: string; you: string; baseline: string; grade: Grade }[] = [
  { metric: "Reach growth", you: "▲ 18%", baseline: "≈ 6%", grade: "Excellent" },
  { metric: "Engagement rate", you: "3.2%", baseline: "2.1%", grade: "Good" },
  { metric: "Ad CTR", you: "1.8%", baseline: "1.6%", grade: "Good" },
  { metric: "Cost per result", you: "RM 6.00", baseline: "RM 5.20", grade: "Fair" },
];

/* ── 每 campaign 一行 ROI（含制作成本 credits）—— [wave-b] Campaign Dashboard + ROI + 横向对比 ── */
function campaignRoiRows() {
  return NS_CAMPAIGNS.map((c) => {
    const revenue = c.result?.kpis.find((k) => k.label === "Order value")?.value;
    const roi = c.status === "DONE" ? "3.9×" : c.status === "ACTIVE" ? "—" : "Not started";
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      madeCredits: c.spentCredits,
      revenue: revenue ?? "—",
      roi,
    };
  });
}

export default function AnalyticsOverview() {
  const immersive = useImmersive();
  const [demo, setDemo] = React.useState<Demo>("ready");
  const [platform, setPlatform] = React.useState<string>("meta");
  const [range, setRange] = React.useState<RangeKey>("28d");
  const [view, setView] = React.useState<ViewPreset>("creator");
  const [attribution, setAttribution] = React.useState<Attribution>("last");
  const [refreshing, setRefreshing] = React.useState(false);
  const [ask, setAsk] = React.useState("");

  useStore();
  const events = recentEvents(6);
  const convos = conversationsView();
  const autoResolved = aiHandledCount();
  const resolvePct = convos.length ? Math.round((autoResolved / convos.length) * 100) : 0;

  const isMeta = platform === "meta";
  const selected = PLATFORMS.find((p) => p.id === platform);
  const series = range === "7d" ? NS_ANALYTICS.reach.slice(-7) : NS_ANALYTICS.reach;
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? "";
  const kpis = view === "owner" ? ownerKpis() : creatorKpis(range);

  function onRangeChange(next: string) {
    setRange(next as RangeKey);
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 600);
  }

  function askOtto() {
    const q = ask.trim() || "How did we do this period?";
    // [wave-b] Otto 自然语言问数据:落进同一条单流(dock/otto 立刻可见),不另开小 AI。
    immersive?.openOtto(q, { view: "Analytics", selectedLabel: "Analytics" });
    setAsk("");
  }

  const roiRows = campaignRoiRows();

  return (
    <>
      <PinnedHeader
        title="Analytics"
        nav={<AnalyticsNav />}
        provenance={<ProvenancePill text="via Meta · read-only" />}
        actions={
          <>
            {/* [wave-b] 角色化预设 Dashboard:老板视角(生意口径)/ 创作者视角(内容口径) */}
            <div className="inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5">
              {(["creator", "owner"] as ViewPreset[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    "flex h-[30px] items-center rounded-[8px] px-3 text-xs font-semibold capitalize transition-colors duration-[120ms]",
                    view === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {v === "creator" ? "Creator" : "Owner"}
                </button>
              ))}
            </div>
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

      <ZoneBody>
        {/* 占位平台:coming soon(切平台不打请求,回 Meta 数据仍在) —— [wave-b] 跨渠道延伸 */}
        {!isMeta && (
          <StateWall
            icon={<OttoAvatar size={40} mood="idle" />}
            title={`${selected?.label} analytics is coming soon`}
            body={`We'll light this up here once ${selected?.label} is connected. Same place, same view — one page for every channel.`}
          />
        )}

        {/* 未连接墙(§O3 connect 空态;按钮 = 人的动作 = INK) */}
        {isMeta && demo === "disconnected" && (
          <StateWall
            icon={<OttoAvatar size={40} mood="idle" />}
            title="Connect Meta to see your numbers"
            body="Analytics reads your reach, spend and results straight from Meta. Read-only."
            action={
              <Button asChild size="sm" className="mt-1">
                <Link href="/northstar-immersive/account/connections">Connect Meta</Link>
              </Button>
            }
          />
        )}

        {/* 瞬时错误:连接没坏,给 Retry 不给 Reconnect */}
        {isMeta && demo === "error" && (
          <StateWall
            title="Couldn't reach Meta just now"
            body="Usually a temporary hiccup on Meta's side. Your connection is fine. Try again in a moment."
            action={
              <Button variant="ghost" size="sm" onClick={() => setDemo("ready")}>
                Retry
              </Button>
            }
          />
        )}

        {/* 加载:骨架(≤3 shimmer;§FB7) */}
        {isMeta && demo === "loading" && (
          <div className="mt-5">
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
          <div className={cn("mt-1 flex flex-col gap-3.5 transition-opacity", refreshing && "opacity-60")}>
            {/* [wave-b] Otto 主动异常播报:一条中性 heads-up(读面不 coral;statement 留给 insight) */}
            {demo === "ready" && (
              <div className="flex items-start gap-2 rounded-[12px] bg-secondary/70 px-4 py-2.5">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" />
                <p className="text-[13px] leading-[18px] text-foreground">
                  Heads up — link clicks dipped 4% this period. One ad has gone stale; the rest is healthy.
                </p>
              </div>
            )}

            {/* ① 答案先行:4 KPI(视角切换换口径;delta 语义色是唯一非-coral 语义色) */}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {kpis.map((k) => (
                <KpiCard key={k.label} kpi={k} empty={demo === "empty"} />
              ))}
            </div>
            {demo === "empty" && <p className="-mt-1 text-xs text-muted-foreground">No activity in this period yet.</p>}

            {/* ⑦ Otto insight banner —— 本屏唯一 coral statement(§O3;§O4) */}
            {demo === "ready" && (
              <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-brand-soft bg-brand-soft/50 px-4 py-3.5">
                <OttoAvatar size={32} mood="helpful" />
                <span className="min-w-0 flex-1 basis-52 text-sm leading-[1.45] text-brand-soft-foreground">
                  {NS_ANALYTICS.insight}
                </span>
                <Button asChild variant="brand" size="sm">
                  <Link href="/northstar-immersive/create/canvas">
                    <Sparkles />
                    Make more like it
                  </Link>
                </Button>
              </div>
            )}

            {/* [wave-b] Otto 自然语言问数据:问一句 → 落进同一条流(dock 展开) */}
            {demo === "ready" && (
              <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-border bg-card px-4 py-3">
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                <Input
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && askOtto()}
                  placeholder="Ask Otto about your numbers — e.g. which channel earned the most?"
                  className="min-w-0 flex-1 basis-52 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                  aria-label="Ask Otto about your numbers"
                />
                <Button variant="secondary" size="sm" onClick={askOtto}>
                  Ask Otto
                </Button>
              </div>
            )}

            {/* ② 一图一问:Reach(空态 = 平基线,面板不藏;§D5) —— [wave-b] 历史快照 */}
            <Panel title="Reach over time" basis={`${rangeLabel} · daily reach · snapshot saved weekly`}>
              <NsLineChart series={series} flat={demo === "empty"} />
              {demo === "ready" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Up 18% versus the same window four weeks ago. Snapshots let you see the trend, not just today.
                </p>
              )}
            </Panel>

            {/* [wave-b] Campaign Dashboard + 每 campaign ROI + 横向对比:有机+付费同屏一行结论 */}
            <Panel
              title="Campaign performance"
              basis="Organic posts, ad spend and return — one row per campaign"
              actions={
                <div className="inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5">
                  {(["last", "first"] as Attribution[]).map((a) => (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={attribution === a}
                      onClick={() => setAttribution(a)}
                      className={cn(
                        "flex h-7 items-center rounded-[8px] px-2.5 text-[11px] font-semibold transition-colors duration-[120ms]",
                        attribution === a ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {a === "last" ? "Last touch" : "First touch"}
                    </button>
                  ))}
                </div>
              }
            >
              {/* [wave-b] 归因口径切换 + 首触归因(最轻:单触点,一句话说清口径) */}
              <p className="mt-1 text-xs text-muted-foreground">
                {attribution === "last"
                  ? "Crediting the last ad clicked before an order — simplest for short sales cycles."
                  : "Crediting the first ad that brought each customer in — good for judging what starts demand."}
              </p>
              <div className="mt-2">
                <div className="hidden grid-cols-[minmax(0,1fr)_88px_112px_72px] gap-3 border-b border-border pb-2 sm:grid">
                  {["Campaign", "Made", "Order value", "ROI"].map((h) => (
                    <span
                      key={h}
                      className={cn(
                        "font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground uppercase",
                        h !== "Campaign" && "text-right",
                      )}
                    >
                      {h}
                    </span>
                  ))}
                </div>
                {roiRows.map((r) => (
                  <Link
                    key={r.id}
                    href="/northstar-immersive/campaign/list"
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 border-t border-border py-2.5 transition-colors first:border-t-0 hover:bg-accent sm:grid-cols-[minmax(0,1fr)_88px_112px_72px]"
                  >
                    <span className="col-span-2 flex items-center gap-2 sm:col-span-1">
                      <span className="min-w-0 truncate text-sm font-semibold text-foreground">{r.name}</span>
                      <Badge variant={r.status === "ACTIVE" ? "success" : r.status === "DONE" ? "info" : "default"}>
                        {r.status.toLowerCase()}
                      </Badge>
                    </span>
                    <span className="text-right text-[13px] text-muted-foreground tabular-nums sm:text-sm">
                      {r.madeCredits} cr
                    </span>
                    <span className="text-right text-[13px] font-semibold text-foreground tabular-nums sm:text-sm">
                      {r.revenue}
                    </span>
                    <span className="text-right text-[13px] font-semibold text-foreground tabular-nums sm:text-sm">
                      {r.roi}
                    </span>
                  </Link>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Made = credits spent generating the content. ROI counts that as cost, so it's the true return.
              </p>
            </Panel>

            {/* [wave-b] 同行对标 Benchmark(4 项评级;冷启动降级说清) */}
            <Panel title="How you compare" basis="Against a public bakery-industry baseline while your peer pool grows">
              <div className="mt-2">
                {BENCHMARKS.map((b) => (
                  <div key={b.metric} className="flex items-center gap-3 border-t border-border py-2.5 first:border-t-0">
                    <span className="min-w-0 flex-1 text-sm text-foreground">{b.metric}</span>
                    <span className="w-16 shrink-0 text-right text-sm font-semibold text-foreground tabular-nums">{b.you}</span>
                    <span className="w-16 shrink-0 text-right text-[13px] text-muted-foreground tabular-nums">{b.baseline}</span>
                    <span className={cn("w-[76px] shrink-0 text-right text-xs font-semibold", GRADE_STYLE[b.grade])}>{b.grade}</span>
                  </div>
                ))}
              </div>
            </Panel>

            {/* [wave-b] 自动回复表现精简报表(3 数字,明确不做排行榜) */}
            {demo === "ready" && (
              <Panel title="Replies at a glance" basis="How fast and how many — no leaderboards">
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <div className="rounded-[10px] border border-border bg-background p-3">
                    <div className="text-[11px] leading-4 font-medium text-muted-foreground">Avg first reply</div>
                    <div className="mt-0.5 text-lg font-bold text-foreground tabular-nums">4 min</div>
                  </div>
                  <div className="rounded-[10px] border border-border bg-background p-3">
                    <div className="text-[11px] leading-4 font-medium text-muted-foreground">Resolved</div>
                    <div className="mt-0.5 text-lg font-bold text-foreground tabular-nums">92%</div>
                  </div>
                  <div className="rounded-[10px] border border-border bg-background p-3">
                    <div className="text-[11px] leading-4 font-medium text-muted-foreground">Otto handled</div>
                    <div className="mt-0.5 text-lg font-bold text-foreground tabular-nums">{resolvePct || 68}%</div>
                  </div>
                </div>
                <Link
                  href="/northstar-immersive/inbox/shared"
                  className="mt-3 inline-flex text-xs font-semibold text-foreground underline-offset-2 hover:underline"
                >
                  Open the inbox
                </Link>
              </Panel>
            )}

            {/* ④ 诚实缺口:organic 断电等钥匙 */}
            <Panel title="Organic posts" actions={<Badge variant="info">Waiting on Meta approval</Badge>}>
              <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
                Per-post organic performance needs one more Meta permission. It lights up here automatically once
                approved. Nothing for you to do.
              </p>
            </Panel>

            {/* [wave-b] 竞品对标(官方 API,honest gap 不假装) + Web 流量(最轻:接现成 GA 只读) */}
            <div className="grid gap-3.5 md:grid-cols-2">
              <Panel title="Competitor watch" actions={<Badge variant="default">Off</Badge>}>
                <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
                  Follower growth and top posts for shops you pick — pulled from the official API, never scraped.
                </p>
                <Button asChild variant="secondary" size="sm" className="mt-3">
                  <Link href="/northstar-immersive/account/connections">Turn on</Link>
                </Button>
              </Panel>
              <Panel title="Website visitors" actions={<Badge variant="default">Not connected</Badge>}>
                <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
                  If you have a site, connect Google Analytics (read-only) to see how many clicks turn into visits.
                </p>
                <Button asChild variant="secondary" size="sm" className="mt-3">
                  <Link href="/northstar-immersive/account/connections">Connect Google Analytics</Link>
                </Button>
              </Panel>
            </div>

            {/* 实时活动(循环系统):共享事件流,newest first */}
            {demo === "ready" && (
              <Panel title="Live activity" basis="Actions across your workspace, newest first">
                {events.length === 0 ? (
                  <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
                    Nothing yet. Anything you or Otto does shows up here live.
                  </p>
                ) : (
                  <ul className="mt-1 flex flex-col">
                    {events.map((e) => (
                      <li key={e.at} className="flex items-center gap-3 border-t border-border py-2.5 first:border-t-0">
                        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-foreground">{e.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}

            {/* 页内三态演示(只在画廊出现,沉浸式壳内自我隐藏) */}
            <DemoSwitch demo={demo} onChange={setDemo} />
          </div>
        )}

        {/* 非 ready 态也保留三态切换入口(墙态下切回来) */}
        {(demo !== "ready" && demo !== "empty") || !isMeta ? <DemoSwitch demo={demo} onChange={setDemo} /> : null}
      </ZoneBody>
    </>
  );
}

/* ── 页内三态切换器(沉浸式壳内隐藏;仅原型演示用) ── */
function DemoSwitch({ demo, onChange }: { demo: Demo; onChange: (d: Demo) => void }) {
  const inside = useImmersive()?.insideImmersive ?? false;
  if (inside) return null;
  const states: Demo[] = ["ready", "loading", "empty", "error", "disconnected"];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground/70">演示</span>
      {states.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={cn(
            "h-6 rounded-full px-2.5 font-mono text-[10px] tracking-[0.06em] transition-colors",
            demo === s ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent",
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

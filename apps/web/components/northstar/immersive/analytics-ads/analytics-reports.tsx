"use client";

/**
 * 报表引擎 + 品牌化报告(§L 双栏 mixed;1280)—— 原生重建。
 *
 * 红旗二双模无例外:报表**无新表**(只读现有对象面,source 副标注明);Build = 人的
 * INK 动作(只读、不花 credits);构建 = Otto 工作(叙述条 3 步→骨架→LandIn + sweep);
 * G-12 品牌化报告体 + GM-04 周报人话;对外分享未拍(N-16)→ 仅 internal preview 印章 +
 * Download PDF。
 *
 * WHATPASS 六章候选:品牌化报告 [wave-b] · 报表订阅/定时推送 [wave-b] · 属性级创意归因 [wave-b]。
 */

import * as React from "react";
import { toast } from "sonner";
import { Download, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, OttoNarrationBar } from "@/components/northstar/_shared";
import { NS_ANALYTICS, NS_BRAND, NS_SCHEDULED_POSTS } from "@/components/northstar/_mock";
import {
  LandIn,
  NsSkeleton,
  Panel,
  ProvenancePill,
  SweepBox,
  fmtMoney,
} from "@/components/northstar/analytics/zone-kit";
import { NsLineChart } from "@/components/northstar/analytics/line-chart";
import { NS_AD_ACCOUNT, NS_ADS, accountMoney, adMoneyFor } from "@/components/northstar/ads/mock-ads";
import {
  cancelReportSubscription,
  creditSpendByCategory,
  reportSubscriptionsView,
  scheduleReport,
  useStore,
} from "@/components/northstar/immersive/_store";
import { OttoAssist } from "../otto-assist";
import { AnalyticsNav, PinnedHeader, ZoneBody } from "./kit";

// 读面型生命周期:build 只读已加载的本地对象面(红旗二无新表),不发生真实失败 —— 故无 error 态。
type Phase = "empty" | "building" | "ready";

const PERIODS = [
  { key: "week", label: "This week · 30 Jun to 6 Jul" },
  { key: "28d", label: "Last 28 days" },
] as const;

const CADENCES = [
  { key: "weekly", label: "Every Monday" },
  { key: "monthly", label: "First of the month" },
] as const;

/** 报表块注册:每块只读一个现有对象面(红旗二:报表自身无新表) */
const BLOCKS = [
  { id: "results", label: "Results (orders + return)", source: "reads Ads" },
  { id: "kpis", label: "Overview KPIs", source: "reads Analytics" },
  { id: "reach", label: "Reach chart", source: "reads Analytics" },
  { id: "ads", label: "Ad results", source: "reads Ads" },
  { id: "creative", label: "What's working in creative", source: "reads Ads" },
  { id: "posts", label: "Posts published", source: "reads Schedule" },
  { id: "credits", label: "Credit spend", source: "reads Billing" },
] as const;
type BlockId = (typeof BLOCKS)[number]["id"];

const BUILD_STEPS = ["Reading your orders + spend…", "Ranking ads by return…", "Writing this week's orders…"] as const;

/** 周报指挥式(GM-04 人话 + `periodic-sales-performance-review` 的三件套骨架):
 * 不是「一切安好」的安慰,是四条点名的指令 —— Keep / Stop today / Fix today / Approve next。
 * 内容从真实钱化派生(点名哪条广告怎么改),下滑就说下滑(link clicks −4% 不藏)。 */
type DirectiveLane = { key: "keep" | "stop" | "fix" | "approve"; label: string; body: string };

function weeklyDirective(): DirectiveLane[] {
  const cur = NS_AD_ACCOUNT.currencyPrefix;
  const scored = NS_ADS.map((a) => ({ ad: a, m: adMoneyFor(a, NS_ADS) }));
  const keep = scored
    .filter((r) => r.m.verdict === "scale")
    .sort((a, b) => b.m.efficiencyIndex - a.m.efficiencyIndex)[0];
  const stop = scored
    .filter((r) => r.m.verdict === "pause")
    .sort((a, b) => (a.m.netMarginMyr ?? 0) - (b.m.netMarginMyr ?? 0))[0];

  const lanes: DirectiveLane[] = [];
  if (keep) {
    lanes.push({
      key: "keep",
      label: "Keep running",
      body: `${keep.ad.name} — ${fmtMoney(cur, keep.m.costPerResultMyr)} a sale, your best converter this week (${keep.m.efficiencyIndex.toFixed(1)}× efficiency). Lifting its budget.`,
    });
  }
  if (stop) {
    const red = Math.abs(stop.m.netMarginMyr ?? 0);
    lanes.push({
      key: "stop",
      label: "Stop today",
      body: `${stop.ad.name} — ${fmtMoney(cur, stop.m.costPerResultMyr)} to sell a ${fmtMoney(cur, stop.m.unitPriceMyr)} item, about ${fmtMoney(cur, red)} in the red. Pause it; it's the biggest leak.`,
    });
  }
  lanes.push({
    key: "fix",
    label: "Fix today",
    body: "Link clicks slipped 4% — more people saw you, fewer clicked through to order. Your next reel needs a clearer \"order now\" line. Clicks are the one number that predicts sales, so this matters.",
  });
  lanes.push({
    key: "approve",
    label: "Approve next",
    body: "A B2B corporate-gifting post for Merdeka — your Raya data shows Facebook drove the bulk orders, and there's no B2B post planned yet. Waiting on your yes.",
  });
  return lanes;
}

const DIRECTIVE_STYLE: Record<DirectiveLane["key"], { dot: string; label: string }> = {
  keep: { dot: "bg-success", label: "text-success-soft-foreground" },
  stop: { dot: "bg-error", label: "text-error-soft-foreground" },
  fix: { dot: "bg-warning", label: "text-warning-soft-foreground" },
  approve: { dot: "bg-[var(--human)]", label: "ns-human-text" },
};

/* [wave-b] 属性级创意归因:LLM 给已发布素材打属性标签 × 表现,轻量相关性 */
const CREATIVE_ATTRIBUTES = [
  { attribute: "Hook in first 2 seconds", lift: "+38% CTR", tone: "up" as const },
  { attribute: "Real person on camera", lift: "+21% CTR", tone: "up" as const },
  { attribute: "Limited-time wording", lift: "+14% CTR", tone: "up" as const },
  { attribute: "Text-heavy image", lift: "−26% CTR", tone: "down" as const },
];

function ReportStat({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="rounded-[10px] border border-border bg-background p-3">
      <div className="text-[11px] leading-4 font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-bold tracking-[-0.01em] text-foreground tabular-nums">{value}</div>
      {delta && <div className="text-[11px] leading-4 font-medium text-muted-foreground">{delta}</div>}
    </div>
  );
}

export default function AnalyticsReports() {
  // stall #12:首访即 building → 自动呈现一份默认周报(答案先行),无需老板先当组装工
  const [phase, setPhase] = React.useState<Phase>("building");
  const [period, setPeriod] = React.useState<string>("week");
  const [cadence, setCadence] = React.useState<string>("weekly");
  const [blocks, setBlocks] = React.useState<Record<BlockId, boolean>>({
    results: true,
    kpis: true,
    reach: true,
    ads: true,
    creative: true,
    posts: true,
    credits: false,
  });
  const [branded, setBranded] = React.useState(true);
  const [ottoRead, setOttoRead] = React.useState(true);
  const [buildId, setBuildId] = React.useState(1);
  const [sweepKey, setSweepKey] = React.useState(0);
  const [downloading, setDownloading] = React.useState(false);
  const [barFull, setBarFull] = React.useState(false);

  useStore();
  const creditSpendRows = creditSpendByCategory();
  const subscriptions = reportSubscriptionsView();

  const anyBlock = Object.values(blocks).some(Boolean);
  const publishedPosts = NS_SCHEDULED_POSTS.filter((p) => p.status === "published");
  const cur = NS_AD_ACCOUNT.currencyPrefix;
  const acct = accountMoney(NS_ADS);
  const directive = weeklyDirective();
  // 广告块按「回本」排(而非 CTR),带 verdict:回答「该留还是该停」
  const rankedAds = NS_ADS.map((a) => ({ ad: a, m: adMoneyFor(a, NS_ADS) }))
    .sort((a, b) => (b.m.netMarginMyr ?? -Infinity) - (a.m.netMarginMyr ?? -Infinity));
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "";
  const cadenceLabel = CADENCES.find((c) => c.key === cadence)?.label ?? "";
  const reportName = `${NS_BRAND.name} report`;

  function downloadPdf() {
    if (downloading) return;
    setDownloading(true);
    setBarFull(false);
    requestAnimationFrame(() => setBarFull(true));
    window.setTimeout(() => {
      setDownloading(false);
      setBarFull(false);
      toast("Report downloaded", { description: "Saved to your downloads (prototype)" });
    }, 1300);
  }

  function startBuild() {
    setBuildId((n) => n + 1);
    setPhase("building");
  }

  // [wave-b] 报表订阅/定时推送:真写 store(dock/otto + Live activity 反映),可取消
  function onSchedule() {
    scheduleReport({ name: reportName, cadence: cadenceLabel });
    toast("Report scheduled", { description: `${cadenceLabel} — saved to your workspace` });
  }

  return (
    <>
      <PinnedHeader
        title="Reports"
        nav={<AnalyticsNav />}
        provenance={<ProvenancePill text="internal preview · no share link" />}
      />

      <ZoneBody width={1280}>
        <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* ── 报表构建器(人工面,双模无例外) ── */}
          <div className="flex flex-col gap-4">
            <Panel title="Report builder" basis="Blocks read existing data. A report adds no new objects.">
              <div className="mt-4 flex flex-col gap-2">
                <label htmlFor="report-period" className="text-[13px] leading-[18px] font-semibold text-foreground">
                  Period
                </label>
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger id="report-period" className="w-full rounded-[14px] bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIODS.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="mt-5">
                <div className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  Blocks
                </div>
                <div className="mt-1">
                  {BLOCKS.map((b) => (
                    <label
                      key={b.id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 border-t border-border py-2 first:border-t-0"
                    >
                      <Switch
                        checked={blocks[b.id]}
                        onCheckedChange={(v) => setBlocks((prev) => ({ ...prev, [b.id]: v }))}
                        aria-label={b.label}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-foreground">{b.label}</span>
                        <span className="block text-xs text-muted-foreground">{b.source}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-5">
                <div className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  Presentation
                </div>
                <div className="mt-1">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 py-2">
                    <Switch checked={branded} onCheckedChange={setBranded} aria-label="Branded header" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-foreground">Branded header</span>
                      <span className="block text-xs text-muted-foreground">Your name and logo on top, ready for a client</span>
                    </span>
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 border-t border-border py-2">
                    <Switch checked={ottoRead} onCheckedChange={setOttoRead} aria-label="Otto's this-week orders" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-foreground">Otto&apos;s this-week orders</span>
                      <span className="block text-xs text-muted-foreground">Keep / stop / fix / approve — named, in plain words</span>
                    </span>
                  </label>
                </div>
              </div>

              {/* §O7 Otto 帮我:替老板配一版报告(stall #27) */}
              <div className="mt-4 flex justify-end">
                <OttoAssist
                  zone="Analytics"
                  entityLabel="Report builder"
                  label="Ask Otto to set it up"
                  formState={{ blocks, branded, ottoRead, period }}
                  intents={[
                    {
                      id: "client-clean",
                      label: "A clean version for a client",
                      prompt: "Set up a clean report I can send a client — results, the reach chart, and my best ads.",
                      reply:
                        "Done — I turned on Results, Reach and Ad results, kept the branded header, and left credit spend off (clients don't need your costs). Build it when you're ready.",
                      apply: {
                        summary: "Client version — Results + Reach + Ads, branded",
                        patch: { preset: "client" },
                      },
                    },
                    {
                      id: "just-orders",
                      label: "Just this week's orders",
                      prompt: "I only want to see what to do this week — the orders and the directive.",
                      reply:
                        "Set it to Results plus my this-week orders (keep / stop / fix / approve) and nothing else. That's your 30-second read.",
                      apply: {
                        summary: "Orders + directive only",
                        patch: { preset: "orders" },
                      },
                    },
                  ]}
                  onApply={(a) => {
                    const preset = (a.patch as { preset?: string }).preset;
                    if (preset === "client") {
                      setBlocks({ results: true, kpis: true, reach: true, ads: true, creative: false, posts: true, credits: false });
                      setBranded(true);
                      setOttoRead(true);
                    } else if (preset === "orders") {
                      setBlocks({ results: true, kpis: false, reach: false, ads: false, creative: false, posts: false, credits: false });
                      setOttoRead(true);
                    }
                    toast("Report set up", { description: a.summary });
                  }}
                />
              </div>

              <Button className="mt-2 w-full" size="sm" disabled={phase === "building" || !anyBlock} onClick={startBuild}>
                {phase === "building" ? "Building…" : phase === "ready" ? "Rebuild report" : "Build report"}
              </Button>
              {!anyBlock && <p className="mt-2 text-xs text-muted-foreground">Pick at least one block first.</p>}
            </Panel>

            {/* [wave-b] 报表订阅/定时推送:绑同一份报告,选频率 → 定时寄到工作区 */}
            <Panel title="Auto-send" basis="Otto prepares this report on a schedule and drops it in your workspace">
              <div className="mt-3 flex flex-col gap-2">
                <Select value={cadence} onValueChange={setCadence}>
                  <SelectTrigger className="w-full rounded-[14px] bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CADENCES.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="secondary" size="sm" onClick={onSchedule}>
                  Schedule this report
                </Button>
              </div>
              {subscriptions.length > 0 && (
                <ul className="mt-3">
                  {subscriptions.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 border-t border-border py-2 first:border-t-0">
                      <Badge variant="success">On</Badge>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                        {s.name} · {s.cadence.toLowerCase()}
                      </span>
                      <button
                        type="button"
                        onClick={() => cancelReportSubscription(s.id)}
                        className="shrink-0 text-xs font-semibold text-muted-foreground hover:text-foreground"
                      >
                        Stop
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* ── 预览面(Otto 工作的表面:叙述条钉在表面顶部) ── */}
          <div className="min-w-0">
            <div className="flex min-h-9 flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                Preview
              </span>
              <ProvenancePill text="internal preview · no share link" />
              <div className="flex-1" />
              {phase === "ready" && (
                <div className="flex items-center gap-2">
                  {downloading && (
                    <div aria-hidden className="h-1 w-20 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-foreground transition-[width] duration-[1200ms] ease-out"
                        style={{ width: barFull ? "100%" : "0%" }}
                      />
                    </div>
                  )}
                  <Button variant="secondary" size="sm" disabled={downloading} onClick={downloadPdf}>
                    <Download />
                    {downloading ? "Preparing…" : "Download PDF"}
                  </Button>
                </div>
              )}
            </div>

            {phase === "empty" && (
              <div className="mt-3 rounded-[var(--radius-card)] border border-border bg-card">
                <EmptyState
                  icon={FileText}
                  title="No report yet"
                  body="Pick blocks on the left and build one. Otto writes the read for you."
                />
              </div>
            )}

            {phase === "building" && (
              <div className="mt-3">
                <OttoNarrationBar
                  key={buildId}
                  steps={BUILD_STEPS}
                  stepMs={1100}
                  counter
                  onSettle={() => {
                    setPhase("ready");
                    setSweepKey((n) => n + 1);
                  }}
                  className="mx-auto w-fit"
                />
                <div className="mx-auto mt-3 max-w-[680px] rounded-[var(--radius-card)] border border-border bg-card p-6">
                  <NsSkeleton className="h-12 w-2/3" />
                  <NsSkeleton className="mt-4 h-16" shimmer={false} />
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <NsSkeleton className="h-[72px]" shimmer={false} />
                    <NsSkeleton className="h-[72px]" shimmer={false} />
                  </div>
                  <NsSkeleton className="mt-4 h-40" />
                </div>
              </div>
            )}

            {phase === "ready" && (
              <LandIn className="mt-3">
                <SweepBox
                  fireKey={sweepKey}
                  className="mx-auto max-w-[680px] rounded-[var(--radius-card)] border border-border bg-card p-6"
                >
                  {branded && (
                    <div className="flex items-center gap-3 border-b border-border pb-4">
                      <span className="flex size-11 items-center justify-center rounded-full bg-secondary text-sm font-bold text-foreground">
                        RB
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-lg font-bold tracking-[-0.01em] text-foreground">{NS_BRAND.name}</div>
                        <div className="text-xs text-muted-foreground">{periodLabel} · prepared 7 Jul 2026</div>
                      </div>
                      <ProvenancePill text="via Meta · read-only" />
                    </div>
                  )}

                  {/* Results 顶到最上:订单 / 营收 / 回报(读的是钱,不是虚荣数) */}
                  {blocks.results && (
                    <div className="mt-4 rounded-[14px] border border-border bg-background p-4">
                      <h3 className="text-sm font-semibold text-foreground">Results from your ads</h3>
                      <div className="mt-2 grid grid-cols-3 gap-3">
                        <ReportStat label="Orders" value={String(acct.orders)} delta={`+ ${acct.enquiries} enquiries`} />
                        <ReportStat label="Sales" value={fmtMoney(cur, acct.revenueMyr)} delta={`${fmtMoney(cur, acct.totalSpendMyr)} spent`} />
                        <ReportStat label="Return" value={`${acct.returnMultiple.toFixed(1)}×`} delta={`${fmtMoney(cur, acct.costPerOrderMyr)} / order`} />
                      </div>
                    </div>
                  )}

                  {/* 周报指挥式:Keep / Stop today / Fix today / Approve next(点名广告,下滑照说) */}
                  {ottoRead && (
                    <div className="mt-4 rounded-[14px] bg-secondary/70 p-4">
                      <div className="flex items-center gap-2">
                        <OttoAvatar size={22} mood="helpful" />
                        <span className="text-sm font-semibold text-foreground">This week — what to do</span>
                      </div>
                      <ul className="mt-3 flex flex-col gap-2.5">
                        {directive.map((lane) => {
                          const s = DIRECTIVE_STYLE[lane.key];
                          return (
                            <li key={lane.key} className="flex items-start gap-2.5">
                              <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", s.dot)} />
                              <span className="min-w-0 flex-1 text-[13px] leading-[18px] text-foreground">
                                <span className={cn("font-semibold", s.label)}>{lane.label}:</span> {lane.body}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {blocks.kpis && (
                    <div className="mt-5">
                      <h3 className="text-sm font-semibold text-foreground">Overview</h3>
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        {NS_ANALYTICS.kpis.map((k) => (
                          <ReportStat key={k.label} label={k.label} value={k.value} delta={`${k.delta.text} vs prev. period`} />
                        ))}
                      </div>
                    </div>
                  )}

                  {blocks.reach && (
                    <div className="mt-5">
                      <h3 className="text-sm font-semibold text-foreground">Reach over time</h3>
                      <p className="text-xs text-muted-foreground">{periodLabel} · daily reach</p>
                      <NsLineChart series={period === "week" ? NS_ANALYTICS.reach.slice(-7) : NS_ANALYTICS.reach} peaks={2} />
                    </div>
                  )}

                  {blocks.ads && (
                    <div className="mt-5">
                      <h3 className="text-sm font-semibold text-foreground">Ad results</h3>
                      <p className="text-xs text-muted-foreground">All {NS_ADS.length} ads · ranked by what each earned this period · keep or stop</p>
                      <div className="mt-2">
                        {rankedAds.map(({ ad, m }) => (
                          <div key={ad.id} className="flex items-baseline gap-3 border-t border-border py-2.5 first:border-t-0">
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{ad.name}</span>
                            <span
                              className={cn(
                                "shrink-0 text-sm font-semibold tabular-nums",
                                m.netMarginMyr === null
                                  ? "text-muted-foreground"
                                  : m.netMarginMyr >= 0
                                    ? "text-success-soft-foreground"
                                    : "text-error-soft-foreground",
                              )}
                            >
                              {m.netMarginMyr === null
                                ? "enquiries"
                                : `${m.netMarginMyr >= 0 ? "+" : "−"}${fmtMoney(cur, Math.abs(m.netMarginMyr))}`}
                            </span>
                            <span className="w-16 shrink-0 text-right text-xs font-semibold text-muted-foreground">
                              {m.verdict === "scale" ? "Keep" : m.verdict === "pause" ? "Stop" : "Fix"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* [wave-b] 属性级创意归因:哪种元素带动效果 */}
                  {blocks.creative && (
                    <div className="mt-5">
                      <h3 className="text-sm font-semibold text-foreground">What&apos;s working in creative</h3>
                      <p className="text-xs text-muted-foreground">Which elements move the numbers · across your published ads</p>
                      <div className="mt-2">
                        {CREATIVE_ATTRIBUTES.map((c) => (
                          <div key={c.attribute} className="flex items-baseline gap-3 border-t border-border py-2.5 first:border-t-0">
                            <span className="min-w-0 flex-1 text-sm text-foreground">{c.attribute}</span>
                            <span
                              className={cn(
                                "shrink-0 text-sm font-semibold tabular-nums",
                                c.tone === "up" ? "text-success-soft-foreground" : "text-error-soft-foreground",
                              )}
                            >
                              {c.lift}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {blocks.posts && (
                    <div className="mt-5">
                      <h3 className="text-sm font-semibold text-foreground">Posts published</h3>
                      <div className="mt-2">
                        {publishedPosts.map((p) => (
                          <div key={p.id} className="flex items-baseline gap-3 border-t border-border py-2.5 first:border-t-0">
                            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{p.caption}</span>
                            <span className="shrink-0 font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground">
                              {p.platform}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {blocks.credits && (
                    <div className="mt-5">
                      <h3 className="text-sm font-semibold text-foreground">Credit spend</h3>
                      <p className="text-xs text-muted-foreground">This period · by category</p>
                      <div className="mt-2">
                        {creditSpendRows.map((r) => (
                          <div key={r.label} className="flex items-baseline gap-3 border-t border-border py-2.5 first:border-t-0">
                            <span className="min-w-0 flex-1 text-sm text-foreground">{r.label}</span>
                            <span className="shrink-0 text-sm font-semibold text-foreground tabular-nums">{r.credits} credits</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </SweepBox>
              </LandIn>
            )}
          </div>
        </div>
      </ZoneBody>
    </>
  );
}

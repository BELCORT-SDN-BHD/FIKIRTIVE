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
import { NS_AD_ACCOUNT, NS_ADS } from "@/components/northstar/ads/mock-ads";
import {
  cancelReportSubscription,
  creditSpendByCategory,
  reportSubscriptionsView,
  scheduleReport,
  useStore,
} from "@/components/northstar/immersive/_store";
import { AnalyticsNav, PinnedHeader, ZoneBody } from "./kit";

type Phase = "empty" | "building" | "ready" | "error";

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
  { id: "kpis", label: "Overview KPIs", source: "reads Analytics" },
  { id: "reach", label: "Reach chart", source: "reads Analytics" },
  { id: "ads", label: "Ad results", source: "reads Ads" },
  { id: "creative", label: "What's working in creative", source: "reads Ads" },
  { id: "posts", label: "Posts published", source: "reads Schedule" },
  { id: "credits", label: "Credit spend", source: "reads Billing" },
] as const;
type BlockId = (typeof BLOCKS)[number]["id"];

const BUILD_STEPS = ["Reading your analytics…", "Pulling ad results…", "Writing the weekly read…"] as const;

/** GM-04 周报语气(O-07):人话、有温度、不夸张,数字全部可回指 mock */
const WEEKLY_READ =
  "A good week. Reach climbed 18% and your Sunday croissant reels did most of the lifting. " +
  "One ad has gone stale, worth a refresh before Merdeka week. Nothing else needs your attention.";

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
  const [phase, setPhase] = React.useState<Phase>("empty");
  const [period, setPeriod] = React.useState<string>("week");
  const [cadence, setCadence] = React.useState<string>("weekly");
  const [blocks, setBlocks] = React.useState<Record<BlockId, boolean>>({
    kpis: true,
    reach: true,
    ads: true,
    creative: true,
    posts: true,
    credits: false,
  });
  const [branded, setBranded] = React.useState(true);
  const [ottoRead, setOttoRead] = React.useState(true);
  const [buildId, setBuildId] = React.useState(0);
  const [sweepKey, setSweepKey] = React.useState(0);
  const [downloading, setDownloading] = React.useState(false);
  const [barFull, setBarFull] = React.useState(false);

  useStore();
  const creditSpendRows = creditSpendByCategory();
  const subscriptions = reportSubscriptionsView();

  const anyBlock = Object.values(blocks).some(Boolean);
  const publishedPosts = NS_SCHEDULED_POSTS.filter((p) => p.status === "published");
  const topAds = [...NS_ADS].sort((a, b) => b.ctr - a.ctr).slice(0, 3);
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
                    <Switch checked={ottoRead} onCheckedChange={setOttoRead} aria-label="Otto's weekly read" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-foreground">Otto&apos;s weekly read</span>
                      <span className="block text-xs text-muted-foreground">Two sentences in plain words, no jargon</span>
                    </span>
                  </label>
                </div>
              </div>

              <Button className="mt-5 w-full" size="sm" disabled={phase === "building" || !anyBlock} onClick={startBuild}>
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

            {phase === "error" && (
              <div className="mt-3 flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card px-6 py-14 text-center">
                <div className="text-lg font-semibold text-foreground">Couldn&apos;t build the report</div>
                <p className="max-w-[380px] text-[13px] leading-[18px] text-muted-foreground">Your data is unchanged. Try again.</p>
                <Button variant="ghost" size="sm" onClick={startBuild}>
                  Retry
                </Button>
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

                  {ottoRead && (
                    <div className="mt-4 flex items-start gap-3 rounded-[14px] bg-secondary/70 p-4">
                      <OttoAvatar size={22} mood="helpful" />
                      <p className="min-w-0 flex-1 text-sm leading-[1.5] text-foreground">{WEEKLY_READ}</p>
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
                      <p className="text-xs text-muted-foreground">Your 3 best ads of {NS_ADS.length} · by click-through rate</p>
                      <div className="mt-2">
                        {topAds.map((ad) => (
                          <div key={ad.id} className="flex items-baseline gap-3 border-t border-border py-2.5 first:border-t-0">
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{ad.name}</span>
                            <span className="shrink-0 text-sm font-semibold text-foreground tabular-nums">{ad.ctr.toFixed(1)}% CTR</span>
                            <span className="w-24 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
                              {fmtMoney(NS_AD_ACCOUNT.currencyPrefix, ad.spendMyr)}
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

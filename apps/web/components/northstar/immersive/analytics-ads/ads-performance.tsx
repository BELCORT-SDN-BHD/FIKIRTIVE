"use client";

/**
 * 广告表现页(§L List;880;P0·live·revamp)—— 原生重建。
 *
 * §五契约:4 KPI + 两段 hairline-list(Doing well/Needs attention);点行展开 = 触发
 * Otto 诊断(叙述条 2 步→skeleton→coral-soft 诊断卡,带 KB/Meta 来源引用,O-10 不捏造);
 * 卡内 brand 按钮 = O-10 诊断→创作链「Opens in canvas. Nothing generates until you confirm
 * the cost.」。performance 是本区唯一 Otto 在场页,走满 §8 三态。
 *
 * WHATPASS 五章 ads 侧候选:创意疲劳提醒 [wave-b] · 学习期状态标签 [wave-b];
 * 六章:属性级创意归因 [wave-b] · Ad Refresh 疲劳→下一轮素材建议 [wave-b]。
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { BookOpen, ChevronDown, ExternalLink, Flame, Megaphone, Sparkles } from "lucide-react";
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
  Panel,
  ProvenancePill,
  fmtCount,
  fmtMoney,
} from "@/components/northstar/analytics/zone-kit";
import { NS_AD_ACCOUNT, NS_ADS, type NsAd, type NsAdCitation } from "@/components/northstar/ads/mock-ads";
import { adSubmissions, useStore } from "@/components/northstar/immersive/_store";
import { useImmersive } from "@/components/northstar/immersive/_context";
import { AdsNav, PinnedHeader, StateWall, ZoneBody } from "./kit";

type Demo = "ready" | "loading" | "empty" | "error";

const DIAGNOSE_STEPS = ["Reading this ad's numbers…", "Checking your creative playbook…"] as const;

/** [wave-b] 广告学习期状态标签:新投 <7 天 = 学习中(别手贱改);≥7 天 = 已稳定。 */
function isLearning(ad: NsAd): boolean {
  return ad.daysRunning < 7;
}
/** [wave-b] 创意疲劳:诊断挂了 fatigue KB 条目 = 该换素材了。 */
function isFatigued(ad: NsAd): boolean {
  return ad.diagnosis.citations.some((c) => c.knowledgeId === "diagnosis-creative-fatigue-frequency");
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
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] leading-[14px] font-medium tracking-[0.01em] text-foreground transition-colors duration-[120ms] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-[76px] shrink-0 text-right">
      <div className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground uppercase">{label}</div>
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
  const learning = isLearning(ad);
  const fatigued = isFatigued(ad);
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">{ad.name}</span>
            <Badge variant={winner ? "success" : "destructive"}>{winner ? "Above average" : "Below average"}</Badge>
            {/* [wave-b] 学习期状态标签 */}
            <Badge variant={learning ? "info" : "default"}>{learning ? "Learning" : "Stable"}</Badge>
            {/* [wave-b] 创意疲劳提醒 */}
            {fatigued && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning-soft-foreground">
                <Flame className="size-3" strokeWidth={2} />
                Refresh
              </span>
            )}
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
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-[150ms]", open && "rotate-180")}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="px-4 pb-4">
          <div className="mb-3 flex flex-wrap gap-3 md:hidden">
            <MetricCell label="Spend" value={fmtMoney(NS_AD_ACCOUNT.currencyPrefix, ad.spendMyr)} />
            <MetricCell label="CTR" value={`${ad.ctr.toFixed(1)}%`} />
            <MetricCell label="CPC" value={fmtMoney(NS_AD_ACCOUNT.currencyPrefix, ad.cpcMyr)} />
            <MetricCell label="Results" value={String(ad.results)} />
          </div>

          {/* [wave-b] 学习期防呆:学习中先别改 */}
          {learning && (
            <p className="mb-3 rounded-[10px] bg-secondary/70 px-3 py-2 text-[13px] leading-[18px] text-muted-foreground">
              Still learning — it&apos;s only run {ad.daysRunning} days. Give it a few more before changing anything, or the
              learning resets.
            </p>
          )}

          {diagnosing ? (
            <div>
              <OttoNarrationBar key={ad.id} steps={DIAGNOSE_STEPS} stepMs={1000} onSettle={onDiagnosed} className="w-fit" />
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
                        <li key={e} className="text-[13px] leading-[18px] text-muted-foreground">· {e}</li>
                      ))}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {ad.diagnosis.citations.map((c) => (
                        <CitationChip key={c.label} citation={c} />
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {/* O-10 诊断 → 创作链(brand;先到画布,花钱前必确认) */}
                      <Button asChild variant="brand" size="sm">
                        <Link href="/northstar-immersive/create/canvas">
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

/* [wave-b] 属性级创意归因(六章 #6):哪种创意元素带动效果 —— 读面小结,不设 coral */
const CREATIVE_ATTRIBUTES = [
  { attribute: "Hook in first 2 seconds", lift: "+38%", tone: "up" as const },
  { attribute: "Real person on camera", lift: "+21%", tone: "up" as const },
  { attribute: "Text-heavy image", lift: "−26%", tone: "down" as const },
];

export default function AdsPerformance() {
  const inside = useImmersive()?.insideImmersive ?? false;
  const [demo, setDemo] = React.useState<Demo>("ready");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [diagnosed, setDiagnosed] = React.useState<Set<string>>(new Set());

  useStore();
  const pending = adSubmissions();

  const winners = NS_ADS.filter((a) => a.ctr >= NS_AD_ACCOUNT.avgCtr);
  const laggards = NS_ADS.filter((a) => a.ctr < NS_AD_ACCOUNT.avgCtr);
  const fatiguedCount = NS_ADS.filter(isFatigued).length;

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
            {/* 账户 KPI(答案先行) */}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {kpis.map((k) => (
                <div key={k.label} className="rounded-[14px] border border-border bg-card p-4">
                  <div className="text-xs font-medium text-muted-foreground">{k.label}</div>
                  <div className="mt-1 text-[26px] leading-8 font-bold tracking-[-0.02em] text-foreground tabular-nums">{k.value}</div>
                </div>
              ))}
            </div>

            {/* [wave-b] 创意疲劳提醒(Ad Refresh 闭环):中性 heads-up,动作在诊断卡里 → 创作链 */}
            {fatiguedCount > 0 && (
              <div className="flex items-start gap-2 rounded-[12px] bg-warning-soft/60 px-4 py-2.5">
                <Flame className="mt-0.5 size-4 shrink-0 text-warning-soft-foreground" strokeWidth={2} />
                <p className="text-[13px] leading-[18px] text-foreground">
                  {fatiguedCount} {fatiguedCount === 1 ? "ad has" : "ads have"} gone stale — open the row to see Otto&apos;s
                  read and make a fresh version.
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Split by your own account average this period: CTR {NS_AD_ACCOUNT.avgCtr.toFixed(1)}% · CPC{" "}
              {fmtMoney(NS_AD_ACCOUNT.currencyPrefix, NS_AD_ACCOUNT.avgCpcMyr)}.
            </p>

            {/* 赢家 */}
            <section className="rounded-[var(--radius-card)] border border-border bg-card">
              <div className="px-4 pt-4 pb-2">
                <h2 className="text-sm font-semibold text-foreground">Doing well</h2>
                <p className="text-xs text-muted-foreground">{winners.length} ads above your account average</p>
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
            <section className="rounded-[var(--radius-card)] border border-border bg-card">
              <div className="px-4 pt-4 pb-2">
                <h2 className="text-sm font-semibold text-foreground">Needs attention</h2>
                <p className="text-xs text-muted-foreground">{laggards.length} ads below your account average</p>
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

            {/* [wave-b] 属性级创意归因:哪种元素带动效果(读面小结) */}
            <Panel title="What's working in your creative" basis="Which elements move click-through · across your ads">
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
                      {c.lift} CTR
                    </span>
                  </div>
                ))}
              </div>
              <Button asChild variant="secondary" size="sm" className="mt-3">
                <Link href="/northstar-immersive/create/canvas">Make more with what works</Link>
              </Button>
            </Panel>
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

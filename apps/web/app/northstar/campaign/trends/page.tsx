/* @nsPage district="Campaign 区" page="trends" status="draft"
   sources="campaign spec §5.2;宪法 7(读的对等)" approvedAt="" pr="" */
"use client";

/**
 * 趋势存档页 — Otto 的市场资料库人工面(「懂市场当下」)。
 * 清单要件:TrendSnapshot 只读列表(结论 + 来源引用 + 日期 + 关联 campaign)。
 * 形态:List 原型(§L2,栏宽 880);行可展开看结论详情 + 来源;搜索 + via segmented 过滤(§N4)。
 * Otto 在场:进场演示深研管线的写入点 — 叙述条 + 最新快照落地(§8b 先留位再落 + §8a sweep);
 * 落定后页面归于平静(读面,零静态 coral;§O3 读的表面不配 approval moods)。
 * 溯源:§D1 provenance — 每行标 via(Deep research / Quick search)+ 来源引用可见。
 */

import * as React from "react";
import Link from "next/link";
import { Archive, ChevronDown, Globe, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, MockNote, OttoNarrationBar, PageHeader } from "@/components/northstar/_shared";
import { TREND_SNAPSHOTS, type TrendSnapshot } from "@/components/northstar/campaign/_data";
import {
  DemoStates,
  InlineError,
  Landed,
  SkeletonBlock,
  type DemoState,
} from "@/components/northstar/campaign/_bits";

const ARCHIVE_STEPS = ["Summarising today's research…", "Filing sources…"] as const;

const NEWEST = TREND_SNAPSHOTS[0]!;

type ViaFilter = "all" | "Deep research" | "Quick search";

const VIA_OPTIONS: { key: ViaFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "Deep research", label: "Deep research" },
  { key: "Quick search", label: "Quick search" },
];

function SnapshotRow({
  snap,
  open,
  onToggle,
  first,
}: {
  snap: TrendSnapshot;
  open: boolean;
  onToggle: () => void;
  first: boolean;
}) {
  return (
    <div className={cn(!first && "border-t border-border")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-[120ms] hover:bg-accent"
      >
        <span className="w-20 shrink-0 font-mono text-[11px] leading-[14px] font-medium text-muted-foreground tabular-nums">
          {snap.capturedAt}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{snap.summary}</span>
        {snap.via === "Deep research" ? <Badge variant="info">Deep research</Badge> : <Badge>Quick search</Badge>}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-[120ms]",
            open && "rotate-180",
          )}
          strokeWidth={2}
        />
      </button>
      {open && (
        <div className="border-t border-border bg-secondary/40 px-4 py-4 sm:pl-[7.75rem]">
          <p className="max-w-[560px] text-[13px] leading-[18px] text-foreground">{snap.detail}</p>
          <div className="mt-3">
            <div className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              Sources
            </div>
            <ul className="mt-1.5 flex flex-col gap-1">
              {snap.sources.map((s) => (
                <li key={s.title} className="flex items-baseline gap-2">
                  <Globe
                    aria-hidden
                    className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground"
                    strokeWidth={2}
                  />
                  <span className="min-w-0 truncate text-[13px] leading-[18px] text-foreground">{s.title}</span>
                  <span className="shrink-0 font-mono text-[11px] leading-[14px] font-medium text-muted-foreground">
                    {s.domain}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {snap.campaignName && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Used by</span>
              <Link
                href="/northstar/campaign/list"
                className="inline-flex h-6 items-center rounded-full border border-border bg-card px-2.5 text-xs font-semibold text-foreground transition-colors duration-[120ms] hover:bg-accent"
              >
                {snap.campaignName}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("default");
  const [query, setQuery] = React.useState("");
  const [via, setVia] = React.useState<ViaFilter>("all");
  const [openId, setOpenId] = React.useState<string | null>(null);
  // 进场演示:最新快照由 Otto 归档落地(深研管线写入点,spec §5.2)
  const [archived, setArchived] = React.useState(false);

  const isLoading = demo === "loading";
  const isEmpty = demo === "empty";
  const isError = demo === "error";

  const base = archived ? TREND_SNAPSHOTS : TREND_SNAPSHOTS.slice(1);
  const q = query.trim().toLowerCase();
  const filtered = base.filter((s) => {
    if (via !== "all" && s.via !== via) return false;
    if (!q) return true;
    return (
      s.summary.toLowerCase().includes(q) ||
      s.detail.toLowerCase().includes(q) ||
      (s.campaignName ?? "").toLowerCase().includes(q)
    );
  });
  const hasFilter = q.length > 0 || via !== "all";
  const olderRows = hasFilter ? filtered : filtered.filter((s) => s.id !== NEWEST.id);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Trend archive"
        subtitle="What's working in your market right now. Otto files every research run here and checks it before planning."
        meta={["via Otto research · read-only"]}
      />

      {/* 工具行:搜索 + via 过滤(segmented,§N4:同一份内容换看法) */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-[360px]">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={2}
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search snapshots"
            aria-label="Search snapshots"
            className="pl-10"
          />
        </div>
        <div
          className="inline-flex rounded-[10px] border border-border bg-card p-0.5"
          role="group"
          aria-label="Filter by source type"
        >
          {VIA_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setVia(o.key)}
              aria-pressed={via === o.key}
              className={cn(
                "h-[30px] rounded-lg px-3 text-xs font-semibold",
                via === o.key
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {/* 叙述条(§8c 一屏一条):深研报告完成 → 快照归档 */}
        {!archived && !isLoading && !isEmpty && !isError && (
          <OttoNarrationBar key="archiving" steps={ARCHIVE_STEPS} stepMs={1400} onSettle={() => setArchived(true)} />
        )}
      </div>

      {/* 主体 */}
      <div className="mt-4 overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
        {isError ? (
          <InlineError text="Couldn't load the archive. Try again." onRetry={() => setDemo("default")} />
        ) : isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            <SkeletonBlock className="h-11 w-full" />
            <SkeletonBlock className="h-11 w-full" />
            <SkeletonBlock className="h-11 w-full" shimmer={false} />
          </div>
        ) : isEmpty ? (
          <EmptyState
            icon={Archive}
            title="No trend snapshots yet"
            body="They file themselves whenever Otto researches. Start a plan in the workbench to kick one off."
            action={
              <Button asChild size="sm">
                <Link href="/northstar/campaign/workbench">Open workbench</Link>
              </Button>
            }
          />
        ) : (
          <>
            {/* 归档中:先留位再落卡(§8b) */}
            {!archived && !hasFilter && (
              <div className="px-4 py-3">
                <SkeletonBlock className="h-11 w-full" />
              </div>
            )}
            {/* 新快照落地(§8b landing + §8a sweep,一次性;之后与旧行无异) */}
            {archived && !hasFilter && (
              <Landed sweep>
                <SnapshotRow
                  snap={NEWEST}
                  open={openId === NEWEST.id}
                  onToggle={() => setOpenId((v) => (v === NEWEST.id ? null : NEWEST.id))}
                  first
                />
              </Landed>
            )}
            {olderRows.map((s, i) => (
              <SnapshotRow
                key={s.id}
                snap={s}
                open={openId === s.id}
                onToggle={() => setOpenId((v) => (v === s.id ? null : s.id))}
                first={hasFilter && i === 0}
              />
            ))}
            {hasFilter && filtered.length === 0 && (
              <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Nothing matches this filter.</p>
            )}
          </>
        )}
      </div>

      {/* 定位注记:与品牌记忆并列的长期资料库(spec §5.2) */}
      <p className="mt-3 px-1 text-xs text-muted-foreground">
        Snapshots keep the conclusion and its sources only. Full reports stay in your research history. Brand memory
        knows your shop, this archive knows your market.
      </p>

      <MockNote path="/northstar/campaign/trends" />
      <DemoStates
        value={demo}
        onChange={(s) => {
          setDemo(s);
          if (s === "default") setArchived(true);
          if (s === "loading") setArchived(false);
        }}
      />
    </div>
  );
}

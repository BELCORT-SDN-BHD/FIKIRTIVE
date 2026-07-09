"use client";

/**
 * 趋势资料库(D3)—— Otto 的市场记忆人工面(「懂市场当下」,与品牌记忆并列)。
 * TrendSnapshot 只读列表(结论 + 来源 + 日期 + 关联 campaign);行展开 disclosure;via 段控过滤。
 * 进场演示深研写入:叙述条 + 最新 TrendSnapshot 落地(§8b 先留位再落 + §8a sweep)→ 归平静。
 * research 可完全独立存在(standalone),也可被任何 campaign 引用(campaignId)。
 *
 * 铁律:纯 client、零后台 import;数据只从 NS_TRENDS 派生;coral 只属于 Otto(叙述条/落卡)。
 */

import * as React from "react";
import Link from "next/link";
import { Activity, Archive, ChevronDown, Globe, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, OttoNarrationBar } from "@/components/northstar/_shared";
import { NS_TRENDS, campaignSummaryById, type NsTrendSnapshot } from "@/components/northstar/_mock";
import { recentEvents, useStore, type NsEventType } from "../_store";
import { CAMP_BASE as BASE, CampaignNav, Landed, SkeletonBlock } from "./kit";

const CAMPAIGN_EVENT_TYPES = new Set<NsEventType>(["campaign_entry_approved", "credits_spent", "post_scheduled"]);
const ARCHIVE_STEPS = ["Summarising today's research…", "Filing sources…"] as const;
const NEWEST = NS_TRENDS[0]!;

type ViaFilter = "all" | "Deep research" | "Quick search";
const VIA_OPTIONS: { key: ViaFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "Deep research", label: "Deep research" },
  { key: "Quick search", label: "Quick search" },
];

function SnapshotRow({ snap, open, onToggle, first }: { snap: NsTrendSnapshot; open: boolean; onToggle: () => void; first: boolean }) {
  const campaign = snap.campaignId ? campaignSummaryById(snap.campaignId) : undefined;
  return (
    <div className={cn(!first && "border-t border-border")}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent">
        <span className="w-20 shrink-0 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">{snap.capturedAt}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{snap.title}</span>
        {snap.stat && <span className="hidden shrink-0 font-mono text-[11px] font-medium text-muted-foreground sm:inline">{snap.stat.value}</span>}
        {snap.via === "Deep research" ? <Badge variant="info">Deep research</Badge> : <Badge>Quick search</Badge>}
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} strokeWidth={2} />
      </button>
      {open && (
        <div className="border-t border-border bg-secondary/40 px-4 py-4 sm:pl-[7.75rem]">
          <p className="max-w-[560px] text-[13px] leading-[18px] text-foreground">{snap.summary}</p>
          <div className="mt-3">
            <div className="font-mono text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">Sources</div>
            <ul className="mt-1.5 flex flex-col gap-1">
              {snap.sources.map((s) => (
                <li key={s.title} className="flex items-baseline gap-2">
                  <Globe aria-hidden className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground" strokeWidth={2} />
                  <span className="min-w-0 truncate text-[13px] leading-[18px] text-foreground">{s.title}</span>
                  <span className="shrink-0 font-mono text-[11px] font-medium text-muted-foreground">{s.domain}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Used by</span>
            {campaign ? (
              <Link href={`${BASE}/campaign/detail?id=${campaign.id}`} className="inline-flex h-6 items-center rounded-full border border-border bg-card px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent">
                {campaign.name}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">
                {snap.campaignId ? "A past campaign" : "No campaign — a standing market cue"}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CampaignTrends() {
  useStore();
  const [query, setQuery] = React.useState("");
  const [via, setVia] = React.useState<ViaFilter>("all");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [archived, setArchived] = React.useState(false);

  const base = archived ? NS_TRENDS : NS_TRENDS.slice(1);
  const q = query.trim().toLowerCase();
  const filtered = base.filter((s) => {
    if (via !== "all" && s.via !== via) return false;
    if (!q) return true;
    return s.title.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q);
  });
  const hasFilter = q.length > 0 || via !== "all";
  const olderRows = hasFilter ? filtered : filtered.filter((s) => s.id !== NEWEST.id);
  const activity = recentEvents(40).filter((e) => CAMPAIGN_EVENT_TYPES.has(e.type)).slice(0, 6);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Trends"
        subtitle="What's working in your market right now. Otto files every research run here and checks it before planning."
        actions={<CampaignNav />}
      />

      <div className="mt-6 overflow-hidden rounded-[18px] border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Activity className="size-4 text-muted-foreground" strokeWidth={2} />
          <span className="text-sm font-semibold text-foreground">Recent campaign activity</span>
        </div>
        {activity.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-muted-foreground">No campaign activity yet. Approve a plan or run a pack and it shows up here.</p>
        ) : (
          <ul className="flex flex-col">
            {activity.map((e) => (
              <li key={e.at} className="flex items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{e.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-[360px]">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={2} />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search snapshots" aria-label="Search snapshots" className="pl-10" />
        </div>
        <div className="inline-flex rounded-[10px] border border-border bg-card p-0.5" role="group" aria-label="Filter by source type">
          {VIA_OPTIONS.map((o) => (
            <button key={o.key} type="button" onClick={() => setVia(o.key)} aria-pressed={via === o.key} className={cn("h-[30px] rounded-lg px-3 text-xs font-semibold", via === o.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {!archived && <OttoNarrationBar key="archiving" steps={ARCHIVE_STEPS} stepMs={1400} onSettle={() => setArchived(true)} />}
      </div>

      <div className="mt-4 overflow-hidden rounded-[18px] border border-border bg-card">
        {!archived && !hasFilter && (
          <div className="px-4 py-3"><SkeletonBlock className="h-11 w-full" /></div>
        )}
        {archived && !hasFilter && (
          <Landed sweep>
            <SnapshotRow snap={NEWEST} open={openId === NEWEST.id} onToggle={() => setOpenId((v) => (v === NEWEST.id ? null : NEWEST.id))} first />
          </Landed>
        )}
        {olderRows.map((s, i) => (
          <SnapshotRow key={s.id} snap={s} open={openId === s.id} onToggle={() => setOpenId((v) => (v === s.id ? null : s.id))} first={hasFilter && i === 0} />
        ))}
        {hasFilter && filtered.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Nothing matches this filter.</p>}
      </div>

      <p className="mt-3 px-1 text-xs text-muted-foreground">
        Snapshots keep the conclusion and its sources only. Full reports stay in your research history. Brand memory knows your shop, this archive knows your market.
      </p>
    </div>
  );
}

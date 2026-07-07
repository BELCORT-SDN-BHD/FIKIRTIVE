/* @nsPage district="Campaign 区" page="list" status="draft"
   sources="红旗六判决;P3-1;GM-03 判决" approvedAt="" pr="" */
"use client";

/**
 * Campaign 列表与详情(完全体)— 独立 Campaign 对象的管理面(P3 形态先画出来)。
 * 清单要件:列表、详情(目标 / 预算 / 周期 / 状态机 / UTM 基串)、GM-03 目标进度条、
 * 归组产物(内容 / 帖 / 广告 / 对话)。
 * 形态:List 原型(§L2)→ 点行进详情(两级封顶,§N1;back = 关,Esc 同效,§N7);
 * 详情 = Detail 原型一栏;归组产物 = tabs(§N4,←/→ roving focus);
 * GM-03 进度条 = ink 确定性进度 + micro-mono 计数(§FB8:bar 必配数字)。
 * Otto 在场:管理面保持安静 — dock 之外零 coral(§O3/§O4)。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptyState, MockNote, PageHeader, StatCard } from "@/components/northstar/_shared";
import { CAMPAIGNS, type CampaignFull, type CampaignStatus } from "@/components/northstar/campaign/_data";
import {
  CampaignStatusBadge,
  DemoStates,
  InlineError,
  PlatformPill,
  SkeletonBlock,
  fmtCredits,
  type DemoState,
} from "@/components/northstar/campaign/_bits";

/* ── 状态机(红旗六最薄行:DRAFT → ACTIVE → DONE;CANCELLED 为终止支线) ── */
const STATUS_TRACK: CampaignStatus[] = ["DRAFT", "ACTIVE", "DONE"];
const STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

function StatusTrack({ status }: { status: CampaignStatus }) {
  const cancelled = status === "CANCELLED";
  const reached = cancelled ? 0 : STATUS_TRACK.indexOf(status);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STATUS_TRACK.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <span aria-hidden className="h-px w-6 bg-border" />}
          <span
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-3 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] uppercase",
              !cancelled && i < reached && "bg-secondary text-muted-foreground",
              !cancelled && i === reached && "bg-secondary text-foreground",
              (cancelled || i > reached) && "border border-border text-muted-foreground/70",
            )}
          >
            {!cancelled && i < reached && <Check className="size-3" strokeWidth={2.5} />}
            {STATUS_LABEL[s]}
          </span>
        </React.Fragment>
      ))}
      {cancelled && (
        <>
          <span aria-hidden className="h-px w-6 bg-border" />
          <span className="inline-flex h-7 items-center rounded-full bg-error-soft px-3 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-error-soft-foreground uppercase">
            Cancelled
          </span>
        </>
      )}
    </div>
  );
}

/* ── 归组产物 tabs(§N4 tabs;hand-rolled tablist 必配 ←/→ roving focus,§A3) ── */
type OutputKey = keyof CampaignFull["outputs"];
const OUTPUT_TABS: { key: OutputKey; label: string }[] = [
  { key: "content", label: "Content" },
  { key: "posts", label: "Posts" },
  { key: "ads", label: "Ads" },
  { key: "conversations", label: "Conversations" },
];

const OUTPUT_EMPTY: Record<OutputKey, string> = {
  content: "No content in this campaign yet. Generated pieces land here after pack confirm.",
  posts: "No posts in this campaign yet. Drafts land here from the schedule.",
  ads: "No ads in this campaign yet. Ad drafts group here when you build them.",
  conversations: "No conversations linked yet. Replies that mention this campaign group here.",
};

function OutputTabs({ campaign }: { campaign: CampaignFull }) {
  const [tab, setTab] = React.useState<OutputKey>("content");
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const cur = OUTPUT_TABS.findIndex((t) => t.key === tab);
    const next = (cur + (e.key === "ArrowRight" ? 1 : OUTPUT_TABS.length - 1)) % OUTPUT_TABS.length;
    setTab(OUTPUT_TABS[next]!.key);
    refs.current[next]?.focus();
  }

  const items = campaign.outputs[tab];

  return (
    <div>
      <div
        role="tablist"
        aria-label="Campaign outputs"
        onKeyDown={onKeyDown}
        className="inline-flex flex-wrap gap-1 rounded-[14px] bg-muted p-1"
      >
        {OUTPUT_TABS.map((t, i) => {
          const active = tab === t.key;
          const count = campaign.outputs[t.key].length;
          return (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-[10px] px-4 text-[13px] font-medium",
                active
                  ? "bg-card font-semibold text-foreground shadow-[var(--shadow-sm)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">{OUTPUT_EMPTY[tab]}</p>
        ) : (
          items.map((item, i) => (
            <div key={item.id} className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t border-border")}>
              {item.thumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumb}
                  alt=""
                  className="size-10 shrink-0 rounded-[10px] border border-border object-cover"
                />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{item.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{item.meta}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── 详情(Detail 原型:目标 / 预算 / 周期 / 状态机 / UTM 基串 + GM-03 + 归组) ── */
function CampaignDetail({ campaign, onBack }: { campaign: CampaignFull; onBack: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const pct = Math.min(100, Math.round((campaign.goalProgress.current / campaign.goalProgress.target) * 100));

  // Esc = 关详情回列表(§N7:overlay 不困 Back)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  function copyUtm() {
    void navigator.clipboard?.writeText(campaign.utmBase).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-medium text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft className="size-4" strokeWidth={2} />
        All campaigns
      </button>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 truncate text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
          {campaign.name}
        </h2>
        <CampaignStatusBadge status={campaign.status} />
        <span className="inline-flex h-7 items-center rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground">
          {campaign.period}
        </span>
        <div className="flex-1" />
        <StatusTrack status={campaign.status} />
      </div>

      {/* 数据一行(§D3:恰好 4 张) */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={campaign.goalProgress.label}
          value={`${campaign.goalProgress.current}/${campaign.goalProgress.target}`}
          delta={{ dir: "flat", text: `${pct}% of goal` }}
        />
        <StatCard
          label="Spent"
          value={String(campaign.spentCredits)}
          delta={{ dir: "flat", text: `of ${campaign.budgetCredits} credits budget` }}
        />
        <StatCard label="Posts" value={String(campaign.outputs.posts.length)} />
        <StatCard label="Content pieces" value={String(campaign.outputs.content.length)} />
      </div>

      {/* 目标进度条(GM-03:可关的克制游戏化 — 一根 ink 条 + 数字,不庆祝不打扰) */}
      <div className="mt-4 rounded-[var(--radius-card)] border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">Goal</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{campaign.goal}</span>
          <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
            {campaign.goalProgress.current}/{campaign.goalProgress.target}
          </span>
        </div>
        <Progress
          value={pct}
          aria-label={`${campaign.goalProgress.label}: ${campaign.goalProgress.current} of ${campaign.goalProgress.target}`}
          className="mt-3"
        />
      </div>

      {/* 配置:平台 + UTM 基串 */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-border bg-card p-5">
          <div className="text-xs font-medium text-muted-foreground">Platforms</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {campaign.platforms.map((p) => (
              <PlatformPill key={p} platform={p} full />
            ))}
          </div>
          <div className="mt-4 text-xs font-medium text-muted-foreground">Budget</div>
          <div className="mt-1 text-sm text-foreground tabular-nums">
            {fmtCredits(campaign.budgetCredits)} · {fmtCredits(campaign.spentCredits)} spent
          </div>
        </div>
        <div className="rounded-[var(--radius-card)] border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">UTM base</span>
            <button
              type="button"
              onClick={copyUtm}
              className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
            >
              {copied ? <Check className="size-3.5" strokeWidth={2.5} /> : <Copy className="size-3.5" strokeWidth={2} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 font-mono text-xs leading-5 break-all text-muted-foreground">{campaign.utmBase}</p>
          <p className="mt-2 text-xs text-muted-foreground">Every link in this campaign carries these tags.</p>
        </div>
      </div>

      {/* 归组产物(内容 / 帖 / 广告 / 对话) */}
      <div className="mt-6">
        <OutputTabs campaign={campaign} />
      </div>
    </div>
  );
}

/* ── 列表行 ── */
function CampaignRow({ campaign, onOpen, first }: { campaign: CampaignFull; onOpen: () => void; first: boolean }) {
  const pct = Math.min(100, Math.round((campaign.goalProgress.current / campaign.goalProgress.target) * 100));
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-[120ms] hover:bg-accent",
        !first && "border-t border-border",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{campaign.name}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{campaign.period}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-1 md:flex">
        {campaign.platforms.map((p) => (
          <PlatformPill key={p} platform={p} />
        ))}
      </span>
      <span className="hidden w-24 shrink-0 sm:block">
        <span className="block font-mono text-[11px] leading-[14px] font-medium text-muted-foreground tabular-nums">
          {campaign.goalProgress.current}/{campaign.goalProgress.target} · {pct}%
        </span>
        <span aria-hidden className="mt-1.5 block h-1 overflow-hidden rounded-full bg-secondary">
          <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </span>
      </span>
      <span className="hidden w-28 shrink-0 text-right font-mono text-[11px] leading-[14px] font-medium text-muted-foreground tabular-nums sm:block">
        {campaign.spentCredits}/{campaign.budgetCredits} cr
      </span>
      <CampaignStatusBadge status={campaign.status} />
    </button>
  );
}

type StatusFilter = "all" | CampaignStatus;

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "ACTIVE", label: "Active" },
  { key: "DONE", label: "Done" },
  { key: "CANCELLED", label: "Cancelled" },
];

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("default");
  const [filter, setFilter] = React.useState<StatusFilter>("all");
  const [openId, setOpenId] = React.useState<string | null>(null);

  const isLoading = demo === "loading";
  const isEmpty = demo === "empty";
  const isError = demo === "error";

  const open = CAMPAIGNS.find((c) => c.id === openId) ?? null;
  const filtered = filter === "all" ? CAMPAIGNS : CAMPAIGNS.filter((c) => c.status === filter);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      {open && !isLoading && !isEmpty && !isError ? (
        <CampaignDetail campaign={open} onBack={() => setOpenId(null)} />
      ) : (
        <>
          <PageHeader
            title="Campaigns"
            subtitle="Everything each campaign produced, in one place. Content, posts, ads and conversations stay grouped."
            actions={
              <Button asChild size="sm">
                <Link href="/northstar/campaign/workbench">New campaign</Link>
              </Button>
            }
          />

          {/* 状态过滤(segmented,§N4) */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div
              className="inline-flex rounded-[10px] border border-border bg-card p-0.5"
              role="group"
              aria-label="Filter by status"
            >
              {STATUS_FILTERS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setFilter(o.key)}
                  aria-pressed={filter === o.key}
                  className={cn(
                    "h-[30px] rounded-lg px-3 text-xs font-semibold",
                    filter === o.key
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              A campaign is its own object, never a folder of copies.
            </p>
          </div>

          {/* 列表 */}
          <div className="mt-4 overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
            {isError ? (
              <InlineError text="Couldn't load your campaigns. Try again." onRetry={() => setDemo("default")} />
            ) : isLoading ? (
              <div className="flex flex-col gap-2 p-4">
                <SkeletonBlock className="h-12 w-full" />
                <SkeletonBlock className="h-12 w-full" />
                <SkeletonBlock className="h-12 w-full" shimmer={false} />
              </div>
            ) : isEmpty ? (
              <EmptyState
                icon={FolderKanban}
                title="No campaigns yet"
                body="Start one in the workbench or ask Otto to plan your month."
                action={
                  <Button asChild size="sm">
                    <Link href="/northstar/campaign/workbench">Open workbench</Link>
                  </Button>
                }
              />
            ) : filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Nothing matches this filter.</p>
            ) : (
              filtered.map((c, i) => (
                <CampaignRow key={c.id} campaign={c} onOpen={() => setOpenId(c.id)} first={i === 0} />
              ))
            )}
          </div>
        </>
      )}

      <MockNote path="/northstar/campaign/list" />
      <DemoStates
        value={demo}
        onChange={(s) => {
          setDemo(s);
          if (s !== "default") setOpenId(null);
        }}
      />
    </div>
  );
}

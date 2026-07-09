"use client";

/**
 * Campaign 列表 —— 「进行中的事」总览(D1:唯一「事」容器的门面)。
 *
 * 三个 canonical campaign(ACTIVE / DRAFT / DONE)真数据真图;每张卡是一个真去处:
 * 整卡点开详情容器(7 tabs)。管理面故意安静 —— dock 之外零 coral(§O3/§O4)。
 * Wave B:节庆预置模板卡(#7)、从模板新建(#6)、多档横向对比(#10)、目标进度条(#4)、
 * 预算/花费两列(#2)、ROI 一行(#3)。
 *
 * 铁律:纯 client、零后台 import;图片只从 NS_IMAGES(campaign.hero);credits 永远是 credits。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, GitCompareArrows, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/northstar/_shared";
import { NS_CAMPAIGNS, type NsCampaignSummary, type NsCampaignStatus } from "@/components/northstar/_mock";
import {
  assetsForCampaign,
  postsForCampaign,
  campaignHeadroom,
} from "../_selectors";
import { useStore } from "../_store";
import {
  CAMP_BASE as BASE,
  CampaignNav,
  CampaignStatusBadge,
  GoalBar,
  fmtCredits,
  roiLine,
} from "./kit";

/* ── 节庆预置(SEA 冷启动种子:非品牌事实,UI 提示口径) ──────────────────────
 * [wave-b] SEA 节庆日历预置 campaign 模板(#7) */
const FESTIVALS: { name: string; when: string; goal: string }[] = [
  { name: "Deepavali gift boxes", when: "Nov 8", goal: "Sell Deepavali gift boxes" },
  { name: "Chinese New Year hampers", when: "Feb 17", goal: "Pre-sell CNY hampers" },
  { name: "Christmas bakes", when: "Dec 25", goal: "Drive Christmas pre-orders" },
];

const STATUS_FILTERS: { key: "all" | NsCampaignStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "DRAFT", label: "Draft" },
  { key: "DONE", label: "Done" },
];

/** 卡内计数(切片自动长在 campaign 上;D1)。 */
function counts(c: NsCampaignSummary) {
  return { content: assetsForCampaign(c.id).length, posts: postsForCampaign(c.id).length };
}

function CampaignCard({
  c,
  selectable,
  selected,
  onToggle,
}: {
  c: NsCampaignSummary;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const { content, posts } = counts(c);
  const roi = c.result ? roiLine(c.spentCredits, c.result.attributedRevenueMyr) : null; // DONE:归因订单额从 result 派生
  const headroom = campaignHeadroom(c);
  const inner = (
    <>
      <div className="relative aspect-[16/7] w-full overflow-hidden bg-secondary">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={c.hero} alt={`${c.name} key visual`} className="size-full object-cover" />
        <div className="absolute top-3 left-3">
          <CampaignStatusBadge status={c.status} />
        </div>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{c.name}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.period}</p>
          </div>
          {!selectable && (
            <ArrowRight
              className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              strokeWidth={2}
            />
          )}
        </div>

        {/* GM-03 目标进度条(#4) */}
        <GoalBar label={c.goalProgress.label} current={c.goalProgress.current} target={c.goalProgress.target} />

        {/* 预算/花费两列(#2) */}
        <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
          <div>
            <p className="font-medium text-muted-foreground">Spent</p>
            <p className="mt-0.5 font-mono font-medium text-foreground tabular-nums">
              {c.spentCredits}/{c.budgetCredits} cr
            </p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Headroom</p>
            <p className="mt-0.5 font-mono font-medium text-foreground tabular-nums">{headroom} cr left</p>
          </div>
        </div>

        {/* ROI 一行(#3;只 DONE 有归因收入) */}
        {roi && (
          <p
            className={cn(
              "rounded-[10px] bg-secondary px-2.5 py-1.5 text-xs font-medium",
              roi.positive ? "text-success-soft-foreground" : "text-error-soft-foreground",
            )}
          >
            {roi.text}
          </p>
        )}

        <div className="flex items-center gap-3 text-[11px] font-medium text-muted-foreground">
          <span>{content} content</span>
          <span aria-hidden>·</span>
          <span>{posts} posts</span>
          <span aria-hidden>·</span>
          <span>{c.platforms.length} platforms</span>
        </div>
      </div>
    </>
  );

  if (selectable) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        className={cn(
          "group flex flex-col overflow-hidden rounded-[18px] border bg-card text-left transition-colors",
          selected ? "border-foreground ring-1 ring-foreground" : "border-border hover:border-muted-foreground/40",
        )}
      >
        {inner}
      </button>
    );
  }
  return (
    <Link
      href={`${BASE}/campaign/detail?id=${c.id}`}
      className="group flex flex-col overflow-hidden rounded-[18px] border border-border bg-card transition-colors hover:bg-accent/40"
    >
      {inner}
    </Link>
  );
}

/** 多档横向对比表(#10)。 [wave-b] Campaign 对比表 */
function CompareTable({ ids }: { ids: string[] }) {
  const rows = ids.map((id) => NS_CAMPAIGNS.find((c) => c.id === id)).filter(Boolean) as NsCampaignSummary[];
  return (
    <div className="mt-4 overflow-x-auto rounded-[18px] border border-border bg-card">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-4 py-3 font-medium">Campaign</th>
            <th className="px-4 py-3 font-medium">Goal</th>
            <th className="px-4 py-3 font-medium">Spent</th>
            <th className="px-4 py-3 font-medium">ROI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const pct =
              c.goalProgress.target > 0
                ? Math.round((c.goalProgress.current / c.goalProgress.target) * 100)
                : 0;
            const roi = c.result ? roiLine(c.spentCredits, c.result.attributedRevenueMyr).text : "—";
            return (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-semibold text-foreground">{c.name}</td>
                <td className="px-4 py-3 text-muted-foreground tabular-nums">{pct}% of goal</td>
                <td className="px-4 py-3 font-mono text-xs text-foreground tabular-nums">
                  {c.spentCredits}/{c.budgetCredits} cr
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{roi}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CampaignList() {
  useStore(); // 订阅共享 store:切片计数随生成/排期实时反映
  const [filter, setFilter] = React.useState<"all" | NsCampaignStatus>("all");
  const [compare, setCompare] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const list = NS_CAMPAIGNS;
  const active = list.filter((c) => c.status === "ACTIVE");
  const filtered = filter === "all" ? list : list.filter((c) => c.status === filter);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 3) next.add(id);
      return next;
    });
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1100px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Campaigns"
        subtitle="Everything you have going on, in one place. Each campaign holds its own research, content, posts, ads and conversations."
        actions={
          <div className="flex items-center gap-2">
            <CampaignNav />
            <Button asChild size="sm">
              <Link href={`${BASE}/campaign/workbench`}>New campaign</Link>
            </Button>
          </div>
        }
      />

      {/* Up next:进行中的事(D1 心智:老板脑子里在办的事) */}
      {active.length > 0 && (
        <section className="mt-6">
          <p className="mb-2 font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            In progress
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((c) => (
              <CampaignCard key={c.id} c={c} selectable={false} selected={false} onToggle={() => {}} />
            ))}
          </div>
        </section>
      )}

      {/* 节庆预置模板(#7):SEA 冷启动种子,一键起草 */}
      <section className="mt-6 rounded-[18px] border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" strokeWidth={2} />
          <p className="text-sm font-semibold text-foreground">Coming up in Malaysia</p>
          <span className="text-xs text-muted-foreground">Start from a festival template</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {FESTIVALS.map((f) => (
            <Link
              key={f.name}
              href={`${BASE}/campaign/workbench?goal=${encodeURIComponent(f.goal)}`}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              {f.name}
              <span className="font-mono text-[10px] text-muted-foreground">{f.when}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* 过滤 + 对比切换 */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-[10px] border border-border bg-card p-0.5" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setFilter(o.key)}
              aria-pressed={filter === o.key}
              className={cn(
                "h-[30px] rounded-lg px-3 text-xs font-semibold transition-colors",
                filter === o.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setCompare((v) => !v);
            setSelected(new Set());
          }}
          aria-pressed={compare}
          className={cn(
            "inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border px-3 text-xs font-semibold transition-colors",
            compare ? "border-foreground bg-secondary text-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <GitCompareArrows className="size-3.5" strokeWidth={2} />
          Compare
        </button>
        <p className="text-xs text-muted-foreground">
          {compare ? "Pick 2 or 3 campaigns to line them up." : "A campaign is its own object, never a folder of copies."}
        </p>
      </div>

      {compare && selected.size >= 2 && <CompareTable ids={[...selected]} />}

      {/* 全部 campaign 卡 */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c) => (
          <CampaignCard
            key={c.id}
            c={c}
            selectable={compare}
            selected={selected.has(c.id)}
            onToggle={() => toggleSelect(c.id)}
          />
        ))}
      </div>
    </div>
  );
}

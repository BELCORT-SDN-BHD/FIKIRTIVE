/* @nsPage district="全城地图" page="index" status="draft"
   sources="PROGRAM.md §二(总目录页 = 全城地图,逐页链接 + @nsPage 状态角标)" approvedAt="" pr="" */
"use client";

/**
 * 北极星总目录 — 全城地图:14 区 57 页,逐页链接 + 状态角标。
 * 每区一张卡,锚点 #zone-<slug>(MockNote 链回这里)。
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { NS_COUNTS, NS_ZONES, nsPagesByZone, type NsPage } from "@/components/northstar/_registry";
import { PageHeader, StatCard } from "@/components/northstar/_shared";

function statusBadge(p: NsPage) {
  switch (p.status) {
    case "stub":
      return <Badge variant="outline" className="text-muted-foreground">未建</Badge>;
    case "draft":
      return <Badge variant="default">draft</Badge>;
    case "approved":
      return <Badge variant="success">approved</Badge>;
    case "lit":
      return <Badge variant="info">lit</Badge>;
  }
}

export default function NorthstarCityMap() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-6 pt-6 pb-10">
      <PageHeader
        title="北极星全城地图"
        subtitle="最终构想的每一页,先建成可点、不通电的样板间。founder 逐页过目、逐页拍板。"
        meta={["设计稿", "57 页"]}
      />

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="P0 · 现有区翻新" value={String(NS_COUNTS.p0)} />
        <StatCard label="P1 · 收钱主线区" value={String(NS_COUNTS.p1)} />
        <StatCard label="P2 · 未来区" value={String(NS_COUNTS.p2)} />
        <StatCard
          label="进度 · 已批 / 已点亮"
          value={`${NS_COUNTS.approved} / ${NS_COUNTS.lit}`}
        />
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {NS_ZONES.map((zone) => {
          const pages = nsPagesByZone(zone.slug);
          return (
            <section
              key={zone.slug}
              id={`zone-${zone.slug}`}
              className="scroll-mt-6 rounded-[18px] border border-border bg-card p-6"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground">
                  {zone.ordinal}
                </span>
                <h2 className="text-lg leading-6 font-semibold text-foreground">{zone.name}</h2>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {pages.length} 页
                </span>
              </div>
              <div className="mt-3 flex flex-col">
                {pages.map((p) => (
                  <Link
                    key={p.path}
                    href={p.path}
                    className="group -mx-2 flex items-center gap-2 rounded-[10px] px-2 py-2 hover:bg-accent"
                  >
                    <span
                      className={cn(
                        "inline-flex h-5 w-9 shrink-0 items-center justify-center rounded-full font-mono text-[10px] leading-none font-medium tracking-[0.06em]",
                        p.priority === "P0" && "bg-secondary text-foreground",
                        p.priority === "P1" && "border border-border bg-card text-muted-foreground",
                        p.priority === "P2" && "border border-border text-muted-foreground/80",
                        p.priority === "降级" && "border border-dashed border-border text-muted-foreground/60",
                      )}
                    >
                      {p.priority}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {p.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.purpose}
                      </span>
                    </span>
                    <span className="shrink-0">{statusBadge(p)}</span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

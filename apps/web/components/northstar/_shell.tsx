"use client";

/**
 * 北极星原型 — 全城外壳(顶栏 + 左轨 + 内容 + 常驻 dock)
 *
 * design-rules v3:§L4 轨 240 / §N2-N3 导航行状态(hover=accent、active=secondary+600、
 * 导航零 coral)/ §L1 一 pane 一滚动 / §8d dock 常驻(Otto home 除外,§O3)。
 * 顶栏永远标「北极星原型 · 设计稿」,防止误认为产品。
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map as MapIcon, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { NS_COUNTS, NS_PAGES, NS_ZONES, nsPagesByZone, type NsPage } from "./_registry";
import { OttoDock } from "./_shared";

function PriorityChip({ page }: { page: NsPage }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {page.status === "stub" && (
        <span className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground/70">
          未建
        </span>
      )}
      <span
        className={cn(
          "inline-flex h-4 items-center rounded-full border px-1.5 font-mono text-[10px] leading-none font-medium tracking-[0.06em]",
          page.priority === "P0" && "border-transparent bg-secondary text-foreground",
          page.priority === "P1" && "border-border bg-card text-muted-foreground",
          page.priority === "P2" && "border-border bg-transparent text-muted-foreground/80",
          page.priority === "降级" && "border-dashed border-border bg-transparent text-muted-foreground/60",
        )}
      >
        {page.priority}
      </span>
    </span>
  );
}

export function NorthstarShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Otto home:dock 隐藏(§O3 — Otto 的全身就是这张页)
  const hideDock = pathname === "/northstar/global/otto-chat";

  return (
    <div className="gb flex h-dvh flex-col bg-background text-foreground">
      {/* 顶栏:身份标记,永远可见 */}
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <TriangleAlert className="size-4 text-warning" strokeWidth={2} />
        <span className="text-sm font-semibold">北极星原型 · 设计稿</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          可点、不通电 — 全部数据为示例,不是产品
        </span>
        <span className="ml-auto font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
          {NS_COUNTS.total} 页 · 已批 {NS_COUNTS.approved} · 已点亮 {NS_COUNTS.lit}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左轨:14 区 → 57 页 */}
        <nav className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border px-3 py-4">
          <Link
            href="/northstar"
            className={cn(
              "flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px]",
              pathname === "/northstar"
                ? "bg-secondary font-semibold text-foreground"
                : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            aria-current={pathname === "/northstar" ? "page" : undefined}
          >
            <MapIcon className="size-[18px]" strokeWidth={2} />
            全城地图
          </Link>

          {NS_ZONES.map((zone) => (
            <div key={zone.slug} className="mt-4">
              <div className="px-3 pb-1 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                {zone.ordinal} {zone.name}
              </div>
              {nsPagesByZone(zone.slug).map((p) => {
                const active = pathname === p.path;
                return (
                  <Link
                    key={p.path}
                    href={p.path}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-8 items-center gap-2 rounded-[10px] px-3 py-1 text-[13px]",
                      active
                        ? "bg-secondary font-semibold text-foreground"
                        : "font-normal text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span className="min-w-0 truncate">{p.title}</span>
                    <PriorityChip page={p} />
                  </Link>
                );
              })}
            </div>
          ))}

          <div className="mt-6 border-t border-border px-3 pt-3 pb-2 text-[11px] leading-[16px] text-muted-foreground/80">
            法律:design-rules v3 · PROGRAM.md · PAGE-INVENTORY.md。
            prod 无 NORTHSTAR_PREVIEW=1 时本区 404。
          </div>
        </nav>

        {/* 内容 pane:唯一滚动所有者 */}
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      {!hideDock && <OttoDock />}
    </div>
  );
}

/** 供总目录页复用的注册表统计(避免重复计算口径) */
export function nsProgress() {
  return {
    ...NS_COUNTS,
    byZone: NS_ZONES.map((z) => ({
      zone: z,
      pages: NS_PAGES.filter((p) => p.zoneSlug === z.slug),
    })),
  };
}

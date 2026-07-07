"use client";

/**
 * 北极星原型 · 全局横切区 — 产品主导航轨(§N2 六区解剖,240 桌面 / 280 抽屉)
 *
 * 六区固定顺序:① Brand ② New(INK)③ History(campaign + 嵌套会话)
 * ④ Workspace tools(Create → Assets → Operate 分组税则,来自 #129)
 * ⑤ Balance(钉底,上有 hairline)⑥ Identity。
 * 行状态 = §N3 单一状态系统:hover=--accent,active=--secondary+600,导航零 coral。
 * 轨内 coral 恰好三处(§N2):brand 云标 · 6px Otto 活动点 · 14px credit 币。
 */

import * as React from "react";
import {
  BookOpen,
  CalendarDays,
  Compass,
  Folder,
  Frame,
  Library,
  LayoutTemplate,
  PanelLeftClose,
  Plug,
  Plus,
  Settings,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { NS_BRAND, NS_CAMPAIGN, NS_CHAT_THREADS } from "./_data";

export interface RailTool {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const RAIL_GROUPS: { label: string; tools: RailTool[] }[] = [
  {
    label: "Create",
    tools: [
      { id: "canvas", label: "Canvas", icon: Frame },
      { id: "library", label: "Library", icon: Library },
      { id: "templates", label: "Templates", icon: LayoutTemplate },
      { id: "discover", label: "Discover", icon: Compass },
    ],
  },
  {
    label: "Assets",
    tools: [
      { id: "my-stuff", label: "My stuff", icon: Folder },
      { id: "brand-memory", label: "Brand memory", icon: BookOpen },
    ],
  },
  {
    label: "Operate",
    tools: [
      { id: "schedule", label: "Schedule", icon: CalendarDays },
      { id: "analytics", label: "Analytics", icon: TrendingUp },
      { id: "connections", label: "Connections", icon: Plug },
      { id: "account", label: "Account", icon: Settings },
    ],
  },
];

function ToolRow({
  tool,
  active,
  onSelect,
}: {
  tool: RailTool;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const Icon = tool.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(tool.id)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-[10px] px-3 text-[13px] transition-colors duration-[120ms]",
        active
          ? "bg-secondary font-semibold text-foreground"
          : "font-normal text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={2} />
      <span className="min-w-0 truncate">{tool.label}</span>
    </button>
  );
}

export function ProductRail({
  activeId,
  onSelect,
  onCollapse,
  className,
}: {
  activeId: string;
  onSelect: (id: string) => void;
  onCollapse?: () => void;
  className?: string;
}) {
  return (
    <nav className={cn("flex h-full w-60 shrink-0 flex-col border-r border-border bg-background", className)}>
      {/* ① Brand */}
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-4">
        <OttoAvatar size={26} mood="idle" />
        <span className="text-[17px] font-bold tracking-[-0.01em] text-foreground">FIKIRTIVE</span>
        <div className="flex-1" />
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse sidebar"
            className="flex size-7 items-center justify-center rounded-[8px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
          >
            <PanelLeftClose className="size-4" strokeWidth={2} />
          </button>
        )}
      </div>

      {/* ② New(唯一主动作;INK,永不 coral 阴影) */}
      <div className="px-3 pb-2">
        <Button size="sm" className="w-full shadow-none">
          <Plus strokeWidth={2.5} />
          New
        </Button>
      </div>

      {/* ③④ 滚动区:History + 工具三组 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        <div className="px-3 pt-3 pb-1 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          History
        </div>
        <button
          type="button"
          className="flex h-9 w-full items-center gap-2 rounded-[10px] px-3 text-sm font-semibold text-foreground transition-colors duration-[120ms] hover:bg-accent"
        >
          <span className="min-w-0 truncate">{NS_CAMPAIGN.name}</span>
        </button>
        {NS_CHAT_THREADS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-[10px] py-1 pr-3 pl-6 text-[13px] font-normal text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
          >
            <span className="min-w-0 truncate">{t.title}</span>
            {/* 6px Otto 活动点:Otto 正在这条 thread 里干活(轨内 coral 之二) */}
            {i === 0 && <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-brand" />}
          </button>
        ))}

        {RAIL_GROUPS.map((g) => (
          <div key={g.label} className="mt-4">
            <div className="px-3 pb-1 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {g.label}
            </div>
            {g.tools.map((tool) => (
              <ToolRow key={tool.id} tool={tool} active={tool.id === activeId} onSelect={onSelect} />
            ))}
          </div>
        ))}
      </div>

      {/* ⑤ Balance(钉底;14px coral credit 币 = 轨内 coral 之三) */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
        <span aria-hidden className="size-3.5 shrink-0 rounded-full bg-brand" />
        <span className="text-[13px] leading-[18px] font-medium text-foreground tabular-nums">
          {NS_BRAND.creditBalance.toLocaleString("en-MY")} credits
        </span>
        <button type="button" className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground">
          Top up
        </button>
      </div>

      {/* ⑥ Identity */}
      <div className="flex shrink-0 items-center gap-2.5 border-t border-border px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
          AR
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] leading-[18px] font-medium text-foreground">{NS_BRAND.owner}</p>
          <p className="truncate text-xs leading-4 text-muted-foreground">{NS_BRAND.email}</p>
        </div>
      </div>
    </nav>
  );
}

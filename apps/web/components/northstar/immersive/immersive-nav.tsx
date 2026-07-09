"use client";

/**
 * 北极星 · 沉浸式产品导航(persistent app nav)
 *
 * 这是产品级导航,不是画廊的 57 项 P0/P1 目录轨:六区解剖(§N2)固定顺序 —
 * ① Brand ② New(INK 唯一主动作)③ History(campaign + 嵌套会话)
 * ④ 工具三组(Create → Assets → Operate,#129 分组税则)⑤ Balance ⑥ Identity。
 * 行状态 = §N3 单一状态系统:hover=--accent,active=--secondary+600,导航零 coral。
 * 每行是真 <Link>,点了在沉浸式路由间平滑流转。
 *
 * 复用:结构照抄 components/northstar/global/product-rail.tsx(那版吃 onSelect 回调,
 * 这版换成路由 <Link>,让页面真正连起来)。
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  Compass,
  Folder,
  Frame,
  Library,
  LayoutTemplate,
  Plug,
  Plus,
  Settings,
  Sparkles,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { NS_BRAND, NS_CAMPAIGN, NS_CHAT_THREADS } from "@/components/northstar/global/_data";
import { balance, useStore } from "./_store";

const BASE = "/northstar-immersive";

interface NavTool {
  label: string;
  icon: LucideIcon;
  href: string;
}

/** 工具三组(Create → Assets → Operate);href 指向沉浸式路由。 */
export const NAV_GROUPS: { label: string; tools: NavTool[] }[] = [
  {
    label: "Create",
    tools: [
      { label: "Canvas", icon: Frame, href: `${BASE}/create/canvas` },
      { label: "Storyboard", icon: Sparkles, href: `${BASE}/create/storyboard` },
      { label: "Library", icon: Library, href: `${BASE}/assets/library` },
      { label: "Templates", icon: LayoutTemplate, href: `${BASE}/assets/templates` },
      { label: "Discover", icon: Compass, href: `${BASE}/assets/discover` },
    ],
  },
  {
    label: "Assets",
    tools: [
      { label: "My stuff", icon: Folder, href: `${BASE}/assets/my-stuff` },
      { label: "Brand memory", icon: BookOpen, href: `${BASE}/assets/brand-memory` },
    ],
  },
  {
    label: "Operate",
    tools: [
      { label: "Schedule", icon: CalendarDays, href: `${BASE}/schedule/plan` },
      { label: "Analytics", icon: TrendingUp, href: `${BASE}/analytics/overview` },
      { label: "Campaigns", icon: Sparkles, href: `${BASE}/campaign/proposal-card` },
      { label: "Contacts", icon: Users, href: `${BASE}/crm/contacts` },
      { label: "Connections", icon: Plug, href: `${BASE}/account/connections` },
      { label: "Account", icon: Settings, href: `${BASE}/account/settings` },
    ],
  },
];

function ToolRow({ tool, active }: { tool: NavTool; active: boolean }) {
  const Icon = tool.icon;
  return (
    <Link
      href={tool.href}
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
    </Link>
  );
}

export function ImmersiveNav({ className }: { className?: string }) {
  const pathname = usePathname();
  useStore();
  const bal = balance();
  // 余额变动(充值/花费)时短暂高亮,让「钱包统一」在导航栏可见地跳动
  const [flash, setFlash] = React.useState(false);
  const prevBal = React.useRef(bal);
  React.useEffect(() => {
    if (prevBal.current === bal) return;
    prevBal.current = bal;
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 900);
    return () => window.clearTimeout(t);
  }, [bal]);
  return (
    <nav className={cn("flex h-full w-60 shrink-0 flex-col border-r border-border bg-background", className)}>
      {/* ① Brand — 回沉浸式首页 */}
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-4">
        <Link href={BASE} className="flex items-center gap-2" aria-label="FIKIRTIVE home">
          <OttoAvatar size={26} mood="idle" />
          <span className="text-[17px] font-bold tracking-[-0.01em] text-foreground">FIKIRTIVE</span>
        </Link>
      </div>

      {/* ② New(唯一主动作;INK)→ 创作首页 */}
      <div className="px-3 pb-2">
        <Button asChild size="sm" className="w-full shadow-none">
          <Link href={`${BASE}/create/home`}>
            <Plus strokeWidth={2.5} />
            New
          </Link>
        </Button>
      </div>

      {/* ③④ 滚动区:History + 工具三组 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        <div className="px-3 pt-3 pb-1 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          History
        </div>
        <Link
          href={`${BASE}/campaign/proposal-card`}
          className="flex h-9 w-full items-center gap-2 rounded-[10px] px-3 text-sm font-semibold text-foreground transition-colors duration-[120ms] hover:bg-accent"
        >
          <span className="min-w-0 truncate">{NS_CAMPAIGN.name}</span>
        </Link>
        {NS_CHAT_THREADS.map((t, i) => (
          <Link
            key={t.id}
            href={`${BASE}/otto?thread=${t.id}`}
            className="flex h-8 w-full items-center gap-2 rounded-[10px] py-1 pr-3 pl-6 text-[13px] font-normal text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
          >
            <span className="min-w-0 truncate">{t.title}</span>
            {i === 0 && <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-brand" />}
          </Link>
        ))}

        {NAV_GROUPS.map((g) => (
          <div key={g.label} className="mt-4">
            <div className="px-3 pb-1 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {g.label}
            </div>
            {g.tools.map((tool) => (
              <ToolRow key={tool.href} tool={tool} active={pathname === tool.href} />
            ))}
          </div>
        ))}
      </div>

      {/* ⑤ Balance(钉底;14px coral credit 币) */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
        <span aria-hidden className="size-3.5 shrink-0 rounded-full bg-brand" />
        <span
          className={cn(
            "rounded-md px-1 text-[13px] leading-[18px] font-medium tabular-nums transition-colors duration-700",
            flash ? "bg-success-soft text-success-soft-foreground" : "text-foreground",
          )}
        >
          {bal.toLocaleString("en-MY")} credits
        </span>
        <Link
          href={`${BASE}/account/top-up`}
          className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          Top up
        </Link>
      </div>

      {/* ⑥ Identity */}
      <Link
        href={`${BASE}/account/settings`}
        className="flex shrink-0 items-center gap-2.5 border-t border-border px-4 py-3 transition-colors duration-[120ms] hover:bg-accent"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
          AR
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] leading-[18px] font-medium text-foreground">{NS_BRAND.owner}</p>
          <p className="truncate text-xs leading-4 text-muted-foreground">{NS_BRAND.email}</p>
        </div>
      </Link>
    </nav>
  );
}

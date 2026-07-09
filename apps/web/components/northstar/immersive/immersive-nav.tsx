"use client";

/**
 * 北极星 · 沉浸式产品导航(persistent app nav)
 *
 * D1 新 IA(ENDGAME-CITY-ORDER §D1):老板脑子里只有三样东西 —— 我在办的事(Campaign)、
 * 我随手做的东西(Studio)、我的员工(Otto)。导航废除 HISTORY 分组、Projects 树、任何第三种
 * 收纳容器。组 = 首页 · Studio · Campaigns · 排期 · 收件箱 · CRM · 分析 · 资产 · 设置;
 * Otto 入口 = 右下常驻 dock(不入 nav);Balance 钉底。路由**保持现有路径**,只改组织。
 *
 * 行状态 = §N3 单一状态系统:hover=--accent,active=--secondary+600,导航零 coral。
 * 每行是真 <Link>,点了在沉浸式路由间平滑流转。Create 是唯一 INK 主按钮 → Studio canvas。
 */

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Bell,
  Bot,
  BookOpen,
  CalendarDays,
  Clapperboard,
  Compass,
  Contact,
  CreditCard,
  Factory,
  FileBarChart,
  Folder,
  Frame,
  Home,
  Inbox,
  LayoutGrid,
  LayoutTemplate,
  Library,
  Lightbulb,
  Megaphone,
  Palette,
  Plug,
  Plus,
  Search,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  UsersRound,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { NS_BRAND } from "@/components/northstar/global/_data";
import { balance, pendingApprovals, useStore } from "./_store";

const BASE = "/northstar-immersive";

interface NavItem {
  label: string;
  icon: LucideIcon;
  href: string;
}

/** 一段导航:单行(lone destination)或带标题的组(§组内多页)。 */
type NavSection =
  | { kind: "item"; item: NavItem }
  | { kind: "group"; label: string; items: NavItem[] };

/**
 * D1 IA 固定顺序:首页 · Studio · Campaigns · 排期 · 收件箱 · CRM · 分析 · 资产 · 设置。
 * 单页区是一行;多页区是一组(组内路由保持现有路径)。
 */
export const NAV_SECTIONS: NavSection[] = [
  { kind: "item", item: { label: "Home", icon: Home, href: BASE } },
  {
    kind: "group",
    label: "Studio",
    items: [
      { label: "Canvas", icon: Frame, href: `${BASE}/create/canvas` },
      { label: "Storyboard", icon: Clapperboard, href: `${BASE}/create/storyboard` },
      { label: "Factory", icon: Factory, href: `${BASE}/create/factory` },
      { label: "Ideas", icon: Lightbulb, href: `${BASE}/create/ideas` },
      { label: "Create home", icon: LayoutGrid, href: `${BASE}/create/home` },
    ],
  },
  {
    kind: "group",
    label: "Campaigns",
    items: [
      { label: "Campaigns", icon: Megaphone, href: `${BASE}/campaign/list` },
      { label: "Trends", icon: TrendingUp, href: `${BASE}/campaign/trends` },
    ],
  },
  { kind: "item", item: { label: "Schedule", icon: CalendarDays, href: `${BASE}/schedule/plan` } },
  { kind: "item", item: { label: "Inbox", icon: Inbox, href: `${BASE}/inbox/shared` } },
  { kind: "item", item: { label: "CRM", icon: Users, href: `${BASE}/crm/contacts` } },
  {
    kind: "group",
    label: "Analytics",
    items: [
      { label: "Overview", icon: BarChart3, href: `${BASE}/analytics/overview` },
      { label: "Reports", icon: FileBarChart, href: `${BASE}/analytics/reports` },
      { label: "AI visibility", icon: Bot, href: `${BASE}/analytics/aeo` },
      { label: "Ads", icon: Target, href: `${BASE}/ads/performance` },
    ],
  },
  {
    kind: "group",
    label: "Assets",
    items: [
      { label: "My stuff", icon: Folder, href: `${BASE}/assets/my-stuff` },
      { label: "Library", icon: Library, href: `${BASE}/assets/library` },
      { label: "Templates", icon: LayoutTemplate, href: `${BASE}/assets/templates` },
      { label: "Discover", icon: Compass, href: `${BASE}/assets/discover` },
      { label: "Brand memory", icon: BookOpen, href: `${BASE}/assets/brand-memory` },
      { label: "Brand kit", icon: Palette, href: `${BASE}/assets/brand-kit` },
      { label: "Cast", icon: Contact, href: `${BASE}/assets/cast` },
    ],
  },
  {
    kind: "group",
    label: "Settings",
    items: [
      { label: "Account", icon: Settings, href: `${BASE}/account/settings` },
      { label: "Credits", icon: CreditCard, href: `${BASE}/account/credits` },
      { label: "Connections", icon: Plug, href: `${BASE}/account/connections` },
      { label: "Wallet", icon: Wallet, href: `${BASE}/account/channel-wallet` },
      { label: "Automation", icon: Sparkles, href: `${BASE}/automation/recipes` },
      { label: "Team", icon: UsersRound, href: `${BASE}/team/members` },
    ],
  },
];

function ToolRow({ tool, active }: { tool: NavItem; active: boolean }) {
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

const SEARCH_HREF = `${BASE}/global/search`;
const NOTIFICATIONS_HREF = `${BASE}/global/notifications`;

/** Home 行 active 判定:只有精确落在 BASE 时高亮(避免所有子路由都点亮首页)。 */
function isActive(href: string, pathname: string): boolean {
  if (href === BASE) return pathname === BASE || pathname === `${BASE}/`;
  return pathname === href;
}

export function ImmersiveNav({
  className,
  mobileOpen = false,
  onCloseMobile,
}: {
  className?: string;
  /** ≤680 抽屉形态:外壳注入的开合态 + 关闭回调(§L4)。桌面(>680)常驻栏忽略这两项。 */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  useStore();
  const bal = balance();
  const pendingCount = pendingApprovals().length;

  // 全局搜索快捷键:⌘K / Ctrl-K 从任意路由打开搜索面板(与搜索图标同一目的地)。
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        router.push(SEARCH_HREF);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
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
    <nav
      className={cn(
        "flex h-full w-60 shrink-0 flex-col border-r border-border bg-background",
        // §L4:≤680 脱离流成 280 抽屉(fixed 覆盖 + translate 滑入/出);>680 保持 240 常驻栏。
        "max-[680px]:fixed max-[680px]:inset-y-0 max-[680px]:left-0 max-[680px]:z-[80] max-[680px]:w-[280px] max-[680px]:shadow-[var(--shadow-xl)] max-[680px]:transition-transform max-[680px]:duration-200 motion-reduce:max-[680px]:transition-none",
        mobileOpen ? "max-[680px]:translate-x-0" : "max-[680px]:-translate-x-full",
        className,
      )}
    >
      {/* ① Brand — 回沉浸式首页 + 全局搜索 / 通知铃铛 */}
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-4">
        <Link href={BASE} className="flex min-w-0 items-center gap-2" aria-label="FIKIRTIVE home">
          <OttoAvatar size={26} mood="idle" />
          <span className="truncate text-[17px] font-bold tracking-[-0.01em] text-foreground">FIKIRTIVE</span>
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Link
            href={SEARCH_HREF}
            aria-label="Search (⌘K)"
            title="Search — ⌘K"
            aria-current={pathname === SEARCH_HREF ? "page" : undefined}
            className={cn(
              "flex size-8 items-center justify-center rounded-[10px] transition-colors duration-[120ms]",
              pathname === SEARCH_HREF
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Search className="size-[18px]" strokeWidth={2} />
          </Link>
          <Link
            href={NOTIFICATIONS_HREF}
            aria-label={pendingCount > 0 ? `Notifications, ${pendingCount} to review` : "Notifications"}
            title="Notifications"
            aria-current={pathname === NOTIFICATIONS_HREF ? "page" : undefined}
            className={cn(
              "relative flex size-8 items-center justify-center rounded-[10px] transition-colors duration-[120ms]",
              pathname === NOTIFICATIONS_HREF
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Bell className="size-[18px]" strokeWidth={2} />
            {pendingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] leading-4 font-semibold text-background tabular-nums ring-2 ring-background">
                {pendingCount > 9 ? "9+" : pendingCount}
              </span>
            )}
          </Link>
          {/* §L4:抽屉形态的显式关闭键,只在 ≤680 出现;桌面常驻栏隐藏。 */}
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close menu"
            className="flex size-8 items-center justify-center rounded-[10px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground min-[681px]:hidden"
          >
            <X className="size-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* ② Create(唯一主动作;INK)→ Studio canvas(自由创作台的家) */}
      <div className="px-3 pb-2">
        <Button asChild size="sm" className="w-full shadow-none">
          <Link href={`${BASE}/create/canvas`}>
            <Plus strokeWidth={2.5} />
            Create
          </Link>
        </Button>
      </div>

      {/* ③ 滚动区:D1 九段 IA(零 HISTORY 分组) */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-2">
        {NAV_SECTIONS.map((section, i) =>
          section.kind === "item" ? (
            <div key={section.item.href} className={i === 0 ? undefined : "mt-1"}>
              <ToolRow tool={section.item} active={isActive(section.item.href, pathname)} />
            </div>
          ) : (
            <div key={section.label} className="mt-4">
              <div className="px-3 pb-1 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                {section.label}
              </div>
              {section.items.map((tool) => (
                <ToolRow key={tool.href} tool={tool} active={isActive(tool.href, pathname)} />
              ))}
            </div>
          ),
        )}
      </div>

      {/* ④ Balance(钉底;14px coral credit 币) */}
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

      {/* ⑤ Identity */}
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

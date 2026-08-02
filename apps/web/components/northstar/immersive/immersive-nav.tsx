"use client";

/**
 * 北极星 · 沉浸式产品导航(persistent app nav)
 *
 * #609(2026-08-02 Founder 逐页裁决 · 父规格 #599):创作版只开**六扇门** ——
 * Home · Canvas · Library · 品牌与商品资料 · 买积分账单 · 设置。原来的九段 IA 里有 22 条
 * 指向从未建过的路由,点开只有 404;它们连同分组标题一起消失。留下的六条每一条都通向仓库里
 * 真实存在的页面:两扇留在壳内(Home / Canvas),四扇通向线上产品本体。
 *
 * 身份栏读的是**登录进来的这个人**(名 + 邮箱由外壳从认证会话喂进来,见
 * components/canvas/NorthstarShellEntry.tsx)。写死的样板余额与 Top up 一并拆除 ——
 * 价格只在方案点头时与账单页出现。
 *
 * 行状态 = §N3 单一状态系统:hover=--accent,active=--secondary+600,导航零 coral。
 * 每行是真 <Link>;零后台 import(围栏见 scripts/check-northstar-imports.sh)。
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CreditCard,
  Frame,
  Home,
  Library,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OttoAvatar } from "@/components/otto/OttoAvatar";

const BASE = "/northstar-immersive";

interface NavDoor {
  label: string;
  icon: LucideIcon;
  href: string;
}

/**
 * 六扇门,顺序即裁决顺序。
 *
 * Library / 品牌与商品资料 / 设置 指向线上产品本体的真实现(Otto 的素材库、品牌记忆、
 * 账户设置);买积分账单指向 /billing。它们不是壳内路由,所以点开会离开这层壳 ——
 * 那正是「指向真页面」的意思:壳不再自建第二套同名的假页。
 */
export const NAV_DOORS: readonly NavDoor[] = [
  { label: "Home", icon: Home, href: BASE },
  { label: "Canvas", icon: Frame, href: `${BASE}/create/canvas` },
  { label: "Library", icon: Library, href: "/otto?view=library" },
  { label: "Brand & products", icon: BookOpen, href: "/otto?view=memory" },
  { label: "Credits & billing", icon: CreditCard, href: "/billing" },
  { label: "Settings", icon: Settings, href: "/otto?view=account" },
];

export interface ShellIdentity {
  /** 商家自己的名字(没设过就退回工作区名 / 邮箱;由外壳解析好再传进来) */
  name: string;
  email: string;
}

function DoorRow({ door, active }: { door: NavDoor; active: boolean }) {
  const Icon = door.icon;
  return (
    <Link
      href={door.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-[10px] px-3 text-[13px] transition-colors duration-[120ms]",
        active
          ? "bg-secondary font-semibold text-foreground"
          : "font-normal text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={2} />
      <span className="min-w-0 truncate">{door.label}</span>
    </Link>
  );
}

/** Home 行只在精确落在 BASE 时高亮;壳外的四扇门 pathname 永不相等,不参与高亮。 */
function isActive(href: string, pathname: string): boolean {
  if (href === BASE) return pathname === BASE || pathname === `${BASE}/`;
  return pathname === href;
}

/** 名字的首字母块(没名字就不渲染缩写,不编造)。 */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function ImmersiveNav({
  className,
  identity,
  mobileOpen = false,
  onCloseMobile,
}: {
  className?: string;
  /** 登录进来的这个人;未登录(如 onboarding/login)传 null —— 壳不冒充任何人。 */
  identity: ShellIdentity | null;
  /** ≤680 抽屉形态:外壳注入的开合态 + 关闭回调(§L4)。桌面(>680)常驻栏忽略这两项。 */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}) {
  const pathname = usePathname();

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
      {/* ① Brand — 回首页(与第一扇门同一目的地) */}
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-4">
        <Link href={BASE} className="flex min-w-0 items-center gap-2" aria-label="FIKIRTIVE home">
          <OttoAvatar size={26} mood="idle" />
          <span className="truncate text-[17px] font-bold tracking-[-0.01em] text-foreground">FIKIRTIVE</span>
        </Link>
        {/* §L4:抽屉形态的显式关闭键,只在 ≤680 出现;桌面常驻栏隐藏。 */}
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close menu"
          className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground min-[681px]:hidden"
        >
          <X className="size-[18px]" strokeWidth={2} />
        </button>
      </div>

      {/* ② 六扇门 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-2">
        {NAV_DOORS.map((door, i) => (
          <div key={door.href} className={i === 0 ? undefined : "mt-1"}>
            <DoorRow door={door} active={isActive(door.href, pathname)} />
          </div>
        ))}
      </div>

      {/* ③ 身份栏 —— 真登录用户。未登录只给一条回登录页的路,不摆任何名字。 */}
      {identity ? (
        <div className="flex shrink-0 items-center gap-2.5 border-t border-border px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
            {initialsOf(identity.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] leading-[18px] font-medium text-foreground">{identity.name}</p>
            <p className="truncate text-xs leading-4 text-muted-foreground">{identity.email}</p>
          </div>
        </div>
      ) : (
        <div className="shrink-0 border-t border-border px-4 py-3">
          <Link href="/login" className="text-[13px] font-medium text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
        </div>
      )}
    </nav>
  );
}

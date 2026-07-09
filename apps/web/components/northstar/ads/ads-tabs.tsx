"use client";

/**
 * 广告区三页子导航(performance / builder / multi-platform)。
 *
 * 常驻 nav 的「Ads」只落到 performance;builder 和 multi-platform 没有 nav 项,
 * 只能靠这条 tab 从 performance 到达(否则等于隐形)。href 走 /northstar/*,
 * 沉浸式外壳的 useKeepInsideImmersive 会自动改跳沉浸式路由 —— 两种上下文都可达。
 * active 用 endsWith 判(独立画廊路由与沉浸式路由都高亮正确)。
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "performance", label: "Performance", href: "/northstar/ads/performance" },
  { key: "builder", label: "Builder", href: "/northstar/ads/builder" },
  { key: "multi-platform", label: "Platforms", href: "/northstar/ads/multi-platform" },
] as const;

export function AdsTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Ads"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5",
        className,
      )}
    >
      {TABS.map((t) => {
        const active = pathname?.endsWith(`/ads/${t.key}`) ?? false;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-[30px] items-center rounded-[8px] px-3 text-xs font-semibold transition-colors duration-[120ms]",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

/**
 * 北极星 · 沉浸式「分析 · 广告」组(analytics-ads)—— 区专属件。
 *
 * 这一组把画廊里的 analytics/* + ads/* 五页原生重建进常驻壳(ENDGAME §D 金标准 +
 * §五广告契约)。共享展示原语从既有单一源复用,本文件只留区专属的两组段控子导航 +
 * §D 的 PinnedHeader(List archetype:pane 滚、header 钉;空/错/未连接墙住 body)。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto;credits 永远是 credits;
 * 图片只从 NS_IMAGES(本组不直接取图,复用组件走既有口径)。
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { IMMERSIVE_BASE } from "../_kit";

const BASE = IMMERSIVE_BASE;
export const ANALYTICS_ADS_BASE = BASE;

/* ── 分析组子导航(Overview · Reports · Ads;§N4 段控) ─────────────────────────
 * IA:导航「Analytics」组内 = Overview · Reports · Ads。Ads 落到 performance(其余
 * 两页靠 AdsNav 到达)。active 用 startsWith 判(Ads 高亮覆盖 performance/builder/platforms)。 */
const ANALYTICS_VIEWS = [
  { href: `${BASE}/analytics/overview`, label: "Overview", match: (p: string) => p === `${BASE}/analytics/overview` },
  { href: `${BASE}/analytics/reports`, label: "Reports", match: (p: string) => p === `${BASE}/analytics/reports` },
  { href: `${BASE}/ads/performance`, label: "Ads", match: (p: string) => p.startsWith(`${BASE}/ads/`) },
] as const;

const ADS_VIEWS = [
  { href: `${BASE}/ads/performance`, label: "Performance" },
  { href: `${BASE}/ads/builder`, label: "Builder" },
  { href: `${BASE}/ads/multi-platform`, label: "Platforms" },
] as const;

function SegLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[30px] items-center rounded-[8px] px-3 text-xs font-semibold transition-colors duration-[120ms]",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}

/** 分析组子导航(Overview · Reports · Ads)。 */
export function AnalyticsNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Analytics" className="inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5">
      {ANALYTICS_VIEWS.map((v) => (
        <SegLink key={v.href} href={v.href} label={v.label} active={v.match(pathname)} />
      ))}
    </nav>
  );
}

/** 广告三页子导航(Performance · Builder · Platforms;常驻 nav 无 Ads 子项,靠它到达)。 */
export function AdsNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Ads" className="inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5">
      {ADS_VIEWS.map((v) => (
        <SegLink key={v.href} href={v.href} label={v.label} active={pathname === v.href} />
      ))}
    </nav>
  );
}

/* ── PinnedHeader — §D/§L List archetype:header 永远渲染并钉在滚动 pane 顶部 ────
 * main 是唯一滚动所有者(immersive-shell);sticky top-0 让页头在 body 滚动时钉住,
 * 空/错/未连接墙住 body 时页头仍在(§D1⑤ states live in the body, header always renders)。 */
export function PinnedHeader({
  title,
  meta,
  nav,
  actions,
  provenance,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  /** 段控子导航(AnalyticsNav / AdsNav)。 */
  nav?: React.ReactNode;
  /** 右侧动作(平台切换器 / 日期区间 / Submit 等)。 */
  actions?: React.ReactNode;
  /** 出处印章行(via Meta · read-only 等);nav 同排右侧。 */
  provenance?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-30 border-b border-border bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="truncate text-2xl leading-[30px] font-bold tracking-[-0.02em] text-foreground">{title}</h1>
          {meta}
          <div className="flex-1" />
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {(nav || provenance || children) && (
          <div className="flex flex-wrap items-center gap-2">
            {nav}
            {provenance}
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/** 读面 body 容器:居中到宽度梯(§L3 默认 880),给 pane 底部留白。 */
export function ZoneBody({
  children,
  width = 880,
  className,
}: {
  children: React.ReactNode;
  width?: number;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full px-6 pt-5 pb-24", className)} style={{ maxWidth: width }}>
      {children}
    </div>
  );
}

/** 墙住 body 的整屏态(空/错/未连接;idle Otto 由调用方决定是否放)。§D1⑤ 住 body 不占页头。 */
export function StateWall({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mt-5 flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card px-6 py-14 text-center">
      {icon}
      <div className="text-[22px] leading-[28px] font-bold tracking-[-0.02em] text-foreground">{title}</div>
      <p className="max-w-[380px] text-[13px] leading-[18px] text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

"use client";

/**
 * 北极星 · 沉浸式共享 kit(the one immersive kit)
 *
 * 全城一套共享原语。此前 account-ops/kit.tsx 与 crm-inbox/kit.tsx 是同一批原语的
 * 复制粘贴,已开始漂移(蓝图 §3.1):两份 useSweep 各注入一个独立 keyframe、两份签名
 * 冲突的 ChannelTag、account 每页手抄 mx-auto max-w、crm 独有 ZonePage。这里把它们
 * 收成单一实现;两份区级 kit 从此 re-export 本文件,只留真正的区专属件(区级 Nav 等)。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto;动效 gate 在 prefers-reduced-motion;
 * credits 永远是 credits,对客花费不写 $;零新造 token/hex(全走 globals.css 里的 .gb token)。
 *
 * PageHeader / StatCard / EmptyState 不在这里 fork —— 从 _shared.tsx 复用(蓝图 §3.1 铁律)。
 */

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useInsideImmersive } from "./_context";

/* ── 唯一 base-path 常量(收敛 ACCOUNT_OPS_BASE + CRM_INBOX_BASE) ─────────── */
export const IMMERSIVE_BASE = "/northstar-immersive";

const GALLERY_PREFIX = "/northstar/";
const IMMERSIVE_PREFIX = "/northstar-immersive/";

/**
 * 沉浸式内的程序化导航(§流转不跳出壳)。
 *
 * 外壳的 useKeepInsideImmersive 只拦 <a> 点击、拦不到 router.push。复用的画廊页里
 * 硬编码着 `/northstar/*` 的 router.push,会把用户弹出常驻壳。这个 hook 把 push 的
 * `/northstar/*` 目标在壳内改写成 `/northstar-immersive/*`(壳外原样),泛化自
 * immersive-search 里验证过的 immersiveHref 改写。
 */
export function useImmersiveRouter(): { push: (href: string) => void } {
  const router = useRouter();
  const inside = useInsideImmersive();
  const push = React.useCallback(
    (href: string) => {
      if (inside && href.startsWith(GALLERY_PREFIX)) {
        router.push(IMMERSIVE_PREFIX + href.slice(GALLERY_PREFIX.length));
      } else {
        router.push(href);
      }
    },
    [router, inside],
  );
  return { push };
}

/**
 * 读 URL query param(prefill / 深链用),reactive。
 *
 * 走 useSearchParams 而非 window.location 快照:App Router 的 client-nav 在 URL commit 前
 * 就渲染目标页,挂载时读 window.location 会拿到上一页的 query,深链参数在 client-nav 时永远
 * 丢失(cx-canvas-runtime 定位的根因)。useSearchParams 反映当前路由 query,client-nav 过来
 * 也读得到。
 *
 * 代价:调用方必须被 <Suspense> 边界包着,否则 next build 静态生成会报错。渲染本 hook 调用方的
 * route page 都已包 Suspense(create/canvas、schedule/composer|share-preview、campaign/
 * workbench|detail、global/otto-chat)。
 */
export function useQueryParam(key: string): string | null {
  return useSearchParams().get(key);
}

/* ── 复用 _shared 的 §N6/§D3/§V4 原语(禁止 fork;home/account/crm 共用一份) ── */
export { PageHeader, StatCard, EmptyState } from "@/components/northstar/_shared";
export type { PageHeaderProps, StatCardProps, EmptyStateProps } from "@/components/northstar/_shared";

/* ── 渠道口径(全 5 渠道单一源;inbox 只传它用的 3 个) ────────────────────── */
export type NsChannel = "instagram" | "facebook" | "tiktok" | "x" | "whatsapp";

export const CHANNELS: Record<
  NsChannel,
  { short: string; label: string; handle: string; group: "meta" | "x" | "tiktok" | "whatsapp" }
> = {
  instagram: { short: "IG", label: "Instagram", handle: "@rotibulan.bakery", group: "meta" },
  facebook: { short: "FB", label: "Facebook", handle: "Roti Bulan Bakery", group: "meta" },
  x: { short: "X", label: "X", handle: "@rotibulanKL", group: "x" },
  tiktok: { short: "TT", label: "TikTok", handle: "@rotibulan", group: "tiktok" },
  whatsapp: { short: "WA", label: "WhatsApp", handle: "+60 12 345 6789", group: "whatsapp" },
};

/** 渠道 chip(§N 渠道 chip)。吃全 5 渠道;inbox 只喂它用的 3 个。 */
export function ChannelTag({ channel, className }: { channel: NsChannel; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-8 shrink-0 items-center justify-center rounded-[8px] bg-secondary font-mono text-[10px] leading-none font-medium tracking-[0.06em] text-secondary-foreground",
        className,
      )}
    >
      {CHANNELS[channel].short}
    </span>
  );
}

/* ── 确定性头像(首字母;零图片依赖) ───────────────────────────────────────── */
export function Initials({ name, className }: { name: string; className?: string }) {
  const letters = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-[13px] font-semibold text-secondary-foreground",
        className,
      )}
    >
      {letters}
    </span>
  );
}

/* ── 时间/金钱格式化(确定性,不用 locale API) ──────────────────────────────── */
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07-07T09:14:00+08:00" → "7 Jul · 9:14 am" */
export function fmtStamp(iso: string): string {
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 16);
  const [, mm, dd] = date.split("-").map(Number);
  const [h, m] = time.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${dd} ${MONTH_SHORT[mm - 1]} · ${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/** "2026-07-06" → "6 Jul" (date-only) */
export function fmtDate(iso: string): string {
  const [, mm, dd] = iso.slice(0, 10).split("-").map(Number);
  return `${dd} ${MONTH_SHORT[mm - 1]}`;
}

/** 200 (MYR) → "RM200" — 对客花费用币种;credits 另有口径 */
export function fmtMyr(n: number): string {
  return `RM${n.toLocaleString("en-MY")}`;
}

/* ── reduced motion(§A5) ──────────────────────────────────────────────────── */
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(REDUCED_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

/* ── coral sweep(§8a:一次性 ≤600ms;reduced motion = 静态描边) ──────────────
 * 单一 keyframe 全城注入一次(id + name 都是 ns-immersive-sweep),
 * 收敛了此前 account(ns-ao-sweep)/ crm(ns-ci-sweep)两份仅名字漂移的副本。 */
const SWEEP_KF_ID = "ns-immersive-sweep";
const SWEEP_KF = `@keyframes ns-immersive-sweep {
  from { box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent); background-color: color-mix(in oklab, var(--brand-soft) 60%, transparent); }
  to { box-shadow: 0 0 0 2px transparent; background-color: transparent; }
}`;
function useSweepKeyframes() {
  React.useEffect(() => {
    if (document.getElementById(SWEEP_KF_ID)) return;
    const el = document.createElement("style");
    el.id = SWEEP_KF_ID;
    el.textContent = SWEEP_KF;
    document.head.appendChild(el);
  }, []);
}

export function useSweep(): { style: React.CSSProperties | undefined; fire: () => void } {
  useSweepKeyframes();
  const reduced = useReducedMotion();
  const [active, setActive] = React.useState(false);
  const fire = React.useCallback(() => {
    setActive(true);
    window.setTimeout(() => setActive(false), 650);
  }, []);
  const style: React.CSSProperties | undefined = active
    ? reduced
      ? { boxShadow: "0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent)" }
      : { animation: "ns-immersive-sweep 600ms ease-out 1" }
    : undefined;
  return { style, fire };
}

/* ── 卡片壳(§5 flat surface;radius-card;hairline) ─────────────────────────── */
export function Card({
  className,
  children,
  style,
}: {
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cn("rounded-[18px] border border-border bg-card", className)} style={style}>
      {children}
    </div>
  );
}

/** 卡片分区标题条(§L5) */
export function CardHeader({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
      </div>
      {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
    </div>
  );
}

/* ── 区段标题(§L5:section heading → first card 12) ─────────────────────────── */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-foreground">{children}</h2>;
}

/* ── 段控子导航(§N4 segmented;active = pathname === href) ──────────────────── */
export interface SegNavView {
  href: string;
  label: string;
}

export function SegNav({ views }: { views: SegNavView[] }) {
  const pathname = usePathname();
  return (
    <div className="inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5">
      {views.map((v) => {
        const active = pathname === v.href;
        return (
          <Link
            key={v.href}
            href={v.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-[30px] items-center rounded-[8px] px-3 text-xs font-semibold transition-colors duration-[120ms]",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {v.label}
          </Link>
        );
      })}
    </div>
  );
}

/* ── 页壳(§L2/§L3:居中到一档宽度梯,default 880) ──────────────────────────── */
export function ZonePage({
  children,
  className,
  width = 880,
}: {
  children: React.ReactNode;
  className?: string;
  width?: number;
}) {
  return (
    <div
      className={cn("mx-auto flex min-h-full w-full flex-col px-6 pt-6 pb-16", className)}
      style={{ maxWidth: width }}
    >
      {children}
    </div>
  );
}

/* ── 设置行(§F7 行解剖:label + 副行 + control;whole row 44+) ──────────────── */
export function SettingRow({
  title,
  desc,
  control,
  className,
}: {
  title: string;
  desc?: string;
  control: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 border-t border-border px-4 py-3.5 first:border-t-0",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {desc && <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{desc}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

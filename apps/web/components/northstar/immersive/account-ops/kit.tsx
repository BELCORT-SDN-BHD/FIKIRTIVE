"use client";

/**
 * 北极星 · 沉浸式「账户 · 自动化 · 团队」共用件(account-ops 组)
 *
 * 这一组把三块「管账」放进常驻产品外壳:Account(设置/额度/充值/连接/渠道钱包)、
 * Automation(规则/例程)、Team(成员/审批)。gallery 里这几页还是 stub,没有可复用的
 * 内容组件 —— 所以内容在这里现建,但严格照 Fable 区(排期/分析/活动)的质量模板:
 * §N6 页头、§D3 数据卡、§D4 hairline 行、§FB7 骨架、§8a coral sweep、§V 文案口径。
 *
 * 数据规矩(照抄 schedule/kit 先例):一切派生自 _mock,不发明品牌事实 —— 连接口径取自
 * schedule PLATFORMS + NS_BRAND;额度取自 NS_CREDIT_LEDGER + NS_BRAND.creditBalance;
 * 审批取自 global NS_APPROVALS + NS_SCHEDULED_POSTS。视图模型里的结构常量(充值档位、
 * 规则/例程、团队成员)是这一组的口径,不是新品牌事实。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto;动效 gate 在 prefers-reduced-motion;
 * credits 永远是 credits,对客花费不写 $。
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const BASE = "/northstar-immersive";
export const ACCOUNT_OPS_BASE = BASE;

/* ── 平台口径(与 schedule/kit 对齐,不新建品牌事实) ──────────────────── */
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

/* ── 时间格式化(确定性,不用 locale API;与 schedule/kit 同风) ──────────── */
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

/* ── reduced motion(§A5;与 _shared / kit 同实现) ───────────────────────── */
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

/* ── coral sweep(§8a:一次性 ≤600ms;reduced motion = 静态描边) ─────────── */
const SWEEP_KF_ID = "ns-account-ops-sweep-kf";
const SWEEP_KF = `@keyframes ns-ao-sweep {
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
      : { animation: "ns-ao-sweep 600ms ease-out 1" }
    : undefined;
  return { style, fire };
}

/* ── 卡片壳(§5 flat surface;radius-card;hairline) ─────────────────────── */
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

/** 卡片分区标题条(§L5:52 高度节律的轻量版,用于卡内分组) */
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

/* ── 区段标题(§L5:section heading → first card 12) ─────────────────────── */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-foreground">{children}</h2>;
}

/* ── 账户子导航(§N4 segmented;各页各占一路由,视觉保持 segmented) ────── */
const ACCOUNT_VIEWS = [
  { href: `${BASE}/account/settings`, label: "Settings" },
  { href: `${BASE}/account/credits`, label: "Credits" },
  { href: `${BASE}/account/connections`, label: "Connections" },
  { href: `${BASE}/account/channel-wallet`, label: "Channel wallet" },
];

const AUTOMATION_VIEWS = [
  { href: `${BASE}/automation/rules`, label: "Rules" },
  { href: `${BASE}/automation/routines`, label: "Routines" },
];

const TEAM_VIEWS = [
  { href: `${BASE}/team/members`, label: "Members" },
  { href: `${BASE}/team/approvals`, label: "Approvals" },
];

function SegNav({ views }: { views: { href: string; label: string }[] }) {
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

export function AccountNav() {
  return <SegNav views={ACCOUNT_VIEWS} />;
}
export function AutomationNav() {
  return <SegNav views={AUTOMATION_VIEWS} />;
}
export function TeamNav() {
  return <SegNav views={TEAM_VIEWS} />;
}

/* ── 设置行(§F7 行解剖:control + label + 副行;whole row 44+;INK 开关) ── */
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

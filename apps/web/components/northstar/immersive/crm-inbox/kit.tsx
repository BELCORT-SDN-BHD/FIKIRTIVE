"use client";

/**
 * 北极星 · 沉浸式「CRM · 收件箱」共用件(crm-inbox 组)
 *
 * 这一组把两块「客户关系」放进常驻产品外壳:CRM(联系人/客户档案/成交/分群)与
 * Inbox(客服区/对话/评论/知识库/试驾)。gallery 里这几页还是 NsStub,没有可复用的
 * 内容组件 —— 所以内容在这里现建,但严格照 Fable 区(排期/分析/账户)的质量模板:
 * §N6 页头、§D3 数据卡、§D4 hairline 行、§N3 状态色、§8a coral sweep、§V 文案口径。
 *
 * 数据规矩(照抄 account-ops / schedule 先例):一切派生自 _mock,不发明品牌事实 ——
 * 联系人取自 NS_CONTACTS;对话取自 NS_CONVERSATIONS;成交金额取自 NS_CONTACTS.totalOrdersMyr;
 * 知识库口径取自 NS_PRODUCTS + NS_BRAND。视图模型里的结构常量(成交阶段、分群、
 * 试驾脚本)是这一组的产品口径,不是新的品牌事实。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto;动效 gate 在 prefers-reduced-motion;
 * credits 永远是 credits,对客花费不写 $。
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const BASE = "/northstar-immersive";
export const CRM_INBOX_BASE = BASE;

/* ── 渠道口径(与 account-ops / schedule 对齐,不新建品牌事实) ──────────── */
export type NsInboxChannel = "whatsapp" | "instagram" | "facebook";

export const INBOX_CHANNELS: Record<NsInboxChannel, { short: string; label: string }> = {
  whatsapp: { short: "WA", label: "WhatsApp" },
  instagram: { short: "IG", label: "Instagram" },
  facebook: { short: "FB", label: "Facebook" },
};

export function ChannelTag({ channel, className }: { channel: NsInboxChannel; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-8 shrink-0 items-center justify-center rounded-[8px] bg-secondary font-mono text-[10px] leading-none font-medium tracking-[0.06em] text-secondary-foreground",
        className,
      )}
    >
      {INBOX_CHANNELS[channel].short}
    </span>
  );
}

/* ── 头像(确定性首字母;与 avatar ui 同风,但零图片依赖) ─────────────── */
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

/* ── 时间格式化(确定性,不用 locale API;与 account-ops/kit 同风) ──────── */
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07-07T08:12:00+08:00" → "7 Jul · 8:12 am" */
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

/* ── reduced motion(§A5;与 account-ops/kit 同实现) ────────────────────── */
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
const SWEEP_KF_ID = "ns-crm-inbox-sweep-kf";
const SWEEP_KF = `@keyframes ns-ci-sweep {
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
      : { animation: "ns-ci-sweep 600ms ease-out 1" }
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

/* ── 组内子导航(§N4 segmented;各页各占一路由) ────────────────────────── */
const CRM_VIEWS = [
  { href: `${BASE}/crm/contacts`, label: "Contacts" },
  { href: `${BASE}/crm/deals`, label: "Deals" },
  { href: `${BASE}/crm/segments`, label: "Segments" },
];

const INBOX_VIEWS = [
  { href: `${BASE}/inbox/shared`, label: "Shared inbox" },
  { href: `${BASE}/inbox/comments`, label: "Comments" },
  { href: `${BASE}/inbox/knowledge`, label: "Knowledge" },
  { href: `${BASE}/inbox/test-drive`, label: "Test drive" },
];

function SegNav({ views }: { views: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <div className="inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5">
      {views.map((v) => {
        // contact-profile / conversation 是详情页,子导航高亮回它们所属的列表页
        const active =
          pathname === v.href ||
          (v.href.endsWith("/crm/contacts") && pathname.startsWith(`${BASE}/crm/contact-profile`)) ||
          (v.href.endsWith("/inbox/shared") && pathname.startsWith(`${BASE}/inbox/conversation`));
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

export function CrmNav() {
  return <SegNav views={CRM_VIEWS} />;
}
export function InboxNav() {
  return <SegNav views={INBOX_VIEWS} />;
}

/* ── 页壳(统一最大宽度 + 内边距,与 account-ops 页对齐) ────────────────── */
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

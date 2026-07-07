"use client";

/**
 * 北极星原型 · 住户服务中心 — 区内共用原语(design-rules v3)
 *
 * DemoStateBar   原型三态演示切换器(§设计审六条:空/载/错都要画)
 * Skeleton       §FB7 骨架(shimmer 1.4s;一屏最多 3 块闪)
 * ErrorPanel     §FB2/§D4 行内错误:soft 对 + ghost Retry(页头/工具条不消失)
 * SweepIn        §8a/§8b 卡片降落(人类动作 → 降落零 coral sweep;此区多为人类动作)
 * CreditCoin     §N2 14px credit 硬币(credits 是 Otto 燃料;coral 仅此一处 mark)
 *
 * 铁律:纯展示零后台;coral 只属于 Otto;动效 gate 在 prefers-reduced-motion。
 * §O3:住户服务中心无 inline Otto avatar(money/identity 是用户的决定)— dock only。
 */

import * as React from "react";
import { CircleAlert, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/* ── keyframes(注入一次) ─────────────────────────────────────────────── */
const KEYFRAMES_ID = "ns-account-keyframes";
const KEYFRAMES = `
@keyframes ns-ac-land { 0% { opacity: 0; transform: translateY(6px); } 100% { opacity: 1; transform: none; } }
@keyframes ns-ac-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.ns-ac-skeleton {
  background: linear-gradient(90deg, var(--border) 25%, var(--card) 50%, var(--border) 75%);
  background-size: 200% 100%;
  animation: ns-ac-shimmer 1.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .ns-ac-land { animation: none !important; }
  .ns-ac-skeleton { animation: none; background: var(--muted); }
}
`;

function useAccountKeyframes() {
  React.useEffect(() => {
    if (document.getElementById(KEYFRAMES_ID)) return;
    const el = document.createElement("style");
    el.id = KEYFRAMES_ID;
    el.textContent = KEYFRAMES;
    document.head.appendChild(el);
  }, []);
}

/* ── DemoStateBar — 原型三态演示切换器 ───────────────────────────────── */
export type DemoState = "normal" | "loading" | "empty" | "error";

const DEMO_STATES: { key: DemoState; label: string }[] = [
  { key: "normal", label: "正常" },
  { key: "loading", label: "加载" },
  { key: "empty", label: "空" },
  { key: "error", label: "错误" },
];

export function DemoStateBar({
  state,
  onChange,
  states = DEMO_STATES,
}: {
  state: DemoState;
  onChange: (s: DemoState) => void;
  states?: { key: DemoState; label: string }[];
}) {
  return (
    <div className="fixed bottom-4 left-1/2 z-[10] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card py-1 pr-1 pl-3 shadow-[var(--shadow-sm)]">
      <span className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground">
        三态演示
      </span>
      <div className="flex items-center gap-0.5">
        {states.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onChange(s.key)}
            aria-pressed={state === s.key}
            className={cn(
              "h-6 rounded-full px-2 text-[11px] leading-none font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              state === s.key
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Skeleton — §FB7 ─────────────────────────────────────────────────── */
export function Skeleton({ shimmer = false, className }: { shimmer?: boolean; className?: string }) {
  useAccountKeyframes();
  return (
    <div
      aria-hidden
      className={cn("rounded-[10px]", shimmer ? "ns-ac-skeleton" : "bg-muted", className)}
    />
  );
}

/** 行清单加载态:同高骨架行(前 3 行 shimmer) */
export function SkeletonRows({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("flex flex-col", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-t border-border py-3.5 first:border-t-0"
        >
          <Skeleton shimmer={i < 3} className="size-9 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton shimmer={i < 3} className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/* ── ErrorPanel — §FB2 ───────────────────────────────────────────────── */
export function ErrorPanel({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-[14px] bg-error-soft px-4 py-3",
        className,
      )}
    >
      <CircleAlert className="size-4 shrink-0 text-error-soft-foreground" strokeWidth={2} />
      <p className="min-w-0 flex-1 text-[13px] leading-[18px] font-medium text-error-soft-foreground">
        {message}
      </p>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/* ── SweepIn — §8b 降落(人类动作:降落 only,零 coral sweep) ──────────── */
export function SweepIn({
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div">) {
  useAccountKeyframes();
  return (
    <div
      className={cn("ns-ac-land", className)}
      style={{ animation: "ns-ac-land 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both", ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── CreditCoin — §N2 14px credit 硬币(credits 是 Otto 燃料 → 允许的 coral mark) ── */
export function CreditCoin({ className }: { className?: string }) {
  return (
    <Coins
      aria-hidden
      className={cn("size-3.5 shrink-0 text-brand", className)}
      strokeWidth={2}
    />
  );
}

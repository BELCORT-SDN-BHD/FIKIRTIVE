"use client";

/**
 * 北极星原型 · 全局横切区 — 动效底座
 *
 * design-rules v3:§6 动效 token / §8a coral sweep(一次性,≤600ms)/
 * §8b card landing(200ms spring)/ §FB8 不定长 gen bar / §A5 reduced-motion
 * (JS gate:matchMedia,sweep 降级为静态 2px 描边 600ms 后移除)。
 * 只注入一次 keyframes;.gb 的 reduced-motion clamp 会冻结循环动画。
 */

import * as React from "react";

const NSG_KEYFRAMES_ID = "nsg-global-keyframes";
const NSG_KEYFRAMES = `
@keyframes nsg-gen-slide { 0% { left: -40%; } 100% { left: 100%; } }
@keyframes nsg-badge-pulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--brand) 45%, transparent); } 50% { box-shadow: 0 0 0 5px color-mix(in oklab, var(--brand) 0%, transparent); } }
@keyframes nsg-sweep { 0% { box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent); background-color: color-mix(in oklab, var(--brand-soft) 60%, transparent); } 100% { box-shadow: 0 0 0 2px transparent; background-color: transparent; } }
@keyframes nsg-land { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes nsg-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`;

export function useNsgKeyframes() {
  React.useEffect(() => {
    if (document.getElementById(NSG_KEYFRAMES_ID)) return;
    const el = document.createElement("style");
    el.id = NSG_KEYFRAMES_ID;
    el.textContent = NSG_KEYFRAMES;
    document.head.appendChild(el);
  }, []);
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/** §8a coral sweep:fire() 后 600ms 一次性;reduced motion = 静态 2px 描边。 */
export function useSweep(): [React.CSSProperties | undefined, () => void] {
  useNsgKeyframes();
  const reduced = useReducedMotion();
  const [on, setOn] = React.useState(false);
  const fire = React.useCallback(() => setOn(true), []);
  React.useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => setOn(false), 600);
    return () => window.clearTimeout(t);
  }, [on]);
  const style: React.CSSProperties | undefined = on
    ? reduced
      ? { boxShadow: "0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent)" }
      : { animation: "nsg-sweep 600ms cubic-bezier(0.22, 1, 0.36, 1) 1" }
    : undefined;
  return [style, fire];
}

/** §8b card landing:挂载时 200ms spring 落地(reduced motion 直接出现)。 */
export function useLanding(): React.CSSProperties | undefined {
  useNsgKeyframes();
  const reduced = useReducedMotion();
  return reduced ? undefined : { animation: "nsg-land 200ms cubic-bezier(0.34, 1.56, 0.64, 1) 1" };
}

/** §FB8 不定长进度:5px 轨 + 40% coral 滑块,1.3s。reduced motion 时整条隐藏。 */
export function GenBar({ className }: { className?: string }) {
  useNsgKeyframes();
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <span
      aria-hidden
      className={
        "relative h-[5px] w-16 shrink-0 overflow-hidden rounded-full border border-border bg-background " +
        (className ?? "")
      }
    >
      <span
        className="absolute top-0 h-full w-[40%] rounded-full bg-brand"
        style={{ animation: "nsg-gen-slide 1.3s ease-in-out infinite" }}
      />
    </span>
  );
}

/** §FB7 骨架条:shimmer 配方(border 25% / card 50% / border 75%,1.4s);reduced motion 冻结为静态渐变。 */
export function SkeletonRow({ className }: { className?: string }) {
  useNsgKeyframes();
  const reduced = useReducedMotion();
  return (
    <span
      aria-hidden
      className={"block rounded-[10px] " + (className ?? "h-9")}
      style={{
        background: "linear-gradient(90deg, var(--border) 25%, var(--card) 50%, var(--border) 75%)",
        backgroundSize: "200% 100%",
        animation: reduced ? undefined : "nsg-shimmer 1.4s ease-in-out infinite",
      }}
    />
  );
}

/** dock 徽点(8px coral,工作中脉冲 / 完成未看静止)。 */
export function DockBadge({ pulsing }: { pulsing: boolean }) {
  useNsgKeyframes();
  const reduced = useReducedMotion();
  return (
    <span
      aria-hidden
      className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand ring-2 ring-background"
      style={pulsing && !reduced ? { animation: "nsg-badge-pulse 2s ease-in-out infinite" } : undefined}
    />
  );
}

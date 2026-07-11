"use client";

/**
 * 北极星原型 · 全局横切区 — 原型陈列用具(不是产品 UI)
 *
 * DemoFrame   带 micro-mono 标签的展示框:框内是产品表面,框本身是图纸边框
 * DemoSwitch  §N4 segmented 配方的状态切换器(原型三态演示器:正常/加载/空/错误)
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export function DemoFrame({
  label,
  children,
  className,
  bodyClassName,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <figure className={cn("flex min-w-0 flex-col gap-2", className)}>
      <figcaption className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </figcaption>
      <div
        className={cn(
          "relative min-w-0 overflow-hidden rounded-[18px] border border-border bg-background shadow-[var(--shadow-xs)]",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </figure>
  );
}

export interface DemoSwitchOption<T extends string> {
  value: T;
  label: string;
}

/** §N4 segmented:--card + 1px border,radius 10,p 2;item h 30 radius 8 12/600,active --secondary。 */
export function DemoSwitch<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: DemoSwitchOption<T>[];
  ariaLabel: string;
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const activeIdx = options.findIndex((o) => o.value === value);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (activeIdx + dir + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn("inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5", className)}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-[30px] rounded-[8px] px-3 text-xs font-semibold transition-colors duration-[120ms]",
              active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 展示框里的示意内容块(静态 --muted 占位,§FB7:非加载语义,只是版面示意) */
export function SketchBlock({ className }: { className?: string }) {
  return <div aria-hidden className={cn("rounded-[10px] bg-muted", className)} />;
}

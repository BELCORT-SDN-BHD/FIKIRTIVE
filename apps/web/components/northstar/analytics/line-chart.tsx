"use client";

/**
 * 北极星原型 — 分析区折线图(§D5 图表法)
 *
 * data is ink · emphasis is coral · state is semantic:
 * 线 2.2px var(--foreground);面积填充单系列 ink@10% → 透明;
 * peak 点 = 头 3 值,r=4,coral(Otto 会谈到它们才存在);
 * 横向网格线 ≤3(--secondary),基线 --border;x 轴标签 ≤6,11px mono muted。
 * 空序列:平基线 + 不藏面板(§D5)。
 * 注:--chart-* 六 token 尚未入 .gb(design-rules §D5 标记 verified absent),
 * 原型按其角色映射到现有 token,不新造值。
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export interface NsChartPoint {
  date: string; // ISO date
  value: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

export function NsLineChart({
  series,
  flat = false,
  peaks = 3,
  labels = true,
  className,
}: {
  series: NsChartPoint[];
  /** 空态:平基线,无填充无 peak */
  flat?: boolean;
  /** coral 强调点数(0 = 关) */
  peaks?: number;
  labels?: boolean;
  className?: string;
}) {
  const gradientId = React.useId();

  const W = 820;
  const H = 180;
  const TOP = 16;
  const BASE = 150;

  const n = series.length;
  const showLine = !flat && n > 1;
  const max = showLine ? Math.max(...series.map((p) => p.value), 1) : 1;

  const pts = showLine
    ? series.map((p, i) => ({
        x: 10 + (i * (W - 20)) / (n - 1),
        y: BASE - (p.value / max) * (BASE - TOP),
        date: p.date,
        value: p.value,
      }))
    : [];

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = showLine
    ? `${linePath} L${pts[pts.length - 1]!.x.toFixed(1)},${BASE} L${pts[0]!.x.toFixed(1)},${BASE} Z`
    : "";

  // peak 点:头 N 值(按值降序取 index)
  const peakIdx = showLine
    ? [...pts.keys()].sort((a, b) => pts[b]!.value - pts[a]!.value).slice(0, Math.max(0, peaks))
    : [];

  // x 轴标签 ≤6,首尾必含
  const labelIdx: number[] = [];
  if (labels && n > 1) {
    const count = Math.min(6, n);
    for (let i = 0; i < count; i++) labelIdx.push(Math.round((i * (n - 1)) / (count - 1)));
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("mt-2.5 h-[170px] w-full", className)} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--foreground)" stopOpacity="0.10" />
          <stop offset="1" stopColor="var(--foreground)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* 网格:内线 --secondary ×2,基线 --border */}
      <line x1="0" y1={BASE} x2={W} y2={BASE} stroke="var(--border)" />
      <line x1="0" y1="100" x2={W} y2="100" stroke="var(--secondary)" />
      <line x1="0" y1="50" x2={W} y2="50" stroke="var(--secondary)" />
      {showLine && (
        <>
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path d={linePath} fill="none" stroke="var(--foreground)" strokeWidth="2.2" />
          {peakIdx.map((i) => (
            <circle key={i} cx={pts[i]!.x} cy={pts[i]!.y} r="4" fill="var(--brand)" />
          ))}
        </>
      )}
      {labels &&
        labelIdx.map((i) => (
          <text
            key={i}
            x={10 + (i * (W - 20)) / (n - 1)}
            y={H - 8}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            fontSize="11"
            fontFamily="var(--font-mono)"
            fill="var(--muted-foreground)"
          >
            {fmtDate(series[i]!.date)}
          </text>
        ))}
    </svg>
  );
}

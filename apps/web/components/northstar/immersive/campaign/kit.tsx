"use client";

/**
 * 北极星 · 沉浸式「Campaign 脊梁」组(Z4)—— 区专属件。
 *
 * 共享原语从 ../_kit(Card / SegNav / fmt*)与 ../../campaign/_bits(PlatformPill / GenBar /
 * Landed / SkeletonBlock / fmtCredits / fmtDay)复用,不 fork。本文件只保留 Campaign 区专属:
 * 段控子导航(Campaigns · Trends)、D1 状态徽章/状态机(NsCampaignStatus)、GM-03 目标进度条。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto(管理面 dock 外零 coral);credits 永远是 credits。
 */

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { SegNav, IMMERSIVE_BASE } from "../_kit";
import type { NsCampaignStatus } from "@/components/northstar/_mock";

/* ── 共享原语 re-export(单一实现在别处;页面 import 路径统一走本 kit) ────────── */
export { Card, CardHeader, fmtDate, fmtMyr, useReducedMotion, useSweep } from "../_kit";
export {
  PlatformPill,
  GenBar,
  Landed,
  SkeletonBlock,
  InlineError,
  fmtCredits,
  fmtDay,
} from "@/components/northstar/campaign/_bits";

export const CAMP_BASE = IMMERSIVE_BASE;

/* ── 段控子导航(§N4;nav 组内:Campaigns · Trends) ─────────────────────────── */
const CAMPAIGN_VIEWS = [
  { href: `${CAMP_BASE}/campaign/list`, label: "Campaigns" },
  { href: `${CAMP_BASE}/campaign/trends`, label: "Trends" },
];

export function CampaignNav() {
  return <SegNav views={CAMPAIGN_VIEWS} />;
}

/* ── D1 状态徽章(DRAFT → ACTIVE → DONE;colour = state) ───────────────────── */
export function CampaignStatusBadge({ status }: { status: NsCampaignStatus }) {
  if (status === "ACTIVE") return <Badge variant="info">Active</Badge>;
  if (status === "DONE") return <Badge variant="success">Done</Badge>;
  return <Badge>Draft</Badge>;
}

/* ── 状态机 StatusTrack(红旗六最薄行:DRAFT → ACTIVE → DONE) ──────────────── */
const STATUS_TRACK: NsCampaignStatus[] = ["DRAFT", "ACTIVE", "DONE"];
const STATUS_LABEL: Record<NsCampaignStatus, string> = { DRAFT: "Draft", ACTIVE: "Active", DONE: "Done" };

export function StatusTrack({ status }: { status: NsCampaignStatus }) {
  const reached = STATUS_TRACK.indexOf(status);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STATUS_TRACK.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <span aria-hidden className="h-px w-6 bg-border" />}
          <span
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-3 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] uppercase",
              i < reached && "bg-secondary text-muted-foreground",
              i === reached && "bg-secondary text-foreground",
              i > reached && "border border-border text-muted-foreground/70",
            )}
          >
            {i < reached && <Check className="size-3" strokeWidth={2.5} />}
            {STATUS_LABEL[s]}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ── GM-03 目标进度条(ink 确定性进度 + micro-mono 计数;bar 必配数字) ───────── */
export function GoalBar({
  label,
  current,
  target,
  className,
}: {
  label: string;
  current: number;
  target: number;
  className?: string;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">{label}</span>
        <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-foreground tabular-nums">
          {current}/{target} · {pct}%
        </span>
      </div>
      <span
        aria-hidden
        className="mt-2 block h-1.5 overflow-hidden rounded-full bg-secondary"
      >
        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/* ── [wave-c] 漏斗角色徽标(让 7 条帖成一条弧线;中性灰,不抢 coral/blue) ────────── */
export function RoleBadge({ role }: { role: string }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-secondary px-2 font-mono text-[10px] leading-none font-semibold tracking-[0.08em] text-muted-foreground uppercase">
      {role}
    </span>
  );
}

/* ── [wave-c] 趋势置信度小标(High/Watch/Cooling;语义色,冷启动诚实) ────────────── */
export function ConfidenceBadge({ level }: { level: "High" | "Watch" | "Cooling" }) {
  if (level === "High") return <Badge variant="success">Confidence · high</Badge>;
  if (level === "Watch") return <Badge variant="warning">Confidence · watch</Badge>;
  return <Badge variant="outline">Confidence · cooling</Badge>;
}

/* ── ROI 一行结论(#3:花费 vs 归因收入 vs ROI%;只用平台自身 insight) ─────────
 * [wave-b] Campaign ROI 一行结论 */
export function roiLine(spentCredits: number, revenueMyr: number): { text: string; positive: boolean } {
  // 生成成本折算(展示口径:1 credit ≈ RM1,原型层近似;真实计费不在此)。
  const costMyr = spentCredits;
  const roi = costMyr > 0 ? Math.round(((revenueMyr - costMyr) / costMyr) * 100) : 0;
  return {
    text: `Spent ~RM${costMyr.toLocaleString("en-MY")}, earned RM${revenueMyr.toLocaleString("en-MY")} · ROI ${roi}%`,
    positive: roi >= 0,
  };
}

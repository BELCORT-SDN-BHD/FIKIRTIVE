"use client";

/**
 * 北极星 · CRM 区专属展示件(Z7 endgame)
 *
 * ContactAvatar    头像全用 NS_IMAGES(§一 图片纪律);缺图回落确定性首字母
 * HeatBadge        Otto 热/温/冷标签 —— 语义色,零 coral(CRM 是 ambient 数据楼)
 * LifecycleBadge   生命周期阶段 chip(outline,语义中性)
 * heatReason       每个热度一句人话理由(确定性派生,非新品牌事实)
 * churnRisk        流失风险预测标签(可筛选属性;规则近似,冷启动口径)
 *
 * 独立文件避免与 inbox 共享的 kit.tsx 抢改动面。coral 只属于 Otto(dock);
 * 名册/看板/分群永不挂 Otto 头像 mood(蓝图 §七 Otto 时刻)。
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Initials } from "./kit";
import { churnResult, daysSince, QUIET_THRESHOLD_DAYS } from "./crm-data";
import type { NsContact, NsHeat, NsLifecycle } from "@/components/northstar/_mock";

/* ── 头像(NS_IMAGES;固定宽高比容器防跳动;缺图回落首字母) ────────────────── */
export function ContactAvatar({
  contact,
  className,
}: {
  contact: Pick<NsContact, "name" | "avatar">;
  className?: string;
}) {
  if (!contact.avatar) return <Initials name={contact.name} className={className} />;
  return (
    <span
      className={cn(
        "relative inline-block size-9 shrink-0 overflow-hidden rounded-full bg-secondary",
        className,
      )}
    >
      {/* 原型层用 <img>(不走 next/image);alt = 姓名,object-cover 固定比例 */}
      <img
        src={contact.avatar}
        alt={contact.name}
        loading="lazy"
        className="size-full object-cover"
      />
    </span>
  );
}

/* ── 生命周期阶段 ─────────────────────────────────────────────────────────── */
export const LIFECYCLE_LABEL: Record<NsLifecycle, string> = {
  lead: "Lead",
  new: "New",
  active: "Active",
  regular: "Regular",
  vip: "VIP",
  dormant: "Dormant",
};

export const LIFECYCLE_ORDER: NsLifecycle[] = ["lead", "new", "active", "regular", "vip", "dormant"];

export function LifecycleBadge({ stage }: { stage?: NsLifecycle }) {
  if (!stage) return null;
  return <Badge variant="outline">{LIFECYCLE_LABEL[stage]}</Badge>;
}

/* ── Otto 热度标签(语义色,零 coral;hot=warning / warm=default / cold=outline) ── */
export const HEAT_LABEL: Record<NsHeat, string> = { hot: "Hot", warm: "Warm", cold: "Cold" };

export function HeatBadge({ heat }: { heat?: NsHeat }) {
  if (!heat) return null;
  const variant = heat === "hot" ? "warning" : heat === "warm" ? "default" : "outline";
  return <Badge variant={variant}>{HEAT_LABEL[heat]}</Badge>;
}

/** 每个热度一句人话理由(Otto 的判断;[wave-c] 现读真实字段带数字,不再死查表)。
 * hot = 该补货的算式;warm = 稳但转淡;cold = 静默天数 + 在险金额。治 ledger gap#2。 */
export function heatReason(c: NsContact): string {
  const orders = c.orderCount ?? 0;
  const avg = orders > 0 ? Math.round(c.totalOrdersMyr / orders) : 0;
  const days = daysSince(c.lastSeen);
  if (c.heat === "hot") {
    if (c.lifecycle === "new") return `New this week — first order in, ordered ${days}d ago. Keep them close.`;
    if (orders >= 2 && avg > 0) return `${orders} orders, ~RM${avg} each — last one ${days}d ago, a reorder looks due. Stock up.`;
    return `Messaged in the last few days — reply while you're top of mind.`;
  }
  if (c.heat === "warm") {
    if (c.lifecycle === "new") return "Just reached out — a friendly nudge could land the first order.";
    if (orders > 0) return `Steady — ${orders} order${orders === 1 ? "" : "s"}, last seen ${days}d ago. A little quiet lately.`;
    return "Steady customer, a little quiet lately.";
  }
  // cold
  if (days > QUIET_THRESHOLD_DAYS) {
    return `Quiet ${days} days (past the ~${QUIET_THRESHOLD_DAYS}-day line) — RM${c.totalOrdersMyr.toLocaleString("en-MY")} at stake. Worth a win-back.`;
  }
  return "Gone cold — no recent messages.";
}

/* ── 流失风险(WHATPASS 一·D)——[wave-c] 换成加权打分引擎(churnResult),带算式解释 ──
 * 冷启动口径明说(见 crm-data QUIET_THRESHOLD_DAYS / CADENCE_NOTE)。可当筛选属性用。 */
export function churnRisk(c: NsContact): { level: "low" | "medium" | "high"; label: string } {
  const r = churnResult(c);
  const level = r.band === "red" || r.band === "orange" ? "high" : r.band === "yellow" ? "medium" : "low";
  return { level, label: r.bandLabel };
}

export function ChurnBadge({ contact }: { contact: NsContact }) {
  const r = churnResult(contact);
  const variant =
    r.band === "red" ? "destructive" : r.band === "orange" ? "warning" : r.band === "yellow" ? "soft" : "success";
  const title = r.signals.length
    ? `${r.actionBy} · ${r.signals.map((s) => s.label).join("; ")}`
    : r.actionBy;
  return (
    <span title={title}>
      <Badge variant={variant}>{r.bandLabel}</Badge>
    </span>
  );
}

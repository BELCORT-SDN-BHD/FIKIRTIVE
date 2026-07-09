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

/** 每个热度一句人话理由(Otto 的判断;确定性派生自已有字段,不新造事实)。 */
export function heatReason(c: NsContact): string {
  if (c.heat === "hot") {
    if (c.lifecycle === "new") return "New this week and already asking about products.";
    if ((c.predictedNextMyr ?? 0) >= 200) return "Orders often — a big reorder looks due.";
    return "Messaged recently and ordering regularly.";
  }
  if (c.heat === "warm") {
    if (c.lifecycle === "new") return "Just reached out — worth a friendly nudge.";
    return "Steady customer, a little quiet lately.";
  }
  if (c.lifecycle === "dormant") return "Hasn't ordered in weeks — a win-back could help.";
  return "Gone quiet — no recent activity.";
}

/* ── 流失风险(WHATPASS 一·D「预测字段」)——[wave-b] 预测字段标签 ────────────────
 * 冷启动数据不够时用规则近似,显示为档案上的标签而非报表数字。可当筛选属性用。 */
export function churnRisk(c: NsContact): { level: "low" | "medium" | "high"; label: string } {
  if (c.lifecycle === "dormant") return { level: "high", label: "High" };
  if (c.heat === "cold") return { level: "medium", label: "Medium" };
  return { level: "low", label: "Low" };
}

export function ChurnBadge({ contact }: { contact: NsContact }) {
  const risk = churnRisk(contact);
  const variant = risk.level === "high" ? "destructive" : risk.level === "medium" ? "warning" : "success";
  return <Badge variant={variant}>{risk.label} churn risk</Badge>;
}

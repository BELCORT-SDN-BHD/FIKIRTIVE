"use client";

/**
 * [f2-primitives] §O7「Otto 帮我」affordance —— 全城共享原语
 *
 * 每个「动脑面」(表单 / 对话框 / composer / 编辑器 / 错误态)挂**一颗** ghost 小钮 +
 * 无眼云 glyph ≤16px(算一个 coral mark set,§O budget)。点开 = dock 带上
 * {zone, entityId, formState} 上下文自动展开,不问「哪一个 / 在哪」;上方浮出 2-3 个
 * 一键意图 chip(零打字路径永远在);Otto 的回应可带 Apply,一键把产出回填本表面。
 *
 * 铁律:coral 只属于 Otto(这颗云是 Otto 的声音);发/花永不由 Apply 触发(Apply 只填
 * 字段,店主再亲手发)。零后台 import。
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useImmersive } from "./_context";
import {
  openAssist,
  clearAssist,
  type NsAssistContext,
  type NsAssistIntent,
  type NsAssistApply,
} from "./_store";

/** eyeless coral 云标记(§O1:≤16px 用无眼云——这是「mark」,不是有情绪的 avatar)。 */
function OttoGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={Math.round((size * 110) / 120)}
      viewBox="0 0 120 110"
      aria-hidden
      focusable="false"
      style={{ display: "block" }}
    >
      <g fill="var(--brand)">
        <ellipse cx="60" cy="64" rx="43" ry="22" />
        <circle cx="37" cy="52" r="18" />
        <circle cx="61" cy="40" r="24" />
        <circle cx="85" cy="53" r="17" />
      </g>
    </svg>
  );
}

export interface OttoAssistProps {
  /** 所在区(context chip / 单流 zone 派生;§O budget 归属) */
  zone: NsAssistContext["zone"];
  /** 选中/编辑对象 id(可选;onApply 落到具体对象) */
  entityId?: string;
  /** 对象人话名(dock「Looking at」chip 显示它) */
  entityLabel?: string;
  /** 当前表单/选区快照(Otto「看见」的现场状态;透传给作者写的 intents / onApply) */
  formState?: Record<string, unknown>;
  /** 2-3 个 surface-specific 意图 chip(零打字路径) */
  intents: NsAssistIntent[];
  /** Apply 回填:把 Otto 产出落回本表面(填字段 + 自己 fire useSweep);发/花仍要店主点 */
  onApply?: (apply: NsAssistApply) => void;
  /** 钮文案(默认 "Ask Otto") */
  label?: string;
  className?: string;
}

/**
 * 挂一颗即得完整承接。示例见 docs/northstar/IMMERSIVE-STORE.md「§O7 assist」。
 */
export function OttoAssist({
  zone,
  entityId,
  entityLabel,
  formState,
  intents,
  onApply,
  label = "Ask Otto",
  className,
}: OttoAssistProps) {
  const immersive = useImmersive();
  const token = React.useId();
  // 离开本表面即清 assist(owner 匹配才清):chip 不残留到别的面。
  React.useEffect(() => () => clearAssist(token), [token]);

  return (
    <button
      type="button"
      onClick={() => {
        openAssist(token, { zone, entityId, entityLabel, formState, intents }, onApply);
        immersive?.openOtto();
      }}
      aria-label={`${label} about this ${zone.toLowerCase()}`}
      className={cn(
        // ghost:透明底、无凸起边衣(§5a 法二),hover=accent;焦点环走壳内蓝(§2 双声部)
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
        className,
      )}
    >
      <OttoGlyph size={14} />
      <span>{label}</span>
    </button>
  );
}

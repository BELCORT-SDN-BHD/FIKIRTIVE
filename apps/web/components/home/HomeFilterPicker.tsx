"use client";

import type { ComponentType } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/design-system/primitives/select";

export function HomeFilterPicker({
  label,
  icon: Icon,
  value,
  options,
  onValueChange,
  disabled = false,
}: {
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  value: string;
  options: readonly { value: string; label: string }[];
  onValueChange: (value: string) => void;
  /** 有未保存的版面草稿时锁住 —— 换 goal / 周期会把草稿冲掉(设计权威
   *  patterns/founder-home/README.md 交互补充规格第 5 条)。 */
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        size="sm"
        aria-label={label}
        className="border-transparent bg-transparent px-2.5 shadow-none hover:bg-accent"
      >
        <Icon className="size-4" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

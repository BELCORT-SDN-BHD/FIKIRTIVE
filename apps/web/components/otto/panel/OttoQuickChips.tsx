"use client";

/**
 * OttoQuickChips.tsx —— 面板底部那 3–4 颗随页面变化的快捷 chips。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.4;票 #995(W2-8)。
 *
 * 它复用的是前门四个目标格子的**同一个机制**:点一下,把这个目标的那句话作为这一轮的消息
 * 发出去,`goalKey` 随行去 seed 开场(`GOAL_PRESETS[key].opening`)。所以这里既没有第二套
 * chips 数据,也没有一句自己写的文案 —— 标签由 `panel-page.ts` 从 `GOAL_PRESETS` 取来。
 *
 * 哪一页给哪几颗,是 `panel-page.ts` 的活;这个文件只负责把它们画成一排。
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { PanelQuickChip } from "./panel-page";

export function OttoQuickChips({
  chips,
  disabled = false,
  onPick,
}: {
  chips: PanelQuickChip[];
  disabled?: boolean;
  onPick: (chip: PanelQuickChip) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div data-otto-panel-quick-chips="" className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
      {chips.map((chip) => (
        <Button
          key={chip.goalKey}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          data-otto-quick-chip={chip.goalKey}
          onClick={() => onPick(chip)}
          className="h-7 rounded-full px-3 text-[12px] font-normal"
        >
          {chip.label}
        </Button>
      ))}
    </div>
  );
}

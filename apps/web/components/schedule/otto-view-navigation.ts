"use client";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { OTTO_VIEW_REDIRECTS } from "@fikirtive/core/navigation";
import type { OttoViewKey } from "@/components/otto/otto-view-param";
import { useOttoPanelControls } from "@/components/otto/panel/OttoPanelShell";

/**
 * 搬家过来的 Schedule / Analytics 视图仍然会说「带我去 Connections」「带我去 Otto」——
 * 它们在旧壳里靠 `onViewChange` 换屏,在真路由 + 面板上得靠地址栏与面板开合各管一半。
 *
 * W2-11(切换总票)落地:这个模块曾经是**临时的**(旧docblock 原话:「W2-11 切换总票
 * 落地时,把这里换成 Otto 面板的开合动作」),现在按那句话本身改掉——
 *   · `otto` 不再是一条地址:它直接开右侧常驻面板(`useOttoPanelControls().openPanel()`),
 *     不 `router.push` 去任何地方。挂不到面板的表面(`controls` 是 `null`,理由见
 *     `panel-surface.ts`)就什么都不做——这两个调用点(Schedule/Analytics)本来就一定
 *     挂着面板,不是这条防线要接住的真实场景,只是让「没有面板」不会在这里炸。
 *   · 其余 view(今天只有 `connections` 真的被调用)一律走 `OTTO_VIEW_REDIRECTS[view]`
 *     ——那是重定向表本身的权威,不在这里手抄第二份 view → 地址的映射。
 */
export function useOttoViewNavigate(): (view: OttoViewKey) => void {
  const router = useRouter();
  const controls = useOttoPanelControls();
  return useCallback(
    (view: OttoViewKey) => {
      if (view === "otto") {
        controls?.openPanel();
        return;
      }
      router.push(OTTO_VIEW_REDIRECTS[view]);
    },
    [router, controls],
  );
}

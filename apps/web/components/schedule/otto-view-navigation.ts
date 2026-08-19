"use client";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { OttoViewKey } from "@/components/otto/otto-view-param";

/**
 * 搬家过来的 Schedule / Analytics 视图仍然会说「带我去 Connections」「带我去 Otto」——
 * 它们在旧壳里靠 `onViewChange` 换屏,在真路由上得靠地址栏。
 *
 * 这里**只写一次**那个地址,而且写的是**今天真的到得了**的那一条:`/otto?view=X`。
 * 为什么不是 `OTTO_VIEW_REDIRECTS[view]`(换壳之后的新地址):Stack A 阶段
 * (规格书 §6.3)六条新路由是分头建的,`/settings/connections` 这一票(W2-4)还没落地,
 * 现在指过去就是一次真 404 —— 而 §2.5 的老纪律是「旧地址一律 307,永不 404」。
 * 指回 `/otto?view=X` 则在整条堆叠里都不会断:今天它就是那块屏,W2-11 把 `/otto`
 * 缩成重定向表之后,同一个地址会自动把人送到新门。
 *
 * 也就是说这个模块是**临时的**:W2-11 切换总票落地时,把这里换成 Otto 面板的开合动作
 * (`connections` 走新路由,`otto` 直接开右侧面板)即可,调用点不用动。
 */
export function ottoViewHref(view: OttoViewKey): string {
  return `/otto?view=${view}`;
}

/** `onNavigate` 的真路由版本 —— 换屏变成换地址。 */
export function useOttoViewNavigate(): (view: OttoViewKey) => void {
  const router = useRouter();
  return useCallback((view: OttoViewKey) => router.push(ottoViewHref(view)), [router]);
}

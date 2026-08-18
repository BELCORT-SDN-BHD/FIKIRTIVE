"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Schedule 的两个页签 —— Founder 决策 Q4-A(规格书 §4.6 / Q4)。
 *
 * 为什么 Analytics 是页签而不是第八格:`getAnalytics` 今天对**每一个**商家都返回
 * `notConnected`(Facebook Login 在 app 层关着)。给一个 100% 空态的能力一个顶层导航格
 * 就是在导轨上说大话;做成页签既留着入口,又不占一格。
 *
 * 页签本身是**地址**,不是本地状态:两条都是真路由,刷新回得来、分享给得出去。所以
 * `value` 由 URL 派生(受控,不给 `onValueChange`),`TabsTrigger asChild` 套一个真
 * `<Link>` —— 键盘、aria-selected、roving focus 与那两个 ARIA 角色全部由 `ui/tabs`
 * 背后的 Radix 负责,这里一个都不手写(规格书 §5.6 ②;围栏
 * `lib/__tests__/schedule-route.test.ts` 会扫这个文件)。
 * `activationMode="manual"` 是因为切页签要发一次导航:方向键只挪焦点,Enter 才走。
 */
export const SCHEDULE_TABS = [
  { key: "schedule", label: "Schedule", href: SHELL_ROUTES.schedule },
  { key: "analytics", label: "Analytics", href: SHELL_ROUTES.analytics },
] as const;

export type ScheduleTabKey = (typeof SCHEDULE_TABS)[number]["key"];

/**
 * 地址 → 当前页签。纯函数,围栏直接拿它对账。
 * `/schedule/analytics` 与它下面的任何一层都算 Analytics,其余(含 `/schedule` 本身)算 Schedule。
 */
export function scheduleTabForPath(pathname: string): ScheduleTabKey {
  const analytics = SHELL_ROUTES.analytics;
  return pathname === analytics || pathname.startsWith(`${analytics}/`) ? "analytics" : "schedule";
}

export function ScheduleTabs({ children }: { children: ReactNode }) {
  const active = scheduleTabForPath(usePathname() || SHELL_ROUTES.schedule);
  return (
    <Tabs value={active} activationMode="manual" className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="border-b border-border px-7 pt-5 pb-3">
        <TabsList aria-label="Schedule sections">
          {SCHEDULE_TABS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} asChild>
              <Link href={tab.href}>{tab.label}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value={active} className="flex min-h-0 flex-1 flex-col">
        {children}
      </TabsContent>
    </Tabs>
  );
}

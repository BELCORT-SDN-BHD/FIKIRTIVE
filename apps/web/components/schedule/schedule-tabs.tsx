"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
 * `value` 由 URL 派生(受控),`TabsTrigger asChild` 套一个真 `<Link>` —— aria-selected、
 * roving focus 与那两个 ARIA 角色全部由 `ui/tabs` 背后的 Radix 负责,这里一个都不手写
 * (规格书 §5.6 ②;围栏 `lib/__tests__/schedule-route.test.ts` 会扫这个文件)。
 * `activationMode="manual"` 是因为切页签要发一次导航:方向键只挪焦点,按键才走。
 *
 * `onValueChange` 是**必须**给的,哪怕 `value` 完全由 URL 派生(判官 r1 P3-1):Radix 的
 * trigger 在 Space / Enter 上一律只做一件事 —— 调 `context.onValueChange(value)`。不给它,
 * 空格就什么都不发生;Enter 之所以还能走,靠的是 anchor 自己的原生默认行为,而 anchor 对
 * 空格没有默认行为。也就是说「键盘全交给 Radix」这句话只有配上这个回调才是真的。
 * 回调里推的仍是 `SCHEDULE_TABS` 那一份地址,不是第二份。
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
  const router = useRouter();
  const active = scheduleTabForPath(usePathname() || SHELL_ROUTES.schedule);
  const goToTab = (key: string) => {
    const tab = SCHEDULE_TABS.find((t) => t.key === key);
    if (tab) router.push(tab.href);
  };
  return (
    <Tabs value={active} activationMode="manual" onValueChange={goToTab} className="flex min-h-0 flex-1 flex-col gap-0">
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

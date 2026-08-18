import type { ReactNode } from "react";
import { ScheduleTabs } from "@/components/schedule/schedule-tabs";

/**
 * `/schedule` 与 `/schedule/analytics` 共用的一层壳(规格书 §4.6、Q4-A)。
 *
 * 页签在这里、内容在下面,所以换页签不重画日历那 1675 行,也不会出现「两个 Schedule
 * 标题」这种两套壳各画一遍的老病。
 */
export default function ScheduleLayout({ children }: { children: ReactNode }) {
  return (
    <main className="gb flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <ScheduleTabs>{children}</ScheduleTabs>
    </main>
  );
}

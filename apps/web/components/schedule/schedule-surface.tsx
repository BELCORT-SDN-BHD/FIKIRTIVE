"use client";
import { OttoSchedule } from "@/components/otto/OttoSchedule";
import type { StuffItem } from "@/lib/stuff-items";
import { useOttoViewNavigate } from "./otto-view-navigation";

/**
 * `/schedule` 的客户端外皮 —— 唯一权威日历原样搬家(规格书 §4.6)。
 *
 * 这里**没有第二套日历**:内容仍是 `OttoSchedule` 那一个组件(真 `ScheduledPost` 表 +
 * worker),这一层只把它从「旧壳的一块屏」接到「一条真路由」上,补上它唯一需要的那个
 * 宿主能力 —— 换屏(`onNavigate`)在真路由上是换地址。
 */
export function ScheduleSurface({ stuffItems }: { stuffItems: StuffItem[] }) {
  const navigate = useOttoViewNavigate();
  return <OttoSchedule stuffItems={stuffItems} onNavigate={navigate} />;
}

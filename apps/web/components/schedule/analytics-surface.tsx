"use client";
import { OttoAnalytics } from "@/components/otto/OttoAnalytics";
import type { AnalyticsData } from "@/lib/analytics-actions";
import { useOttoViewNavigate } from "./otto-view-navigation";

/**
 * `/schedule/analytics` 的客户端外皮 —— 现有 Analytics 视图原样搬家(规格书 Q4-A)。
 *
 * 视图自己会说实话:Meta 没连上的时候画的是 connect / reconnect 卡,不是编出来的数字。
 * 这一层不添一句新话,只把「打开 Connections」那颗按钮接到地址栏上。
 *
 * 刻意**不**传 `onUseInOtto`:这条路由上还没有聊天框(Otto 面板是 W2-7),没地方放那句预填。
 * 视图自己的兜底是把人带去 Otto,这一层就照它的兜底走 —— 预填在这条路上会丢一次,而这颗
 * 按钮挂在 `data.insight` 上,`data.insight` 只在 ready 态才有,今天到不了。面板落地后
 * 把预填接进面板即可。
 */
export function AnalyticsSurface({ initial }: { initial: AnalyticsData }) {
  const navigate = useOttoViewNavigate();
  return <OttoAnalytics initial={initial} onNavigate={navigate} />;
}

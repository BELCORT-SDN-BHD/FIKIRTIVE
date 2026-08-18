import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getAnalytics } from "@/lib/analytics-actions";
import { AnalyticsSurface } from "@/components/schedule/analytics-surface";

/**
 * Analytics —— Schedule 页内的第二个页签(Founder 决策 Q4-A,规格书 §4.6)。
 *
 * 它不是一个顶层导航格,因为 `getAnalytics` 今天对每一个商家都返回 `notConnected`;
 * 但入口留着,并且读不到数据的时候页面自己说出来,不编数字。
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics · Fikirtive" };

export default async function ScheduleAnalyticsPage() {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  const initial = await getAnalytics({}).catch(() => ({ state: "notConnected" as const }));
  return <AnalyticsSurface initial={initial} />;
}

import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getAnalytics } from "@/lib/analytics-actions";
import {
  AnalyticsSurface,
  R22_ANALYTICS_FIXTURE,
} from "@/components/schedule/analytics-surface";

/**
 * Analytics —— Schedule 页内的第二个页签(Founder 决策 Q4-A,规格书 §4.6)。
 *
 * 它不是一个顶层导航格,因为 `getAnalytics` 今天对每一个商家都返回 `notConnected`;
 * 但入口留着,并且读不到数据的时候页面自己说出来,不编数字。
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics · Fikirtive" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ScheduleAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
} = { searchParams: Promise.resolve({}) }) {
  const params = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && first(params.fixture) === "r22";
  if (fixture) {
    const requestedState = Array.isArray(params.state) ? params.state[0] : params.state;
    const initial =
      requestedState === "not-connected"
        ? ({ state: "notConnected" } as const)
        : requestedState === "reconnect"
          ? ({ state: "needsReconnect" } as const)
          : requestedState === "error"
            ? ({ state: "transientError" } as const)
            : requestedState === "empty"
              ? { ...R22_ANALYTICS_FIXTURE, empty: true, chart: null, insight: null, kpis: [] }
              : R22_ANALYTICS_FIXTURE;
    const fixtureQuality = requestedState === "stale" || requestedState === "partial" || requestedState === "permission" || requestedState === "empty" || requestedState === "unknown" ? requestedState : "ready";
    return <AnalyticsSurface initial={initial} fixture fixtureQuality={fixtureQuality} />;
  }

  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  const initial = await getAnalytics({}).catch(() => ({ state: "transientError" as const }));
  return <AnalyticsSurface initial={initial} />;
}

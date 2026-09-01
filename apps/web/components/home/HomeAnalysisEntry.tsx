import "server-only";

import { redirect } from "next/navigation";

import { HomeAnalysisView } from "@/components/home/HomeAnalysisView";
import { getAnalytics } from "@/lib/analytics-actions";
import { requireOwner } from "@/lib/auth-guard";
import type { HomeAnalysisContext } from "@/lib/home-analysis-context";
import {
  analyticsRangeForHomeRange,
  marketingHealthFromAnalytics,
} from "@/lib/home-marketing-health";

export async function HomeAnalysisEntry({ context }: { context: HomeAnalysisContext }) {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  const analytics = await getAnalytics({
    range: analyticsRangeForHomeRange(context.range),
  }).catch(() => ({ state: "transientError" as const }));

  return (
    <HomeAnalysisView
      context={context}
      health={marketingHealthFromAnalytics(analytics, context.goal, context.range)}
    />
  );
}

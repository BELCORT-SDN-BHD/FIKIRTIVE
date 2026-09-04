import "server-only";

import { redirect } from "next/navigation";

import { MarketingHomeView, type HomeRecentCanvasRead } from "@/components/home/MarketingHomeView";
import { getAnalytics } from "@/lib/analytics-actions";
import { requireOwner } from "@/lib/auth-guard";
import { getProjects } from "@/lib/data";
import {
  analyticsRangeForHomeRange,
  marketingHealthFromAnalytics,
  type HomeSearchState,
} from "@/lib/home-marketing-health";
import { availableHomeComponents, resolveHomeComponents } from "@/lib/home-layout";
import { canManageHome, readHomeLayout } from "@/lib/home-layout-store";
import { MY_DATE_FORMAT } from "@/lib/my-date-format";

const HOME_RECENT_CANVAS_LIMIT = 2;

function formatUpdated(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return MY_DATE_FORMAT.format(date);
}

async function readRecentCanvases(ownerId: string): Promise<HomeRecentCanvasRead> {
  try {
    const projects = await getProjects(ownerId);
    return {
      ok: true,
      value: projects.slice(0, HOME_RECENT_CANVAS_LIMIT).map((project) => ({
        id: project.id,
        name: project.name,
        updatedLabel: formatUpdated(project.updatedAt),
      })),
    };
  } catch {
    return { ok: false };
  }
}

export async function HomeEntry({ filters }: { filters: HomeSearchState }) {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  const [recents, analytics, saved, manageHome] = await Promise.all([
    readRecentCanvases(owner.ownerId),
    getAnalytics({ range: analyticsRangeForHomeRange(filters.range) }).catch(
      () => ({ state: "transientError" as const }),
    ),
    // 版面从服务器读,不从浏览器读 —— 换浏览器、换设备登录读到的是同一行(FRONT-A4)。
    readHomeLayout(owner.ownerId),
    canManageHome(owner),
  ]);

  return (
    <MarketingHomeView
      filters={filters}
      recents={recents}
      health={marketingHealthFromAnalytics(analytics, filters.goal, filters.range)}
      components={resolveHomeComponents({ goal: filters.goal, saved })}
      offeredComponents={availableHomeComponents()}
      recommendedComponents={resolveHomeComponents({ goal: filters.goal, saved: null })}
      canManageHome={manageHome}
    />
  );
}

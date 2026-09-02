import type { Metadata } from "next";

import { HomeAnalysisReference } from "@/design-system/patterns/founder-home/HomeAnalysisReference";
import { isHomeAnalysisState, isHomeAnalysisType } from "@/design-system/patterns/founder-home/home-analysis";
import {
  HOME_COMPARISONS,
  HOME_COMPONENTS,
  HOME_GOALS,
  HOME_RANGES,
  type HomeComparison,
  type HomeComponentId,
  type HomeGoal,
  type HomeRange,
} from "@/design-system/patterns/founder-home/model";
import { assertReviewFixtureRoute } from "@/lib/review-fixture-guard";

export const metadata: Metadata = {
  title: "Home analysis · Fikirtive",
};

function inRegistry<T extends string>(value: string | undefined, registry: readonly { value: T }[], fallback: T): T {
  return registry.some((item) => item.value === value) ? value as T : fallback;
}

function parseLayout(value?: string): HomeComponentId[] | undefined {
  if (!value) return undefined;
  const registered = new Set(HOME_COMPONENTS.map((item) => item.id));
  const layout = value.split(",").filter((item): item is HomeComponentId => registered.has(item as HomeComponentId));
  return layout.length ? [...new Set(layout)] : undefined;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  assertReviewFixtureRoute();
  const params = await searchParams;
  const read = (key: string) => typeof params[key] === "string" ? params[key] as string : undefined;
  const typeParam = read("type");
  const stateParam = read("state");
  const type = isHomeAnalysisType(typeParam) ? typeParam : "performance-change";
  const state = isHomeAnalysisState(stateParam) ? stateParam : "ready";
  const goal = inRegistry<HomeGoal>(read("goal"), HOME_GOALS, "online-sales");
  const range = inRegistry<HomeRange>(read("range"), HOME_RANGES, "30-days");
  const comparison = inRegistry<HomeComparison>(read("comparison"), HOME_COMPARISONS, "previous-period");

  return (
    <HomeAnalysisReference
      type={type}
      state={state}
      goal={goal}
      range={range}
      comparison={comparison}
      originRange={inRegistry<HomeRange>(read("originRange"), HOME_RANGES, range)}
      originComparison={inRegistry<HomeComparison>(read("originComparison"), HOME_COMPARISONS, comparison)}
      layout={parseLayout(read("layout"))}
      subject={read("subject")}
      detail={read("detail")}
      source={read("source")}
      metricLabel={read("metricLabel")}
      value={read("value")}
      change={read("change")}
      changeDirection={read("changeDirection") === "down" ? "down" : read("changeDirection") === "up" ? "up" : undefined}
    />
  );
}

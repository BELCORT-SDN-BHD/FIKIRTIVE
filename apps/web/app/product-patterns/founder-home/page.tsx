import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FounderHomeReference } from "@/design-system/patterns/founder-home/FounderHomeReference";
import { createWorkspaceReviewHref } from "@/design-system/patterns/canvas/review-links";
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
  title: "Founder Home · Fikirtive",
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
  const intent = read("intent");
  const context = read("context");
  if (intent === "create") redirect(createWorkspaceReviewHref(context));
  return (
    <FounderHomeReference
      goal={inRegistry<HomeGoal>(read("goal"), HOME_GOALS, "online-sales")}
      range={inRegistry<HomeRange>(read("range"), HOME_RANGES, "30-days")}
      comparison={inRegistry<HomeComparison>(read("comparison"), HOME_COMPARISONS, "previous-period")}
      layout={parseLayout(read("layout"))}
    />
  );
}

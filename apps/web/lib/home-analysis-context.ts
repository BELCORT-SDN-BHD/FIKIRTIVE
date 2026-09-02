import {
  HOME_ANALYSIS_TYPES,
  type HomeAnalysisType,
} from "@/design-system/patterns/founder-home/home-analysis";
import type {
  HomeComparison,
  HomeGoal,
  HomeRange,
} from "@/design-system/patterns/founder-home/model";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { homeHref, parseHomeSearchState } from "@/lib/home-marketing-health";

export const HOME_ANALYSIS_SUBJECTS = ["meta-ads-overview", "marketing-health-overview"] as const;
export const HOME_RETURN_FOCUS_TARGETS = ["home-main", "marketing-health-heading"] as const;

export type HomeAnalysisSubject = (typeof HOME_ANALYSIS_SUBJECTS)[number];
export type HomeReturnFocusTarget = (typeof HOME_RETURN_FOCUS_TARGETS)[number];

export type HomeAnalysisContext = {
  type: HomeAnalysisType;
  subject: HomeAnalysisSubject;
  goal: HomeGoal;
  range: HomeRange;
  comparison: HomeComparison;
  originRange: HomeRange;
  originComparison: HomeComparison;
  returnFocus: HomeReturnFocusTarget;
};

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseHomeAnalysisContext(search: RawSearchParams): HomeAnalysisContext {
  const filters = parseHomeSearchState(search);
  const rawType = firstString(search.type);
  const rawSubject = firstString(search.subject);
  const rawReturnFocus = firstString(search.returnFocus);
  const origin = parseHomeSearchState({
    goal: filters.goal,
    range: firstString(search.originRange) ?? filters.range,
    comparison: firstString(search.originComparison) ?? filters.comparison,
  });

  return {
    type: HOME_ANALYSIS_TYPES.includes(rawType as HomeAnalysisType)
      ? (rawType as HomeAnalysisType)
      : "data-health",
    subject: HOME_ANALYSIS_SUBJECTS.includes(rawSubject as HomeAnalysisSubject)
      ? (rawSubject as HomeAnalysisSubject)
      : "meta-ads-overview",
    goal: filters.goal,
    range: filters.range,
    comparison: filters.comparison,
    originRange: origin.range,
    originComparison: origin.comparison,
    returnFocus: HOME_RETURN_FOCUS_TARGETS.includes(rawReturnFocus as HomeReturnFocusTarget)
      ? (rawReturnFocus as HomeReturnFocusTarget)
      : "home-main",
  };
}

export function homeHrefFromAnalysis(context: HomeAnalysisContext): string {
  const href = homeHref({
    goal: context.goal,
    range: context.originRange,
    comparison: context.originComparison,
  });
  return `${href}#${context.returnFocus}`;
}

export function homeAnalysisHref(
  context: HomeAnalysisContext,
  patch: Partial<Pick<HomeAnalysisContext, "range" | "comparison">> = {},
  options: { openOtto?: boolean } = {},
): string {
  const query = new URLSearchParams({
    type: context.type,
    subject: context.subject,
    goal: context.goal,
    range: patch.range ?? context.range,
    comparison: patch.comparison ?? context.comparison,
    originRange: context.originRange,
    originComparison: context.originComparison,
    returnFocus: context.returnFocus,
  });
  if (options.openOtto) query.set("otto", "1");
  return `${SHELL_ROUTES.homeAnalysis}?${query.toString()}`;
}

import type { HomeAnalysisState, HomeAnalysisType } from "./home-analysis"
import type { HomeComparison, HomeGoal, HomeRange } from "./model"

export const FOUNDER_HOME_REVIEW_HREF = "/product-patterns/founder-home"
export const HOME_ANALYSIS_REVIEW_HREF = `${FOUNDER_HOME_REVIEW_HREF}/analysis`

export type HomeReviewState = {
  goal: HomeGoal
  range: HomeRange
  comparison: HomeComparison
  layout?: readonly string[]
}

export function founderHomeReviewHref({
  goal,
  range,
  comparison,
  layout,
  focus,
}: HomeReviewState & { focus?: string }): string {
  const params = new URLSearchParams({ goal, range, comparison })
  if (layout?.length) params.set("layout", layout.join(","))
  return `${FOUNDER_HOME_REVIEW_HREF}?${params.toString()}${focus ? `#${focus}` : ""}`
}

export function homeAnalysisReviewHref({
  type,
  state = "ready",
  goal,
  range,
  comparison,
  layout,
  subject,
  detail,
  source,
  metricLabel,
  value,
  change,
  changeDirection,
  originRange = range,
  originComparison = comparison,
}: HomeReviewState & {
  type: HomeAnalysisType
  state?: HomeAnalysisState
  subject?: string
  detail?: string
  source?: string
  metricLabel?: string
  value?: string
  change?: string
  changeDirection?: "up" | "down"
  originRange?: HomeRange
  originComparison?: HomeComparison
}): string {
  const params = new URLSearchParams({ type, state, goal, range, comparison })
  params.set("originRange", originRange)
  params.set("originComparison", originComparison)
  if (layout?.length) params.set("layout", layout.join(","))
  if (subject) params.set("subject", subject)
  if (detail) params.set("detail", detail)
  if (source) params.set("source", source)
  if (metricLabel) params.set("metricLabel", metricLabel)
  if (value) params.set("value", value)
  if (change) params.set("change", change)
  if (changeDirection) params.set("changeDirection", changeDirection)
  return `${HOME_ANALYSIS_REVIEW_HREF}?${params.toString()}`
}

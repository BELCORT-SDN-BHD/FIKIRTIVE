import type { HomeComparison, HomeRange } from "./model"

export const HOME_ANALYSIS_TYPES = [
  "performance-change",
  "top-performer",
  "data-health",
] as const

export type HomeAnalysisType = (typeof HOME_ANALYSIS_TYPES)[number]

export const HOME_ANALYSIS_STATES = [
  "ready",
  "partial",
  "insufficient",
  "error",
  "loading",
] as const

export type HomeAnalysisState = (typeof HOME_ANALYSIS_STATES)[number]

export function isHomeAnalysisType(value?: string): value is HomeAnalysisType {
  return HOME_ANALYSIS_TYPES.includes(value as HomeAnalysisType)
}

export function isHomeAnalysisState(value?: string): value is HomeAnalysisState {
  return HOME_ANALYSIS_STATES.includes(value as HomeAnalysisState)
}

export type HomeAnalysisEvidence = {
  title: string
  detail: string
  source: string
}

export type HomeAnalysisFixture = {
  type: HomeAnalysisType
  title: string
  conclusion: string
  metricLabel: string
  metricValue: string
  metricChange: { value: string; direction: "up" | "down" } | null
  metricDescription: string
  chartTitle: string
  chartUnit: string
  trend: readonly { label: string; value: number }[]
  evidenceStrength: "Strong evidence" | "Some evidence" | "Limited evidence"
  evidenceDescription: string
  evidence: readonly [HomeAnalysisEvidence, HomeAnalysisEvidence, HomeAnalysisEvidence]
  meaning: string
  primaryAction: "create" | "connection"
  primaryActionLabel: string
  breakdownLabel: string
  breakdownRows: readonly { label: string; value: string; change: string }[]
}

const RANGE_LABELS: Record<HomeRange, readonly string[]> = {
  "7-days": ["21 Aug", "22 Aug", "23 Aug", "24 Aug", "25 Aug", "26 Aug", "27 Aug"],
  "30-days": ["29 Jul", "1 Aug", "5 Aug", "8 Aug", "12 Aug", "16 Aug", "19 Aug", "20 Aug", "23 Aug", "27 Aug"],
  "90-days": ["30 May", "12 Jun", "25 Jun", "8 Jul", "21 Jul", "3 Aug", "16 Aug", "27 Aug"],
}

const ANALYSIS_BASE = {
  "performance-change": {
    title: "Meta ads became more efficient",
    conclusion: "Lower cost per purchase helped revenue grow without increasing spend.",
    metricLabel: "Cost per purchase",
    metricValue: "RM 24.80",
    metricChange: { value: "22%", direction: "down" as const },
    metricDescription: "Average cost to acquire a purchase through Meta ads.",
    chartTitle: "Cost per purchase over time",
    chartUnit: "RM per purchase",
    values: {
      "7-days": [29, 27, 26, 24, 23, 21, 19],
      "30-days": [42, 38, 31, 22, 30, 27, 23, 22, 21, 16],
      "90-days": [47, 44, 40, 35, 31, 27, 24, 20],
    },
    evidenceStrength: "Strong evidence" as const,
    evidenceDescription: "Consistent improvement across three connected performance signals.",
    evidence: [
      { title: "Cost per purchase dropped", detail: "CPA fell from RM 31.80 to RM 24.80 with no meaningful increase in spend.", source: "Meta ads" },
      { title: "Conversion rate improved", detail: "Conversion rate increased from 2.1% to 2.6%, helping more visits become purchases.", source: "Website analytics" },
      { title: "High-intent sessions increased", detail: "High-intent sessions grew 19% compared with the previous period.", source: "Website analytics" },
    ] as const,
    meaning: "The same overall budget produced more purchases because more of the right visitors converted at a lower cost.",
    primaryAction: "create" as const,
    primaryActionLabel: "Create a variation",
    breakdownLabel: "Campaign breakdown",
    breakdownRows: [
      { label: "Meta conversions", value: "RM 22.40 CPA", change: "↓ 24%" },
      { label: "Retargeting · Merdeka", value: "RM 25.10 CPA", change: "↓ 18%" },
      { label: "New arrivals", value: "RM 27.80 CPA", change: "↓ 11%" },
    ],
  },
  "top-performer": {
    title: "Sales Aug 2026 was a top performer",
    conclusion: "High-intent search traffic made this period's strongest revenue contribution.",
    metricLabel: "Revenue",
    metricValue: "RM 6,820",
    metricChange: { value: "28.6%", direction: "up" as const },
    metricDescription: "Revenue attributed to this performer in the selected period.",
    chartTitle: "Revenue contribution over time",
    chartUnit: "RM revenue",
    values: {
      "7-days": [520, 610, 680, 730, 880, 1040, 1190],
      "30-days": [360, 440, 510, 620, 590, 760, 850, 980, 1110, 1220],
      "90-days": [310, 420, 540, 690, 810, 940, 1080, 1260],
    },
    evidenceStrength: "Strong evidence" as const,
    evidenceDescription: "Revenue, session quality and conversion moved together across the period.",
    evidence: [
      { title: "Revenue contribution led the period", detail: "The selected performer generated RM 6,820 in attributed revenue.", source: "Shopify" },
      { title: "More visitors showed purchase intent", detail: "High-intent sessions increased 24% compared with similar traffic.", source: "Website analytics" },
      { title: "Conversion stayed efficient", detail: "Conversion improved without a matching increase in acquisition cost.", source: "Connected ads" },
    ] as const,
    meaning: "This performer reached more purchase-ready visitors and converted them without sacrificing efficiency.",
    primaryAction: "create" as const,
    primaryActionLabel: "Create a variation",
    breakdownLabel: "Source breakdown",
    breakdownRows: [
      { label: "Paid search", value: "RM 3,140", change: "↑ 31%" },
      { label: "Meta ads", value: "RM 2,020", change: "↑ 22%" },
      { label: "Email", value: "RM 1,660", change: "↑ 18%" },
    ],
  },
  "data-health": {
    title: "Your marketing data is complete",
    conclusion: "All three connected sources reported recently, so this view uses complete current data.",
    metricLabel: "Sources reporting",
    metricValue: "3 of 3",
    metricChange: null,
    metricDescription: "Shopify, Meta ads and website analytics are included.",
    chartTitle: "Source coverage over time",
    chartUnit: "% reporting",
    values: {
      "7-days": [100, 100, 100, 100, 100, 100, 100],
      "30-days": [96, 100, 100, 100, 98, 100, 100, 100, 100, 100],
      "90-days": [94, 96, 98, 100, 100, 98, 100, 100],
    },
    evidenceStrength: "Strong evidence" as const,
    evidenceDescription: "All expected sources reported within their normal sync windows.",
    evidence: [
      { title: "Shopify is current", detail: "Orders and revenue last synced 12 minutes ago.", source: "Shopify" },
      { title: "Meta ads is current", detail: "Spend and campaign performance last synced 18 minutes ago.", source: "Meta ads" },
      { title: "Website analytics is current", detail: "Sessions and conversion events last synced 9 minutes ago.", source: "Website analytics" },
    ] as const,
    meaning: "No source gap is large enough to change the current marketing-health conclusion.",
    primaryAction: "connection" as const,
    primaryActionLabel: "Manage connections",
    breakdownLabel: "Connection details",
    breakdownRows: [
      { label: "Shopify", value: "12 min ago", change: "Healthy" },
      { label: "Meta ads", value: "18 min ago", change: "Healthy" },
      { label: "Website analytics", value: "9 min ago", change: "Healthy" },
    ],
  },
} as const

const COMPARISON_LABELS: Record<HomeComparison, string> = {
  "previous-period": "vs previous period",
  "previous-year": "vs previous year",
  none: "for this period",
}

export function buildHomeAnalysisFixture({
  type,
  range,
  comparison,
  subject,
  detail,
  source,
  metricLabel,
  value,
  change,
  changeDirection,
}: {
  type: HomeAnalysisType
  range: HomeRange
  comparison: HomeComparison
  subject?: string
  detail?: string
  source?: string
  metricLabel?: string
  value?: string
  change?: string
  changeDirection?: "up" | "down"
}): HomeAnalysisFixture {
  const base = ANALYSIS_BASE[type]
  const title = subject
    ? type === "top-performer" ? `${subject} was a top performer` : subject
    : base.title
  const conclusion = detail || base.conclusion
  const metricValue = value || base.metricValue
  const metricChange = comparison === "none"
    ? null
    : change
      ? { value: change.replace(/^[↑↓]\s*/, ""), direction: changeDirection || (change.trim().startsWith("↓") ? "down" as const : "up" as const) }
      : base.metricChange
  const evidence = type === "top-performer" && source
    ? [
        { ...base.evidence[0], title: `${subject || "This performer"} led the period`, detail: `${source} contributed ${metricValue} in the selected period.` },
        base.evidence[1],
        base.evidence[2],
      ] as const
    : base.evidence

  return {
    type,
    title,
    conclusion,
    metricLabel: metricLabel || base.metricLabel,
    metricValue,
    metricChange,
    metricDescription: base.metricDescription,
    chartTitle: base.chartTitle,
    chartUnit: base.chartUnit,
    trend: RANGE_LABELS[range].map((label, index) => ({ label, value: base.values[range][index] })),
    evidenceStrength: base.evidenceStrength,
    evidenceDescription: `${base.evidenceDescription} ${COMPARISON_LABELS[comparison]}.`,
    evidence,
    meaning: base.meaning,
    primaryAction: base.primaryAction,
    primaryActionLabel: base.primaryActionLabel,
    breakdownLabel: base.breakdownLabel,
    breakdownRows: base.breakdownRows,
  }
}

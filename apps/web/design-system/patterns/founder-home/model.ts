export const HOME_COMPONENT_FAMILIES = [
  "Outcome",
  "Trends",
  "Breakdowns",
  "Attention",
  "Operations",
  "Otto",
] as const;

export type HomeComponentFamily = (typeof HOME_COMPONENT_FAMILIES)[number];

export const HOME_COMPONENTS = [
  {
    id: "marketing-health",
    label: "Marketing health",
    description: "The primary outcome, comparison, and 30-day trend.",
    family: "Outcome",
  },
  {
    id: "efficiency",
    label: "Efficiency",
    description: "Return on ad spend and total ad spend.",
    family: "Outcome",
  },
  {
    id: "what-changed",
    label: "What changed",
    description: "The most important movements in founder language.",
    family: "Attention",
  },
  {
    id: "top-performers",
    label: "Top performers",
    description: "The campaigns or creatives driving results.",
    family: "Breakdowns",
  },
  {
    id: "recommended-action",
    label: "Recommended next action",
    description: "One useful next step prepared by Otto.",
    family: "Otto",
  },
  {
    id: "channel-contribution",
    label: "Channel contribution",
    description: "How each connected channel contributes to revenue.",
    family: "Breakdowns",
  },
  {
    id: "waiting-approval",
    label: "Waiting for approval",
    description: "Work that needs the founder's decision.",
    family: "Operations",
  },
  {
    id: "publishing-next",
    label: "Publishing next",
    description: "The next approved item due to go live.",
    family: "Operations",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  description: string;
  family: HomeComponentFamily;
}[];

export type HomeComponentId = (typeof HOME_COMPONENTS)[number]["id"];

export const ONLINE_SALES_HOME: readonly HomeComponentId[] = [
  "marketing-health",
  "efficiency",
  "what-changed",
  "top-performers",
  "recommended-action",
  "channel-contribution",
];

export const LEADS_BOOKINGS_HOME: readonly HomeComponentId[] = [
  "marketing-health",
  "what-changed",
  "top-performers",
  "efficiency",
  "recommended-action",
  "channel-contribution",
];

export const BRAND_AWARENESS_HOME: readonly HomeComponentId[] = [
  "marketing-health",
  "channel-contribution",
  "what-changed",
  "top-performers",
  "recommended-action",
];

export const HOME_GOALS = [
  { value: "online-sales", label: "Online sales" },
  { value: "leads-bookings", label: "Leads / bookings" },
  { value: "brand-awareness", label: "Brand awareness" },
] as const;

export type HomeGoal = (typeof HOME_GOALS)[number]["value"];

export const HOME_TEMPLATES = {
  "online-sales": ONLINE_SALES_HOME,
  "leads-bookings": LEADS_BOOKINGS_HOME,
  "brand-awareness": BRAND_AWARENESS_HOME,
} as const satisfies Record<HomeGoal, readonly HomeComponentId[]>;

export type HomeLayouts = Record<HomeGoal, HomeComponentId[]>;

export function createHomeLayouts(): HomeLayouts {
  return {
    "online-sales": [...HOME_TEMPLATES["online-sales"]],
    "leads-bookings": [...HOME_TEMPLATES["leads-bookings"]],
    "brand-awareness": [...HOME_TEMPLATES["brand-awareness"]],
  };
}

export const HOME_RANGES = [
  { value: "7-days", label: "Last 7 days" },
  { value: "30-days", label: "Last 30 days" },
  { value: "90-days", label: "Last 90 days" },
] as const;

export type HomeRange = (typeof HOME_RANGES)[number]["value"];

export const HOME_COMPARISONS = [
  { value: "previous-period", label: "Previous period" },
  { value: "previous-year", label: "Previous year" },
  { value: "none", label: "No comparison" },
] as const;

export type HomeComparison = (typeof HOME_COMPARISONS)[number]["value"];

export type HomeChangeDirection = "up" | "down";

export type HomeDashboardChange = {
  value: string;
  direction: HomeChangeDirection;
};

export type HomeDashboardMetric = {
  label: string;
  value: string;
  change: HomeDashboardChange | null;
};

export type HomeDashboardPerformer = {
  label: string;
  source: string;
  value: string;
  change: HomeDashboardChange | null;
  data: readonly number[];
};

/**
 * Full marketing-health payload expected by the approved Home hierarchy.
 * Review fixtures and the future production aggregate share this shape, but
 * production never imports the fixture builder.
 */
export type HomeDashboardSnapshot = {
  goal: HomeGoal;
  headline: string;
  summary: string;
  periodLabel: string;
  comparison: { label: string; periodLabel: string } | null;
  primary: HomeDashboardMetric & { axis: "currency" | "number" };
  trend: readonly { label: string; value: number }[];
  efficiency: readonly [HomeDashboardMetric, HomeDashboardMetric];
  findings: readonly {
    title: string;
    detail: string;
    action: string;
    analysisMetric: {
      label: string;
      value: string;
      change: string;
      direction: HomeChangeDirection;
    };
  }[];
  performerMetric: string;
  campaignPerformers: readonly HomeDashboardPerformer[];
  creativePerformers: readonly HomeDashboardPerformer[];
  channelMetric: string;
  channels: readonly { label: string; share: number; value: string }[];
  recommendation: { title: string; detail: string; prompt: string };
};

export function recommendedHome(goal: HomeGoal): readonly HomeComponentId[] {
  return HOME_TEMPLATES[goal];
}

export function homeComponent(id: HomeComponentId) {
  const component = HOME_COMPONENTS.find((item) => item.id === id);
  if (!component) throw new Error(`Unknown Home component: ${id}`);
  return component;
}

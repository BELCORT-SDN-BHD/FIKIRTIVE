import type {
  HomeChangeDirection,
  HomeComparison,
  HomeDashboardChange,
  HomeDashboardPerformer,
  HomeDashboardSnapshot,
  HomeGoal,
  HomeRange,
} from "./model";

export type {
  HomeChangeDirection as ChangeDirection,
  HomeDashboardChange as DashboardChange,
  HomeDashboardSnapshot as HomeDashboardFixture,
} from "./model";

type ChangeDirection = HomeChangeDirection;
type DashboardChange = HomeDashboardChange;
type DashboardPerformer = HomeDashboardPerformer;
type HomeDashboardFixture = HomeDashboardSnapshot;

type GoalPerformer = {
  label: string;
  source: string;
  amount: number;
  change: number;
  data: readonly number[];
};

type GoalFixture = {
  headline: string;
  primary: {
    label: string;
    axis: "currency" | "number";
    values: Record<HomeRange, number>;
    change: number;
  };
  efficiency: readonly [
    { label: string; values: Record<HomeRange, string>; change: number; direction: ChangeDirection },
    { label: string; values: Record<HomeRange, string>; change: number; direction: ChangeDirection },
  ];
  trendBase: readonly number[];
  findings: HomeDashboardFixture["findings"];
  performerMetric: string;
  campaignPerformers: readonly GoalPerformer[];
  creativePerformers: readonly GoalPerformer[];
  channelMetric: string;
  channels: readonly { label: string; share: number; amount: number }[];
  recommendation: HomeDashboardFixture["recommendation"];
};

const RANGE_META: Record<HomeRange, { label: string; factor: number; trendLabels: readonly string[] }> = {
  "7-days": {
    label: "Last 7 days",
    factor: 0.27,
    trendLabels: ["21 Aug", "22 Aug", "23 Aug", "24 Aug", "25 Aug", "26 Aug", "27 Aug"],
  },
  "30-days": {
    label: "Last 30 days",
    factor: 1,
    trendLabels: ["29 Jul", "1 Aug", "5 Aug", "8 Aug", "12 Aug", "15 Aug", "19 Aug", "21 Aug", "23 Aug", "26 Aug", "27 Aug"],
  },
  "90-days": {
    label: "Last 90 days",
    factor: 2.85,
    trendLabels: ["30 May", "12 Jun", "25 Jun", "8 Jul", "21 Jul", "3 Aug", "16 Aug", "27 Aug"],
  },
};

const COMPARISON_META: Record<Exclude<HomeComparison, "none">, { label: string; periodLabel: Record<HomeRange, string>; changeFactor: number }> = {
  "previous-period": {
    label: "vs previous period",
    periodLabel: {
      "7-days": "vs previous 7 days",
      "30-days": "vs previous 30 days",
      "90-days": "vs previous 90 days",
    },
    changeFactor: 1,
  },
  "previous-year": {
    label: "vs previous year",
    periodLabel: {
      "7-days": "vs the same 7 days last year",
      "30-days": "vs the same 30 days last year",
      "90-days": "vs the same 90 days last year",
    },
    changeFactor: 1.35,
  },
};

const GOAL_FIXTURES: Record<HomeGoal, GoalFixture> = {
  "online-sales": {
    headline: "Marketing is growing efficiently",
    primary: {
      label: "Revenue",
      axis: "currency",
      values: { "7-days": 4820, "30-days": 18420, "90-days": 52100 },
      change: 18.4,
    },
    efficiency: [
      { label: "ROAS", values: { "7-days": "4.1x", "30-days": "3.8x", "90-days": "3.6x" }, change: 0.6, direction: "up" },
      { label: "Ad spend", values: { "7-days": "RM 1,180", "30-days": "RM 4,850", "90-days": "RM 14,420" }, change: 4.7, direction: "down" },
    ],
    trendBase: [380, 520, 310, 590, 360, 620, 880, 1110, 820, 1210, 1080],
    findings: [
      { title: "Sales campaign drove more high-intent traffic", detail: "Sales Aug 2026 brought in 36% more sessions and 24% more revenue.", action: "View analysis", analysisMetric: { label: "High-intent sessions", value: "+36%", change: "36%", direction: "up" } },
      { title: "Meta ads became more efficient", detail: "Lower cost per purchase helped revenue grow without increasing spend.", action: "View analysis", analysisMetric: { label: "Cost per purchase", value: "RM 24.80", change: "22%", direction: "down" } },
      { title: "New product video lifted conversion rate", detail: "Conversion rate improved from 1.9% to 2.6%.", action: "View analysis", analysisMetric: { label: "Conversion rate", value: "2.6%", change: "0.7 pp", direction: "up" } },
    ],
    performerMetric: "By revenue",
    campaignPerformers: [
      { label: "Sales Aug 2026", source: "Search · Malaysia", amount: 6820, change: 28.6, data: [4, 5, 4, 7, 6, 8] },
      { label: "Meta conversions", source: "Meta Ads · Malaysia", amount: 4950, change: 14.2, data: [3, 4, 3, 5, 5, 7] },
      { label: "Promo Merdeka", source: "Performance Max · Malaysia", amount: 3120, change: 9.8, data: [2, 3, 2, 4, 4, 6] },
      { label: "Email — New arrivals", source: "Email · Malaysia", amount: 1420, change: 22.1, data: [2, 2, 3, 2, 4, 6] },
    ],
    creativePerformers: [
      { label: "Coffee ritual video", source: "Meta · 9:16 video", amount: 2880, change: 31.4, data: [2, 3, 4, 3, 5, 7] },
      { label: "Merdeka bundle", source: "Google · Image", amount: 2120, change: 18.9, data: [3, 3, 4, 4, 5, 6] },
      { label: "Founder story", source: "Email · Story", amount: 1740, change: 12.2, data: [2, 4, 3, 5, 4, 6] },
    ],
    channelMetric: "By revenue",
    channels: [
      { label: "Paid Search", share: 46, amount: 8470 },
      { label: "Meta Ads", share: 28, amount: 5180 },
      { label: "Performance Max", share: 17, amount: 3150 },
      { label: "Email", share: 6, amount: 1110 },
      { label: "Organic", share: 3, amount: 510 },
    ],
    recommendation: {
      title: "Review the strongest sales campaign",
      detail: "Ask Otto whether the current budget can grow without reducing efficiency.",
      prompt: "Should I increase the Sales Aug 2026 campaign budget?",
    },
  },
  "leads-bookings": {
    headline: "Lead generation is gaining momentum",
    primary: {
      label: "Qualified leads",
      axis: "number",
      values: { "7-days": 68, "30-days": 286, "90-days": 813 },
      change: 22.7,
    },
    efficiency: [
      { label: "Booking rate", values: { "7-days": "15.8%", "30-days": "14.7%", "90-days": "13.9%" }, change: 2.1, direction: "up" },
      { label: "Cost per lead", values: { "7-days": "RM 15.40", "30-days": "RM 16.90", "90-days": "RM 18.10" }, change: 8.3, direction: "down" },
    ],
    trendBase: [8, 12, 9, 16, 14, 21, 19, 26, 23, 31, 28],
    findings: [
      { title: "WhatsApp enquiries converted into more bookings", detail: "Fast replies produced 19 additional confirmed appointments.", action: "View analysis", analysisMetric: { label: "Confirmed bookings", value: "+19", change: "19", direction: "up" } },
      { title: "The service pricing page reduced drop-off", detail: "Form completion improved after visitors saw a clear starting price.", action: "View analysis", analysisMetric: { label: "Form completion", value: "18.4%", change: "3.2 pp", direction: "up" } },
      { title: "Retargeting recovered undecided visitors", detail: "Returning visitors created 17% of this period's qualified leads.", action: "View analysis", analysisMetric: { label: "Qualified leads", value: "17%", change: "17%", direction: "up" } },
    ],
    performerMetric: "By qualified leads",
    campaignPerformers: [
      { label: "Consultation bookings", source: "Meta Leads · Malaysia", amount: 94, change: 24.1, data: [3, 4, 5, 5, 7, 8] },
      { label: "WhatsApp enquiries", source: "Search · Kuala Lumpur", amount: 76, change: 18.6, data: [2, 4, 3, 6, 6, 7] },
      { label: "Free assessment", source: "Landing page · Malaysia", amount: 61, change: 12.3, data: [2, 3, 3, 4, 5, 6] },
      { label: "Weekend appointments", source: "Instagram · Malaysia", amount: 38, change: 9.7, data: [1, 2, 3, 2, 4, 5] },
    ],
    creativePerformers: [
      { label: "Book in two taps", source: "Meta · 9:16 video", amount: 58, change: 29.4, data: [2, 3, 3, 5, 6, 8] },
      { label: "Before your first visit", source: "Instagram · Carousel", amount: 43, change: 17.9, data: [2, 2, 4, 3, 5, 6] },
      { label: "Founder consultation", source: "Search · Image", amount: 31, change: 11.2, data: [1, 3, 2, 4, 4, 5] },
    ],
    channelMetric: "By qualified leads",
    channels: [
      { label: "Meta Leads", share: 38, amount: 109 },
      { label: "Paid Search", share: 27, amount: 77 },
      { label: "WhatsApp", share: 19, amount: 54 },
      { label: "Instagram", share: 11, amount: 32 },
      { label: "Organic", share: 5, amount: 14 },
    ],
    recommendation: {
      title: "Improve the booking handoff",
      detail: "Ask Otto to find where qualified leads stop before confirming an appointment.",
      prompt: "Where are qualified leads dropping before they book?",
    },
  },
  "brand-awareness": {
    headline: "Brand attention is widening",
    primary: {
      label: "Engaged reach",
      axis: "number",
      values: { "7-days": 32900, "30-days": 128400, "90-days": 352800 },
      change: 16.2,
    },
    efficiency: [
      { label: "Engagement rate", values: { "7-days": "6.9%", "30-days": "6.4%", "90-days": "5.8%" }, change: 1.2, direction: "up" },
      { label: "Cost per 1,000 reached", values: { "7-days": "RM 7.20", "30-days": "RM 7.80", "90-days": "RM 8.40" }, change: 5.1, direction: "down" },
    ],
    trendBase: [8200, 9400, 8700, 11200, 10500, 12900, 13700, 15100, 14600, 16800, 17500],
    findings: [
      { title: "Founder-led stories earned the most saves", detail: "Behind-the-scenes posts were saved 2.4x more than product-only posts.", action: "View analysis", analysisMetric: { label: "Save rate", value: "2.4x", change: "140%", direction: "up" } },
      { title: "Video reached a new local audience", detail: "Seventy-one percent of engaged viewers had not interacted with the brand before.", action: "View analysis", analysisMetric: { label: "New audience share", value: "71%", change: "12%", direction: "up" } },
      { title: "Organic mentions increased after the launch", detail: "Customers created 38 public posts featuring the new collection.", action: "View analysis", analysisMetric: { label: "Organic mentions", value: "38", change: "21%", direction: "up" } },
    ],
    performerMetric: "By engaged reach",
    campaignPerformers: [
      { label: "Meet the founder", source: "Instagram · Malaysia", amount: 48200, change: 26.8, data: [3, 4, 5, 6, 7, 9] },
      { label: "Merdeka collection", source: "Meta Video · Malaysia", amount: 36700, change: 19.3, data: [2, 4, 4, 6, 6, 8] },
      { label: "How it is made", source: "TikTok · Malaysia", amount: 24100, change: 14.6, data: [2, 3, 4, 4, 6, 7] },
      { label: "Customer rituals", source: "Organic · Malaysia", amount: 19400, change: 11.5, data: [1, 3, 3, 5, 5, 6] },
    ],
    creativePerformers: [
      { label: "Morning ritual reel", source: "Instagram · 9:16 video", amount: 31800, change: 32.1, data: [2, 3, 5, 4, 7, 9] },
      { label: "Founder portrait", source: "Meta · Image", amount: 24600, change: 21.7, data: [2, 4, 3, 5, 6, 8] },
      { label: "Workshop carousel", source: "Instagram · Carousel", amount: 18100, change: 13.4, data: [2, 2, 4, 4, 5, 7] },
    ],
    channelMetric: "By engaged reach",
    channels: [
      { label: "Instagram", share: 41, amount: 52600 },
      { label: "Meta Video", share: 26, amount: 33400 },
      { label: "TikTok", share: 18, amount: 23100 },
      { label: "Organic search", share: 9, amount: 11600 },
      { label: "Email", share: 6, amount: 7700 },
    ],
    recommendation: {
      title: "Extend the strongest brand story",
      detail: "Ask Otto to turn the founder-led story into the next three channel-ready ideas.",
      prompt: "Turn the strongest founder story into three follow-up ideas.",
    },
  },
};

function compactNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Math.round(value));
}

function formatValue(goal: HomeGoal, value: number) {
  if (goal === "online-sales") return `RM ${Math.round(value).toLocaleString("en-MY")}`;
  return compactNumber(value);
}

function changeFor(value: number, direction: ChangeDirection, comparison: HomeComparison): DashboardChange | null {
  if (comparison === "none") return null;
  return {
    value: `${(value * COMPARISON_META[comparison].changeFactor).toFixed(1)}%`,
    direction,
  };
}

function fitTrend(values: readonly number[], length: number) {
  if (values.length === length) return values;
  return Array.from({ length }, (_, index) => values[Math.round(index * (values.length - 1) / Math.max(length - 1, 1))]);
}

export function buildHomeDashboardFixture(goal: HomeGoal, range: HomeRange, comparison: HomeComparison): HomeDashboardFixture {
  const fixture = GOAL_FIXTURES[goal];
  const rangeMeta = RANGE_META[range];
  const comparisonMeta = comparison === "none" ? null : COMPARISON_META[comparison];
  const primaryChange = changeFor(fixture.primary.change, "up", comparison);
  const primaryValue = formatValue(goal, fixture.primary.values[range]);
  const trendValues = fitTrend(fixture.trendBase, rangeMeta.trendLabels.length);

  const mapPerformers = (items: readonly GoalPerformer[]): readonly DashboardPerformer[] => items.map((item) => ({
    label: item.label,
    source: item.source,
    value: formatValue(goal, item.amount * rangeMeta.factor),
    change: changeFor(item.change, "up", comparison),
    data: item.data,
  }));

  return {
    goal,
    headline: fixture.headline,
    summary: comparisonMeta && primaryChange
      ? `${fixture.primary.label} is ${primaryChange.direction === "up" ? "up" : "down"} ${primaryChange.value} ${comparisonMeta.label}.`
      : `${fixture.primary.label} is ${primaryValue} for ${rangeMeta.label.toLowerCase()}.`,
    periodLabel: rangeMeta.label,
    comparison: comparisonMeta ? { label: comparisonMeta.label, periodLabel: comparisonMeta.periodLabel[range] } : null,
    primary: {
      label: fixture.primary.label,
      value: primaryValue,
      axis: fixture.primary.axis,
      change: primaryChange,
    },
    trend: rangeMeta.trendLabels.map((label, index) => ({ label, value: Math.round(trendValues[index] * rangeMeta.factor) })),
    efficiency: [
      {
        label: fixture.efficiency[0].label,
        value: fixture.efficiency[0].values[range],
        change: changeFor(fixture.efficiency[0].change, fixture.efficiency[0].direction, comparison),
      },
      {
        label: fixture.efficiency[1].label,
        value: fixture.efficiency[1].values[range],
        change: changeFor(fixture.efficiency[1].change, fixture.efficiency[1].direction, comparison),
      },
    ],
    findings: fixture.findings,
    performerMetric: fixture.performerMetric,
    campaignPerformers: mapPerformers(fixture.campaignPerformers),
    creativePerformers: mapPerformers(fixture.creativePerformers),
    channelMetric: fixture.channelMetric,
    channels: fixture.channels.map((channel) => ({
      label: channel.label,
      share: channel.share,
      value: formatValue(goal, channel.amount * rangeMeta.factor),
    })),
    recommendation: fixture.recommendation,
  };
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Database,
  GripVertical,
  ImagePlus,
  PanelsTopLeft,
  Settings2,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { ProductPatternShellFrame } from "@/design-system/patterns/application-shell/ProductPatternShellFrame";
import { OttoMark } from "@/components/brand/OttoMark";
import { OttoPanelFlowReference, useOttoPanelReference } from "@/components/otto/panel/OttoPanelFlowReference";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { REVIEW_ACCOUNT } from "@/design-system/patterns/application-shell/review-account";
import { settingsSectionReviewHref } from "@/design-system/patterns/settings/review-links";
import {
  CANVAS_REVIEW_HREF,
  CREATE_WORKSPACE_REVIEW_HREF,
  createWorkspaceReviewHref,
} from "@/design-system/patterns/canvas/review-links";
import { DesktopHomeRequired, useDesktopHome } from "./DesktopHomeBoundary";
import {
  buildHomeDashboardFixture,
  type DashboardChange,
  type HomeDashboardFixture,
} from "./fixtures";
import {
  HOME_COMPARISONS,
  HOME_COMPONENT_FAMILIES,
  HOME_COMPONENTS,
  HOME_GOALS,
  HOME_RANGES,
  createHomeLayouts,
  homeComponent,
  recommendedHome,
  type HomeComparison,
  type HomeComponentId,
  type HomeGoal,
  type HomeRange,
} from "./model";
import {
  founderHomeReviewHref,
  homeAnalysisReviewHref,
  type HomeReviewState,
} from "./review-links";

const DEFAULT_RECOMMENDED_OTTO_PROMPT = buildHomeDashboardFixture(
  "online-sales",
  "30-days",
  "previous-period",
).recommendation.prompt;

const FULL_WIDTH_COMPONENTS = new Set<HomeComponentId>(["marketing-health", "efficiency"]);

export type FounderHomeReferenceProps = HomeReviewState;

function Picker({
  label,
  icon: Icon,
  value,
  options,
  onValueChange,
  disabled = false,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  value: string;
  options: readonly { value: string; label: string }[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger size="sm" aria-label={label} className="border-transparent bg-transparent px-2.5 shadow-none hover:bg-accent">
        <Icon className="size-4" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Change({ children, direction = "up" }: { children: React.ReactNode; direction?: "up" | "down" }) {
  const Icon = direction === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", direction === "up" ? "text-success-soft-foreground" : "text-muted-foreground")}>
      <Icon className="size-3.5" aria-hidden />
      {children}
    </span>
  );
}

function MetricChange({ change }: { change: DashboardChange | null }) {
  if (!change) return null;
  return <Change direction={change.direction}>{change.value}</Change>;
}

function MarketingHealth({ dashboard, reviewState }: { dashboard: HomeDashboardFixture; reviewState: HomeReviewState }) {
  const axisFormatter = (value: number) => dashboard.primary.axis === "currency"
    ? `RM ${value}`
    : new Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);

  return (
    <section aria-labelledby="marketing-health-heading" className="col-span-full border-b border-border pb-6">
      <div className="mb-3">
        <h2 id="marketing-health-heading" className="text-lg font-semibold tracking-[-0.02em]">
          <Link
            href={homeAnalysisReviewHref({
              ...reviewState,
              type: "performance-change",
              subject: dashboard.headline,
              detail: dashboard.summary,
              metricLabel: dashboard.primary.label,
              value: dashboard.primary.value,
              change: dashboard.primary.change?.value,
              changeDirection: dashboard.primary.change?.direction,
            })}
            className="rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            {dashboard.headline}
          </Link>
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{dashboard.summary}</p>
      </div>
      <div className="grid min-w-0 grid-cols-[170px_minmax(0,1fr)] items-end gap-8">
        <div className="pb-5">
          <p className="text-xs text-muted-foreground">{dashboard.primary.label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] tabular-nums">{dashboard.primary.value}</p>
          {dashboard.comparison ? (
            <div className="mt-2 flex items-center gap-2">
              <MetricChange change={dashboard.primary.change} />
              <span className="text-xs text-muted-foreground">{dashboard.comparison.periodLabel}</span>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">{dashboard.periodLabel}</p>
          )}
        </div>
        <ChartContainer
          config={{ value: { label: dashboard.primary.label, color: "var(--info)" } }}
          className="h-[164px] w-full aspect-auto"
          initialDimension={{ width: 860, height: 164 }}
        >
          <AreaChart data={dashboard.trend} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={52} />
            <YAxis axisLine={false} tickLine={false} width={60} tickFormatter={axisFormatter} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--color-value)"
              fill="var(--color-value)"
              fillOpacity={0.08}
              strokeWidth={2}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </section>
  );
}

function Efficiency({ dashboard, reviewState }: { dashboard: HomeDashboardFixture; reviewState: HomeReviewState }) {
  const [first, second] = dashboard.efficiency;
  return (
    <section aria-label="Efficiency and source completeness" className="col-span-full grid grid-cols-3 border-b border-border py-4">
      <div className="pr-8">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{first.label} <CircleHelp className="size-3.5" aria-hidden /></div>
        <p className="mt-2 text-xl font-semibold tabular-nums">{first.value}</p>
        {dashboard.comparison ? <div className="mt-1"><MetricChange change={first.change} /> <span className="text-xs text-muted-foreground">{dashboard.comparison.label}</span></div> : null}
      </div>
      <div className="border-l border-border px-8">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{second.label} <CircleHelp className="size-3.5" aria-hidden /></div>
        <p className="mt-2 text-xl font-semibold tabular-nums">{second.value}</p>
        {dashboard.comparison ? <div className="mt-1"><MetricChange change={second.change} /> <span className="text-xs text-muted-foreground">{dashboard.comparison.label}</span></div> : null}
      </div>
      <Link
        id="source-completeness"
        href={homeAnalysisReviewHref({
          ...reviewState,
          type: "data-health",
          subject: "Your marketing data is complete",
          detail: "All three connected sources reported recently, so this view uses complete current data.",
          metricLabel: "Sources reporting",
          value: "3 of 3",
        })}
        className="group flex items-center border-l border-border pl-8 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
          <CheckCircle2 className="size-4" aria-hidden />
        </span>
        <span className="ml-3">
          <span className="block text-xs text-muted-foreground">Source completeness</span>
          <span className="mt-1 block text-sm font-semibold">All good</span>
          <span className="block text-xs text-muted-foreground">3 of 3 sources reporting</span>
        </span>
        <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </section>
  );
}

function WhatChanged({ dashboard, reviewState }: { dashboard: HomeDashboardFixture; reviewState: HomeReviewState }) {
  return (
    <section id="what-changed" aria-labelledby="what-changed-heading" className="min-w-0 border-b border-border py-5">
      <h2 id="what-changed-heading" className="text-sm font-semibold">What changed</h2>
      <p className="mt-1 text-xs text-muted-foreground">{dashboard.comparison ? `Key drivers ${dashboard.comparison.periodLabel}` : `Key drivers for ${dashboard.periodLabel.toLowerCase()}`}</p>
      <ol className="mt-4 space-y-4">
        {dashboard.findings.map((finding, index) => (
          <li key={finding.title} className="grid grid-cols-[26px_minmax(0,1fr)] gap-3">
            <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-semibold">{index + 1}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{finding.title}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{finding.detail}</p>
              <Link
                href={homeAnalysisReviewHref({
                  ...reviewState,
                  type: "performance-change",
                  subject: finding.title,
                  detail: finding.detail,
                  metricLabel: finding.analysisMetric.label,
                  value: finding.analysisMetric.value,
                  change: finding.analysisMetric.change,
                  changeDirection: finding.analysisMetric.direction,
                })}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-info hover:underline"
              >
                {finding.action}<ChevronRight className="size-3" aria-hidden />
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Sparkline({ values }: { values: readonly number[] }) {
  const data = values.map((value, index) => ({ index, value }));
  return (
    <ChartContainer config={{ value: { color: "var(--foreground)" } }} className="h-8 w-28 aspect-auto" initialDimension={{ width: 112, height: 32 }}>
      <LineChart data={data} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
        <Line dataKey="value" stroke="var(--color-value)" strokeWidth={1.5} type="monotone" dot={false} />
      </LineChart>
    </ChartContainer>
  );
}

function TopPerformers({ dashboard, reviewState }: { dashboard: HomeDashboardFixture; reviewState: HomeReviewState }) {
  const [view, setView] = React.useState("campaigns");
  const performers = view === "campaigns" ? dashboard.campaignPerformers : dashboard.creativePerformers;
  return (
    <section aria-labelledby="top-performers-heading" className="min-w-0 border-b border-border py-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="top-performers-heading" className="text-sm font-semibold">Top performers</h2>
          <p className="mt-1 text-xs text-muted-foreground">{dashboard.performerMetric}</p>
        </div>
        <Select value={view} onValueChange={setView}>
          <SelectTrigger size="sm" aria-label="Top performer type"><SelectValue /></SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="campaigns">Campaigns</SelectItem>
            <SelectItem value="creatives">Creatives</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-3 divide-y divide-border">
        {performers.map((item) => (
          <Link
            key={item.label}
            href={homeAnalysisReviewHref({
              ...reviewState,
              type: "top-performer",
              subject: item.label,
              source: item.source,
              metricLabel: dashboard.performerMetric.replace(/^By /, "").replace(/^./, (letter) => letter.toUpperCase()),
              value: item.value,
              change: item.change?.value,
              changeDirection: item.change?.direction,
            })}
            className="group grid grid-cols-[minmax(0,1fr)_100px_64px_112px] items-center gap-3 py-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{item.label}</p>
              <p className="truncate text-xs text-muted-foreground">{item.source}</p>
            </div>
            <p className="text-right text-sm font-semibold tabular-nums">{item.value}</p>
            <MetricChange change={item.change} />
            <Sparkline values={item.data} />
          </Link>
        ))}
      </div>
    </section>
  );
}

function RecommendedAction({ dashboard }: { dashboard: HomeDashboardFixture }) {
  const otto = useOttoPanelReference();
  return (
    <section aria-labelledby="recommended-action-heading" className="min-w-0 py-5">
      <h2 id="recommended-action-heading" className="text-sm font-semibold">Recommended next action</h2>
      <p className="mt-1 text-xs text-muted-foreground">Otto can help you take the next best step.</p>
      <div className="mt-4 flex items-center rounded-[var(--radius-card)] border border-border p-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-soft">
          <OttoMark expression="helpful" size={34} />
        </span>
        <div className="ml-3 min-w-0 flex-1">
          <p className="text-sm font-semibold">{dashboard.recommendation.title}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{dashboard.recommendation.detail}</p>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => otto?.askOtto(dashboard.recommendation.prompt)}>
            <Sparkles aria-hidden /> Ask Otto
          </Button>
          <Link className={buttonVariants({ size: "sm" })} href={createWorkspaceReviewHref(dashboard.recommendation.title)}>
            <ImagePlus aria-hidden /> Create this
          </Link>
        </div>
      </div>
    </section>
  );
}

function CreationShortcuts() {
  return (
    <section aria-label="Creation shortcuts" className="border-b border-border py-3">
      <div className="flex items-center gap-3">
        <div className="mr-1 min-w-0">
          <p className="text-xs font-semibold">Continue creating</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Pick up a recent canvas, or start from a fresh outcome.</p>
        </div>
        {["Merdeka launch", "Weekend tea launch"].map((name) => (
          <Link className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "max-w-48")} href={CANVAS_REVIEW_HREF} key={name}>
            <PanelsTopLeft aria-hidden /> <span className="truncate">{name}</span>
          </Link>
        ))}
        <Link className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto shrink-0")} href={CREATE_WORKSPACE_REVIEW_HREF}>
          Create something new <ChevronRight aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function ChannelContribution({ dashboard, reviewState }: { dashboard: HomeDashboardFixture; reviewState: HomeReviewState }) {
  return (
    <section aria-labelledby="channel-heading" className="min-w-0 py-5">
      <h2 id="channel-heading" className="text-sm font-semibold">Channel contribution</h2>
      <p className="mt-1 text-xs text-muted-foreground">{dashboard.channelMetric}</p>
      <div className="mt-3 space-y-2.5">
        {dashboard.channels.map((channel) => (
          <Link
            key={channel.label}
            href={homeAnalysisReviewHref({
              ...reviewState,
              type: "top-performer",
              subject: channel.label,
              source: "Connected marketing sources",
              metricLabel: dashboard.channelMetric.replace(/^By /, "").replace(/^./, (letter) => letter.toUpperCase()),
              value: channel.value,
            })}
            className="group grid grid-cols-[116px_minmax(80px,1fr)_38px_92px_16px] items-center gap-3 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <span className="truncate">{channel.label}</span>
            <Progress value={channel.share} className="h-1.5 bg-secondary" />
            <span className="text-right tabular-nums">{channel.share}%</span>
            <span className="text-right tabular-nums text-muted-foreground">{channel.value}</span>
            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        ))}
      </div>
    </section>
  );
}

function OperationComponent({ type }: { type: "waiting-approval" | "publishing-next" }) {
  const waiting = type === "waiting-approval";
  return (
    <section className="min-w-0 py-5">
      <h2 className="text-sm font-semibold">{waiting ? "Waiting for approval" : "Publishing next"}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{waiting ? "Nothing needs your decision." : "No approved posts are scheduled."}</p>
      <Empty className="mt-4 min-h-36 border border-border py-6">
        <EmptyHeader>
          <EmptyMedia variant="icon"><CheckCircle2 /></EmptyMedia>
          <EmptyTitle>{waiting ? "All caught up" : "Nothing scheduled"}</EmptyTitle>
          <EmptyDescription>{waiting ? "New approvals will appear here." : "Approved work will appear here."}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </section>
  );
}

function HomeComponent({ id, dashboard, reviewState }: { id: HomeComponentId; dashboard: HomeDashboardFixture; reviewState: HomeReviewState }) {
  switch (id) {
    case "marketing-health": return <MarketingHealth dashboard={dashboard} reviewState={reviewState} />;
    case "efficiency": return <Efficiency dashboard={dashboard} reviewState={reviewState} />;
    case "what-changed": return <WhatChanged dashboard={dashboard} reviewState={reviewState} />;
    case "top-performers": return <TopPerformers dashboard={dashboard} reviewState={reviewState} />;
    case "recommended-action": return <RecommendedAction dashboard={dashboard} />;
    case "channel-contribution": return <ChannelContribution dashboard={dashboard} reviewState={reviewState} />;
    case "waiting-approval": return <OperationComponent type="waiting-approval" />;
    case "publishing-next": return <OperationComponent type="publishing-next" />;
  }
}

function CustomizeHomePanel({
  selected,
  onToggle,
  onMove,
  onReorder,
  onCancel,
  onReset,
  onSave,
}: {
  selected: readonly HomeComponentId[];
  onToggle: (id: HomeComponentId, checked: boolean) => void;
  onMove: (id: HomeComponentId, direction: -1 | 1) => void;
  onReorder: (fromId: HomeComponentId, toId: HomeComponentId) => void;
  onCancel: () => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const [draggedId, setDraggedId] = React.useState<HomeComponentId | null>(null);

  return (
    <aside aria-label="Customize home" className="sticky top-0 z-[46] flex h-[calc(100dvh-2.75rem)] w-[340px] shrink-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Customize home</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose what matters, then put it in the right order.</p>
          </div>
          <Button type="button" variant="ghost" size="icon-xs" onClick={onCancel} aria-label="Close customize home">
            <X aria-hidden />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Home order</h3>
        <div className="mt-3 space-y-2">
          {selected.map((id, index) => {
            const item = homeComponent(id);
            return (
              <div
                key={id}
                draggable
                onDragStart={(event) => {
                  setDraggedId(id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedId && draggedId !== id) onReorder(draggedId, id);
                  setDraggedId(null);
                }}
                onDragEnd={() => setDraggedId(null)}
                className={cn(
                  "flex cursor-grab items-center gap-2 rounded-lg border border-border bg-background p-2 active:cursor-grabbing",
                  draggedId === id && "opacity-50",
                )}
              >
                <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.label}</span>
                <Button type="button" variant="ghost" size="icon-xs" disabled={index === 0} onClick={() => onMove(id, -1)} aria-label={`Move ${item.label} up`}>
                  <ArrowUp aria-hidden />
                </Button>
                <Button type="button" variant="ghost" size="icon-xs" disabled={index === selected.length - 1} onClick={() => onMove(id, 1)} aria-label={`Move ${item.label} down`}>
                  <ArrowUp className="rotate-180" aria-hidden />
                </Button>
              </div>
            );
          })}
        </div>
        <Separator className="my-5" />
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Component library</h3>
        <div className="mt-4 space-y-5">
          {HOME_COMPONENT_FAMILIES.map((family) => {
            const items = HOME_COMPONENTS.filter((item) => item.family === family);
            if (!items.length) return null;
            return (
              <div key={family}>
                <p className="mb-2 text-xs font-semibold">{family}</p>
                <div className="space-y-1">
                  {items.map((item) => {
                    const checked = selected.includes(item.id);
                    return (
                      <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-accent">
                        <Checkbox checked={checked} onCheckedChange={(value) => onToggle(item.id, value)} aria-label={item.label} />
                        <span>
                          <span className="block text-xs font-semibold">{item.label}</span>
                          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{item.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-t border-border p-4">
        <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={onReset}>Reset</Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="button" size="sm" onClick={onSave}>Save</Button>
      </div>
    </aside>
  );
}

function FounderHomeCanvas({ initialState }: { initialState: FounderHomeReferenceProps }) {
  const router = useRouter();
  const isDesktop = useDesktopHome();
  const [goal, setGoal] = React.useState<HomeGoal>(initialState.goal);
  const [range, setRange] = React.useState<HomeRange>(initialState.range);
  const [comparison, setComparison] = React.useState<HomeComparison>(initialState.comparison);
  const [savedByGoal, setSavedByGoal] = React.useState(() => {
    const layouts = createHomeLayouts();
    if (initialState.layout?.length) layouts[initialState.goal] = [...initialState.layout] as HomeComponentId[];
    return layouts;
  });
  const [draft, setDraft] = React.useState<HomeComponentId[]>(() => initialState.layout?.length
    ? [...initialState.layout] as HomeComponentId[]
    : [...recommendedHome(initialState.goal)]);
  const [customizing, setCustomizing] = React.useState(false);
  const dashboard = React.useMemo(
    () => buildHomeDashboardFixture(goal, range, comparison),
    [comparison, goal, range],
  );
  const visible = customizing ? draft : savedByGoal[goal];
  const reviewState: HomeReviewState = { goal, range, comparison, layout: savedByGoal[goal] };

  function replaceHome(next: HomeReviewState) {
    router.replace(founderHomeReviewHref(next), { scroll: false });
  }

  function changeGoal(nextGoal: HomeGoal) {
    setGoal(nextGoal);
    replaceHome({ goal: nextGoal, range, comparison, layout: savedByGoal[nextGoal] });
  }

  function changeRange(nextRange: HomeRange) {
    setRange(nextRange);
    replaceHome({ goal, range: nextRange, comparison, layout: savedByGoal[goal] });
  }

  function changeComparison(nextComparison: HomeComparison) {
    setComparison(nextComparison);
    replaceHome({ goal, range, comparison: nextComparison, layout: savedByGoal[goal] });
  }

  function startCustomizing() {
    setDraft([...savedByGoal[goal]]);
    setCustomizing(true);
  }

  function toggleComponent(id: HomeComponentId, checked: boolean) {
    setDraft((current) => checked ? [...current, id] : current.filter((value) => value !== id));
  }

  function moveComponent(id: HomeComponentId, direction: -1 | 1) {
    setDraft((current) => {
      const from = current.indexOf(id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  function reorderComponent(fromId: HomeComponentId, toId: HomeComponentId) {
    setDraft((current) => {
      const from = current.indexOf(fromId);
      const to = current.indexOf(toId);
      if (from < 0 || to < 0 || from === to) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function saveHome() {
    setSavedByGoal((current) => ({ ...current, [goal]: [...draft] }));
    setCustomizing(false);
    replaceHome({ goal, range, comparison, layout: draft });
    toast.success("Home saved");
  }

  if (!isDesktop) return <DesktopHomeRequired />;

  return (
      <div className="flex min-h-full">
        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1220px] px-8 py-6">
            <div className="flex items-center justify-between gap-4">
              <h1 className="text-3xl font-semibold tracking-[-0.035em]">Home</h1>
              {!customizing ? (
                <div className="flex items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={startCustomizing}>
                    <Settings2 aria-hidden /> Customize home
                  </Button>
                </div>
              ) : (
                <span className="text-xs font-medium text-muted-foreground">Previewing unsaved changes</span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1 border-b border-border pb-4">
              <Picker label="Business goal" icon={Target} value={goal} options={HOME_GOALS} onValueChange={(value) => changeGoal(value as HomeGoal)} disabled={customizing} />
              <Picker label="Date range" icon={CalendarRange} value={range} options={HOME_RANGES} onValueChange={(value) => changeRange(value as HomeRange)} disabled={customizing} />
              <Picker label="Comparison" icon={ArrowUpRight} value={comparison} options={HOME_COMPARISONS} onValueChange={(value) => changeComparison(value as HomeComparison)} disabled={customizing} />
              <Link href={settingsSectionReviewHref("connections")} className="ml-auto inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40">
                <Database className="size-3.5" aria-hidden /> Updated 12 min ago · 3 sources
              </Link>
            </div>

            {!customizing ? <CreationShortcuts /> : null}

            {visible.length ? (
              <div data-founder-home-components className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,26rem),1fr))] gap-x-8">
                {visible.map((id) => (
                  <div key={id} data-home-component={id} className={cn("min-w-0", FULL_WIDTH_COMPONENTS.has(id) && "col-span-full")}>
                    <HomeComponent id={id} dashboard={dashboard} reviewState={reviewState} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty className="mt-8 min-h-80 border border-border">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Settings2 /></EmptyMedia>
                  <EmptyTitle>Choose what belongs on Home</EmptyTitle>
                  <EmptyDescription>Add components from the library to build this workspace Home.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </main>
        {customizing ? (
          <CustomizeHomePanel
            selected={draft}
            onToggle={toggleComponent}
            onMove={moveComponent}
            onReorder={reorderComponent}
            onCancel={() => { setDraft([...savedByGoal[goal]]); setCustomizing(false); }}
            onReset={() => setDraft([...recommendedHome(goal)])}
            onSave={saveHome}
          />
        ) : null}
      </div>
  );
}

export function FounderHomeReference(props: FounderHomeReferenceProps) {
  const reviewKey = [props.goal, props.range, props.comparison, props.layout?.join(",")].join("|");
  return (
    <div className="gb min-h-dvh bg-background text-foreground">
      <OttoPanelFlowReference
        founderName={REVIEW_ACCOUNT.displayName}
        recommendedPrompt={DEFAULT_RECOMMENDED_OTTO_PROMPT}
      >
        <ProductPatternShellFrame
          pathname={SHELL_ROUTES.home}
        >
          <FounderHomeCanvas key={reviewKey} initialState={props} />
        </ProductPatternShellFrame>
      </OttoPanelFlowReference>
    </div>
  );
}

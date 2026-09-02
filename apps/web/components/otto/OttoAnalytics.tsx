"use client";

import React, { useState, useTransition } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartNoAxesCombined,
  LockKeyhole,
  Minus,
  PlugZap,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { getAnalytics, type AnalyticsData } from "@/lib/analytics-actions";
import { RANGES, buildCurrencyNotes, type RangeKey } from "@/lib/analytics-view";
import { ANALYTICS_PLATFORM_LABEL } from "@/lib/analytics-platforms";
import { formatCalendarDay } from "@/lib/schedule-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { OttoAvatar } from "./OttoAvatar";
import type { OttoViewKey } from "./otto-view-param";
import { PerAdPerformance } from "./PerAdPerformance";

const chartConfig = {
  reach: { label: "Reach", color: "var(--foreground)" },
} satisfies ChartConfig;

export function OttoAnalytics({
  initial,
  onNavigate,
  onUseInOtto,
}: {
  initial: AnalyticsData;
  onNavigate: (view: OttoViewKey) => void;
  onUseInOtto?: (prompt: string) => void;
}) {
  const [data, setData] = useState<AnalyticsData>(initial);
  const [pending, startTransition] = useTransition();

  function loadRange(range: RangeKey) {
    startTransition(async () => setData(await getAnalytics({ range })));
  }

  const isReady = data.state === "ready";
  const currencyNotes = isReady
    ? buildCurrencyNotes(data.kpis)
    : { multipleCurrencies: null, unreportedCurrency: null };
  const rangeLabel = isReady
    ? RANGES.find((range) => range.key === data.range)?.label ?? ""
    : "";

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-7 lg:py-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-[-0.025em] sm:text-[1.75rem]">Analytics</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Read Meta performance without changing your campaigns.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge>{ANALYTICS_PLATFORM_LABEL}</Badge>
              <Badge variant="outline">Read-only</Badge>
            </div>
          </div>
          {isReady && (
            <NativeSelect
              aria-label="Date range"
              size="sm"
              value={data.range}
              disabled={pending}
              onChange={(event) => loadRange(event.target.value as RangeKey)}
              className="min-w-40 bg-card font-medium"
            >
              {RANGES.map((range) => (
                <NativeSelectOption key={range.key} value={range.key}>
                  {range.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </header>

        {data.state === "notConnected" && <ConnectionState kind="connect" onNavigate={onNavigate} />}
        {data.state === "needsReconnect" && <ConnectionState kind="reconnect" onNavigate={onNavigate} />}
        {data.state === "transientError" && (
          <Empty className="min-h-80 border border-border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon"><RefreshCw aria-hidden /></EmptyMedia>
              <EmptyTitle>Couldn&apos;t reach Meta just now</EmptyTitle>
              <EmptyDescription>
                Your connection is fine. Meta may be temporarily unavailable, so try again in a moment.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={() => loadRange("30d")} disabled={pending}>
                <RefreshCw data-icon="inline-start" aria-hidden />
                {pending ? "Trying again…" : "Try again"}
              </Button>
            </EmptyContent>
          </Empty>
        )}

        {isReady && (
          <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <section aria-label="Key metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.kpis.map((kpi) => (
                <Card key={kpi.label} size="sm">
                  <CardHeader>
                    <CardDescription className="font-medium">{kpi.label}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {(data.empty ? [{ text: "—", currency: null, accountName: null }] : kpi.values).map(
                        (value, index) => (
                          <div key={`${value.currency ?? ""}|${value.accountName ?? ""}|${index}`}>
                            <div className={kpi.values.length > 1 ? "text-xl font-bold tabular-nums tracking-tight" : "text-2xl font-bold tabular-nums tracking-tight sm:text-[1.7rem]"}>
                              {value.text}
                            </div>
                            {!data.empty && value.accountName !== null && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Currency not reported — {value.accountName}
                              </p>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                    {kpi.delta && <DeltaBadge delta={kpi.delta} />}
                  </CardContent>
                </Card>
              ))}
            </section>

            {(data.empty || currencyNotes.multipleCurrencies || currencyNotes.unreportedCurrency) && (
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                {data.empty && <p>No activity in this period yet.</p>}
                {currencyNotes.multipleCurrencies && <p>{currencyNotes.multipleCurrencies}</p>}
                {currencyNotes.unreportedCurrency && <p>{currencyNotes.unreportedCurrency}</p>}
              </div>
            )}

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.75fr)]">
              <Card>
                <CardHeader>
                  <CardTitle>Reach over time</CardTitle>
                  <CardDescription>{rangeLabel}</CardDescription>
                </CardHeader>
                <CardContent>
                  {data.chart ? (
                    <ChartContainer config={chartConfig} className="h-[280px] w-full" role="img" aria-label={`Reach over time, ${rangeLabel}`}>
                      <AreaChart data={data.chart.points} margin={{ left: -8, right: 8, top: 8 }} accessibilityLayer>
                        <defs>
                          <linearGradient id="reach-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--color-reach)" stopOpacity={0.16} />
                            <stop offset="95%" stopColor="var(--color-reach)" stopOpacity={0.01} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={28} tickFormatter={formatCalendarDay} />
                        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={44} tickFormatter={(value: number) => value.toLocaleString("en-US", { notation: "compact" })} />
                        <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(label) => formatCalendarDay(String(label))} />} />
                        <Area dataKey="value" name="reach" type="monotone" fill="url(#reach-fill)" stroke="var(--color-reach)" strokeWidth={2} activeDot={{ r: 4 }} />
                      </AreaChart>
                    </ChartContainer>
                  ) : (
                    <Empty className="min-h-64">
                      <EmptyHeader>
                        <EmptyMedia variant="icon"><ChartNoAxesCombined aria-hidden /></EmptyMedia>
                        <EmptyTitle>No reach activity yet</EmptyTitle>
                        <EmptyDescription>The chart will appear after Meta reports activity for this period.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </CardContent>
              </Card>

              <div className="grid content-start gap-4">
                {data.insight && (
                  <Card tone="otto">
                    <CardHeader className="flex-row items-center gap-3">
                      <OttoAvatar size={38} mood="helpful" />
                      <div>
                        <CardTitle>Otto insight</CardTitle>
                        <CardDescription>Based on this reporting period</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed text-brand-soft-foreground">{data.insight.text}</p>
                    </CardContent>
                    <CardFooter>
                      <Button
                        size="sm"
                        onClick={() => {
                          if (onUseInOtto) onUseInOtto(data.insight!.prefill);
                          else onNavigate("otto");
                        }}
                      >
                        Make more like it
                      </Button>
                    </CardFooter>
                  </Card>
                )}

                <Card size="sm">
                  <Empty className="min-h-48 p-4 md:p-6">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><LockKeyhole aria-hidden /></EmptyMedia>
                      <EmptyTitle className="text-base">Top posts need one more permission</EmptyTitle>
                      <EmptyDescription>
                        This section will appear automatically after Meta approves per-post reporting.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </Card>
              </div>
            </div>

            <PerAdPerformance range={data.range} />
          </div>
        )}
      </div>
    </div>
  );
}

function DeltaBadge({ delta }: { delta: { dir: "up" | "down" | "flat"; text: string } }) {
  const Icon = delta.dir === "up" ? TrendingUp : delta.dir === "down" ? TrendingDown : Minus;
  const variant = delta.dir === "up" ? "success" : delta.dir === "down" ? "destructive" : "default";
  const value = delta.text.replace(/^[▲▼]\s*/, "");
  return (
    <Badge variant={variant} className="mt-3">
      <Icon aria-hidden />
      {value} vs prev. period
    </Badge>
  );
}

function ConnectionState({ kind, onNavigate }: { kind: "connect" | "reconnect"; onNavigate: (view: OttoViewKey) => void }) {
  const isConnect = kind === "connect";
  return (
    <Empty className="min-h-80 border border-border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon"><PlugZap aria-hidden /></EmptyMedia>
        <EmptyTitle>{isConnect ? "Connect Instagram or Facebook to see your numbers" : "Reconnect Meta"}</EmptyTitle>
        <EmptyDescription>
          Analytics reads reach, spend and results straight from Meta. It never changes your campaigns.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={() => onNavigate("connections")}>
          {isConnect ? "Open connections" : "Reconnect"}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

"use client";

import React, { useEffect, useState, useTransition } from "react";
import { CirclePlay, Megaphone } from "lucide-react";
import { getAdPerformance } from "@/lib/meta-performance-actions";
import { buildPerAdView, type PerAdView } from "@/lib/per-ad-view";
import { RANGES, type RangeKey } from "@/lib/analytics-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function PerAdPerformance({ range }: { range: RangeKey }) {
  const [view, setView] = useState<PerAdView | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    const preset = RANGES.find((item) => item.key === range)?.preset ?? "last_30d";
    start(async () => {
      const result = await getAdPerformance(preset);
      if (!result || "error" in result || "notConnected" in result || "needsReconnect" in result || "transientError" in result) {
        setGone(true);
        return;
      }
      setGone(false);
      setView(buildPerAdView(result));
    });
  }, [range]);

  if (gone) return null;

  const notes = [view?.currencyNote, view?.unreportedNote, view?.truncatedNote].filter(Boolean);

  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Per-ad performance</CardTitle>
          <CardDescription>Compare specific ads and creatives using Meta&apos;s reported results.</CardDescription>
        </div>
        {view && <Badge variant="outline">{view.stamp}</Badge>}
      </CardHeader>
      <CardContent>
        {notes.length > 0 && (
          <div className="mb-4 space-y-1 text-xs leading-relaxed text-muted-foreground">
            {notes.map((note) => <p key={note}>{note}</p>)}
          </div>
        )}

        {pending && !view && <PerformanceSkeleton />}

        {view && view.rows.length === 0 && (
          <Empty className="min-h-52">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Megaphone aria-hidden /></EmptyMedia>
              <EmptyTitle>No ads ran in this period</EmptyTitle>
              <EmptyDescription>Ads will appear here after Meta reports their first results.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {view && view.rows.length > 0 && (
          <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-56">Ad</TableHead>
                  {view.rows[0]?.metrics.map((metric) => (
                    <TableHead key={metric.label} className="text-right text-muted-foreground">{metric.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.rows.map((row) => (
                  <React.Fragment key={row.adId}>
                    {row.groupLabel && (
                      <TableRow className="bg-muted/35 hover:bg-muted/35">
                        <TableCell colSpan={6} className="py-2 text-xs font-semibold text-muted-foreground">
                          {row.groupLabel}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="relative size-11 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                            {row.creative.imageUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={row.creative.imageUrl} alt="" className="size-full object-cover" />
                            )}
                            {row.creative.isVideo && (
                              <div className="absolute inset-0 grid place-items-center bg-foreground/20 text-white">
                                <CirclePlay className="size-5 drop-shadow-sm" aria-hidden />
                              </div>
                            )}
                          </div>
                          <span className="max-w-64 truncate font-medium">{row.name}</span>
                        </div>
                      </TableCell>
                      {row.metrics.map((metric) => (
                        <TableCell key={metric.label} className={metric.value === "—" ? "text-right font-medium text-muted-foreground" : "text-right font-semibold tabular-nums"}>
                          {metric.value}
                        </TableCell>
                      ))}
                    </TableRow>
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PerformanceSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading ad performance">
      <div className="flex gap-3">
        <Skeleton className="size-11 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
      <div className="flex gap-3">
        <Skeleton className="size-11 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
    </div>
  );
}

export default PerAdPerformance;

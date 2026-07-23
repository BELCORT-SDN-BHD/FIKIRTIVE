"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  LoaderCircle,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { listBroadcastRuns } from "@/lib/customer-broadcast-ui-actions";
import { getCustomerBroadcastReport } from "@/lib/customer-broadcast-report-ui-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import ReportAxisGroups from "./report-axis-groups";
import {
  broadcastTitle,
  channelLabel,
  dateTimeLabel,
  errorMessage,
  isDenialErrorCode,
  purposeLabel,
  runStatusPresentation,
  shortBroadcastId,
} from "./report-format";

type RunsResult = Awaited<ReturnType<typeof listBroadcastRuns>>;
type RunsSuccess = Extract<RunsResult, { ok: true }>;
type Run = RunsSuccess["resource"][number];
type ReportResult = Awaited<ReturnType<typeof getCustomerBroadcastReport>>;

export type BroadcastReportListItem = { run: Run; report: ReportResult };

function DeniedState() {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning-soft-foreground">
          <AlertCircle className="size-5" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM Reports</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This report workspace is not available</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          It may not exist, or your account may not have access. Delivery reports are owner-scoped and read-only.
        </p>
        <Button asChild className="mt-6" variant="secondary"><Link href="/otto"><ArrowLeft />Return to Otto</Link></Button>
      </section>
    </main>
  );
}

function ReportReadError({ code }: { code: string }) {
  return (
    <div className="mt-4 rounded-xl border border-destructive/30 bg-error-soft px-4 py-3 text-sm leading-6 text-destructive">
      <p className="font-semibold">Aggregate report unavailable</p>
      <p className="mt-1">{errorMessage(code)}</p>
    </div>
  );
}

export default function BroadcastReportListPage({
  initialRuns,
  initialItems,
}: {
  initialRuns: RunsResult;
  initialItems: BroadcastReportListItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [listError, setListError] = useState<string | null>(initialRuns.ok ? null : initialRuns.error);
  const [loading, setLoading] = useState(false);

  const reportAccessDenied =
    items.length > 0 &&
    items.every(
      (item) => !item.report.ok && ["NOT_AUTHORIZED", "ACTION_DENIED"].includes(item.report.error),
    );
  if ((listError && isDenialErrorCode(listError)) || reportAccessDenied) return <DeniedState />;

  async function refresh() {
    setLoading(true);
    try {
      const runs = await listBroadcastRuns({});
      if (!runs.ok) {
        setListError(runs.error);
        return;
      }
      const nextItems = await Promise.all(
        runs.resource.map(async (run) => ({
          run,
          report: await getCustomerBroadcastReport({ broadcastRunId: run.id }),
        })),
      );
      setItems(nextItems);
      setListError(null);
    } catch {
      setListError("NETWORK");
    } finally {
      setLoading(false);
    }
  }

  const partialFailures = items.filter((item) => !item.report.ok).length;

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/otto" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="size-4" />Return to Otto
            </Link>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">CRM</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Delivery reports</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Review each broadcast across sending attempts, provider receipts, and reconciliation. These axes stay separate so missing evidence never looks successful.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={() => void refresh()} disabled={loading}>
              {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Refresh
            </Button>
            <Button asChild variant="secondary"><Link href="/crm/broadcasts">Open broadcasts</Link></Button>
          </div>
        </header>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
          <Unplug className="mt-0.5 size-4 shrink-0" />
          <span><strong>Simulated workspace.</strong> Provider receipts are not connected. Delivered, read, and failed therefore remain <strong>Unknown</strong> — never zero and never a green success state.</span>
        </div>

        {listError && !isDenialErrorCode(listError) ? (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-error-soft px-4 py-3 text-sm leading-6 text-destructive">
            <p className="font-semibold">The report list could not refresh</p>
            <p className="mt-1">{listError === "NETWORK" ? "The request could not finish. Please retry." : errorMessage(listError)}</p>
          </div>
        ) : null}

        {partialFailures > 0 ? (
          <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
            Some report data could not load. Available axes remain visible, and missing values were not replaced with zero.
          </div>
        ) : null}

        {items.length === 0 && listError ? (
          <section className="mt-6 rounded-[var(--radius-card)] border border-dashed border-destructive/40 bg-card px-6 py-14 text-center shadow-sm">
            <AlertCircle className="mx-auto size-8 text-destructive" />
            <h2 className="mt-4 text-lg font-semibold">The report list could not load</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              {listError === "NETWORK" ? "The request could not finish. Please retry." : errorMessage(listError)}
            </p>
            <Button className="mt-5" type="button" variant="secondary" onClick={() => void refresh()} disabled={loading}>
              {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Retry
            </Button>
          </section>
        ) : items.length === 0 ? (
          <section className="mt-6 rounded-[var(--radius-card)] border border-dashed border-border bg-card px-6 py-14 text-center shadow-sm">
            <BarChart3 className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No broadcast reports yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Once a broadcast exists, its known sending attempts and honest receipt state will appear here.
            </p>
            <Button asChild className="mt-5" variant="secondary"><Link href="/crm/broadcasts">Open broadcasts</Link></Button>
          </section>
        ) : (
          <section className="mt-6 grid gap-5" aria-label="Broadcast delivery reports">
            {items.map(({ run, report }) => {
              const status = runStatusPresentation(run.status);
              return (
                <Card key={run.id}>
                  <CardContent>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={status.variant}>{status.label}</Badge>
                          <Badge variant="outline">{purposeLabel(run.purpose)}</Badge>
                          <Badge variant="outline">{channelLabel(run.channel)}</Badge>
                        </div>
                        <h2 className="mt-3 text-xl font-semibold tracking-tight">{broadcastTitle(run.purpose)}</h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Broadcast {shortBroadcastId(run.id)} · Created {dateTimeLabel(run.createdAt)}
                        </p>
                      </div>
                      <Button asChild variant="secondary" className="shrink-0">
                        <Link href={`/crm/reports/${run.id}`}>View report<ArrowRight /></Link>
                      </Button>
                    </div>
                    {report.ok ? <div className="mt-5"><ReportAxisGroups report={report.resource} /></div> : <ReportReadError code={report.error} />}
                  </CardContent>
                </Card>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}

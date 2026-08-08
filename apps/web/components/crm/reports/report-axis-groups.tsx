import { CircleHelp, Radio, Scale } from "lucide-react";
import type { ReactNode } from "react";
import type { getCustomerBroadcastReport } from "@/lib/customer-broadcast-report-ui-actions";
import { Badge } from "@/components/ui/badge";
import { skipReasonCopy } from "@/components/crm/broadcasts/broadcast-format";
import { dateTimeLabel } from "./report-format";

type ReportResult = Awaited<ReturnType<typeof getCustomerBroadcastReport>>;
type ReportSuccess = Extract<ReportResult, { ok: true }>;
export type BroadcastReportResource = ReportSuccess["resource"];

type Metric = { status: string; value: number | null };

/**
 * #731 — every one of these tiles can read "Unknown" instead of a number, and today
 * (no provider receipts connected anywhere) that is the normal case, not the edge one.
 * The tile used to be laid out for digits — a fixed three-across grid plus `tabular-nums`
 * on the whole value row — so at 1280px the word ran 19px past its own border and over
 * the next tile. Two changes, both about the word:
 *   1. `tabular-nums` moves onto the number itself; it is a digit-alignment feature and
 *      has no business sizing a word.
 *   2. the value row wraps and the icon refuses to shrink, so no width can push the word
 *      out of the tile — it takes a second line first.
 * The tracks themselves are content-sized in the grids below.
 */
function MetricValue({ label, metric }: { label: string; metric: Metric }) {
  const value = metric.status === "known" ? metric.value : null;
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background/70 px-3 py-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xl font-semibold tracking-tight">
        {value !== null ? (
          <span className="tabular-nums">{value.toLocaleString("en-MY")}</span>
        ) : (
          <>
            <CircleHelp className="size-4 shrink-0 text-muted-foreground" />
            <span>Unknown</span>
          </>
        )}
      </dd>
    </div>
  );
}

/**
 * Tracks sized by what a tile has to hold, not by a column count (#731). 8.5rem is the
 * width the widest value ("Unknown", with its icon, at this type size) needs; below that
 * the grid drops a column instead of overflowing one.
 */
const METRIC_GRID = "mt-3 grid gap-2 grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]";

function FreshnessLine({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs leading-5 text-muted-foreground">{children}</p>;
}

export default function ReportAxisGroups({
  report,
  showSkipReasons = false,
}: {
  report: BroadcastReportResource;
  showSkipReasons?: boolean;
}) {
  const skipReasons = Object.entries(
    report.sending.skipped.byReason as Record<string, number>,
  ).sort(([left], [right]) => left.localeCompare(right));

  return (
    <div>
      <div className="grid gap-3 lg:grid-cols-3">
        <section className="rounded-[var(--radius-card)] border border-border border-l-4 border-l-brand bg-card p-4" aria-labelledby={`sending-${report.broadcastRunId}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id={`sending-${report.broadcastRunId}`} className="font-semibold">Sending attempts</h3>
            </div>
            <Badge variant="soft">Known</Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">What happened before provider receipts.</p>
          <dl className={METRIC_GRID}>
            <MetricValue label="Attempted" metric={report.sending.attempted} />
            <MetricValue label="Pending" metric={report.sending.pending} />
            <MetricValue label="Skipped" metric={report.sending.skipped} />
            <MetricValue label="Unavailable" metric={report.sending.unavailable} />
          </dl>
          {showSkipReasons && skipReasons.length > 0 ? (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-xs font-semibold">Skip reasons</p>
              <ul className="mt-2 grid gap-2 text-xs leading-5 text-muted-foreground">
                {skipReasons.map(([reason, count]) => (
                  <li key={reason} className="flex items-start justify-between gap-3">
                    <span>{skipReasonCopy(reason)}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <FreshnessLine>Data loaded {dateTimeLabel(report.sending.freshness.lastDataLoadedAt)}</FreshnessLine>
        </section>

        <section className="rounded-[var(--radius-card)] border border-border border-l-4 border-l-muted-foreground/35 bg-card p-4" aria-labelledby={`delivery-${report.broadcastRunId}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id={`delivery-${report.broadcastRunId}`} className="font-semibold">Provider receipts</h3>
            </div>
            <Badge variant="outline"><CircleHelp />Unknown</Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Provider receipts are not connected in this simulated workspace.</p>
          <dl className={METRIC_GRID}>
            <MetricValue label="Delivered" metric={report.delivery.delivered} />
            <MetricValue label="Read" metric={report.delivery.read} />
            <MetricValue label="Failed" metric={report.delivery.failed} />
          </dl>
          <FreshnessLine>
            Last provider event: {dateTimeLabel(report.delivery.freshness.lastProviderEventAt)}<br />
            Data loaded {dateTimeLabel(report.delivery.freshness.lastDataLoadedAt)}
          </FreshnessLine>
        </section>

        <section className="rounded-[var(--radius-card)] border border-border border-l-4 border-l-warning/60 bg-card p-4" aria-labelledby={`reconciliation-${report.broadcastRunId}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id={`reconciliation-${report.broadcastRunId}`} className="font-semibold">Reconciliation</h3>
            </div>
            <Badge variant="warning"><Scale />Separate</Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Unsettled receipt evidence stays separate from delivery outcomes.</p>
          <dl className={METRIC_GRID}>
            <MetricValue label="Pending" metric={report.reconciliation.pending} />
            <MetricValue label="Conflict" metric={report.reconciliation.conflict} />
            <MetricValue label="Timeout unknown" metric={report.reconciliation.timeoutUnknown} />
          </dl>
          <FreshnessLine>
            Last reconciled: {dateTimeLabel(report.reconciliation.freshness.lastReconciledAt)}<br />
            Data loaded {dateTimeLabel(report.reconciliation.freshness.lastDataLoadedAt)}
          </FreshnessLine>
        </section>
      </div>

      <div className="mt-3 flex items-start gap-3 rounded-xl border border-border bg-secondary/35 px-4 py-3">
        <Radio className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 text-sm leading-6">
          <span className="font-semibold">Reply rate: </span>
          <Badge variant="outline" className="align-middle">Deferred</Badge>
          <span className="ml-2 text-muted-foreground">Replies are not attributed to a specific broadcast on this report.</span>
        </div>
      </div>
    </div>
  );
}

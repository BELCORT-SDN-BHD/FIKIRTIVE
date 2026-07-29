"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CircleHelp,
  LoaderCircle,
  RefreshCw,
  Unplug,
  Users,
} from "lucide-react";
import { getBroadcastRun } from "@/lib/customer-broadcast-ui-actions";
import {
  getBroadcastDeliveryReceipt,
  getCustomerBroadcastReport,
} from "@/lib/customer-broadcast-report-ui-actions";
import { memberDisplay, skipReasonCopy } from "@/components/crm/broadcasts/broadcast-format";
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
  lifecyclePresentation,
  purposeLabel,
  receiptReasonCopy,
  reconciliationPresentation,
  runStatusPresentation,
  sendStatePresentation,
  shortBroadcastId,
} from "./report-format";

type RunResult = Awaited<ReturnType<typeof getBroadcastRun>>;
type ReportResult = Awaited<ReturnType<typeof getCustomerBroadcastReport>>;
type ReceiptResult = Awaited<ReturnType<typeof getBroadcastDeliveryReceipt>>;

export type BroadcastReceiptEntry = {
  audienceMemberId: string;
  result: ReceiptResult | null;
  transportError?: boolean;
};

export type BroadcastReportDetailInitialState = {
  run: RunResult;
  report: ReportResult;
  receipts: BroadcastReceiptEntry[];
};

function DetailUnavailable() {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning-soft-foreground">
          <AlertCircle className="size-5" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM Reports</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This broadcast report is not available</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          It may not exist, or you may not have access. Nothing was changed, and no report data was guessed.
        </p>
        <Button asChild className="mt-6" variant="secondary"><Link href="/crm/reports"><ArrowLeft />Back to reports</Link></Button>
      </section>
    </main>
  );
}

function ReadErrorCard({ title, code }: { title: string; code: string }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-dashed border-destructive/40 bg-card px-6 py-10 text-center shadow-sm">
      <AlertCircle className="mx-auto size-8 text-destructive" />
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{errorMessage(code)}</p>
      <p className="mt-2 font-mono text-xs text-muted-foreground">Error code: {code}</p>
    </section>
  );
}

export default function BroadcastReportDetailPage({
  broadcastRunId,
  initialState,
}: {
  broadcastRunId: string;
  initialState: BroadcastReportDetailInitialState;
}) {
  const [state, setState] = useState(initialState);
  const [loading, setLoading] = useState(false);
  const [transportError, setTransportError] = useState(false);

  const denialCode = !state.run.ok && isDenialErrorCode(state.run.error)
    ? state.run.error
    : !state.report.ok && isDenialErrorCode(state.report.error)
      ? state.report.error
      : null;
  if (denialCode) return <DetailUnavailable />;

  async function refresh() {
    setLoading(true);
    setTransportError(false);
    try {
      const [run, report] = await Promise.all([
        getBroadcastRun({ broadcastRunId }),
        getCustomerBroadcastReport({ broadcastRunId }),
      ]);
      const receipts: BroadcastReceiptEntry[] = run.ok
        ? await Promise.all(
            run.resource.members.map(async (member) => {
              try {
                return {
                  audienceMemberId: member.id,
                  result: await getBroadcastDeliveryReceipt({
                    broadcastRunId,
                    audienceMemberId: member.id,
                  }),
                };
              } catch {
                return { audienceMemberId: member.id, result: null, transportError: true };
              }
            }),
          )
        : [];
      setState({ run, report, receipts });
    } catch {
      setTransportError(true);
    } finally {
      setLoading(false);
    }
  }

  if (!state.run.ok) {
    return (
      <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
        <div className="mx-auto max-w-4xl">
          <Link href="/crm/reports" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" />Back to reports
          </Link>
          <div className="mt-5"><ReadErrorCard title="This broadcast could not load" code={state.run.error} /></div>
          <Button className="mt-4" type="button" variant="secondary" onClick={() => void refresh()} disabled={loading}>
            {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Retry
          </Button>
        </div>
      </main>
    );
  }

  const { run, members } = state.run.resource;
  const status = runStatusPresentation(run.status);
  const receiptByMember = new Map(state.receipts.map((entry) => [entry.audienceMemberId, entry]));
  const receiptFailures = members.filter((member) => !receiptByMember.get(member.id)?.result?.ok).length;

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-6xl">
        <Link href="/crm/reports" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" />Back to reports
        </Link>

        <header className="mt-4 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status.variant}>{status.label}</Badge>
              <Badge variant="outline">{purposeLabel(run.purpose)}</Badge>
              <Badge variant="outline">{channelLabel(run.channel)}</Badge>
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{broadcastTitle(run.purpose)} report</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Broadcast {shortBroadcastId(run.id)} · Created {dateTimeLabel(run.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={() => void refresh()} disabled={loading}>
              {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Refresh
            </Button>
            <Button asChild variant="secondary"><Link href={`/crm/broadcasts/${run.id}`}>Open broadcast</Link></Button>
          </div>
        </header>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
          <Unplug className="mt-0.5 size-4 shrink-0" />
          <span><strong>Simulated workspace.</strong> Sending attempts are recorded. Provider delivery, read, and failure receipts are not connected, so those outcomes remain <strong>Unknown</strong>.</span>
        </div>

        {transportError ? (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-error-soft px-4 py-3 text-sm leading-6 text-destructive">
            The refresh could not finish. The previously loaded report remains visible.
          </div>
        ) : null}

        <section className="mt-7" aria-labelledby="report-overview-heading">
          <div className="mb-4">
            <h2 id="report-overview-heading" className="text-xl font-semibold tracking-tight">Report overview</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Each part of this report has its own reliability and freshness. No combined success rate is shown.</p>
          </div>
          {state.report.ok ? (
            <ReportAxisGroups report={state.report.resource} showSkipReasons />
          ) : (
            <ReadErrorCard title="The aggregate report could not load" code={state.report.error} />
          )}
        </section>

        <section className="mt-8" aria-labelledby="recipient-receipts-heading">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="recipient-receipts-heading" className="text-xl font-semibold tracking-tight">Recipient receipts</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Sending state and provider receipt state remain separate for every recipient.</p>
            </div>
            <p className="text-sm text-muted-foreground">{members.length} {members.length === 1 ? "recipient" : "recipients"}</p>
          </div>

          {receiptFailures > 0 ? (
            <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
              Some recipient receipts could not load. Their outcomes remain unavailable and were not replaced with a status.
            </div>
          ) : null}

          {members.length === 0 ? (
            <section className="mt-4 rounded-[var(--radius-card)] border border-dashed border-border bg-card px-6 py-14 text-center shadow-sm">
              <Users className="mx-auto size-8 text-muted-foreground" />
              <h3 className="mt-4 text-base font-semibold">No recipients in this report</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">This broadcast has no frozen audience members yet.</p>
            </section>
          ) : (
            <div className="mt-4 grid gap-3">
              {members.map((member) => {
                const display = memberDisplay(member);
                const send = sendStatePresentation(member.sendState);
                const entry = receiptByMember.get(member.id);
                const receipt = entry?.result?.ok ? entry.result.resource : null;
                const lifecycle = lifecyclePresentation(receipt?.lifecycle ?? "unknown");
                const reconciliation = receipt ? reconciliationPresentation(receipt.reconciliation) : null;
                const reason = receiptReasonCopy(receipt?.reason);
                const noAttempt = member.sendState !== "simulated_sent";

                return (
                  <Card key={member.id}>
                    <CardContent className="flex flex-col gap-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{display.name}</p>
                          {display.handle ? <p className="mt-1 truncate text-xs text-muted-foreground">{display.handle}</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={send.variant}>{send.label}</Badge>
                          <Badge variant={lifecycle.variant}><CircleHelp />Receipt: {lifecycle.label}</Badge>
                          {reconciliation ? <Badge variant={reconciliation.variant}>Reconciliation: {reconciliation.label}</Badge> : null}
                        </div>
                      </div>

                      {entry?.result && !entry.result.ok ? (
                        <p className="rounded-xl border border-destructive/30 bg-error-soft px-3 py-2 text-xs leading-5 text-destructive">
                          Receipt unavailable. {errorMessage(entry.result.error)}
                        </p>
                      ) : entry?.transportError || !entry ? (
                        <p className="rounded-xl border border-destructive/30 bg-error-soft px-3 py-2 text-xs leading-5 text-destructive">
                          Receipt unavailable. The request could not finish.
                        </p>
                      ) : (
                        <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-[1fr_auto] sm:items-start">
                          <div>
                            <p className="text-xs leading-5 text-muted-foreground">
                              {noAttempt
                                ? "No sending attempt reached this recipient, so no provider delivery fact exists."
                                : reason ?? "No provider delivery fact has been recorded."}
                            </p>
                            {member.skipReason ? <p className="mt-1 text-xs leading-5 text-muted-foreground">Skip reason: {skipReasonCopy(member.skipReason)}</p> : null}
                          </div>
                          <div className="text-xs leading-5 text-muted-foreground sm:text-right">
                            <p>Provider event: {dateTimeLabel(receipt?.lastProviderEventAt)}</p>
                            <p>Last reconciled: {dateTimeLabel(receipt?.lastReconciledAt)}</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

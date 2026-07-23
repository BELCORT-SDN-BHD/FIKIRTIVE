"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, CircleHelp, Clock3, LoaderCircle, Route, ShieldAlert } from "lucide-react";
import {
  getContactJourneyStates,
  listRoutineRuns,
} from "@/lib/customer-workflow-ui-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  dateTimeLabel,
  journeyStatusPresentation,
  reasonCodeCopy,
  runStatusPresentation,
  shortWorkflowId,
  workflowErrorMessage,
} from "./workflow-format";

type RunsResult = Awaited<ReturnType<typeof listRoutineRuns>>;
type Run = Extract<RunsResult, { ok: true }>["resource"]["items"][number];
type JourneysResult = Awaited<ReturnType<typeof getContactJourneyStates>>;
type Journey = Extract<JourneysResult, { ok: true }>["resource"]["items"][number];

function Reason({ code }: { code: string | null }) {
  if (!code) return null;
  return (
    <div className="mt-3 rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <p className="text-xs leading-5 text-muted-foreground">{reasonCodeCopy(code)}</p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">Reason code: {code}</p>
    </div>
  );
}

function UnavailablePanel({
  icon: Icon,
  title,
  copy,
}: {
  icon: typeof Activity;
  title: string;
  copy: string;
}) {
  return (
    <Card className="border-dashed shadow-none">
      <CardContent>
        <span className="grid size-10 place-items-center rounded-xl bg-secondary text-muted-foreground"><Icon className="size-4" /></span>
        <div className="mt-4 flex items-center gap-2"><h3 className="font-semibold">{title}</h3><Badge variant="outline">Unavailable</Badge></div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p>
      </CardContent>
    </Card>
  );
}

function summaryLabel(summary: Run["summary"]): string | null {
  if (!summary) return null;
  const entries = Object.entries(summary);
  return entries.length === 0
    ? null
    : entries.map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`).join(" · ");
}

export default function WorkflowMonitoring({
  workflowDefinitionId,
  initialRuns,
  initialJourneys,
}: {
  workflowDefinitionId: string;
  initialRuns: RunsResult;
  initialJourneys: JourneysResult;
}) {
  const [runs, setRuns] = useState<Run[]>(initialRuns.ok ? initialRuns.resource.items : []);
  const [runCursor, setRunCursor] = useState(initialRuns.ok ? initialRuns.resource.nextCursor : null);
  const [runError, setRunError] = useState<string | null>(initialRuns.ok ? null : initialRuns.error);
  const [journeys, setJourneys] = useState<Journey[]>(initialJourneys.ok ? initialJourneys.resource.items : []);
  const [journeyCursor, setJourneyCursor] = useState(
    initialJourneys.ok ? initialJourneys.resource.nextCursor : null,
  );
  const [journeyError, setJourneyError] = useState<string | null>(
    initialJourneys.ok ? null : initialJourneys.error,
  );
  const [busy, setBusy] = useState<"runs" | "journeys" | null>(null);

  async function loadMoreRuns() {
    if (!runCursor) return;
    setBusy("runs");
    try {
      const page = await listRoutineRuns({ workflowDefinitionId, cursor: runCursor, limit: 50 });
      if (!page.ok) setRunError(page.error);
      else {
        setRuns((current) => [...current, ...page.resource.items]);
        setRunCursor(page.resource.nextCursor);
        setRunError(null);
      }
    } catch {
      setRunError("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  async function loadMoreJourneys() {
    if (!journeyCursor) return;
    setBusy("journeys");
    try {
      const page = await getContactJourneyStates({
        workflowDefinitionId,
        cursor: journeyCursor,
        limit: 50,
      });
      if (!page.ok) setJourneyError(page.error);
      else {
        setJourneys((current) => [...current, ...page.resource.items]);
        setJourneyCursor(page.resource.nextCursor);
        setJourneyError(null);
      }
    } catch {
      setJourneyError("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="activity" className="scroll-mt-8" aria-labelledby="workflow-activity-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">Observe</p>
          <h2 id="workflow-activity-heading" className="mt-2 text-2xl font-semibold tracking-tight">Runs and journeys</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">A run is one trigger occurrence. Local status is not a provider receipt or delivery claim.</p>
        </div>
        <Badge variant="outline">Simulated era</Badge>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 rounded-xl border border-border bg-secondary/25 p-4 text-sm">
        <div><p className="font-semibold text-warning-soft-foreground">Blocked</p><p className="mt-1 text-xs leading-5 text-muted-foreground">A safety or authority gate stopped the next action.</p></div>
        <div><p className="font-semibold text-destructive">Failed</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The workflow engine hit an error.</p></div>
        <div><p className="font-semibold">Unavailable</p><p className="mt-1 text-xs leading-5 text-muted-foreground">A required dependency or fact could not be verified.</p></div>
      </div>

      <div className="mt-5 grid gap-8">
        <div>
          <h3 className="text-lg font-semibold">Run history</h3>
          {runError ? <div className="mt-3"><UnavailablePanel icon={Activity} title="Run history" copy={runError === "NETWORK" ? "The request could not finish. Previously loaded run data is not treated as current." : workflowErrorMessage(runError)} /></div> : runs.length === 0 ? <p className="mt-3 rounded-xl border border-dashed border-border bg-card px-5 py-8 text-sm text-muted-foreground">No Routine runs yet.</p> : <div className="mt-3 grid gap-3">{runs.map((run) => { const status = runStatusPresentation(run.status); return <Card key={run.id}><CardContent className="grid grid-cols-[minmax(0,1fr)_auto] gap-4"><div><div className="flex flex-wrap items-center gap-2"><Badge variant={status.variant}>{status.label}</Badge><Badge variant="outline">{run.triggerKind.replaceAll("_", " ")}</Badge>{run.simulated ? <Badge variant="brand">Simulation only</Badge> : null}</div><p className="mt-3 text-sm font-semibold">Run {shortWorkflowId(run.id)}</p><p className="mt-1 text-xs text-muted-foreground">Current step: {run.currentStepKey ?? "Not recorded"}</p><Reason code={run.blockReason ?? run.errorCode} /></div><div className="text-right text-xs text-muted-foreground"><p>{dateTimeLabel(run.createdAt)}</p><p className="mt-2 max-w-xs">{summaryLabel(run.summary) ?? "No bounded summary was recorded."}</p></div></CardContent></Card>; })}{runCursor ? <Button className="justify-self-start" type="button" variant="secondary" disabled={busy !== null} onClick={() => void loadMoreRuns()}>{busy === "runs" ? <LoaderCircle className="animate-spin" /> : null}Load more runs</Button> : null}</div>}
        </div>

        <div>
          <h3 className="text-lg font-semibold">Step ledger</h3>
          <div className="mt-3"><UnavailablePanel icon={ShieldAlert} title="Step ledger" copy="Per-step execution rows are not exposed by the current read surface. No step status or C4/C5 send outcome is guessed." /></div>
        </div>

        <div>
          <h3 className="text-lg font-semibold">Contact journeys</h3>
          {journeyError ? <div className="mt-3"><UnavailablePanel icon={Route} title="Contact journeys" copy={journeyError === "NETWORK" ? "The request could not finish. Previously loaded journey data is not treated as current." : workflowErrorMessage(journeyError)} /></div> : journeys.length === 0 ? <p className="mt-3 rounded-xl border border-dashed border-border bg-card px-5 py-8 text-sm text-muted-foreground">No contacts are enrolled in this journey.</p> : <div className="mt-3 grid grid-cols-2 gap-3">{journeys.map((journey) => { const status = journeyStatusPresentation(journey.status); const reason = journey.lastRoutineRun?.blockReason ?? journey.lastRoutineRun?.errorCode ?? null; return <Card key={journey.id}><CardContent><div className="flex items-start justify-between gap-3"><div><Link className="font-semibold underline-offset-4 hover:underline" href={`/crm/contacts/${journey.contact.id}`}>{journey.contact.name}</Link><p className="mt-1 font-mono text-[11px] text-muted-foreground">{journey.contact.id}</p><p className="mt-2 text-xs text-muted-foreground">Current step: {journey.currentStepKey ?? "Not recorded"}</p></div><Badge variant={status.variant}>{status.label}</Badge></div>{journey.nextEligibleAt ? <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" />Eligible after {dateTimeLabel(journey.nextEligibleAt)}</p> : null}<Reason code={reason} /></CardContent></Card>; })}{journeyCursor ? <Button className="justify-self-start" type="button" variant="secondary" disabled={busy !== null} onClick={() => void loadMoreJourneys()}>{busy === "journeys" ? <LoaderCircle className="animate-spin" /> : null}Load more journeys</Button> : null}</div>}
        </div>
      </div>

      <div className="mt-5 flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground"><CircleHelp className="mt-0.5 size-4 shrink-0" /><span>Simulated means the local workflow path completed. It does not mean sent, delivered, or read.</span></div>
    </section>
  );
}

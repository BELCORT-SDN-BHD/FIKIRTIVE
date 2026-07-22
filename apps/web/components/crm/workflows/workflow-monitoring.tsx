import { Activity, CircleHelp, Clock3, Route, ShieldAlert, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  dateTimeLabel,
  journeyStatusPresentation,
  reasonCodeCopy,
  runStatusPresentation,
  shortWorkflowId,
  stepStatusPresentation,
} from "./workflow-format";

export type WorkflowRunView = {
  id: string;
  status: string;
  triggerKind: string;
  currentStepKey: string | null;
  simulated: boolean;
  summary: string | null;
  reasonCode: string | null;
  createdAt: Date | string;
};

export type WorkflowStepView = {
  id: string;
  runId: string;
  stepKey: string;
  actionKind: string;
  status: string;
  reasonCode: string | null;
  createdAt: Date | string;
};

export type WorkflowJourneyView = {
  id: string;
  contactLabel: string;
  status: string;
  currentStepKey: string | null;
  nextEligibleAt: Date | string | null;
  reasonCode: string | null;
};

export type WorkflowMonitoringData = {
  runs: WorkflowRunView[];
  steps: WorkflowStepView[];
  journeys: WorkflowJourneyView[];
};

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
        <span className="grid size-10 place-items-center rounded-xl bg-secondary text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div className="mt-4 flex items-center gap-2">
          <h3 className="font-semibold">{title}</h3>
          <Badge variant="outline">Unavailable</Badge>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p>
      </CardContent>
    </Card>
  );
}

export default function WorkflowMonitoring({ data }: { data: WorkflowMonitoringData | null }) {
  return (
    <section id="activity" className="scroll-mt-8" aria-labelledby="workflow-activity-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">Observe</p>
          <h2 id="workflow-activity-heading" className="mt-2 text-2xl font-semibold tracking-tight">
            Runs and journeys
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            A run is one trigger occurrence. Its step ledger records local workflow decisions; it is not a provider receipt or delivery claim.
          </p>
        </div>
        <Badge variant="outline">Simulated era</Badge>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 rounded-xl border border-border bg-secondary/25 p-4 text-sm">
        <div>
          <p className="font-semibold text-warning-soft-foreground">Blocked</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">A safety or authority gate stopped the next action.</p>
        </div>
        <div>
          <p className="font-semibold text-destructive">Failed</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">The workflow engine hit an error.</p>
        </div>
        <div>
          <p className="font-semibold">Unavailable</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">A required dependency or fact could not be verified.</p>
        </div>
      </div>

      {!data ? (
        <>
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
            <Unplug className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong>Activity data unavailable.</strong> The current workflow read surface does not return Routine runs, step executions, or contact journeys. No counts or outcomes are guessed.
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <UnavailablePanel icon={Activity} title="Run history" copy="Run status, trigger, summary, and timestamps are not available to this page." />
            <UnavailablePanel icon={ShieldAlert} title="Step ledger" copy="Per-step decisions and stable reason codes are not available to this page." />
            <UnavailablePanel icon={Route} title="Contact journeys" copy="Per-contact step, wait, and terminal state are not available to this page." />
          </div>
        </>
      ) : (
        <div className="mt-5 grid gap-6">
          <div>
            <h3 className="text-lg font-semibold">Run history</h3>
            {data.runs.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-border bg-card px-5 py-8 text-sm text-muted-foreground">No Routine runs yet.</p>
            ) : (
              <div className="mt-3 grid gap-3">
                {data.runs.map((run) => {
                  const status = runStatusPresentation(run.status);
                  return (
                    <Card key={run.id}>
                      <CardContent className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={status.variant}>{status.label}</Badge>
                            <Badge variant="outline">{run.triggerKind.replaceAll("_", " ")}</Badge>
                            {run.simulated ? <Badge variant="brand">Simulation only</Badge> : null}
                          </div>
                          <p className="mt-3 text-sm font-semibold">Run {shortWorkflowId(run.id)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">Current step: {run.currentStepKey ?? "Not recorded"}</p>
                          <Reason code={run.reasonCode} />
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <p>{dateTimeLabel(run.createdAt)}</p>
                          <p className="mt-2 max-w-xs">{run.summary ?? "No summary was recorded."}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-lg font-semibold">Step ledger</h3>
            {data.steps.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-border bg-card px-5 py-8 text-sm text-muted-foreground">No workflow steps yet.</p>
            ) : (
              <div className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-sm)]">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-secondary/35 text-xs text-muted-foreground">
                    <tr><th className="px-4 py-3 font-semibold">Step</th><th className="px-4 py-3 font-semibold">Action</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Reason</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.steps.map((step) => {
                      const status = stepStatusPresentation(step.status);
                      return (
                        <tr key={step.id}>
                          <td className="px-4 py-4"><p className="font-medium">{step.stepKey}</p><p className="mt-1 text-xs text-muted-foreground">{dateTimeLabel(step.createdAt)}</p></td>
                          <td className="px-4 py-4">{step.actionKind.replaceAll("_", " ")}</td>
                          <td className="px-4 py-4"><Badge variant={status.variant}>{status.label}</Badge></td>
                          <td className="px-4 py-4"><p className="max-w-md text-xs leading-5 text-muted-foreground">{reasonCodeCopy(step.reasonCode)}</p>{step.reasonCode ? <p className="mt-1 font-mono text-[11px] text-muted-foreground">{step.reasonCode}</p> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-lg font-semibold">Contact journeys</h3>
            {data.journeys.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-border bg-card px-5 py-8 text-sm text-muted-foreground">No contacts are enrolled in this journey.</p>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3">
                {data.journeys.map((journey) => {
                  const status = journeyStatusPresentation(journey.status);
                  return (
                    <Card key={journey.id}>
                      <CardContent>
                        <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{journey.contactLabel}</p><p className="mt-1 text-xs text-muted-foreground">Current step: {journey.currentStepKey ?? "Not recorded"}</p></div><Badge variant={status.variant}>{status.label}</Badge></div>
                        {journey.nextEligibleAt ? <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" />Eligible after {dateTimeLabel(journey.nextEligibleAt)}</p> : null}
                        <Reason code={journey.reasonCode} />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground">
        <CircleHelp className="mt-0.5 size-4 shrink-0" />
        <span>Simulated means the local workflow path completed. It does not mean sent, delivered, or read.</span>
      </div>
    </section>
  );
}

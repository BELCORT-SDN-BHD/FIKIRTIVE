"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  LoaderCircle,
  LockKeyhole,
  Power,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import {
  activateRoutine,
  createRoutineDraft,
  getRoutine,
  killRoutine,
  listRoutines,
  listWorkflowRevisions,
  reauthorizeRoutine,
} from "@/lib/customer-workflow-ui-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  dateTimeLabel,
  routineStatusPresentation,
  shortWorkflowId,
  workflowErrorMessage,
} from "./workflow-format";

type RevisionsResult = Awaited<ReturnType<typeof listWorkflowRevisions>>;
type Revision = Extract<RevisionsResult, { ok: true }>["resource"][number];
type RoutineDraftResult = Awaited<ReturnType<typeof createRoutineDraft>>;
type Routine = Extract<RoutineDraftResult, { ok: true }>["resource"];
type RoutinesResult = Awaited<ReturnType<typeof listRoutines>>;
type PersistedRoutine = Extract<RoutinesResult, { ok: true }>["resource"]["items"][number];
type RoutineDetailResult = Awaited<ReturnType<typeof getRoutine>>;
type RoutineDetail = Extract<RoutineDetailResult, { ok: true }>["resource"];

type ActionKind = "conversation_reply" | "broadcast_run" | "wait" | "complete";
type EnvelopeDraft = {
  workflowRevisionId: string;
  routineKey: string;
  actionKinds: ActionKind[];
  whatsapp: boolean;
  contactIds: string[];
  segmentIds: string[];
  maxActions: number;
  maxRecipients: number;
  expiresAt: Date;
};

type SessionEnvelope = {
  routine: Routine;
  details: EnvelopeDraft;
};

const ACTION_OPTIONS: Array<{ value: ActionKind; label: string; description: string }> = [
  { value: "conversation_reply", label: "Reply in a conversation", description: "Prepare a workflow reply for one verified customer conversation." },
  { value: "broadcast_run", label: "Start a broadcast handoff", description: "Prepare the approved broadcast action for an eligible customer." },
  { value: "wait", label: "Wait", description: "Pause the journey until its next eligible time." },
  { value: "complete", label: "Complete the journey", description: "Mark the contact journey complete." },
];

function splitReferences(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))].sort();
}

function actionLabel(action: ActionKind): string {
  return ACTION_OPTIONS.find((option) => option.value === action)?.label ?? action;
}

function EnvelopeReview({ draft, revision }: { draft: EnvelopeDraft; revision: Revision | null }) {
  const audience = [
    draft.contactIds.length ? `${draft.contactIds.length} exact contact ${draft.contactIds.length === 1 ? "reference" : "references"}` : null,
    draft.segmentIds.length ? `${draft.segmentIds.length} exact segment ${draft.segmentIds.length === 1 ? "reference" : "references"}` : null,
  ].filter(Boolean).join(" and ");

  return (
    <dl className="grid gap-3 rounded-xl border border-border bg-secondary/25 p-4 text-sm">
      <div className="grid grid-cols-[120px_1fr] gap-3"><dt className="text-muted-foreground">Rule</dt><dd className="font-medium">Revision {revision?.revision ?? "unknown"}</dd></div>
      <div className="grid grid-cols-[120px_1fr] gap-3"><dt className="text-muted-foreground">Allowed work</dt><dd className="font-medium">{draft.actionKinds.map(actionLabel).join(", ") || "Nothing"}</dd></div>
      <div className="grid grid-cols-[120px_1fr] gap-3"><dt className="text-muted-foreground">Channel</dt><dd className="font-medium">{draft.whatsapp ? "WhatsApp" : "No channel"}</dd></div>
      <div className="grid grid-cols-[120px_1fr] gap-3"><dt className="text-muted-foreground">Audience</dt><dd className="font-medium">{audience || "No contacts or segments"}</dd></div>
      <div className="grid grid-cols-[120px_1fr] gap-3"><dt className="text-muted-foreground">Limits</dt><dd className="font-medium">Up to {draft.maxActions} actions and {draft.maxRecipients} recipients per run</dd></div>
      <div className="grid grid-cols-[120px_1fr] gap-3"><dt className="text-muted-foreground">Budget</dt><dd className="font-medium">0 credits per run · 0 credits per month · no spend allowed</dd></div>
      <div className="grid grid-cols-[120px_1fr] gap-3"><dt className="text-muted-foreground">Expiry</dt><dd className="font-medium">{dateTimeLabel(draft.expiresAt)}</dd></div>
      <div className="grid grid-cols-[120px_1fr] gap-3"><dt className="text-muted-foreground">Summary</dt><dd className="font-medium">Show a summary in workflow activity after every run</dd></div>
    </dl>
  );
}

export default function RoutineAuthorizationPanel({
  workflowDefinitionId,
  workflowSlug,
  revisions,
  routines,
  routineReadError,
  onRoutinesChanged,
  disabled,
}: {
  workflowDefinitionId: string;
  workflowSlug: string;
  revisions: Revision[];
  routines: PersistedRoutine[];
  routineReadError: string | null;
  onRoutinesChanged: () => void;
  disabled: boolean;
}) {
  const validRevisions = revisions.filter((revision) => revision.validationState === "valid");
  const latestValidRevision = validRevisions[0] ?? null;
  const [setupOpen, setSetupOpen] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const [mode, setMode] = useState<"activate" | "reauthorize">("activate");
  const [busy, setBusy] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [sessionEnvelopes, setSessionEnvelopes] = useState<SessionEnvelope[]>([]);
  const [pendingDraft, setPendingDraft] = useState<SessionEnvelope | null>(null);
  const [workflowRevisionId, setWorkflowRevisionId] = useState(latestValidRevision?.id ?? "");
  const [routineKey, setRoutineKey] = useState(`${workflowSlug}-routine`.replace(/[^a-z0-9_-]/g, "-"));
  const [actionKinds, setActionKinds] = useState<ActionKind[]>(["complete"]);
  const [whatsapp, setWhatsapp] = useState(false);
  const [contactRefs, setContactRefs] = useState("");
  const [segmentRefs, setSegmentRefs] = useState("");
  const [maxActions, setMaxActions] = useState("1");
  const [maxRecipients, setMaxRecipients] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [persistedRoutines, setPersistedRoutines] = useState(routines);
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null);
  const [routineDetail, setRoutineDetail] = useState<RoutineDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const currentEnvelope = sessionEnvelopes.at(-1) ?? pendingDraft;
  const currentRoutine = currentEnvelope?.routine ?? null;
  const currentStatus = currentRoutine ? routineStatusPresentation(currentRoutine.status) : null;
  const currentIsActive = currentRoutine?.status === "active" && !currentRoutine.killSwitchEngaged;
  const chain = useMemo(
    () => sessionEnvelopes.filter((entry) => entry.routine.routineKey === currentRoutine?.routineKey),
    [currentRoutine?.routineKey, sessionEnvelopes],
  );
  const activePersistedCount = persistedRoutines.filter(
    (routine) => routine.status === "active" && !routine.killSwitchEngaged,
  ).length;

  function buildEnvelope(): EnvelopeDraft | null {
    const actions = Number.parseInt(maxActions, 10);
    const recipients = Number.parseInt(maxRecipients, 10);
    const expiry = new Date(expiresAt);
    if (
      !workflowRevisionId ||
      !routineKey ||
      actionKinds.length === 0 ||
      !Number.isSafeInteger(actions) ||
      actions < 1 ||
      !Number.isSafeInteger(recipients) ||
      recipients < 1 ||
      !Number.isFinite(expiry.getTime())
    ) return null;
    return {
      workflowRevisionId,
      routineKey: mode === "reauthorize" && currentRoutine ? currentRoutine.routineKey : routineKey,
      actionKinds,
      whatsapp,
      contactIds: splitReferences(contactRefs),
      segmentIds: splitReferences(segmentRefs),
      maxActions: actions,
      maxRecipients: recipients,
      expiresAt: expiry,
    };
  }

  function scopeFor(draft: EnvelopeDraft) {
    return {
      actionKinds: draft.actionKinds,
      channelScopes: draft.whatsapp ? [{ channel: "whatsapp", providerConnectionId: null }] : [],
      contactIds: draft.contactIds,
      segmentIds: draft.segmentIds,
      maxActions: draft.maxActions,
      maxRecipients: draft.maxRecipients,
    };
  }

  async function prepareActivation() {
    const draft = buildEnvelope();
    if (!draft) {
      setErrorCode("INVALID_ARGUMENT");
      return;
    }
    setBusy("draft");
    setErrorCode(null);
    try {
      const result = await createRoutineDraft({
        workflowDefinitionId,
        workflowRevisionId: draft.workflowRevisionId,
        routineKey: draft.routineKey,
        scopeJson: scopeFor(draft),
        maxCreditsPerRun: 0,
        maxCreditsPerMonth: 0,
        summaryPolicyJson: { afterEachRun: "workflow_activity" },
        expiresAt: draft.expiresAt,
      });
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      const envelope = { routine: result.resource, details: draft };
      setPendingDraft(envelope);
      setMode("activate");
      setConfirmationChecked(false);
      setConfirmationOpen(true);
    } catch {
      setErrorCode("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  function prepareReauthorization() {
    const draft = buildEnvelope();
    if (!draft || !currentRoutine?.authorizationHash) {
      setErrorCode("INVALID_ARGUMENT");
      return;
    }
    setMode("reauthorize");
    setConfirmationChecked(false);
    setConfirmationOpen(true);
  }

  async function confirmAuthorization() {
    const draft = mode === "activate" ? pendingDraft?.details ?? null : buildEnvelope();
    const sourceRoutine = mode === "activate" ? pendingDraft?.routine ?? null : currentRoutine;
    if (!draft || !sourceRoutine || !confirmationChecked) return;
    setBusy(mode);
    setErrorCode(null);
    try {
      const result = mode === "activate"
        ? await activateRoutine({ routineId: sourceRoutine.id, expectedRowRevision: sourceRoutine.rowRevision })
        : await reauthorizeRoutine({
            routineId: sourceRoutine.id,
            expectedRowRevision: sourceRoutine.rowRevision,
            workflowRevisionId: draft.workflowRevisionId,
            scopeJson: scopeFor(draft),
            maxCreditsPerRun: 0,
            maxCreditsPerMonth: 0,
            summaryPolicyJson: { afterEachRun: "workflow_activity" },
            expiresAt: draft.expiresAt,
          });
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      setSessionEnvelopes((current) => [...current, { routine: result.resource, details: draft }]);
      setPendingDraft(null);
      setConfirmationOpen(false);
      setSetupOpen(false);
      onRoutinesChanged();
    } catch {
      setErrorCode("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  async function engageKillSwitch() {
    if (!currentRoutine || currentRoutine.killSwitchEngaged) return;
    setBusy("kill");
    setErrorCode(null);
    try {
      const result = await killRoutine({
        routineId: currentRoutine.id,
        expectedRowRevision: currentRoutine.rowRevision,
        reasonCode: "merchant_kill_switch",
      });
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      setSessionEnvelopes((current) => {
        const next = current.filter((entry) => entry.routine.id !== result.resource.id);
        return [...next, { routine: result.resource, details: currentEnvelope!.details }];
      });
      setPendingDraft(null);
      onRoutinesChanged();
    } catch {
      setErrorCode("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  async function killPersistedRoutine(routine: PersistedRoutine) {
    if (routine.killSwitchEngaged || !["draft", "active", "paused"].includes(routine.status)) return;
    setBusy(routine.id);
    setErrorCode(null);
    try {
      const result = await killRoutine({
        routineId: routine.id,
        expectedRowRevision: routine.rowRevision,
        reasonCode: "merchant_kill_switch",
      });
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      setPersistedRoutines((current) => current.map((item) => item.id === routine.id
        ? {
            ...item,
            status: "paused",
            killSwitchEngaged: true,
            killedAt: result.resource.killedAt,
            killReasonCode: result.resource.killReasonCode,
            rowRevision: result.resource.rowRevision,
            updatedAt: result.resource.updatedAt,
          }
        : item));
      onRoutinesChanged();
    } catch {
      setErrorCode("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  async function viewPersistedRoutine(routineId: string) {
    if (selectedRoutineId === routineId && routineDetail) {
      setSelectedRoutineId(null);
      setRoutineDetail(null);
      setDetailError(null);
      return;
    }
    setSelectedRoutineId(routineId);
    setRoutineDetail(null);
    setDetailBusy(routineId);
    setDetailError(null);
    try {
      const result = await getRoutine({ routineId });
      if (!result.ok) setDetailError(result.error);
      else setRoutineDetail(result.resource);
    } catch {
      setDetailError("NETWORK");
    } finally {
      setDetailBusy(null);
    }
  }

  function toggleAction(action: ActionKind) {
    setActionKinds((current) => current.includes(action)
      ? current.filter((item) => item !== action)
      : [...current, action]);
  }

  return (
    <section id="routine" className="scroll-mt-8" aria-labelledby="routine-heading">
      <div className="flex items-start justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">Authorize</p>
          <h2 id="routine-heading" className="mt-2 text-2xl font-semibold tracking-tight">Routine authorization</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            A Routine is standing permission for one exact rule revision, scope, budget, expiry, and summary policy. Publishing a rule does not activate it.
          </p>
        </div>
        {currentStatus ? <Badge variant={currentStatus.variant}>{currentStatus.label}</Badge> : routineReadError ? <Badge variant="outline">Status unavailable</Badge> : activePersistedCount > 0 ? <Badge variant="brand">{activePersistedCount} active</Badge> : <Badge variant="outline">No active Routines</Badge>}
      </div>

      {routineReadError ? <div className="mt-5 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground"><Unplug className="mt-0.5 size-4 shrink-0" /><span><strong>Routine status could not be refreshed.</strong> {routineReadError === "NETWORK" ? "The request could not finish." : workflowErrorMessage(routineReadError)} No authorization is inferred.</span></div> : null}

      {errorCode ? (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-error-soft px-4 py-3 text-sm leading-6 text-destructive">
          <p className="font-semibold">The Routine action could not finish</p>
          <p className="mt-1">{errorCode === "NETWORK" ? "The request could not finish. Please retry." : workflowErrorMessage(errorCode)}</p>
          <p className="mt-1 font-mono text-xs">Error code: {errorCode}</p>
        </div>
      ) : null}

      {!routineReadError ? (
        <div className="mt-5 grid gap-3">
          {persistedRoutines.length === 0 ? <p className="rounded-xl border border-dashed border-border bg-card px-5 py-8 text-sm text-muted-foreground">No Routine authorization envelopes exist for this workflow.</p> : persistedRoutines.map((routine) => {
            const persistedStatus = routineStatusPresentation(routine.status);
            const canKill = !routine.killSwitchEngaged && ["draft", "active", "paused"].includes(routine.status);
            return <Card key={routine.id}><CardContent><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-5"><div><div className="flex flex-wrap items-center gap-2"><Badge variant={persistedStatus.variant}>{persistedStatus.label}</Badge>{routine.killSwitchEngaged ? <Badge variant="destructive">Kill switch engaged</Badge> : null}<Badge variant="outline">Authorization {routine.authorization.revision}</Badge></div><p className="mt-3 font-mono text-xs">{routine.routineKey}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{routine.id}</p><p className="mt-3 text-xs leading-5 text-muted-foreground">Revision {routine.workflowRevision.revision} · {routine.scopeSummary.actionKinds.map(actionLabel).join(", ") || "No actions"} · {routine.scopeSummary.contactCount} contacts · {routine.scopeSummary.segmentCount} segments</p><p className="mt-1 text-xs text-muted-foreground">Updated {dateTimeLabel(routine.updatedAt)}{routine.authorization.expiresAt ? ` · expires ${dateTimeLabel(routine.authorization.expiresAt)}` : ""}</p></div><div className="flex items-start gap-2"><Button type="button" variant="secondary" disabled={detailBusy !== null} onClick={() => void viewPersistedRoutine(routine.id)}>{detailBusy === routine.id ? <LoaderCircle className="animate-spin" /> : null}{selectedRoutineId === routine.id && routineDetail ? "Hide details" : "View authorization"}</Button><Button type="button" variant="destructive" disabled={busy !== null || !canKill} onClick={() => void killPersistedRoutine(routine)}>{busy === routine.id ? <LoaderCircle className="animate-spin" /> : <Power />}{routine.killSwitchEngaged ? "Killed" : "Kill Routine"}</Button></div></div>{selectedRoutineId === routine.id ? <div className="mt-5 border-t border-border pt-5">{detailError ? <div className="rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground"><p className="font-semibold">Authorization details could not be read</p><p className="mt-1">{detailError === "NETWORK" ? "The request could not finish." : workflowErrorMessage(detailError)} No missing envelope or predecessor is inferred.</p><p className="mt-1 font-mono text-xs">Error code: {detailError}</p></div> : routineDetail ? <div><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">Exact authorization envelope</h4><Badge variant="outline">{routineDetail.predecessors.length} superseded {routineDetail.predecessors.length === 1 ? "authorization" : "authorizations"}</Badge></div><p className="mt-2 text-xs leading-5 text-muted-foreground">This is the complete owner-scoped read result, including exact scope, budget, summary policy, kill state, and ordered predecessor chain.</p><pre className="mt-3 max-h-[520px] overflow-auto rounded-xl bg-[#111114] p-4 text-[11px] leading-5 text-[#F4F4F5]">{JSON.stringify(routineDetail, null, 2)}</pre></div> : <p className="text-sm text-muted-foreground">Reading the exact authorization envelope…</p>}</div> : null}</CardContent></Card>;
          })}
        </div>
      ) : null}

      {currentRoutine ? (
        <Card className="mt-5">
          <CardContent>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={currentStatus?.variant ?? "outline"}>{currentStatus?.label ?? "Unknown"}</Badge>
                  {currentRoutine.killSwitchEngaged ? <Badge variant="destructive">Kill switch engaged</Badge> : null}
                  <Badge variant="outline">Authorization {currentRoutine.authorizationRevision}</Badge>
                </div>
                <p className="mt-3 font-mono text-xs text-muted-foreground">{currentRoutine.routineKey} · {currentRoutine.id}</p>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
                <div><p className="text-sm font-semibold">Routine active</p><p className="text-xs text-muted-foreground">OFF engages the kill switch</p></div>
                <Switch checked={currentIsActive} disabled={busy !== null || currentRoutine.killSwitchEngaged} onCheckedChange={(checked) => { if (checked && pendingDraft) { setConfirmationChecked(false); setConfirmationOpen(true); } else if (!checked) void engageKillSwitch(); }} aria-label="Routine active" />
              </div>
            </div>

            <div className="mt-5"><EnvelopeReview draft={currentEnvelope!.details} revision={validRevisions.find((revision) => revision.id === currentEnvelope!.details.workflowRevisionId) ?? null} /></div>

            {chain.length > 1 ? (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Supersedes chain</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {chain.map((entry, index) => (
                    <div key={entry.routine.id} className="flex items-center gap-2">
                      {index > 0 ? <ArrowRight className="size-3.5 text-muted-foreground" /> : null}
                      <span className="rounded-lg border border-border bg-secondary/30 px-2.5 py-1.5 font-mono text-[11px]">Authorization {entry.routine.authorizationRevision} · {shortWorkflowId(entry.routine.id)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {currentRoutine && !currentRoutine.killSwitchEngaged && ["draft", "active", "paused"].includes(currentRoutine.status) ? (
        <div className="mt-5 rounded-[var(--radius-card)] border-2 border-destructive/45 bg-error-soft p-5">
          <div className="flex items-start justify-between gap-5">
            <div className="flex gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-destructive text-destructive-foreground"><Power className="size-5" /></span>
              <div><h3 className="font-semibold text-destructive">Kill this Routine now</h3><p className="mt-1 max-w-xl text-sm leading-6 text-error-soft-foreground">One click engages the fail-safe kill switch. New runs and steps stop; history stays intact. This cannot recall an action already handed to a provider.</p></div>
            </div>
            <Button type="button" variant="destructive" disabled={busy !== null} onClick={() => void engageKillSwitch()}>{busy === "kill" ? <LoaderCircle className="animate-spin" /> : <Power />}Kill Routine</Button>
          </div>
        </div>
      ) : null}

      {!setupOpen ? (
        <div className="mt-5 flex gap-3">
          {!currentRoutine ? <Button type="button" disabled={disabled || validRevisions.length === 0} onClick={() => { setMode("activate"); setSetupOpen(true); }}><ShieldCheck />Set up a new Routine</Button> : null}
          {pendingDraft ? <Button type="button" disabled={disabled || busy !== null} onClick={() => { setMode("activate"); setConfirmationChecked(false); setConfirmationOpen(true); }}><ShieldCheck />Review activation</Button> : null}
          {currentRoutine?.authorizationHash ? <Button type="button" variant="secondary" disabled={disabled || busy !== null} onClick={() => { setMode("reauthorize"); setSetupOpen(true); }}><LockKeyhole />Prepare new authorization</Button> : null}
        </div>
      ) : (
        <Card className="mt-5 border-brand/25">
          <CardContent>
            <div className="flex items-start justify-between gap-4">
              <div><h3 className="text-lg font-semibold">{mode === "reauthorize" ? "Prepare a replacement envelope" : "Define the authorization envelope"}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Every field below becomes part of the exact approval. Changing any field later requires a new authorization.</p></div>
              <ChevronDown className="size-5 text-muted-foreground" />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-5">
              <label className="grid gap-2 text-sm font-semibold">Rule revision<select className="h-11 rounded-lg border border-input bg-card px-3 text-sm font-normal" value={workflowRevisionId} onChange={(event) => setWorkflowRevisionId(event.target.value)}><option value="">Select a valid revision…</option>{validRevisions.map((revision) => <option key={revision.id} value={revision.id}>Revision {revision.revision}</option>)}</select></label>
              <label className="grid gap-2 text-sm font-semibold">Routine key<Input value={mode === "reauthorize" && currentRoutine ? currentRoutine.routineKey : routineKey} disabled={mode === "reauthorize"} onChange={(event) => setRoutineKey(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))} placeholder="outside-hours-reply" /></label>
            </div>

            <fieldset className="mt-5"><legend className="text-sm font-semibold">What this Routine may do</legend><div className="mt-3 grid grid-cols-2 gap-3">{ACTION_OPTIONS.map((option) => <label key={option.value} className="flex cursor-pointer gap-3 rounded-xl border border-border bg-secondary/20 p-3"><input className="mt-1 size-4 accent-[var(--brand)]" type="checkbox" checked={actionKinds.includes(option.value)} onChange={() => toggleAction(option.value)} /><span><span className="block text-sm font-semibold">{option.label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span></span></label>)}</div></fieldset>

            <div className="mt-5 grid grid-cols-2 gap-5">
              <div><p className="text-sm font-semibold">Allowed channel</p><label className="mt-3 flex items-center justify-between rounded-xl border border-border bg-secondary/20 px-4 py-3"><span><span className="block text-sm font-semibold">WhatsApp</span><span className="mt-1 block text-xs text-muted-foreground">Provider connection is not pinned in this simulated envelope.</span></span><input className="size-4 accent-[var(--brand)]" type="checkbox" checked={whatsapp} onChange={(event) => setWhatsapp(event.target.checked)} /></label></div>
              <div><p className="text-sm font-semibold">Budget</p><div className="mt-3 rounded-xl border border-border bg-secondary/20 px-4 py-3"><p className="text-sm font-semibold">No credit spend</p><p className="mt-1 text-xs leading-5 text-muted-foreground">0 credits per run and 0 credits per month. Zero is a hard stop, never unlimited.</p></div></div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-5">
              <label className="grid gap-2 text-sm font-semibold">Exact contact references<span className="text-xs font-normal leading-5 text-muted-foreground">Comma-separated CRM references. Leave empty if this Routine does not target exact contacts.</span><Input value={contactRefs} onChange={(event) => setContactRefs(event.target.value)} placeholder="contact_…" /></label>
              <label className="grid gap-2 text-sm font-semibold">Exact segment references<span className="text-xs font-normal leading-5 text-muted-foreground">Comma-separated CRM references. Leave empty if this Routine does not target segments.</span><Input value={segmentRefs} onChange={(event) => setSegmentRefs(event.target.value)} placeholder="segment_…" /></label>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-5">
              <label className="grid gap-2 text-sm font-semibold">Actions per run<Input type="number" min="1" step="1" value={maxActions} onChange={(event) => setMaxActions(event.target.value)} /></label>
              <label className="grid gap-2 text-sm font-semibold">Recipients per run<Input type="number" min="1" step="1" value={maxRecipients} onChange={(event) => setMaxRecipients(event.target.value)} /></label>
              <label className="grid gap-2 text-sm font-semibold">Authorization expires<Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-xl border border-border bg-secondary/20 px-4 py-3"><CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><p className="text-sm leading-6 text-muted-foreground"><strong className="text-foreground">Summary policy:</strong> show a bounded summary in workflow activity after every run. A summary is not a delivery receipt.</p></div>

            <div className="mt-5 flex justify-end gap-3"><Button type="button" variant="ghost" onClick={() => setSetupOpen(false)}>Cancel</Button><Button type="button" disabled={busy !== null || validRevisions.length === 0} onClick={() => { if (mode === "reauthorize") prepareReauthorization(); else void prepareActivation(); }}>{busy === "draft" ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}{mode === "reauthorize" ? "Review new authorization" : "Review and create draft"}</Button></div>
          </CardContent>
        </Card>
      )}

      {validRevisions.length === 0 ? <p className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm leading-6 text-muted-foreground"><LockKeyhole className="mt-0.5 size-4 shrink-0" />Save a valid rule revision before creating a Routine. Invalid or unavailable rules cannot be authorized.</p> : null}

      <Dialog open={confirmationOpen} onOpenChange={(open) => { if (busy === null) setConfirmationOpen(open); }}>
        <DialogContent className="max-w-[680px]">
          <DialogHeader><DialogTitle>Human confirmation required</DialogTitle><DialogDescription>Only you can {mode === "reauthorize" ? "reauthorize" : "activate"} this Routine. Otto cannot approve, activate, or reauthorize it.</DialogDescription></DialogHeader>
          {(() => { const draft = mode === "activate" ? pendingDraft?.details ?? null : buildEnvelope(); return draft ? <EnvelopeReview draft={draft} revision={validRevisions.find((revision) => revision.id === draft.workflowRevisionId) ?? null} /> : null; })()}
          {mode === "reauthorize" && currentRoutine ? <div className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>This creates a new immutable envelope and revokes authorization {currentRoutine.authorizationRevision}. The new Routine will visibly supersede {currentRoutine.id}.</span></div> : null}
          {errorCode ? <div className="rounded-xl border border-destructive/30 bg-error-soft px-4 py-3 text-sm leading-6 text-destructive"><p className="font-semibold">The Routine action could not finish</p><p className="mt-1">{errorCode === "NETWORK" ? "The request could not finish. Please retry." : workflowErrorMessage(errorCode)}</p><p className="mt-1 font-mono text-xs">Error code: {errorCode}</p></div> : null}
          <label className="flex cursor-pointer gap-3 rounded-xl border border-border p-4"><input className="mt-1 size-4 accent-[var(--brand)]" type="checkbox" checked={confirmationChecked} onChange={(event) => setConfirmationChecked(event.target.checked)} /><span><span className="block text-sm font-semibold">I reviewed this exact authorization</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">I understand the scope, zero-credit budget, expiry, and after-run summary policy.</span></span></label>
          <DialogFooter><Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setConfirmationOpen(false)}>Not now</Button><Button type="button" disabled={!confirmationChecked || busy !== null} onClick={() => void confirmAuthorization()}>{busy === "activate" || busy === "reauthorize" ? <LoaderCircle className="animate-spin" /> : <Check />}{mode === "reauthorize" ? "Reauthorize Routine" : "Activate Routine"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

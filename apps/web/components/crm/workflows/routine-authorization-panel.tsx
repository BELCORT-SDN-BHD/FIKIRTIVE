"use client";

import { useState } from "react";
import {
  AlertTriangle,
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
  getRoutineAuthorizationPreview,
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
  workflowErrorMessage,
} from "./workflow-format";
import {
  describeAuthorization,
  routineLimitsSummary,
  type AuthorizationFacts,
} from "@/lib/routine-authorization-facts";

type RevisionsResult = Awaited<ReturnType<typeof listWorkflowRevisions>>;
type Revision = Extract<RevisionsResult, { ok: true }>["resource"][number];
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

function ReviewGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid gap-3 rounded-xl border border-border bg-secondary/25 p-4 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[120px_1fr] gap-3">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EnvelopeReview({ draft, revision }: { draft: EnvelopeDraft; revision: Revision | null }) {
  const audience = [
    draft.contactIds.length ? `${draft.contactIds.length} exact contact ${draft.contactIds.length === 1 ? "reference" : "references"}` : null,
    draft.segmentIds.length ? `${draft.segmentIds.length} exact segment ${draft.segmentIds.length === 1 ? "reference" : "references"}` : null,
  ].filter(Boolean).join(" and ");

  return (
    <ReviewGrid
      rows={[
        ["Rule", `Revision ${revision?.revision ?? "unknown"}`],
        ["Allowed work", draft.actionKinds.map(actionLabel).join(", ") || "Nothing"],
        ["Channel", draft.whatsapp ? "WhatsApp" : "No channel"],
        ["Audience", audience || "No contacts or segments"],
        ["Limits", routineLimitsSummary(draft.maxActions, draft.maxRecipients)],
        ["Budget", "0 credits per run · 0 credits per month · no spend allowed"],
        ["Expiry", dateTimeLabel(draft.expiresAt)],
        ["Summary", "Show a summary in workflow activity after every run"],
      ]}
    />
  );
}

/** #720 判官 r2 / §5.1 — the exact envelope activateRoutine is about to sign, rendered from
 *  `routine-authorization-facts`, whose rows are derived from the authorization hash's own
 *  input set. Nothing shown here is assembled by this component, so a hashed field cannot be
 *  displayed as something else — or omitted. */
function AuthorizationReview({ facts }: { facts: AuthorizationFacts }) {
  return <ReviewGrid rows={facts.rows.map((row) => [row.label, row.value] as [string, string])} />;
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
  // The activation dialog is driven by the authoritative single-Routine read, never by a
  // summary or by this session's form state — §5.1 requires the merchant to confirm the exact
  // scope and summary policy that will be authorized.
  const [activationTarget, setActivationTarget] = useState<{ id: string; rowRevision: number; authorizationHash: string } | null>(null);
  const [activationFacts, setActivationFacts] = useState<AuthorizationFacts | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [activationLoading, setActivationLoading] = useState(false);
  const [reauthorizeTarget, setReauthorizeTarget] = useState<PersistedRoutine | null>(null);
  const [workflowRevisionId, setWorkflowRevisionId] = useState(latestValidRevision?.id ?? "");
  const [routineKey, setRoutineKey] = useState(`${workflowSlug}-routine`.replace(/[^a-z0-9_-]/g, "-"));
  const [actionKinds, setActionKinds] = useState<ActionKind[]>(["complete"]);
  const [whatsapp, setWhatsapp] = useState(false);
  const [contactRefs, setContactRefs] = useState("");
  const [segmentRefs, setSegmentRefs] = useState("");
  const [maxActions, setMaxActions] = useState("1");
  const [maxRecipients, setMaxRecipients] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null);
  const [routineDetail, setRoutineDetail] = useState<RoutineDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // #720 — the server read is the ONLY source of Routine truth here. The panel used to mirror
  // it into state and drive activation from this session's memory instead, so a Routine that
  // existed in the database but not in this page load could never be switched on. Every action
  // below re-reads through onRoutinesChanged rather than patching a local copy.
  const persistedRoutines = routines;
  const activePersistedCount = persistedRoutines.filter(
    (routine) => routine.status === "active" && !routine.killSwitchEngaged,
  ).length;
  const anyKillable = persistedRoutines.some(
    (routine) => !routine.killSwitchEngaged && ["draft", "active", "paused"].includes(routine.status),
  );

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
      routineKey: mode === "reauthorize" && reauthorizeTarget ? reauthorizeTarget.routineKey : routineKey,
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
      // The draft is a persisted row the moment it is created. Publish it to the list too, so
      // closing this dialog never leaves the merchant with an invisible Routine holding its key.
      onRoutinesChanged();
      // Review what the SERVER stored, not what this form thinks it sent.
      void reviewActivation(result.resource.id);
    } catch {
      setErrorCode("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  /** Open the human confirmation dialog for one Routine, showing the exact envelope the server
   *  holds for it. Confirmation stays unavailable until that read lands: a dialog that cannot
   *  say what it is authorizing must not be able to authorize it. */
  async function reviewActivation(routineId: string) {
    setMode("activate");
    setErrorCode(null);
    setConfirmationChecked(false);
    setActivationTarget(null);
    setActivationFacts(null);
    setActivationError(null);
    setConfirmationOpen(true);
    setActivationLoading(true);
    try {
      const result = await getRoutineAuthorizationPreview({ routineId });
      if (!result.ok) {
        setActivationError(result.error);
        return;
      }
      const snapshot = result.resource.snapshot as unknown as Record<string, unknown>;
      setActivationFacts(describeAuthorization(snapshot, result.resource.names));
      setActivationTarget({
        id: routineId,
        rowRevision: result.resource.routineRowRevision,
        authorizationHash: result.resource.authorizationHash,
      });
    } catch {
      setActivationError("NETWORK");
    } finally {
      setActivationLoading(false);
    }
  }

  /** The replacement envelope is previewed by the SERVER too, so the merchant reviews the exact
   *  thing reauthorizeRoutine will hash — and hands that hash back for the server to re-check. */
  async function prepareReauthorization() {
    const draft = buildEnvelope();
    if (!draft || !reauthorizeTarget?.authorization.authorized) {
      setErrorCode("INVALID_ARGUMENT");
      return;
    }
    setMode("reauthorize");
    setErrorCode(null);
    setConfirmationChecked(false);
    setActivationTarget(null);
    setActivationFacts(null);
    setActivationError(null);
    setConfirmationOpen(true);
    setActivationLoading(true);
    try {
      const result = await getRoutineAuthorizationPreview({
        routineId: reauthorizeTarget.id,
        proposed: {
          workflowRevisionId: draft.workflowRevisionId,
          scopeJson: scopeFor(draft),
          maxCreditsPerRun: 0,
          maxCreditsPerMonth: 0,
          summaryPolicyJson: { afterEachRun: "workflow_activity" },
          expiresAt: draft.expiresAt,
        },
      });
      if (!result.ok) {
        setActivationError(result.error);
        return;
      }
      setActivationFacts(describeAuthorization(result.resource.snapshot as unknown as Record<string, unknown>, result.resource.names));
      setActivationTarget({
        id: reauthorizeTarget.id,
        rowRevision: reauthorizeTarget.rowRevision,
        authorizationHash: result.resource.authorizationHash,
      });
    } catch {
      setActivationError("NETWORK");
    } finally {
      setActivationLoading(false);
    }
  }

  async function confirmAuthorization() {
    const target = activationTarget;
    // Fail closed on screen too. The server enforces the same two rules (reviewed-hash match and
    // an explainable summary policy), so this only saves a round trip — it is not the gate.
    if (activationFacts === null || activationFacts.unexplained.length > 0) return;
    const draft = mode === "activate" ? null : buildEnvelope();
    if (!target || !confirmationChecked) return;
    if (mode === "reauthorize" && !draft) {
      setErrorCode("INVALID_ARGUMENT");
      return;
    }
    setBusy(mode);
    setErrorCode(null);
    try {
      const result = mode === "activate"
        ? await activateRoutine({
            routineId: target.id,
            expectedRowRevision: target.rowRevision,
            expectedAuthorizationHash: target.authorizationHash,
          })
        : await reauthorizeRoutine({
            routineId: target.id,
            expectedRowRevision: target.rowRevision,
            workflowRevisionId: draft!.workflowRevisionId,
            scopeJson: scopeFor(draft!),
            maxCreditsPerRun: 0,
            maxCreditsPerMonth: 0,
            summaryPolicyJson: { afterEachRun: "workflow_activity" },
            expiresAt: draft!.expiresAt,
            expectedAuthorizationHash: target.authorizationHash,
          });
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      setActivationTarget(null);
      setActivationFacts(null);
      setReauthorizeTarget(null);
      setConfirmationOpen(false);
      setSetupOpen(false);
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
      // No local patch: the re-read is the truth. A failed re-read surfaces as
      // routineReadError instead of a row that only this browser believes in.
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
          <p className="text-xs font-semibold uppercase tracking-[var(--r22-track-caps)] text-brand-strong">Authorize</p>
          <h2 id="routine-heading" className="mt-2 text-2xl font-semibold tracking-tight">Routine authorization</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            A Routine is standing permission for one exact rule revision, scope, budget, expiry, and summary policy. Publishing a rule does not activate it.
          </p>
        </div>
        {routineReadError ? <Badge variant="outline">Status unavailable</Badge> : activePersistedCount > 0 ? <Badge variant="brand">{activePersistedCount} active</Badge> : <Badge variant="outline">No active Routines</Badge>}
      </div>

      {routineReadError ? <div className="mt-5 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground"><Unplug className="mt-0.5 size-4 shrink-0" /><span><strong>Routine status could not be refreshed.</strong> {routineReadError === "NETWORK" ? "The request could not finish." : workflowErrorMessage(routineReadError)} Nothing is guessed in its place.</span></div> : null}

      {errorCode ? (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-error-soft px-4 py-3 text-sm leading-6 text-destructive" data-error-code={errorCode}>
          <p className="font-semibold">The Routine action could not finish</p>
          <p className="mt-1">{workflowErrorMessage(errorCode)}</p>
        </div>
      ) : null}

      {!routineReadError ? (
        <div className="mt-5 grid gap-3">
          {persistedRoutines.length === 0 ? <p className="rounded-xl border border-dashed border-border bg-card px-5 py-8 text-sm text-muted-foreground">No Routine authorizations exist for this workflow yet.</p> : persistedRoutines.map((routine) => {
            const persistedStatus = routineStatusPresentation(routine.status);
            const canKill = !routine.killSwitchEngaged && ["draft", "active", "paused"].includes(routine.status);
            // #720 — the on/off control and the activation review live on the server-read row.
            // A draft is OFF and can be switched on after human confirmation; an active Routine
            // is ON and switching it off engages its kill switch.
            const isActive = routine.status === "active" && !routine.killSwitchEngaged;
            const canSwitch = !routine.killSwitchEngaged && (routine.status === "draft" || routine.status === "active");
            return <Card key={routine.id}><CardContent><div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]"><div><div className="flex flex-wrap items-center gap-2"><Badge variant={persistedStatus.variant}>{persistedStatus.label}</Badge>{routine.killSwitchEngaged ? <Badge variant="destructive">Kill switch engaged</Badge> : null}<Badge variant="outline">Authorization {routine.authorization.revision}</Badge></div><p className="mt-3 font-mono text-xs">{routine.routineKey}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{routine.id}</p><p className="mt-3 text-xs leading-5 text-muted-foreground">Revision {routine.workflowRevision.revision} · {routine.scopeSummary.actionKinds.map(actionLabel).join(", ") || "No actions"} · {routine.scopeSummary.contactCount} contacts · {routine.scopeSummary.segmentCount} segments</p><p className="mt-1 text-xs text-muted-foreground">Updated {dateTimeLabel(routine.updatedAt)}{routine.authorization.expiresAt ? ` · expires ${dateTimeLabel(routine.authorization.expiresAt)}` : ""}</p></div><div className="grid content-start gap-3 sm:justify-items-end">{canSwitch ? <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-2"><div><p className="text-sm font-semibold">Routine active</p><p className="text-xs text-muted-foreground">{isActive ? "OFF engages the kill switch" : "ON needs your confirmation"}</p></div><Switch checked={isActive} disabled={busy !== null || (!isActive && disabled)} onCheckedChange={(checked) => { if (checked) void reviewActivation(routine.id); else void killPersistedRoutine(routine); }} aria-label="Routine active" /></div> : null}<div className="flex flex-wrap items-start gap-2">{routine.status === "draft" && !routine.killSwitchEngaged ? <Button type="button" disabled={disabled || busy !== null} onClick={() => void reviewActivation(routine.id)}><ShieldCheck />Review activation</Button> : null}{isActive && routine.authorization.authorized ? <Button type="button" variant="secondary" disabled={disabled || busy !== null} onClick={() => { setReauthorizeTarget(routine); setMode("reauthorize"); setSetupOpen(true); }}><LockKeyhole />Prepare new authorization</Button> : null}<Button type="button" variant="secondary" disabled={detailBusy !== null} onClick={() => void viewPersistedRoutine(routine.id)}>{detailBusy === routine.id ? <LoaderCircle className="animate-spin" /> : null}{selectedRoutineId === routine.id && routineDetail ? "Hide details" : "View authorization"}</Button><Button type="button" variant="destructive" disabled={busy !== null || !canKill} onClick={() => void killPersistedRoutine(routine)}>{busy === routine.id ? <LoaderCircle className="animate-spin" /> : <Power />}{routine.killSwitchEngaged ? "Killed" : "Kill Routine"}</Button></div></div></div>{selectedRoutineId === routine.id ? <div className="mt-5 border-t border-border pt-5">{detailError ? <div className="rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground" data-error-code={detailError}><p className="font-semibold">Authorization details could not be read</p><p className="mt-1">{detailError === "NETWORK" ? "The request could not finish." : workflowErrorMessage(detailError)} Nothing about a missing predecessor is assumed.</p></div> : routineDetail ? <div><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">Exact authorization details</h4><Badge variant="outline">{routineDetail.predecessors.length} superseded {routineDetail.predecessors.length === 1 ? "authorization" : "authorizations"}</Badge></div><p className="mt-2 text-xs leading-5 text-muted-foreground">This is the complete owner-scoped read result, including which contacts, segments, and actions it covers, its budget, summary policy, kill state, and every authorization it replaced, in order.</p><pre className="mt-3 max-h-[520px] overflow-auto rounded-xl bg-[#111114] p-4 text-[11px] leading-5 text-[#F4F4F5]">{JSON.stringify(routineDetail, null, 2)}</pre></div> : <p className="text-sm text-muted-foreground">Reading the exact authorization details…</p>}</div> : null}</CardContent></Card>;
          })}
        </div>
      ) : null}

      {anyKillable ? (
        <div className="mt-5 rounded-[var(--radius-card)] border-2 border-destructive/45 bg-error-soft p-5">
          <div className="flex gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-destructive text-destructive-foreground"><Power className="size-5" /></span>
            <div><h3 className="font-semibold text-destructive">Kill switch</h3><p className="mt-1 max-w-xl text-sm leading-6 text-error-soft-foreground">Every Routine above has its own <strong>Kill Routine</strong> button. One click engages the fail-safe kill switch: new runs and steps stop and history stays intact. This cannot recall an action already handed to a provider, and it cannot be undone.</p></div>
          </div>
        </div>
      ) : null}

      {!setupOpen ? (
        <div className="mt-5 flex gap-3">
          <Button type="button" disabled={disabled || validRevisions.length === 0} onClick={() => { setReauthorizeTarget(null); setMode("activate"); setSetupOpen(true); }}><ShieldCheck />Set up a new Routine</Button>
          {activationTarget ? <Button type="button" disabled={disabled || busy !== null} onClick={() => void reviewActivation(activationTarget.id)}><ShieldCheck />Review activation</Button> : null}
        </div>
      ) : (
        <Card className="mt-5 border-brand/25">
          <CardContent>
            <div className="flex items-start justify-between gap-4">
              <div><h3 className="text-lg font-semibold">{mode === "reauthorize" ? "Prepare a replacement authorization" : "Define this authorization"}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Every field below becomes part of the exact approval. Changing any field later requires a new authorization.</p></div>
              <ChevronDown className="size-5 text-muted-foreground" />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-5">
              <label className="grid gap-2 text-sm font-semibold">Rule revision<select className="h-11 rounded-lg border border-input bg-card px-3 text-sm font-normal" value={workflowRevisionId} onChange={(event) => setWorkflowRevisionId(event.target.value)}><option value="">Select a valid revision…</option>{validRevisions.map((revision) => <option key={revision.id} value={revision.id}>Revision {revision.revision}</option>)}</select></label>
              <label className="grid gap-2 text-sm font-semibold">Routine key<Input value={mode === "reauthorize" && reauthorizeTarget ? reauthorizeTarget.routineKey : routineKey} disabled={mode === "reauthorize"} onChange={(event) => setRoutineKey(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))} placeholder="outside-hours-reply" /></label>
            </div>

            <fieldset className="mt-5"><legend className="text-sm font-semibold">What this Routine may do</legend><div className="mt-3 grid grid-cols-2 gap-3">{ACTION_OPTIONS.map((option) => <label key={option.value} className="flex cursor-pointer gap-3 rounded-xl border border-border bg-secondary/20 p-3"><input className="mt-1 size-4 accent-[var(--brand)]" type="checkbox" checked={actionKinds.includes(option.value)} onChange={() => toggleAction(option.value)} /><span><span className="block text-sm font-semibold">{option.label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span></span></label>)}</div></fieldset>

            <div className="mt-5 grid grid-cols-2 gap-5">
              <div><p className="text-sm font-semibold">Allowed channel</p><label className="mt-3 flex items-center justify-between rounded-xl border border-border bg-secondary/20 px-4 py-3"><span><span className="block text-sm font-semibold">WhatsApp</span><span className="mt-1 block text-xs text-muted-foreground">Provider connection is not pinned in this simulated authorization.</span></span><input className="size-4 accent-[var(--brand)]" type="checkbox" checked={whatsapp} onChange={(event) => setWhatsapp(event.target.checked)} /></label></div>
              <div><p className="text-sm font-semibold">Budget</p><div className="mt-3 rounded-xl border border-border bg-secondary/20 px-4 py-3"><p className="text-sm font-semibold">No credit spend</p><p className="mt-1 text-xs leading-5 text-muted-foreground">0 credits per run and 0 credits per month. Zero is a hard stop with no way to exceed it.</p></div></div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-5">
              <label className="grid gap-2 text-sm font-semibold">Exact contact references<span className="text-xs font-normal leading-5 text-muted-foreground">Comma-separated CRM references. Leave empty if this Routine does not target exact contacts.</span><Input value={contactRefs} onChange={(event) => setContactRefs(event.target.value)} placeholder="contact_…" /></label>
              <label className="grid gap-2 text-sm font-semibold">Exact segment references<span className="text-xs font-normal leading-5 text-muted-foreground">Comma-separated CRM references. Leave empty if this Routine does not target segments.</span><Input value={segmentRefs} onChange={(event) => setSegmentRefs(event.target.value)} placeholder="segment_…" /></label>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-5">
              <label className="grid gap-2 text-sm font-semibold">Actions per run<Input type="number" min="1" step="1" value={maxActions} onChange={(event) => setMaxActions(event.target.value)} /></label>
              <label className="grid gap-2 text-sm font-semibold">Recipients per run<Input type="number" min="1" step="1" value={maxRecipients} onChange={(event) => setMaxRecipients(event.target.value)} /></label>
              <label className="grid gap-2 text-sm font-semibold">Authorization expires (required)<Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-xl border border-border bg-secondary/20 px-4 py-3"><CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><p className="text-sm leading-6 text-muted-foreground"><strong className="text-foreground">Summary policy:</strong> show a bounded summary in workflow activity after every run. A summary is not a delivery receipt.</p></div>

            <div className="mt-5 flex justify-end gap-3"><Button type="button" variant="ghost" onClick={() => setSetupOpen(false)}>Cancel</Button><Button type="button" disabled={busy !== null || validRevisions.length === 0} onClick={() => { if (mode === "reauthorize") void prepareReauthorization(); else void prepareActivation(); }}>{busy === "draft" ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}{mode === "reauthorize" ? "Review new authorization" : "Review and create draft"}</Button></div>
          </CardContent>
        </Card>
      )}

      {validRevisions.length === 0 ? <p className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm leading-6 text-muted-foreground"><LockKeyhole className="mt-0.5 size-4 shrink-0" />Save a valid rule revision before creating a Routine. Invalid or unavailable rules cannot be authorized.</p> : null}

      <Dialog open={confirmationOpen} onOpenChange={(open) => { if (busy === null) setConfirmationOpen(open); }}>
        <DialogContent className="max-w-[680px]">
          <DialogHeader><DialogTitle>Human confirmation required</DialogTitle><DialogDescription>Only you can {mode === "reauthorize" ? "reauthorize" : "activate"} this Routine. Otto cannot approve, activate, or reauthorize it.</DialogDescription></DialogHeader>
          {(() => {
            {
              // Fail closed: describe the server-built envelope, or say plainly that it could
              // not be read. Never a placeholder that looks like an authorization.
              if (activationError) {
                // 判官 r2 P3 — the merchant reads what happened, not the machine's word for it.
                return (
                  <div className="rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
                    <p className="font-semibold">This authorization could not be read</p>
                    <p className="mt-1">{activationError === "NETWORK" ? "The request could not finish. Please retry." : workflowErrorMessage(activationError)} Nothing was activated, and nothing about its scope is assumed.</p>
                  </div>
                );
              }
              if (!activationFacts) {
                return <p className="text-sm text-muted-foreground">Reading the exact authorization this will activate…</p>;
              }
              return (
                <>
                  <AuthorizationReview facts={activationFacts} />
                  {activationFacts.unexplained.length > 0 ? (
                    <div className="rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
                      <p className="font-semibold">Part of this authorization cannot be shown in plain language</p>
                      <p className="mt-1">This Routine records something this screen cannot explain, so it cannot be activated here. Nothing was activated. Set up a new Routine, or ask support to look at this one.</p>
                    </div>
                  ) : null}
                </>
              );
            }
          })()}
          {mode === "reauthorize" && reauthorizeTarget ? <div className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>This creates a new, unchangeable authorization and revokes authorization {reauthorizeTarget.authorization.revision}. The new Routine will visibly supersede {reauthorizeTarget.id}.</span></div> : null}
          {errorCode ? <div className="rounded-xl border border-destructive/30 bg-error-soft px-4 py-3 text-sm leading-6 text-destructive" data-error-code={errorCode}><p className="font-semibold">The Routine action could not finish</p><p className="mt-1">{workflowErrorMessage(errorCode)}</p></div> : null}
          <label className="flex cursor-pointer gap-3 rounded-xl border border-border p-4"><input className="mt-1 size-4 accent-[var(--brand)]" type="checkbox" checked={confirmationChecked} onChange={(event) => setConfirmationChecked(event.target.checked)} /><span><span className="block text-sm font-semibold">I reviewed this exact authorization</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">I understand the scope, zero-credit budget, expiry, and after-run summary policy.</span></span></label>
          <DialogFooter><Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setConfirmationOpen(false)}>Not now</Button><Button type="button" disabled={!confirmationChecked || busy !== null || (activationLoading || !activationFacts || activationFacts.unexplained.length > 0)} onClick={() => void confirmAuthorization()}>{busy === "activate" || busy === "reauthorize" ? <LoaderCircle className="animate-spin" /> : <Check />}{mode === "reauthorize" ? "Reauthorize Routine" : "Activate Routine"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

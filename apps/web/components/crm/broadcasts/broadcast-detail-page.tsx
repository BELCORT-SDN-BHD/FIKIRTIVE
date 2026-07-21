"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  LoaderCircle,
  Lock,
  Play,
  RefreshCw,
  ShieldAlert,
  Snowflake,
  Unplug,
  X,
} from "lucide-react";
import {
  cancelBroadcastRun,
  confirmBroadcastRun,
  executeBroadcastRun,
  freezeAudience,
  getBroadcastRunLivePreflight,
} from "@/lib/customer-broadcast-ui-actions";
import type {
  getBroadcastComposerOptions,
  getBroadcastRun,
  getBroadcastRunLivePreflight as getBroadcastRunLivePreflightGateway,
  getMemberDirectory,
} from "@/lib/customer-broadcast-gateway";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AXIS_LABELS,
  AXIS_ORDER,
  axisReasonCopy,
  axisStatusPresentation,
  dateTimeLabel,
  errorMessage,
  isDenialErrorCode,
  memberDisplay,
  purposeLabel,
  roleLabel,
  runStatusPresentation,
  sendStatePresentation,
  skipReasonCopy,
  type AxisKey,
} from "./broadcast-format";

type RunResult = Awaited<ReturnType<typeof getBroadcastRun>>;
type PreflightResult = Awaited<ReturnType<typeof getBroadcastRunLivePreflightGateway>>;
type PreflightSuccess = Extract<PreflightResult, { ok: true }>;
type Run = PreflightSuccess["resource"]["run"];
type Row = PreflightSuccess["resource"]["members"][number];
type DirectoryResult = Awaited<ReturnType<typeof getMemberDirectory>>;
type OptionsResult = Awaited<ReturnType<typeof getBroadcastComposerOptions>>;

type Axis = { status: string; source?: string; reason?: string | null; checkedAt?: string };
type Verdict = Record<AxisKey, Axis> & { aggregate?: { status: string; reason?: string } };

function axisOf(verdict: unknown, key: AxisKey): Axis {
  const record = (verdict ?? {}) as Partial<Verdict>;
  const axis = record[key];
  return axis && typeof axis === "object" ? (axis as Axis) : { status: "unknown" };
}

/** consent risk = consentState != verified_grant (risk, or an effective_revoke block). The ONLY
 *  axis a D5 two-confirm override could ever cover — every other block is a hard block. */
function isConsentRisk(live: unknown): boolean {
  const axis = axisOf(live, "consentStop");
  return axis.status === "risk" || (axis.status === "block" && axis.reason === "effective_revoke");
}

function allFourPass(live: unknown): boolean {
  return AXIS_ORDER.every((key) => axisOf(live, key).status === "pass");
}

function DeniedState({ message }: { message: string }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning-soft-foreground">
          <AlertCircle className="size-5" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM Broadcasts</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This broadcast is not available</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <Button asChild className="mt-6" variant="secondary"><Link href="/crm/broadcasts"><ArrowLeft />Back to broadcasts</Link></Button>
      </section>
    </main>
  );
}

function AxisStrip({ verdict, title }: { verdict: unknown; title: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {AXIS_ORDER.map((key) => {
          const axis = axisOf(verdict, key);
          const p = axisStatusPresentation(axis.status);
          const reason = axisReasonCopy(axis.reason);
          return (
            <span key={key} title={reason ?? undefined} className="inline-flex items-center gap-1">
              <span className="text-[11px] text-muted-foreground">{AXIS_LABELS[key]}</span>
              <Badge variant={p.variant}>{p.label}</Badge>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function BroadcastDetailPage({
  broadcastRunId,
  initialRun,
  initialPreflight,
  initialDirectory,
  initialOptions,
  preselectedSegmentId,
}: {
  broadcastRunId: string;
  initialRun: RunResult;
  initialPreflight: PreflightResult;
  initialDirectory: DirectoryResult;
  initialOptions: OptionsResult;
  preselectedSegmentId: string | null;
}) {
  // Degraded/partial honest state: if the live preflight read failed but the plain run read
  // succeeded, still render the run header from it — the audience section then shows the preflight
  // read error instead of live verdicts, rather than a blank page.
  const runFallback = initialRun.ok ? initialRun.resource.run : null;
  const [run, setRun] = useState<Run | null>(initialPreflight.ok ? initialPreflight.resource.run : runFallback);
  const [rows, setRows] = useState<Row[]>(initialPreflight.ok ? initialPreflight.resource.members : []);
  const [readError, setReadError] = useState<string | null>(initialPreflight.ok ? null : initialPreflight.error);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "freeze" | "confirm" | "execute" | "cancel" | "refresh">(null);
  const [segmentId, setSegmentId] = useState(preselectedSegmentId ?? "");

  // Denial (NOT_AUTHORIZED / ACTION_DENIED / RESOURCE_NOT_FOUND) gets the deliberately
  // indistinguishable "not available" page. Placed after the hooks so hook order is stable.
  if (!initialPreflight.ok && isDenialErrorCode(initialPreflight.error)) {
    return <DeniedState message={errorMessage(initialPreflight.error)} />;
  }

  const directory = initialDirectory.ok ? initialDirectory.resource : null;
  const isOwner = directory?.self.role === "owner";
  const selfRole = directory?.self.role ?? null;
  const options = initialOptions.ok ? initialOptions.resource : null;
  const createdByName =
    run && directory ? directory.members.find((m) => m.membershipId === run.createdByMembershipId)?.displayName ?? null : null;

  async function refresh() {
    setBusy("refresh");
    setActionError(null);
    try {
      const result = await getBroadcastRunLivePreflight({ broadcastRunId });
      if (!result.ok) {
        setReadError(result.error);
      } else {
        setRun(result.resource.run);
        setRows(result.resource.members);
        setReadError(null);
      }
    } catch {
      setReadError("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  async function runMutation(
    kind: "freeze" | "confirm" | "execute" | "cancel",
    call: () => Promise<{ ok: boolean; error?: string } | { error: string }>,
  ) {
    setBusy(kind);
    setActionError(null);
    try {
      const result = (await call()) as { ok?: boolean; error?: string };
      if (result && "error" in result && result.error) {
        setActionError(result.error);
      }
    } catch {
      setActionError("NETWORK");
    } finally {
      setBusy(null);
      // Always re-read: a CAS conflict or a successful transition both need the latest revision.
      await refresh();
    }
  }

  if (!run) {
    return (
      <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
        <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-dashed border-destructive/40 bg-card px-6 py-14 text-center shadow-sm">
          <AlertCircle className="mx-auto size-8 text-destructive" />
          <h2 className="mt-4 text-lg font-semibold">This broadcast could not load</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{errorMessage(readError ?? "RESOURCE_NOT_FOUND")}</p>
          <Button className="mt-5" type="button" variant="secondary" onClick={() => void refresh()} disabled={busy === "refresh"}>
            {busy === "refresh" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Retry
          </Button>
        </section>
      </main>
    );
  }

  const status = runStatusPresentation(run.status);
  const consentRiskRows = rows.filter((row) => isConsentRisk(row.liveVerdict));
  const eligibleNowCount = rows.filter((row) => allFourPass(row.liveVerdict)).length;
  const simulatedSentCount = rows.filter((row) => row.sendState === "simulated_sent").length;
  const skippedCount = rows.filter((row) => row.sendState === "skipped_ineligible").length;

  const canFreeze = isOwner && (run.status === "draft" || run.status === "audience_frozen");
  const canConfirm = isOwner && run.status === "audience_frozen";
  const canExecute = isOwner && (run.status === "confirmed" || run.status === "executing");
  const canCancel = isOwner && (run.status === "draft" || run.status === "audience_frozen" || run.status === "confirmed");

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-4xl">
        <Link href="/crm/broadcasts" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" />Back to broadcasts
        </Link>

        <header className="mt-4 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status.variant}>{status.label}</Badge>
              <Badge variant="outline">{purposeLabel(run.purpose)}</Badge>
              <Badge variant="outline">{run.channel}</Badge>
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Broadcast</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {createdByName ? `Created by ${createdByName} · ` : ""}{dateTimeLabel(run.createdAt)} · revision {run.revision}
            </p>
          </div>
          <Button type="button" variant="ghost" onClick={() => void refresh()} disabled={busy !== null}>
            <RefreshCw className={busy === "refresh" ? "animate-spin" : undefined} />Refresh
          </Button>
        </header>

        {/* Provider quota / degrade banner — honestly unavailable in the simulated era (§6.1). */}
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
          <Unplug className="mt-0.5 size-4 shrink-0" />
          <span>Provider messaging tier (quota preflight / quality downgrade): <strong>unavailable</strong>. No channel is connected, so this workbench runs simulated sends only — no message reaches a real customer and no quota is consumed.</span>
        </div>

        {!isOwner ? (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
            <Lock className="mt-0.5 size-4 shrink-0" />
            You are signed in as {selfRole ? roleLabel(selfRole).toLowerCase() : "a non-owner"}. Freeze, confirm, and run are owner-only; the controls below are shown but disabled. The server enforces this regardless of the UI.
          </p>
        ) : null}

        {readError && !isDenialErrorCode(readError) ? (
          <p className="mt-4 text-sm text-destructive">Could not refresh live preflight: {errorMessage(readError)}</p>
        ) : null}
        {actionError ? (
          <p className="mt-4 rounded-xl border border-destructive/30 bg-error-soft px-4 py-3 text-sm text-destructive">
            {errorMessage(actionError)}{actionError === "CAS_CONFLICT" ? " The latest state has been reloaded." : ""}
          </p>
        ) : null}

        {/* Lifecycle actions */}
        <Card className="mt-6">
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {run.status === "completed" ? (
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="size-4" />Simulated run complete</span>
              ) : (
                <span className="text-sm font-semibold">Precise approval — each step is a manual, owner-only action</span>
              )}
            </div>

            {/* Freeze step */}
            {(run.status === "draft" || run.status === "audience_frozen") ? (
              <div className="grid gap-2 rounded-xl border border-border bg-secondary/20 p-4">
                <p className="text-sm font-semibold">1 · Freeze the audience</p>
                <p className="text-xs text-muted-foreground">Snapshot the segment now. Contacts with unknown permission stay in and are flagged — the estimate never drops them.</p>
                <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <select
                    className="min-h-11 w-full rounded-[var(--radius-input)] border border-border bg-background px-3 text-sm disabled:opacity-50"
                    value={segmentId}
                    onChange={(e) => setSegmentId(e.target.value)}
                    disabled={!canFreeze || busy !== null}
                  >
                    <option value="">Select a segment…</option>
                    {(options?.segments ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <Button type="button" disabled={!canFreeze || busy !== null || !segmentId} onClick={() => void runMutation("freeze", () => freezeAudience({ broadcastRunId, expectedRevision: run.revision, segmentId }))}>
                    {busy === "freeze" ? <LoaderCircle className="animate-spin" /> : <Snowflake />}{run.status === "audience_frozen" ? "Re-freeze audience" : "Freeze audience"}
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Confirm step */}
            {run.status === "audience_frozen" ? (
              <div className="grid gap-2 rounded-xl border border-border bg-secondary/20 p-4">
                <p className="text-sm font-semibold">2 · Confirm this exact audience</p>
                <p className="text-xs text-muted-foreground">Confirming locks the frozen action. Execution still re-reads every axis live — a confirmed snapshot never authorizes a stale send.</p>
                <Button className="mt-1 w-fit" type="button" disabled={!canConfirm || busy !== null} onClick={() => void runMutation("confirm", () => confirmBroadcastRun({ broadcastRunId, expectedRevision: run.revision }))}>
                  {busy === "confirm" ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}Confirm audience
                </Button>
              </div>
            ) : null}

            {/* Execute step */}
            {(run.status === "confirmed" || run.status === "executing") ? (
              <div className="grid gap-2 rounded-xl border border-brand/25 bg-brand-soft/40 p-4">
                <p className="text-sm font-semibold">3 · Run the simulated send</p>
                <p className="text-xs text-muted-foreground">Re-reads all four axes per contact right now. Four-axis-pass contacts are marked simulated-sent and count against the frequency cap; anyone blocked is skipped with a reason. Zero real messages, zero spend.</p>
                <Button className="mt-1 w-fit" type="button" disabled={!canExecute || busy !== null} onClick={() => void runMutation("execute", () => executeBroadcastRun({ broadcastRunId, expectedRevision: run.revision }))}>
                  {busy === "execute" ? <LoaderCircle className="animate-spin" /> : <Play />}{run.status === "executing" ? "Resume simulated send" : "Run simulated send"}
                </Button>
              </div>
            ) : null}

            {run.status === "completed" ? (
              <div className="grid gap-1 rounded-xl border border-success/25 bg-success-soft/40 p-4 text-sm">
                <p><strong>{simulatedSentCount}</strong> simulated {simulatedSentCount === 1 ? "send" : "sends"} · <strong>{skippedCount}</strong> skipped as ineligible.</p>
                <p className="text-xs text-muted-foreground">Each simulated send recorded exactly one frequency event. Skipped contacts recorded none.</p>
              </div>
            ) : null}

            {canCancel ? (
              <Button className="w-fit" type="button" variant="ghost" disabled={busy !== null} onClick={() => void runMutation("cancel", () => cancelBroadcastRun({ broadcastRunId, expectedRevision: run.revision }))}>
                {busy === "cancel" ? <LoaderCircle className="animate-spin" /> : <X />}Cancel broadcast
              </Button>
            ) : null}
          </CardContent>
        </Card>

        {/* D5 two-confirm — visible flow, override always unavailable (fail closed, §6.4). */}
        {consentRiskRows.length > 0 ? (
          <Card className="mt-6 border-warning/30">
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-warning-soft-foreground" />
                <p className="text-sm font-semibold">D5 two-confirm override — required for {consentRiskRows.length} consent-risk {consentRiskRows.length === 1 ? "contact" : "contacts"}</p>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                A contact whose consent is unknown or opted-out can only be sent to after two independent human confirmations of this exact frozen action — and it never changes their consent. The flow is shown for reference; the override cannot be minted yet, so these contacts are always skipped by a simulated run.
              </p>
              <ol className="grid gap-2 text-sm">
                <li className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full border border-border text-xs">1</span>First confirmation</li>
                <li className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full border border-border text-xs">2</span>Second, independent confirmation</li>
              </ol>
              <Button className="w-fit" type="button" variant="outline" disabled title="D5 override carriers are not implemented — overrides are unavailable.">
                <Lock />Apply override (unavailable)
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {/* Audience members: frozen snapshot + live preflight side by side */}
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Audience</h2>
            <p className="text-sm text-muted-foreground">{rows.length} {rows.length === 1 ? "contact" : "contacts"} · {eligibleNowCount} eligible now</p>
          </div>

          {rows.length === 0 ? (
            <section className="mt-4 rounded-[var(--radius-card)] border border-dashed border-border bg-card px-6 py-14 text-center shadow-sm">
              <Snowflake className="mx-auto size-8 text-muted-foreground" />
              <h3 className="mt-4 text-base font-semibold">No audience frozen yet</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Freeze a segment above to snapshot the audience and see each contact&rsquo;s four-axis verdict.</p>
            </section>
          ) : (
            <div className="mt-4 grid gap-3">
              {rows.map((row) => {
                const display = memberDisplay(row);
                const send = sendStatePresentation(row.sendState);
                const stale = AXIS_ORDER.some((key) => axisOf(row.frozenVerdict, key).status !== axisOf(row.liveVerdict, key).status);
                const consentRisk = isConsentRisk(row.liveVerdict);
                return (
                  <Card key={row.id}>
                    <CardContent className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{display.name}</p>
                          {display.handle ? <p className="truncate text-xs text-muted-foreground">{display.handle}</p> : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {row.includedByMerchant ? <Badge variant="outline">Kept</Badge> : <Badge variant="outline">Excluded</Badge>}
                          {consentRisk ? <Badge variant="warning">Consent risk · D5</Badge> : null}
                          {stale ? <Badge variant="warning">Stale snapshot</Badge> : null}
                          <Badge variant={send.variant}>{send.label}</Badge>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <AxisStrip verdict={row.frozenVerdict} title="Frozen at snapshot" />
                        <AxisStrip verdict={row.liveVerdict} title="Live preflight now" />
                      </div>
                      {row.skipReason ? (
                        <p className="text-xs text-muted-foreground">Skip reason — {skipReasonCopy(row.skipReason)}</p>
                      ) : null}
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

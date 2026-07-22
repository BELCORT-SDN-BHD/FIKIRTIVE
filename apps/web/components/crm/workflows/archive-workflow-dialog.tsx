"use client";

import { useState } from "react";
import { AlertTriangle, Archive, LoaderCircle, Power, Unplug } from "lucide-react";
import {
  archiveWorkflowDefinition,
  getWorkflowDefinition,
  killRoutine,
} from "@/lib/customer-workflow-ui-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { workflowErrorMessage } from "./workflow-format";

type DefinitionResult = Awaited<ReturnType<typeof getWorkflowDefinition>>;
type Definition = Extract<DefinitionResult, { ok: true }>["resource"];

export type ArchiveRoutineReference = {
  id: string;
  routineKey: string;
  rowRevision: number;
  active: boolean;
};

export default function ArchiveWorkflowDialog({
  definition,
  activeRoutines,
  onArchived,
}: {
  definition: Definition;
  activeRoutines: ArchiveRoutineReference[] | null;
  onArchived: (definition: Definition) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [references, setReferences] = useState(activeRoutines);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const active = references?.filter((routine) => routine.active) ?? null;
  const allReviewed = active !== null && active.every((routine) => confirmed.includes(routine.id));
  const exactMessage = active ? `Archiving does not stop these ${active.length} active Routines` : null;

  async function archive() {
    setBusy("archive");
    setErrorCode(null);
    try {
      const acknowledgement = active && active.length > 0
        ? {
            message: exactMessage!,
            routines: active.map(({ id, routineKey }) => ({ id, routineKey })),
          }
        : undefined;
      const result = await archiveWorkflowDefinition({
        workflowDefinitionId: definition.id,
        expectedRowRevision: definition.rowRevision,
        ...(acknowledgement ? { acknowledgement } : {}),
      });
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      onArchived(result.resource);
      setOpen(false);
    } catch {
      setErrorCode("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  async function kill(reference: ArchiveRoutineReference) {
    setBusy(reference.id);
    setErrorCode(null);
    try {
      const result = await killRoutine({
        routineId: reference.id,
        expectedRowRevision: reference.rowRevision,
        reasonCode: "merchant_archive_preflight_kill",
      });
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      setReferences((current) => current?.map((item) => item.id === reference.id
        ? { ...item, rowRevision: result.resource.rowRevision, active: false }
        : item) ?? null);
    } catch {
      setErrorCode("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button type="button" variant="ghost" disabled={definition.status === "archived"} onClick={() => setOpen(true)}>
        <Archive />Archive
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (busy === null) setOpen(next); }}>
        <DialogContent className="max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Archive this workflow?</DialogTitle>
            <DialogDescription>Archiving hides the definition from active work. It keeps every revision, run, step, and journey record.</DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-warning/25 bg-warning-soft p-4 text-sm leading-6 text-warning-soft-foreground">
            <div className="flex gap-3"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><p><strong>Archive is not OFF.</strong> Archiving never kills or pauses a Routine.</p></div>
          </div>

          {active === null ? (
            <div className="rounded-xl border border-border bg-secondary/25 p-4">
              <div className="flex items-start gap-3"><Unplug className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div><div className="flex items-center gap-2"><p className="text-sm font-semibold">Active Routine list unavailable</p><Badge variant="outline">Fail closed</Badge></div><p className="mt-2 text-sm leading-6 text-muted-foreground">The gateway cannot list the exact Routine keys and IDs required for acknowledgment. You may ask the server to archive only if there are zero active Routines. If any remain, archiving stops here and nothing changes.</p></div></div>
            </div>
          ) : active.length > 0 ? (
            <div>
              <p className="text-sm font-semibold text-warning-soft-foreground">{exactMessage}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">For every Routine below, either kill it first or explicitly confirm that it should continue running.</p>
              <div className="mt-3 grid gap-3">
                {active.map((routine) => (
                  <div key={routine.id} className="rounded-xl border border-border p-4">
                    <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-xs font-semibold">{routine.routineKey}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{routine.id}</p></div><Button type="button" size="sm" variant="destructive" disabled={busy !== null} onClick={() => void kill(routine)}>{busy === routine.id ? <LoaderCircle className="animate-spin" /> : <Power />}Kill Routine</Button></div>
                    <label className="mt-3 flex cursor-pointer gap-3 border-t border-border pt-3"><input className="mt-1 size-4 accent-[var(--brand)]" type="checkbox" checked={confirmed.includes(routine.id)} onChange={(event) => setConfirmed((current) => event.target.checked ? [...current, routine.id] : current.filter((id) => id !== routine.id))} /><span><span className="block text-sm font-semibold">Continue running after archive</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">I understand that archiving this workflow does not stop Routine {routine.routineKey}.</span></span></label>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="rounded-xl border border-border bg-secondary/25 px-4 py-3 text-sm text-muted-foreground">No active Routines reference this workflow. It can be archived without an acknowledgment.</p>
          )}

          {errorCode ? (
            <div className="rounded-xl border border-destructive/30 bg-error-soft px-4 py-3 text-sm leading-6 text-destructive">
              <p className="font-semibold">The workflow was not archived</p>
              <p className="mt-1">{errorCode === "NETWORK" ? "The request could not finish. Please retry." : workflowErrorMessage(errorCode)}</p>
              {errorCode === "ACTIVE_ROUTINE_ACKNOWLEDGEMENT_REQUIRED" && active === null ? <p className="mt-2">The exact active Routine list is required before you can continue. No Routine was stopped.</p> : null}
              <p className="mt-1 font-mono text-xs">Error code: {errorCode}</p>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={busy !== null || (active !== null && active.length > 0 && !allReviewed)} onClick={() => void archive()}>{busy === "archive" ? <LoaderCircle className="animate-spin" /> : <Archive />}{active === null ? "Archive only if no Routines are active" : "Archive workflow"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Code2,
  FileCheck2,
  History,
  LoaderCircle,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  Unplug,
} from "lucide-react";
import {
  getWorkflowDefinition,
  listWorkflowRevisions,
  publishWorkflowRevision,
  saveWorkflowRevision,
  validateWorkflowRules,
} from "@/lib/customer-workflow-ui-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import ArchiveWorkflowDialog from "./archive-workflow-dialog";
import RoutineAuthorizationPanel from "./routine-authorization-panel";
import WorkflowMonitoring from "./workflow-monitoring";
import WorkflowRecipesPanel from "./workflow-recipes-panel";
import {
  dateTimeLabel,
  definitionStatusPresentation,
  isDenialErrorCode,
  shortWorkflowId,
  validationIssueCopy,
  validationIssues,
  validationStatusPresentation,
  workflowErrorMessage,
} from "./workflow-format";

type DefinitionResult = Awaited<ReturnType<typeof getWorkflowDefinition>>;
type Definition = Extract<DefinitionResult, { ok: true }>["resource"];
type RevisionsResult = Awaited<ReturnType<typeof listWorkflowRevisions>>;
type Revision = Extract<RevisionsResult, { ok: true }>["resource"][number];
type Compilation = { validationState: string; validationErrorsJson: unknown };

const STARTER_RULE = [
  "version: fikirtive-workflow/v1",
  "name: New workflow",
  "trigger:",
  "  type: manual",
  "conditions: []",
  "steps:",
  "  - key: finish",
  "    action:",
  "      type: complete",
].join("\n");

function UnavailableState({ message }: { message: string }) {
  return (
    <main className="min-h-dvh bg-background px-8 py-10 text-foreground">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-8 shadow-[var(--shadow-sm)]">
        <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning-soft-foreground"><AlertCircle className="size-5" /></span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM Workflows</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This workflow is not available</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <Button asChild className="mt-6" variant="secondary"><Link href="/crm/workflows"><ArrowLeft />Back to workflows</Link></Button>
      </section>
    </main>
  );
}

export default function WorkflowDetailPage({
  workflowDefinitionId,
  initialDefinition,
  initialRevisions,
}: {
  workflowDefinitionId: string;
  initialDefinition: DefinitionResult;
  initialRevisions: RevisionsResult;
}) {
  const initialRevisionRows = initialRevisions.ok ? initialRevisions.resource : [];
  const initialCurrent = initialDefinition.ok
    ? initialRevisionRows.find((revision) => revision.revision === initialDefinition.resource.currentRevision) ?? initialRevisionRows[0] ?? null
    : initialRevisionRows[0] ?? null;
  const [definition, setDefinition] = useState<Definition | null>(initialDefinition.ok ? initialDefinition.resource : null);
  const [revisions, setRevisions] = useState<Revision[]>(initialRevisionRows);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(initialCurrent?.id ?? null);
  const [rulesSource, setRulesSource] = useState(initialCurrent?.rulesSource ?? STARTER_RULE);
  const [compilation, setCompilation] = useState<Compilation | null>(initialCurrent ?? null);
  const [readError, setReadError] = useState<string | null>(
    !initialDefinition.ok ? initialDefinition.error : !initialRevisions.ok ? initialRevisions.error : null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "refresh" | "validate" | "save" | "publish">(null);

  const denialCode = !initialDefinition.ok && isDenialErrorCode(initialDefinition.error)
    ? initialDefinition.error
    : !initialRevisions.ok && isDenialErrorCode(initialRevisions.error)
      ? initialRevisions.error
      : null;
  if (denialCode) return <UnavailableState message={workflowErrorMessage(denialCode)} />;
  if (!definition) return <UnavailableState message={workflowErrorMessage(readError ?? "RESOURCE_NOT_FOUND")} />;
  const currentDefinition = definition;

  const selectedRevision = revisions.find((revision) => revision.id === selectedRevisionId) ?? null;
  const dirty = !selectedRevision || rulesSource !== selectedRevision.rulesSource;
  const status = definitionStatusPresentation(definition.status);
  const validation = validationStatusPresentation(compilation?.validationState ?? "not_validated");
  const issues = validationIssues(compilation?.validationErrorsJson);
  const archived = definition.status === "archived";
  const canPublish = Boolean(
    selectedRevision &&
    !dirty &&
    selectedRevision.validationState === "valid" &&
    definition.currentRevision !== selectedRevision.revision &&
    !archived,
  );

  async function refresh() {
    setBusy("refresh");
    setActionError(null);
    try {
      const [definitionResult, revisionsResult] = await Promise.all([
        getWorkflowDefinition({ workflowDefinitionId }),
        listWorkflowRevisions({ workflowDefinitionId }),
      ]);
      if (!definitionResult.ok) {
        setReadError(definitionResult.error);
        return;
      }
      setDefinition(definitionResult.resource);
      if (!revisionsResult.ok) {
        setReadError(revisionsResult.error);
        return;
      }
      setRevisions(revisionsResult.resource);
      setReadError(null);
    } catch {
      setReadError("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  async function validate() {
    setBusy("validate");
    setActionError(null);
    try {
      const result = await validateWorkflowRules({ workflowDefinitionId, rulesSource });
      if (!result.ok) setActionError(result.error);
      else setCompilation(result.resource);
    } catch {
      setActionError("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setActionError(null);
    try {
      const result = await saveWorkflowRevision({ workflowDefinitionId, rulesSource });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setRevisions((current) => [result.resource, ...current.filter((revision) => revision.id !== result.resource.id)]
        .sort((left, right) => right.revision - left.revision));
      setSelectedRevisionId(result.resource.id);
      setRulesSource(result.resource.rulesSource);
      setCompilation(result.resource);
    } catch {
      setActionError("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!selectedRevision || !canPublish) return;
    setBusy("publish");
    setActionError(null);
    try {
      const result = await publishWorkflowRevision({
        workflowDefinitionId,
        workflowRevisionId: selectedRevision.id,
        expectedRowRevision: currentDefinition.rowRevision,
      });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setDefinition(result.resource);
    } catch {
      setActionError("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  function openRevision(revision: Revision) {
    setSelectedRevisionId(revision.id);
    setRulesSource(revision.rulesSource);
    setCompilation(revision);
    setActionError(null);
  }

  return (
    <main className="min-h-dvh bg-background px-8 py-9 text-foreground">
      <div className="mx-auto max-w-[1280px]">
        <Link href="/crm/workflows" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="size-4" />Back to workflows</Link>

        <header className="mt-4 flex items-start justify-between gap-8 border-b border-border pb-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><Badge variant={status.variant}>{status.label}</Badge><Badge variant="outline">{definition.definitionKind === "journey" ? "Contact journey" : "Rule"}</Badge><Badge variant="outline">Routine status unavailable</Badge></div>
            <h1 className="mt-3 truncate text-3xl font-semibold tracking-[-0.03em]">{definition.name}</h1>
            <p className="mt-2 font-mono text-xs text-muted-foreground">/workflows/{definition.slug}.workflow.yaml · {shortWorkflowId(definition.id)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2"><Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void refresh()}>{busy === "refresh" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Refresh</Button><ArchiveWorkflowDialog definition={definition} activeRoutines={null} onArchived={setDefinition} /></div>
        </header>

        <nav className="sticky top-0 z-20 -mx-2 flex gap-1 border-b border-border bg-background/95 px-2 py-3 backdrop-blur" aria-label="Workflow sections">
          <a className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-secondary" href="#rule-file">Rule file</a>
          <a className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-secondary" href="#routine">Routine</a>
          <a className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-secondary" href="#activity">Runs and journeys</a>
          <a className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-secondary" href="#recipes">Recipes and hours</a>
        </nav>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
          <Unplug className="mt-0.5 size-4 shrink-0" />
          <span><strong>Simulation only.</strong> A valid or published rule is not permission to contact customers. Activation needs a separate human authorization envelope, and real delivery remains disconnected.</span>
        </div>

        {readError ? <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground"><p className="font-semibold">Some workflow data could not refresh</p><p className="mt-1">{readError === "NETWORK" ? "The request could not finish. Previously loaded data remains visible." : workflowErrorMessage(readError)}</p><p className="mt-1 font-mono text-xs">Error code: {readError}</p></div> : null}
        {actionError ? <div className="mt-4 rounded-xl border border-destructive/30 bg-error-soft px-4 py-3 text-sm leading-6 text-destructive"><p className="font-semibold">The workflow action could not finish</p><p className="mt-1">{actionError === "NETWORK" ? "The request could not finish. Please retry." : workflowErrorMessage(actionError)}</p><p className="mt-1 font-mono text-xs">Error code: {actionError}</p></div> : null}

        <section id="rule-file" className="scroll-mt-20 pt-8" aria-labelledby="rule-file-heading">
          <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">Define</p><h2 id="rule-file-heading" className="mt-2 text-2xl font-semibold tracking-tight">Readable rule file</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Edit the rule as constrained text. Every material save creates an immutable revision; no node canvas or runtime script is involved.</p></div><Badge variant={validation.variant}>{validation.label}</Badge></div>

          <div className="mt-5 grid grid-cols-[minmax(0,1fr)_340px] gap-5">
            <Card className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-border bg-secondary/35 px-5 py-3"><div className="flex items-center gap-2"><Code2 className="size-4 text-muted-foreground" /><span className="font-mono text-xs">{definition.slug}.workflow.yaml</span></div><span className="text-xs text-muted-foreground">Fikirtive workflow v1</span></div>
              <CardContent className="p-5">
                <Textarea aria-label="Workflow rule file" spellCheck={false} disabled={archived} value={rulesSource} onChange={(event) => { setRulesSource(event.target.value); setCompilation(null); }} className="min-h-[500px] resize-y rounded-xl bg-[#111114] p-5 font-mono text-[13px] leading-6 text-[#F4F4F5] shadow-inner selection:bg-brand/35" />
                <div className="mt-4 flex items-center justify-between gap-4"><p className="text-xs leading-5 text-muted-foreground">Validate checks the text and exact references. Save keeps the result as a revision. Only a valid saved revision can be published.</p><div className="flex shrink-0 gap-2"><Button type="button" variant="secondary" disabled={busy !== null || archived} onClick={() => void validate()}>{busy === "validate" ? <LoaderCircle className="animate-spin" /> : <FileCheck2 />}Validate</Button><Button type="button" variant="secondary" disabled={busy !== null || archived} onClick={() => void save()}>{busy === "save" ? <LoaderCircle className="animate-spin" /> : <Save />}Save revision</Button><Button type="button" disabled={busy !== null || !canPublish} onClick={() => void publish()}>{busy === "publish" ? <LoaderCircle className="animate-spin" /> : <Send />}Publish revision</Button></div></div>
              </CardContent>
            </Card>

            <div className="grid content-start gap-4">
              <Card className={compilation?.validationState === "invalid" ? "border-destructive/35" : compilation?.validationState === "unavailable" ? "border-warning/35" : ""}>
                <CardContent>
                  <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Validation</h3><Badge variant={validation.variant}>{validation.label}</Badge></div>
                  {!compilation ? <p className="mt-3 text-sm leading-6 text-muted-foreground">Validate this edited text before publishing. An unvalidated edit cannot be published.</p> : compilation.validationState === "valid" ? <div className="mt-3 flex gap-3"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /><div><p className="text-sm font-semibold">The rule is valid</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Its structure and exact dependencies compiled successfully. Saving or publishing still does not activate a Routine.</p></div></div> : (
                    <div className="mt-3"><div className="flex gap-3"><ShieldAlert className={compilation.validationState === "invalid" ? "mt-0.5 size-4 shrink-0 text-destructive" : "mt-0.5 size-4 shrink-0 text-warning-soft-foreground"} /><div><p className="text-sm font-semibold">{compilation.validationState === "invalid" ? "This rule cannot be published" : "This rule is unavailable"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{compilation.validationState === "invalid" ? "Fix every issue below, validate again, then save a new revision." : "A required exact dependency could not be verified. Nothing will run."}</p></div></div><div className="mt-4 grid gap-2">{issues.map((issue, index) => <div key={`${issue.code}-${issue.path}-${index}`} className="rounded-lg border border-border bg-secondary/30 px-3 py-2"><p className="text-xs leading-5">{validationIssueCopy(issue)}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{issue.path}{issue.line ? ` · line ${issue.line}${issue.column ? `, column ${issue.column}` : ""}` : ""} · {issue.code}</p></div>)}</div></div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent><h3 className="font-semibold">Publication</h3><div className="mt-3 grid gap-2 text-sm"><div className="flex items-center justify-between"><span className="text-muted-foreground">Current revision</span><span className="font-semibold">{definition.currentRevision ? `Revision ${definition.currentRevision}` : "None"}</span></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Open revision</span><span className="font-semibold">{selectedRevision ? `Revision ${selectedRevision.revision}` : "Unsaved text"}</span></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Edited</span><span className="font-semibold">{dirty ? "Yes" : "No"}</span></div></div><p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">Publishing moves the definition pointer only. Existing Routines stay pinned to their exact older revision until a person reauthorizes them.</p></CardContent>
              </Card>
            </div>
          </div>

          <Card className="mt-5">
            <CardContent>
              <div className="flex items-end justify-between gap-4"><div><div className="flex items-center gap-2"><History className="size-4 text-muted-foreground" /><h3 className="font-semibold">Revision history</h3></div><p className="mt-1 text-sm text-muted-foreground">Newest first. Opening history never edits that immutable revision.</p></div><p className="text-sm text-muted-foreground">{revisions.length} {revisions.length === 1 ? "revision" : "revisions"}</p></div>
              {revisions.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">No revisions saved yet. Validate the starter rule, then save the first immutable revision.</p> : <div className="mt-4 grid grid-cols-2 gap-3">{revisions.map((revision) => { const revisionValidation = validationStatusPresentation(revision.validationState); const current = definition.currentRevision === revision.revision; const selected = selectedRevisionId === revision.id; return <button key={revision.id} type="button" onClick={() => openRevision(revision)} className={`rounded-xl border p-4 text-left transition-colors ${selected ? "border-brand bg-brand-soft/35" : "border-border hover:bg-secondary/35"}`}><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="font-semibold">Revision {revision.revision}</span>{current ? <Badge variant="brand">Published</Badge> : null}</div><Badge variant={revisionValidation.variant}>{revisionValidation.label}</Badge></div><p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" />{dateTimeLabel(revision.createdAt)}</p><p className="mt-2 font-mono text-[11px] text-muted-foreground">{shortWorkflowId(revision.id)}</p></button>; })}</div>}
            </CardContent>
          </Card>
        </section>

        <div className="mt-12 border-t border-border pt-10"><RoutineAuthorizationPanel workflowDefinitionId={definition.id} workflowSlug={definition.slug} revisions={revisions} disabled={archived} /></div>
        <div className="mt-12 border-t border-border pt-10"><WorkflowMonitoring data={null} /></div>
        <div className="mt-12 border-t border-border pt-10 pb-16"><WorkflowRecipesPanel /></div>
      </div>
    </main>
  );
}

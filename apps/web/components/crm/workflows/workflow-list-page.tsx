"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  FileCode2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Unplug,
} from "lucide-react";
import {
  createWorkflowDefinition,
  listRoutines,
  listWorkflowDefinitions,
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
import {
  dateTimeLabel,
  definitionStatusPresentation,
  isDenialErrorCode,
  shortWorkflowId,
  workflowErrorMessage,
} from "./workflow-format";

type DefinitionsResult = Awaited<ReturnType<typeof listWorkflowDefinitions>>;
type Definition = Extract<DefinitionsResult, { ok: true }>["resource"][number];
type RoutinesResult = Awaited<ReturnType<typeof listRoutines>>;
type Routine = Extract<RoutinesResult, { ok: true }>["resource"]["items"][number];

async function listAllRoutines() {
  const items: Routine[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await listRoutines({ limit: 200, ...(cursor ? { cursor } : {}) });
    if (!page.ok) return page;
    items.push(...page.resource.items);
    const next = page.resource.nextCursor ?? undefined;
    if (next && seen.has(next)) return { ok: false as const, error: "AUTHORITY_UNAVAILABLE" as const };
    if (next) seen.add(next);
    cursor = next;
  } while (cursor);
  return { ok: true as const, resource: { items, nextCursor: null } };
}

function safeSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}

function DeniedState({ message }: { message: string }) {
  return (
    <main className="min-h-dvh bg-background px-6 py-10 text-foreground">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-8 shadow-[var(--shadow-sm)]">
        <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning-soft-foreground"><AlertCircle className="size-5" /></span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM Workflows</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This workflow workspace is not available</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <Button asChild className="mt-6" variant="secondary"><Link href="/otto"><ArrowLeft />Return to Otto</Link></Button>
      </section>
    </main>
  );
}

export default function WorkflowListPage({
  initialDefinitions,
  initialRoutines,
}: {
  initialDefinitions: DefinitionsResult;
  initialRoutines: RoutinesResult;
}) {
  const router = useRouter();
  const [definitions, setDefinitions] = useState<Definition[]>(initialDefinitions.ok ? initialDefinitions.resource : []);
  const [errorCode, setErrorCode] = useState<string | null>(initialDefinitions.ok ? null : initialDefinitions.error);
  const [routines, setRoutines] = useState<Routine[]>(initialRoutines.ok ? initialRoutines.resource.items : []);
  const [routineErrorCode, setRoutineErrorCode] = useState<string | null>(
    initialRoutines.ok ? null : initialRoutines.error,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [kind, setKind] = useState<"rule" | "journey">("rule");

  if (!initialDefinitions.ok && isDenialErrorCode(initialDefinitions.error)) {
    return <DeniedState message={workflowErrorMessage(initialDefinitions.error)} />;
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const [definitionsResult, routinesResult] = await Promise.allSettled([
        listWorkflowDefinitions({ limit: 200 }),
        listAllRoutines(),
      ]);
      if (definitionsResult.status === "rejected") setErrorCode("NETWORK");
      else if (!definitionsResult.value.ok) setErrorCode(definitionsResult.value.error);
      else {
        setDefinitions(definitionsResult.value.resource);
        setErrorCode(null);
      }
      if (routinesResult.status === "rejected") setRoutineErrorCode("NETWORK");
      else if (!routinesResult.value.ok) setRoutineErrorCode(routinesResult.value.error);
      else {
        setRoutines(routinesResult.value.resource.items);
        setRoutineErrorCode(null);
      }
    } catch {
      setErrorCode("NETWORK");
    } finally {
      setRefreshing(false);
    }
  }

  async function create() {
    if (!name.trim() || !slug) {
      setErrorCode("INVALID_ARGUMENT");
      return;
    }
    setCreating(true);
    setErrorCode(null);
    try {
      const result = await createWorkflowDefinition({
        name: name.trim(),
        slug,
        definitionKind: kind,
        originKind: "custom",
      });
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      setDefinitions((current) => [result.resource, ...current]);
      setDialogOpen(false);
      router.push(`/crm/workflows/${result.resource.id}`);
    } catch {
      setErrorCode("NETWORK");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background px-8 py-9 text-foreground">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-end justify-between gap-8 border-b border-border pb-7">
          <div>
            <Link href="/otto" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="size-4" />Return to Otto</Link>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">CRM</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-[-0.035em]">Workflows</h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">Write readable rules, authorize exactly what a Routine may do, and inspect every simulated decision. Workflows never send or spend from this workspace.</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Button type="button" variant="ghost" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Refresh</Button>
            <Button type="button" onClick={() => setDialogOpen(true)}><Plus />New workflow</Button>
          </div>
        </header>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
          <Unplug className="mt-0.5 size-4 shrink-0" />
          <span><strong>Simulated workspace.</strong> A published rule is not an active Routine. Provider delivery and spend are disconnected, so no workflow action reaches a real customer.</span>
        </div>

        {errorCode ? (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-error-soft px-4 py-3 text-sm leading-6 text-destructive">
            <p className="font-semibold">The workflow request could not finish</p>
            <p className="mt-1">{errorCode === "NETWORK" ? "The request could not finish. Please retry." : workflowErrorMessage(errorCode)}</p>
            <p className="mt-1 font-mono text-xs">Error code: {errorCode}</p>
          </div>
        ) : null}

        <section className="mt-7" aria-labelledby="workflow-list-heading">
          <div className="flex items-end justify-between gap-4">
            <div><h2 id="workflow-list-heading" className="text-xl font-semibold tracking-tight">Rule definitions</h2><p className="mt-1 text-sm text-muted-foreground">Definition status and execution authority stay separate.</p></div>
            <p className="text-sm text-muted-foreground">{definitions.length} {definitions.length === 1 ? "workflow" : "workflows"}</p>
          </div>

          {definitions.length === 0 ? (
            <div className="mt-4 rounded-[var(--radius-card)] border border-dashed border-border bg-card px-8 py-16 text-center shadow-sm">
              <FileCode2 className="mx-auto size-9 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No workflows yet</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Create a readable rule file, validate it, and publish an immutable revision. Routine authorization happens separately.</p>
              <Button className="mt-5" type="button" onClick={() => setDialogOpen(true)}><Plus />New workflow</Button>
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {definitions.map((definition) => {
                const status = definitionStatusPresentation(definition.status);
                const definitionRoutines = routines.filter(
                  (routine) => routine.workflowDefinition.id === definition.id,
                );
                const activeRoutines = definitionRoutines.filter(
                  (routine) => routine.status === "active" && !routine.killSwitchEngaged,
                );
                return (
                  <Link key={definition.id} href={`/crm/workflows/${definition.id}`} className="group block">
                    <Card className="transition-[border-color,transform,box-shadow] group-hover:-translate-y-0.5 group-hover:border-foreground/20 group-hover:shadow-md">
                      <CardContent className="grid grid-cols-[minmax(0,1fr)_220px_auto] items-center gap-6">
                        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant={status.variant}>{status.label}</Badge><Badge variant="outline">{definition.definitionKind === "journey" ? "Journey" : "Rule"}</Badge>{definition.originKind === "inbox_recipe" ? <Badge variant="outline">Recipe</Badge> : null}</div><h3 className="mt-3 truncate text-lg font-semibold">{definition.name}</h3><p className="mt-1 truncate font-mono text-xs text-muted-foreground">/workflows/{definition.slug}.workflow.yaml</p></div>
                        <div className="border-l border-border pl-6"><div className="flex items-center gap-2"><CircleHelp className="size-4 text-muted-foreground" />{routineErrorCode ? <Badge variant="outline">Routine status unavailable</Badge> : activeRoutines.length > 0 ? <Badge variant="brand">{activeRoutines.length} active {activeRoutines.length === 1 ? "Routine" : "Routines"}</Badge> : <Badge variant="outline">No active Routines</Badge>}</div><p className="mt-2 text-xs leading-5 text-muted-foreground">{routineErrorCode ? workflowErrorMessage(routineErrorCode) : `${definitionRoutines.length} authorization ${definitionRoutines.length === 1 ? "envelope" : "envelopes"}. Published never implies active.`}</p></div>
                        <div className="text-right"><p className="text-xs text-muted-foreground">Updated {dateTimeLabel(definition.updatedAt)}</p><p className="mt-2 font-mono text-[11px] text-muted-foreground">{shortWorkflowId(definition.id)}</p><ArrowRight className="ml-auto mt-3 size-4 text-muted-foreground transition-transform group-hover:translate-x-1" /></div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!creating) setDialogOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create a workflow</DialogTitle><DialogDescription>Start with a stable definition. The readable rule file and every saved revision come next.</DialogDescription></DialogHeader>
          <label className="grid gap-2 text-sm font-semibold">Name<Input autoFocus value={name} onChange={(event) => { const next = event.target.value; setName(next); if (!slugEdited) setSlug(safeSlug(next)); }} placeholder="Outside-hours reply" /></label>
          <label className="grid gap-2 text-sm font-semibold">File path<Input value={slug} onChange={(event) => { setSlugEdited(true); setSlug(safeSlug(event.target.value)); }} placeholder="outside-hours-reply" /><span className="font-mono text-xs font-normal text-muted-foreground">/workflows/{slug || "your-workflow"}.workflow.yaml</span></label>
          <label className="grid gap-2 text-sm font-semibold">Type<select className="h-11 rounded-lg border border-input bg-card px-3 text-sm font-normal" value={kind} onChange={(event) => setKind(event.target.value as "rule" | "journey")}><option value="rule">Rule</option><option value="journey">Contact journey</option></select></label>
          <div className="rounded-xl border border-border bg-secondary/25 px-4 py-3 text-sm leading-6 text-muted-foreground">Creating a definition does not publish a rule or authorize a Routine.</div>
          {errorCode ? <div className="rounded-xl border border-destructive/30 bg-error-soft px-4 py-3 text-sm leading-6 text-destructive"><p className="font-semibold">The workflow request could not finish</p><p className="mt-1">{errorCode === "NETWORK" ? "The request could not finish. Please retry." : workflowErrorMessage(errorCode)}</p><p className="mt-1 font-mono text-xs">Error code: {errorCode}</p></div> : null}
          <DialogFooter><Button type="button" variant="secondary" disabled={creating} onClick={() => setDialogOpen(false)}>Cancel</Button><Button type="button" disabled={creating || !name.trim() || !slug} onClick={() => void create()}>{creating ? <LoaderCircle className="animate-spin" /> : <Plus />}Create workflow</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

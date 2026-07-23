import WorkflowDetailPage from "@/components/crm/workflows/workflow-detail-page";
import {
  getContactJourneyStates,
  getWorkflowDefinition,
  listBusinessHoursPolicies,
  listRoutineRuns,
  listRoutines,
  listWorkflowRevisions,
} from "@/lib/customer-workflow-ui-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workflow · Fikirtive" };

type RoutinesResult = Awaited<ReturnType<typeof listRoutines>>;
type Routine = Extract<RoutinesResult, { ok: true }>["resource"]["items"][number];

async function listAllDefinitionRoutines(workflowDefinitionId: string) {
  const items: Routine[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await listRoutines({
      workflowDefinitionId,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    if (!page.ok) return page;
    items.push(...page.resource.items);
    const next = page.resource.nextCursor ?? undefined;
    if (next && seen.has(next)) return { ok: false as const, error: "AUTHORITY_UNAVAILABLE" as const };
    if (next) seen.add(next);
    cursor = next;
  } while (cursor);
  return { ok: true as const, resource: { items, nextCursor: null } };
}

export default async function CrmWorkflowDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [definition, revisions, routines, runs, journeys, policies] = await Promise.all([
    getWorkflowDefinition({ workflowDefinitionId: id }),
    listWorkflowRevisions({ workflowDefinitionId: id, limit: 200 }),
    listAllDefinitionRoutines(id),
    listRoutineRuns({ workflowDefinitionId: id, limit: 50 }),
    getContactJourneyStates({ workflowDefinitionId: id, limit: 50 }),
    listBusinessHoursPolicies({ limit: 50 }),
  ]);
  return (
    <WorkflowDetailPage
      workflowDefinitionId={id}
      initialDefinition={definition}
      initialRevisions={revisions}
      initialRoutines={routines}
      initialRuns={runs}
      initialJourneys={journeys}
      initialPolicies={policies}
    />
  );
}

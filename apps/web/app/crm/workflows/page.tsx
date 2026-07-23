import WorkflowListPage from "@/components/crm/workflows/workflow-list-page";
import {
  listRoutines,
  listWorkflowDefinitions,
} from "@/lib/customer-workflow-ui-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workflows · Fikirtive" };

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

export default async function CrmWorkflowsRoute() {
  const [definitions, routines] = await Promise.all([
    listWorkflowDefinitions({ limit: 200 }),
    listAllRoutines(),
  ]);
  return <WorkflowListPage initialDefinitions={definitions} initialRoutines={routines} />;
}

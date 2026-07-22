import WorkflowDetailPage from "@/components/crm/workflows/workflow-detail-page";
import {
  getWorkflowDefinition,
  listWorkflowRevisions,
} from "@/lib/customer-workflow-ui-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workflow · Fikirtive" };

export default async function CrmWorkflowDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [definition, revisions] = await Promise.all([
    getWorkflowDefinition({ workflowDefinitionId: id }),
    listWorkflowRevisions({ workflowDefinitionId: id }),
  ]);
  return (
    <WorkflowDetailPage
      workflowDefinitionId={id}
      initialDefinition={definition}
      initialRevisions={revisions}
    />
  );
}

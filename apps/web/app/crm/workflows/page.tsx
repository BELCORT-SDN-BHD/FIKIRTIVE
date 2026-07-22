import WorkflowListPage from "@/components/crm/workflows/workflow-list-page";
import { listWorkflowDefinitions } from "@/lib/customer-workflow-ui-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workflows · Fikirtive" };

export default async function CrmWorkflowsRoute() {
  const definitions = await listWorkflowDefinitions({});
  return <WorkflowListPage initialDefinitions={definitions} />;
}

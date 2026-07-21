import InboxTemplatesPage from "@/components/crm/inbox/inbox-templates-page";
import { listTemplates } from "@/lib/customer-inbox-gateway";

export const dynamic = "force-dynamic";
export const metadata = { title: "Message templates · Fikirtive" };

export default async function CrmInboxTemplatesRoute() {
  return <InboxTemplatesPage initialState={await listTemplates({})} />;
}

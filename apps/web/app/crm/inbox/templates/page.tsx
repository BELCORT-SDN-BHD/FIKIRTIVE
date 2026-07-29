import InboxTemplatesPage from "@/components/crm/inbox/inbox-templates-page";
import { listChannelScopes, listTemplates } from "@/lib/customer-inbox-gateway";

export const dynamic = "force-dynamic";
export const metadata = { title: "Message templates · Fikirtive" };

export default async function CrmInboxTemplatesRoute() {
  const [initialState, initialScopes] = await Promise.all([listTemplates({}), listChannelScopes()]);
  return <InboxTemplatesPage initialState={initialState} initialScopes={initialScopes} />;
}

import InboxListPage from "@/components/crm/inbox/inbox-list-page";
import { listConversations } from "@/lib/customer-inbox-gateway";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox · Fikirtive" };

export default async function CrmInboxRoute() {
  return <InboxListPage initialState={await listConversations({ view: "all" })} />;
}

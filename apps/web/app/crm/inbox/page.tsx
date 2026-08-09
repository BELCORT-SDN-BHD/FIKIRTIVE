import InboxListPage from "@/components/crm/inbox/inbox-list-page";
import { listChannelScopes, listConversations } from "@/lib/customer-inbox-gateway";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox · Fikirtive" };

export default async function CrmInboxRoute() {
  // #727 — the same tenant-gated read the Templates page uses. The banner below used to state
  // the answer without ever asking for it.
  const [conversations, channelScopes] = await Promise.all([
    listConversations({ view: "all" }),
    listChannelScopes(),
  ]);
  return <InboxListPage initialState={conversations} initialChannelScopes={channelScopes} />;
}

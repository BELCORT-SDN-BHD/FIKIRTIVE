import InboxConversationPage from "@/components/crm/inbox/inbox-conversation-page";
import {
  getConversation,
  getConversationPreflight,
  getHistory,
  getMemberDirectory,
  listChannelScopes,
} from "@/lib/customer-inbox-gateway";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conversation · Fikirtive" };

export default async function CrmInboxConversationRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // #727 判官 r2 P1-2 — the banner used to read "Not connected yet" off an axis the service
  // hard-codes to "unknown", so it asserted a fact nobody had established. It now reads the same
  // workspace channel authority every other CRM surface reads.
  const [conversation, history, preflight, directory, channelScopes] = await Promise.all([
    getConversation({ conversationId: id }),
    getHistory({ conversationId: id }),
    getConversationPreflight({ conversationId: id }),
    getMemberDirectory(),
    listChannelScopes(),
  ]);
  return (
    <InboxConversationPage
      conversationId={id}
      initialState={{ conversation, history, preflight }}
      initialDirectory={directory}
      initialChannelScopes={channelScopes}
    />
  );
}

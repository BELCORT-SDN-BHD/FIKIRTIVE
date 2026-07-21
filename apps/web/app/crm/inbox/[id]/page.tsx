import InboxConversationPage from "@/components/crm/inbox/inbox-conversation-page";
import { getConversation, getConversationPreflight, getHistory } from "@/lib/customer-inbox-gateway";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conversation · Fikirtive" };

export default async function CrmInboxConversationRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [conversation, history, preflight] = await Promise.all([
    getConversation({ conversationId: id }),
    getHistory({ conversationId: id }),
    getConversationPreflight({ conversationId: id }),
  ]);
  return <InboxConversationPage conversationId={id} initialState={{ conversation, history, preflight }} />;
}

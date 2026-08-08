import InboxConversationPage from "@/components/crm/inbox/inbox-conversation-page";
import {
  getConversation,
  getConversationPreflight,
  getHistory,
  getMemberDirectory,
} from "@/lib/customer-inbox-gateway";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conversation · Fikirtive" };

export default async function CrmInboxConversationRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [conversation, history, preflight, directory] = await Promise.all([
    getConversation({ conversationId: id }),
    getHistory({ conversationId: id }),
    getConversationPreflight({ conversationId: id }),
    getMemberDirectory(),
  ]);
  return (
    <InboxConversationPage
      conversationId={id}
      initialState={{ conversation, history, preflight }}
      initialDirectory={directory}
    />
  );
}

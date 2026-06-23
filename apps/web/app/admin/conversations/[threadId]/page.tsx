import { redirect, notFound } from "next/navigation";
import { requireRole } from "@/lib/auth-guard";
import { getConversation } from "@/lib/conversation-admin";
import { ConversationView } from "@/components/admin/ConversationsAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conversation · Fikirtive admin" };

export default async function ConversationPage({ params }: { params: Promise<{ threadId: string }> }) {
  const gate = await requireRole("content", "read");
  if ("error" in gate) redirect("/login?from=/admin/conversations");
  const { threadId } = await params;
  const detail = await getConversation(threadId);
  if (!detail) notFound();
  return <ConversationView detail={detail} />;
}

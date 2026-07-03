import { redirect } from "next/navigation";

export default async function ConversationPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  redirect(`/admin/cases?case=${encodeURIComponent(threadId)}`);
}

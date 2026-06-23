import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth-guard";
import { listConversations } from "@/lib/conversation-admin";
import { ConversationsAdmin } from "@/components/admin/ConversationsAdmin";

// reads the DB at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "Otto conversations · Fikirtive admin" };

export default async function ConversationsPage() {
  const gate = await requireRole("content", "read");
  if ("error" in gate) redirect("/login?from=/admin/conversations");
  const rows = await listConversations();
  return <ConversationsAdmin rows={rows} />;
}

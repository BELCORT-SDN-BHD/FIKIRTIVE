import { redirect } from "next/navigation";
import { QueueHealthBoard } from "@/components/admin/QueueHealthBoard";
import { requireRole } from "@/lib/auth-guard";
import { getQueueObservability } from "@/lib/queue-observability";

/**
 * #779 — the queue board.
 *
 * Deliberately NOT routed through `renderAdminV2Page`: that helper loads `getAdminV2Data()`,
 * the platform-wide database read model shared by the eight v2 pages, and this page needs
 * none of it. Putting a remote metrics call inside that shared loader would also have made
 * every other admin page wait on a third party.
 *
 * Two gates, same as its neighbours: the founder-only admin shell (`app/admin/layout.tsx`)
 * and this `system.read` capability check. No tenant data is read here at all — every number
 * is a platform-wide queue aggregate — so there is no tenant scope to leak.
 */

// reads a remote metrics store at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "Queue health · Fikirtive admin" };

export default async function QueueHealthPage() {
  const gate = await requireRole("system", "read");
  if ("error" in gate) redirect("/login?from=/admin/queue");

  const board = await getQueueObservability();
  return <QueueHealthBoard board={board} />;
}

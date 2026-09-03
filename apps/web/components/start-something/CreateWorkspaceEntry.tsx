import "server-only";

import { redirect } from "next/navigation";
import { CreateWorkspace, type CreateWorkspaceProject } from "@/components/start-something/CreateWorkspace";
import { requireOwner } from "@/lib/auth-guard";
import { getProjects } from "@/lib/data";
import { MY_DATE_FORMAT } from "@/lib/my-date-format";

/** Same "en-MY" date the merchant sees everywhere else, formatted once, server-side —
 *  see the `updatedLabel` doc comment on CreateWorkspaceProject for why it lands here
 *  and not in the client component (#949 A5). Uses the shared `MY_DATE_FORMAT`
 *  (`@/lib/my-date-format`, #952 item 12) so `timeZone: "Asia/Kuala_Lumpur"` can never be
 *  left off again — without it this reads in the SERVER's zone (production containers
 *  commonly run UTC), so a Malaysian merchant (UTC+8) would see "yesterday" for the first
 *  8 hours of every day.
 */
function formatUpdated(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return MY_DATE_FORMAT.format(date);
}

/**
 * The Create start page's controlled server entry (FRONT §7.1 ⑨).
 *
 * It sits outside the fenced northstar tree, like the other `*Entry` adapters, so it can read the
 * merchant's own projects by authenticated ownerId while the route file and the presentation
 * component still import no server action, database or auth.
 *
 * 租户口径:项目只经 `requireOwner()` 解析出的 ownerId 读,客户端传来的任何身份都不采信。
 */
export async function CreateWorkspaceEntry() {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  const projects = await getProjects(owner.ownerId);
  const rows: CreateWorkspaceProject[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    updatedLabel: formatUpdated(project.updatedAt),
  }));

  return <CreateWorkspace projects={rows} />;
}

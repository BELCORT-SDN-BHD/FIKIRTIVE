import "server-only";

import { redirect } from "next/navigation";
import { NorthstarHome, type NorthstarHomeProject } from "@/components/canvas/NorthstarHome";
import { requireOwner } from "@/lib/auth-guard";
import { getProjects } from "@/lib/data";

/** Same "en-MY" date the merchant sees everywhere else, formatted once, server-side —
 *  see the `updatedLabel` doc comment on NorthstarHomeProject for why it lands here
 *  and not in the client component (#949 A5). */
function formatUpdated(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * 北极星 · 极简真首页的受控入口(#609)。
 *
 * 位置在 fenced tree 之外(与 ImmersiveCanvasEntry / NorthstarShellEntry 同一处受控 adapter),
 * 所以可以直接按认证 ownerId 读商家自己的项目;北极星路由文件仍然一行后端都不 import。
 *
 * 租户口径:项目只经 `requireOwner()` 解析出的 ownerId 读,客户端传来的任何身份都不采信。
 */
export async function NorthstarHomeEntry() {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  const projects = await getProjects(owner.ownerId);
  const rows: NorthstarHomeProject[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    updatedLabel: formatUpdated(project.updatedAt),
  }));

  return <NorthstarHome projects={rows} />;
}

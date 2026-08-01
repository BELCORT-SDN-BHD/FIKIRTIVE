import "server-only";

import { notFound, redirect } from "next/navigation";
import { NorthstarHome, type NorthstarHomeProject } from "@/components/canvas/NorthstarHome";
import { requireOwner } from "@/lib/auth-guard";
import { getProjects } from "@/lib/data";

/**
 * 北极星 · 极简真首页的受控入口(#609)。
 *
 * 位置在 fenced tree 之外(与 ImmersiveCanvasEntry / NorthstarShellEntry 同一处受控 adapter),
 * 所以可以直接按认证 ownerId 读商家自己的项目;北极星路由文件仍然一行后端都不 import。
 *
 * 租户口径:项目只经 `requireOwner()` 解析出的 ownerId 读,客户端传来的任何身份都不采信。
 */
export async function NorthstarHomeEntry() {
  // Layouts and pages can be evaluated independently while streaming. Repeat the preview
  // gate here so a hidden production route cannot touch runtime data first.
  if (process.env.NODE_ENV === "production" && process.env.NORTHSTAR_PREVIEW !== "1") {
    notFound();
  }
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  const projects = await getProjects(owner.ownerId);
  const rows: NorthstarHomeProject[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt.toISOString(),
  }));

  return <NorthstarHome projects={rows} />;
}

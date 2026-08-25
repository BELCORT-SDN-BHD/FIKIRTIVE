"use server";

import { requireOwner } from "@/lib/auth-guard";
import { getProjects } from "@/lib/data";

export type GlobalSearchProject = { id: string; name: string };

/** The global search only returns projects owned by the authenticated workspace. */
export async function loadGlobalSearchProjects(): Promise<{ projects: GlobalSearchProject[] } | { error: string }> {
  const owner = await requireOwner();
  if ("error" in owner) return owner;
  try {
    const projects = await getProjects(owner.ownerId);
    return { projects: projects.map((project) => ({ id: project.id, name: project.name })) };
  } catch {
    return { error: "Projects could not be searched right now." };
  }
}

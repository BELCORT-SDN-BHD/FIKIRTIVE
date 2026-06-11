"use server";
/**
 * Redesign Storyboard actions — thin wrappers over the existing shot engine.
 * A storyboard shot is a real Shot; its prompt persists as plain text (+ a
 * minimal Tiptap doc so the old Workbench stays compatible) and entity refs.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@artlio/db";
import { newId, FOUNDER_OWNER_ID } from "@artlio/core";

const OWNED = { ownerId: FOUNDER_OWNER_ID, deletedAt: null } as const;

export async function addShot(projectId: string): Promise<{ id: string; number: number } | { error: string }> {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await prisma.shot.findFirst({ where: { projectId }, orderBy: { number: "desc" } });
    try {
      const shot = await prisma.shot.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, number: (last?.number ?? 0) + 1 } });
      revalidatePath("/", "layout");
      return { id: shot.id, number: shot.number };
    } catch {
      if (attempt === 2) return { error: "Could not allocate a shot number." };
    }
  }
  return { error: "retry" };
}

/** Persist a storyboard shot's prompt (plain text + entity refs + a minimal
 *  Tiptap doc for old-Workbench compatibility). */
export async function setShotPromptText(shotId: string, text: string, entityIds: string[] = []) {
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ...OWNED } });
  if (!shot) return { error: "Shot not found." };
  const ids = [...new Set(entityIds)];
  const doc = { type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] };
  await prisma.$transaction([
    prisma.shot.update({ where: { id: shotId }, data: { promptDoc: doc, description: text } }),
    prisma.shotEntityRef.deleteMany({ where: { shotId } }),
    ...(ids.length ? [prisma.shotEntityRef.createMany({ data: ids.map((entityId) => ({ shotId, entityId, ownerId: FOUNDER_OWNER_ID })) })] : []),
  ]);
  revalidatePath("/", "layout");
  return { ok: true };
}

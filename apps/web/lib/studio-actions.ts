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

export async function addShot(projectId: string, scene?: number): Promise<{ id: string; number: number } | { error: string }> {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };
  // default into the current last scene; "Add scene" passes an explicit next scene
  let useScene = scene;
  if (useScene == null) {
    const lastScene = await prisma.shot.findFirst({ where: { projectId, ...OWNED }, orderBy: { scene: "desc" }, select: { scene: true } });
    useScene = lastScene?.scene ?? 1;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await prisma.shot.findFirst({ where: { projectId }, orderBy: { number: "desc" } });
    try {
      const shot = await prisma.shot.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, number: (last?.number ?? 0) + 1, scene: useScene } });
      revalidatePath("/", "layout");
      return { id: shot.id, number: shot.number };
    } catch {
      if (attempt === 2) return { error: "Could not allocate a shot number." };
    }
  }
  return { error: "retry" };
}

/** Soft-delete a shot (its generations drop out of the board + editor since
 *  every query filters deletedAt). The number stays retired — reorder swaps
 *  among live shots, and the board renumbers display 1..N. */
export async function deleteShot(shotId: string): Promise<{ ok: true } | { error: string }> {
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ...OWNED } });
  if (!shot) return { error: "Shot not found." };
  await prisma.shot.update({ where: { id: shotId }, data: { deletedAt: new Date() } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Reorder by swapping `number` with the adjacent same-scene live shot. Done
 *  in one interactive transaction (neighbor re-read inside, so a concurrent
 *  move can't apply a stale neighbor and violate @@unique([projectId, number]));
 *  the swap parks one row at a negative temp (never assigned) mid-transaction.
 *  Overlapping moves at worst deadlock → Postgres aborts one → retryable error. */
export async function moveShot(shotId: string, direction: "left" | "right"): Promise<{ ok: true } | { error: string }> {
  const exists = await prisma.shot.findFirst({ where: { id: shotId, ...OWNED }, select: { id: true } });
  if (!exists) return { error: "Shot not found." };
  try {
    await prisma.$transaction(async (tx) => {
      const me = await tx.shot.findUnique({ where: { id: shotId } });
      if (!me || me.deletedAt) return;
      const neighbor = await tx.shot.findFirst({
        where: {
          projectId: me.projectId, ownerId: me.ownerId, deletedAt: null, scene: me.scene,
          number: direction === "left" ? { lt: me.number } : { gt: me.number },
        },
        orderBy: { number: direction === "left" ? "desc" : "asc" },
      });
      if (!neighbor) return; // already at the edge of its scene
      const temp = -Math.abs(me.number) - 1;
      await tx.shot.update({ where: { id: me.id }, data: { number: temp } });
      await tx.shot.update({ where: { id: neighbor.id }, data: { number: me.number } });
      await tx.shot.update({ where: { id: me.id }, data: { number: neighbor.number } });
    });
  } catch {
    return { error: "Could not reorder — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Start a new scene with its first shot. Computes the next scene number
 *  server-side (fresh) so a stale client can't collide two scenes into one. */
export async function addScene(projectId: string): Promise<{ id: string; number: number } | { error: string }> {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };
  const last = await prisma.shot.findFirst({ where: { projectId, ...OWNED }, orderBy: { scene: "desc" }, select: { scene: true } });
  return addShot(projectId, (last?.scene ?? 0) + 1);
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

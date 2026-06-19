"use server";
/**
 * Redesign Storyboard actions — thin wrappers over the existing shot engine.
 * A storyboard shot is a real Shot; its prompt persists as plain text (+ a
 * minimal Tiptap doc so the old Workbench stays compatible) and entity refs.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@artlio/db";
import { newId } from "@artlio/core";
import { requireOwner } from "./auth-guard";

export async function addShot(projectId: string, scene?: number): Promise<{ id: string; number: number } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };
  // default into the current last scene; "Add scene" passes an explicit next scene
  let useScene = scene;
  if (useScene == null) {
    const lastScene = await prisma.shot.findFirst({ where: { projectId, ...OWNED }, orderBy: { scene: "desc" }, select: { scene: true } });
    useScene = lastScene?.scene ?? 1;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await prisma.shot.findFirst({ where: { projectId, ownerId }, orderBy: { number: "desc" } });
    try {
      const shot = await prisma.shot.create({ data: { id: newId(), ownerId, projectId, number: (last?.number ?? 0) + 1, scene: useScene } });
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
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ...OWNED } });
  if (!shot) return { error: "Shot not found." };
  // detach the shot's renders (→ candidates, re-attachable) and clear its entity
  // refs in one tx, so deleting a shot never orphans generated media or leaves
  // generations pointing at a dead shot (which Assets would still show "In a shot").
  await prisma.$transaction([
    prisma.generation.updateMany({ where: { shotId, ownerId, deletedAt: null }, data: { shotId: null, attachedAt: null } }),
    prisma.shotEntityRef.deleteMany({ where: { shotId, ownerId } }),
    prisma.shot.update({ where: { id: shotId }, data: { deletedAt: new Date() } }),
  ]);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Reorder by swapping `number` with the adjacent same-scene live shot. Done
 *  in one interactive transaction (neighbor re-read inside, so a concurrent
 *  move can't apply a stale neighbor and violate @@unique([projectId, number]));
 *  the swap parks one row at a negative temp (never assigned) mid-transaction.
 *  Overlapping moves at worst deadlock → Postgres aborts one → retryable error. */
export async function moveShot(shotId: string, direction: "left" | "right"): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
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
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };
  const last = await prisma.shot.findFirst({ where: { projectId, ...OWNED }, orderBy: { scene: "desc" }, select: { scene: true } });
  return addShot(projectId, (last?.scene ?? 0) + 1);
}

/** Persist a storyboard shot's prompt (plain text + entity refs + a minimal
 *  Tiptap doc for old-Workbench compatibility). */
export async function setShotPromptText(shotId: string, text: string, entityIds: string[] = []) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ...OWNED } });
  if (!shot) return { error: "Shot not found." };
  const ids = [...new Set(entityIds)];
  const doc = { type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] };
  await prisma.$transaction([
    prisma.shot.update({ where: { id: shotId }, data: { promptDoc: doc, description: text } }),
    prisma.shotEntityRef.deleteMany({ where: { shotId, ownerId } }),
    ...(ids.length ? [prisma.shotEntityRef.createMany({ data: ids.map((entityId) => ({ shotId, entityId, ownerId })) })] : []),
  ]);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Attach (or clear, with null) a segment's first/last frame image — the i2v
 *  keyframes. The generation must be an owned image in the shot's project (D19). */
export async function setShotFrame(shotId: string, slot: "first" | "last", generationId: string | null): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ...OWNED } });
  if (!shot) return { error: "Shot not found." };
  if (generationId) {
    const gen = await prisma.generation.findFirst({
      where: { id: generationId, projectId: shot.projectId, ...OWNED, asset: { ext: { in: ["png", "jpg", "jpeg", "webp"] } } },
    });
    if (!gen) return { error: "Frame image not found in this project." };
  }
  await prisma.shot.update({
    where: { id: shotId },
    data: slot === "first" ? { firstFrameGenerationId: generationId } : { lastFrameGenerationId: generationId },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

const SHOT_TRANSITIONS = ["in", "out", "both"] as const;
export type ShotTransition = (typeof SHOT_TRANSITIONS)[number];
/** Set (or clear, with null) a segment's fade transition. It flows into the
 *  editor's board cut via buildBoardEdit → clip.transition (storyboard→editor). */
export async function setShotTransition(shotId: string, transition: ShotTransition | null): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
  if (transition !== null && !SHOT_TRANSITIONS.includes(transition)) return { error: "Unknown transition." };
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ...OWNED }, select: { id: true } });
  if (!shot) return { error: "Shot not found." };
  await prisma.shot.update({ where: { id: shotId }, data: { transition } });
  revalidatePath("/", "layout");
  return { ok: true };
}

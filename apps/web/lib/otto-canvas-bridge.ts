"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";
import { getCoworkThread, getGenerationThumbs } from "./data";
import { createCanvasNode, type CanvasNodeDTO } from "./canvas-actions";
import { planBridgeNodes } from "./otto-canvas-bridge-core";

/** A canvas node plus its resolved media URL (display-only). */
export type CanvasNodeWithUrl = CanvasNodeDTO & { url: string | null };

const NODE = { w: 320, h: 320, step: 340, y: 80 } as const;

/**
 * chat→canvas bridge — DISPLAY-ONLY, NO new spend.
 *
 * Ensures OTTO's chat results (GEN_RESULT messages) for a thread show up as
 * canvas nodes, then returns ALL of this project's canvas nodes with their
 * media URLs resolved. It is idempotent (one node per generation; skips
 * generations that already have a node) and it ONLY references generations the
 * worker already produced — it never calls startGen / the provider / the credit
 * ledger, so it cannot reserve, settle, or charge anything.
 *
 * Gated behind ?skin=gb on the client (the canvas only calls this under the
 * Grok-bright skin), so the default canvas behaviour is unchanged.
 */
export async function syncOttoCanvasNodes(
  projectId: string,
  threadId?: string,
): Promise<CanvasNodeWithUrl[] | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!project) return { error: "Project not found." };

  // ── 1. Ensure a node per generation the thread's GEN_RESULTs produced ──
  if (threadId) {
    const thread = await getCoworkThread(ownerId, threadId); // owner-scoped; null if not theirs
    if (thread && thread.projectId === projectId) {
      const existing = await prisma.canvasNode.findMany({
        where: { ownerId, projectId, generationId: { not: null } },
        select: { generationId: true },
      });
      let placed = await prisma.canvasNode.count({ where: { ownerId, projectId } });

      const genResults = thread.messages.filter((m) => m.kind === "GEN_RESULT" && m.genJobId);
      const jobIds = genResults.map((m) => m.genJobId as string);
      const jobs = jobIds.length
        ? await prisma.genJob.findMany({ where: { id: { in: jobIds }, ownerId }, select: { id: true, generationIds: true } })
        : [];
      const jobGenIds = new Map(jobs.map((j) => [j.id, j.generationIds]));

      // Pure decision (tested): which generations still need a node, in order.
      const toCreate = planBridgeNodes(genResults, jobGenIds, existing.map((n) => n.generationId));
      for (const node of toCreate) {
        // Reuses the validated, fail-closed insert (owner-scopes threadId /
        // generationId / genJobId). No spend path is touched.
        await createCanvasNode({
          projectId,
          type: node.kind,
          x: 80 + placed * NODE.step,
          y: NODE.y,
          w: NODE.w,
          h: NODE.h,
          generationId: node.generationId,
          genJobId: node.genJobId,
          threadId,
          status: "done",
          prompt: node.prompt ?? undefined,
        });
        placed += 1;
      }
    }
  }

  // ── 2. Return all project nodes with media URLs resolved (display-only) ──
  const nodes = await prisma.canvasNode.findMany({
    where: { ownerId, projectId },
    select: {
      id: true, type: true, x: true, y: true, w: true, h: true, text: true,
      prompt: true, generationId: true, genJobId: true, status: true,
      sourceNodeId: true, threadId: true,
    },
  });

  // A node's media comes from its generationId, or (for canvas-promptbar nodes,
  // which persist only the job) from the job's first generation.
  const jobOnlyIds = [...new Set(
    nodes.filter((n) => !n.generationId && n.genJobId).map((n) => n.genJobId as string),
  )];
  const jobs = jobOnlyIds.length
    ? await prisma.genJob.findMany({ where: { id: { in: jobOnlyIds }, ownerId }, select: { id: true, generationIds: true } })
    : [];
  const jobFirstGen = new Map(jobs.map((j) => [j.id, j.generationIds[0]]));

  const genIds = [
    ...nodes.map((n) => n.generationId).filter((x): x is string => !!x),
    ...jobs.map((j) => j.generationIds[0]).filter((x): x is string => !!x),
  ];
  const thumbs = await getGenerationThumbs(ownerId, genIds); // generationId → { src, kind }

  return nodes.map((n) => {
    const gid = n.generationId ?? (n.genJobId ? jobFirstGen.get(n.genJobId) ?? null : null);
    return { ...n, url: gid ? thumbs[gid]?.src ?? null : null };
  });
}

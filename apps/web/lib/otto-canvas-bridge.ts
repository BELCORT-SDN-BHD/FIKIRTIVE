"use server";

import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { withCanvasLineage } from "./canvas-lineage-data";
import { canvasJobPlacementLockKey } from "./canvas-node-placement";
import { reconcileSettledCanvasJobs } from "./canvas-settlement-reconcile";
import { getGenerationThumbs } from "./data";
import type { CanvasNodeDTO } from "./canvas-actions";
import { canvasNodeDisplayStatus, firstDisplayableGenerationId, planPendingJobNodes, settledCanvasNodeRepairPatch } from "./otto-canvas-bridge-core";

/** A canvas node plus its resolved media URL (display-only). */
export type CanvasNodeWithUrl = CanvasNodeDTO & { url: string | null };

const NODE = { w: 320, h: 320, step: 340, y: 80 } as const;

function canvasNodeOrigin(idempotencyKey: string | null | undefined): "otto" | null {
  return idempotencyKey?.startsWith("cowork:") ? "otto" : null;
}

type BridgeMessage = {
  id: string;
  kind: string;
  seq: number;
  genJobId: string | null;
  payload: unknown;
  text: string | null;
};

async function createPendingCanvasNodeOnce(input: {
  ownerId: string;
  projectId: string;
  threadId: string;
  type: "image" | "video";
  x: number;
  y: number;
  w: number;
  h: number;
  genJobId: string;
  prompt: string | null;
}): Promise<boolean> {
  const id = newId();
  const lockKey = canvasJobPlacementLockKey(input.ownerId, input.projectId, input.genJobId);
  const inserted = await prisma.$executeRaw`
    WITH guard AS (
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))
    )
    INSERT INTO "CanvasNode" (
      "id", "ownerId", "projectId", "type", "x", "y", "w", "h",
      "text", "prompt", "generationId", "genJobId", "status",
      "sourceNodeId", "threadId", "createdAt", "updatedAt"
    )
    SELECT
      ${id}, ${input.ownerId}, ${input.projectId}, ${input.type},
      ${input.x}, ${input.y}, ${input.w}, ${input.h},
      NULL, ${input.prompt}, NULL, ${input.genJobId}, 'pending',
      NULL, ${input.threadId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM guard
    WHERE EXISTS (
      SELECT 1 FROM "GenJob"
      WHERE "id" = ${input.genJobId}
        AND "ownerId" = ${input.ownerId}
        AND "projectId" = ${input.projectId}
    )
      AND EXISTS (
        SELECT 1 FROM "ChatThread"
        WHERE "id" = ${input.threadId}
          AND "ownerId" = ${input.ownerId}
          AND "projectId" = ${input.projectId}
          AND "deletedAt" IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM "CanvasNode"
        WHERE "ownerId" = ${input.ownerId}
          AND "projectId" = ${input.projectId}
          AND "genJobId" = ${input.genJobId}
      )
  `;
  return inserted === 1;
}

/**
 * chat→canvas bridge — DISPLAY-ONLY, NO new spend.
 *
 * Ensures OTTO's chat results (GEN_RESULT messages) for every live thread in
 * this project show up as canvas nodes, then returns ALL of this project's canvas nodes with their
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
): Promise<CanvasNodeWithUrl[] | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!project) return { error: "Project not found." };

  // ── 1. Ensure project chat generation work appears on the canvas ──
  const threads = await prisma.chatThread.findMany({
    where: { ownerId, projectId, deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      messages: {
        where: { kind: { in: ["GEN_CARD", "GEN_RESULT"] }, deletedAt: null },
        orderBy: { seq: "asc" },
        select: { id: true, kind: true, seq: true, genJobId: true, payload: true, text: true },
      },
    },
  });
  // Tombstones included — a deleted card is a durable instruction the settlement below must see.
  const cardsBeforeSettlement = await prisma.canvasNode.findMany({
    where: { ownerId, projectId },
    select: { generationId: true, genJobId: true, status: true },
  });
  const messages = threads.flatMap((thread) => thread.messages) as BridgeMessage[];
  const jobIds = [...new Set(messages.map((m) => m.genJobId).filter((id): id is string => !!id))];
  const cardJobKeys = [...new Set(messages
    .filter((m) => m.kind === "GEN_CARD")
    .map((m) => `cowork:${m.id}`))];
  const jobWhere = [
    ...(jobIds.length ? [{ id: { in: jobIds } }] : []),
    ...(cardJobKeys.length ? [{ idempotencyKey: { in: cardJobKeys } }] : []),
  ];
  const bridgeJobs = jobWhere.length
    ? await prisma.genJob.findMany({ where: { ownerId, projectId, OR: jobWhere }, select: { id: true, idempotencyKey: true, status: true, generationIds: true } })
    : [];
  const bridgeJobById = new Map(bridgeJobs.map((j) => [j.id, j]));
  const bridgeJobByCardId = new Map(
    bridgeJobs
      .filter((j) => j.idempotencyKey?.startsWith("cowork:"))
      .map((j) => [j.idempotencyKey!.slice("cowork:".length), j]),
  );

  // A DELIVERED job's cards belong to the ONE settlement, here as everywhere else (#601 r2 judge
  // P2②). This used to place them itself, one card per output, left to right — so the board a
  // merchant got depended on whether a chat happened to be open when the batch landed: this
  // writer produced a 1×4 row and the settlement a 2×2 grid, and whichever reached the job lock
  // first decided. Worse, its own writes made the shared pre-check say "the board is finished",
  // so the settlement never got to correct it.
  const resultJobIds = new Set(messages
    .filter((m) => m.kind === "GEN_RESULT")
    .map((m) => m.genJobId)
    .filter((id): id is string => !!id));
  const settlementWrote = await reconcileSettledCanvasJobs({
    ownerId,
    cards: cardsBeforeSettlement,
    jobs: bridgeJobs.filter((job) => resultJobIds.has(job.id)),
  });
  const existing = settlementWrote
    ? await prisma.canvasNode.findMany({
      where: { ownerId, projectId },
      select: { generationId: true, genJobId: true, status: true },
    })
    : cardsBeforeSettlement;

  let placed = await prisma.canvasNode.count({ where: { ownerId, projectId } });
  const have = new Set(existing.map((n) => n.generationId).filter((id): id is string => !!id));
  const haveJobs = new Set(existing.map((n) => n.genJobId).filter((id): id is string => !!id));
  for (const thread of threads) {
    const cardMessages = (thread.messages as BridgeMessage[])
      .filter((m) => m.kind === "GEN_CARD")
      .map((m) => ({ ...m, genJobId: m.genJobId ?? bridgeJobByCardId.get(m.id)?.id ?? null }));
    const pendingToCreate = planPendingJobNodes(cardMessages, bridgeJobById, have, haveJobs);
    for (const node of pendingToCreate) {
      haveJobs.add(node.genJobId);
      // Pending card for a paid GenJob that already exists. This is a canvas
      // placement only; the spend happened earlier in startGen.
      const inserted = await createPendingCanvasNodeOnce({
        ownerId,
        projectId,
        type: node.kind,
        x: 80 + placed * NODE.step,
        y: NODE.y,
        w: NODE.w,
        h: NODE.h,
        genJobId: node.genJobId,
        threadId: thread.id,
        prompt: node.prompt,
      });
      if (inserted) placed += 1;
    }
  }

  // ── 2. Return all project nodes with media URLs resolved (display-only) ──
  // Tombstones are read too: a deleted card is a durable instruction the settlement below must
  // see, so it cannot mistake a suppressed batch for a board that is missing everything.
  const boardSelect = {
    id: true, type: true, x: true, y: true, w: true, h: true, text: true,
    prompt: true, generationId: true, genJobId: true, status: true,
    sourceNodeId: true, threadId: true,
  } as const;
  let board = await prisma.canvasNode.findMany({ where: { ownerId, projectId }, select: boardSelect });

  // A node's media comes from its generationId, or (for canvas-promptbar nodes,
  // which persist only the job) from the job's first generation. Pull status for
  // every linked job too: CanvasNode.status is not a reliable activity source
  // after terminal settlement because legacy rows can stay "pending" forever.
  const linkedJobIds = [...new Set(board.map((n) => n.genJobId).filter((x): x is string => !!x))];
  const jobs = linkedJobIds.length
    ? await prisma.genJob.findMany({
      where: { id: { in: linkedJobIds }, ownerId, projectId },
      select: { id: true, generationIds: true, status: true, idempotencyKey: true },
    })
    : [];
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  // Finish any delivered job whose cards are still incomplete — the SAME settlement the canvas
  // reader and the worker call, so this board cannot end up different from the board a merchant
  // who never opened the chat would see. Re-read only when it actually wrote something.
  if (await reconcileSettledCanvasJobs({ ownerId, cards: board, jobs })) {
    board = await prisma.canvasNode.findMany({ where: { ownerId, projectId }, select: boardSelect });
  }
  const nodes = board.filter((node) => node.status !== "deleted");

  const genIds = [
    ...nodes.map((n) => n.generationId).filter((x): x is string => !!x),
    ...jobs.flatMap((j) => j.generationIds),
  ];
  const thumbs = await getGenerationThumbs(ownerId, genIds); // generationId → { src, kind }

  const repairs: Array<{
    id: string;
    status: string;
    generationId: string | null;
    data: NonNullable<ReturnType<typeof settledCanvasNodeRepairPatch>>;
  }> = [];
  const resolved = nodes.map((n) => {
    const job = n.genJobId ? jobById.get(n.genJobId) : null;
    const gid = n.generationId ?? firstDisplayableGenerationId(job?.generationIds, thumbs);
    // Return the RESOLVED generationId, not the raw row's. A promptbar-created node
    // persists only genJobId (generationId null), so after a reload the client had no
    // generationId for it — Make video / Detail silently no-oped on that primary card
    // (their guard needs nodeDataRef.generationId). Display-only metadata resolution;
    // the id is the job's OWN generation (owner-scoped above), no spend logic.
    const thumb = gid ? thumbs[gid] : undefined;
    const url = thumb?.src ?? null;
    const jobStatus = job?.status;
    const status = gid && !url ? "missing" : canvasNodeDisplayStatus(n.status, jobStatus, url);
    // A delivered job's rows are the settlement's to write (see canvas-settlement-reconcile.ts):
    // repairing one here from a picture's availability is the second opinion that made the two
    // writers disagree. Rows of a job that is NOT delivered still get repaired here.
    const patch = jobStatus === "DONE"
      ? null
      : settledCanvasNodeRepairPatch(n.status, n.generationId, jobStatus, gid, url);
    if (patch) repairs.push({ id: n.id, status: n.status, generationId: n.generationId, data: patch });
    return {
      ...n,
      generationId: gid,
      status,
      url,
      mediaWidth: thumb?.width ?? null,
      mediaHeight: thumb?.height ?? null,
      origin: canvasNodeOrigin(job?.idempotencyKey),
    };
  });
  if (repairs.length) {
    await Promise.all(repairs.map(async (r) => {
      await prisma.canvasNode.updateMany({
        where: { id: r.id, ownerId, projectId, status: r.status, generationId: r.generationId },
        data: r.data,
      });
    }));
  }

  return withCanvasLineage(ownerId, projectId, resolved);
}

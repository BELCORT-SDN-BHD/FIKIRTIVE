import "server-only";

import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";

export type CanvasJobPlacementInput = {
  ownerId: string;
  projectId: string;
  genJobId: string;
  type: "image" | "video";
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string | null;
  prompt?: string | null;
  generationId?: string | null;
  status?: string;
  threadId?: string | null;
};

export type CanvasJobPlacementNode = {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string | null;
  prompt: string | null;
  generationId: string | null;
  genJobId: string | null;
  status: string;
  batchIndex: number | null;
  batchSize: number | null;
  layoutAnchorNodeId: string | null;
  madeFromNodeId: string | null;
  threadId: string | null;
};

export type CanvasJobPlacementResult =
  | { inserted: boolean; node: CanvasJobPlacementNode }
  | { suppressed: true; scope: "job" | "generation" }
  | { error: string };

const NODE_SELECT = {
  id: true,
  type: true,
  x: true,
  y: true,
  w: true,
  h: true,
  text: true,
  prompt: true,
  generationId: true,
  genJobId: true,
  status: true,
  batchIndex: true,
  batchSize: true,
  layoutAnchorNodeId: true,
  madeFromNodeId: true,
  threadId: true,
} as const;

/** Every writer for one paid job shares this lock, regardless of pending/primary/sibling role. */
export function canvasJobPlacementLockKey(ownerId: string, projectId: string, genJobId: string): string {
  return `canvas-job-placement:${ownerId}:${projectId}:${genJobId}`;
}

/**
 * Exactly-once Canvas placement for an already-created GenJob. This function never creates a
 * GenJob, reserves credits, or calls a provider. It only serializes CanvasNode placement.
 */
export async function placeCanvasJobNode(input: CanvasJobPlacementInput): Promise<CanvasJobPlacementResult> {
  return prisma.$transaction(async (tx) => {
    const lockKey = canvasJobPlacementLockKey(input.ownerId, input.projectId, input.genJobId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;

    const job = await tx.genJob.findFirst({
      where: { id: input.genJobId, ownerId: input.ownerId, projectId: input.projectId },
      select: { id: true, generationIds: true, sourceGenerationId: true, threadId: true },
    });
    if (!job) return { error: "Generation job not found." };

    const generationId = input.generationId ?? null;
    const generationIndex = generationId ? job.generationIds.indexOf(generationId) : -1;
    if (generationId && generationIndex < 0) {
      return { error: "Generation does not belong to that job." };
    }

    // Deletion is a durable owner instruction, not a temporary display state. A deleted
    // in-flight anchor (generationId=null) suppresses every later output for that paid job;
    // a deleted settled card suppresses only that exact generation. Every Canvas writer
    // reaches this check under the same job lock, so browser polling and Otto recovery cannot
    // race a tombstone and put the removed result back.
    const tombstones = await tx.canvasNode.findMany({
      where: {
        ownerId: input.ownerId,
        projectId: input.projectId,
        genJobId: input.genJobId,
        status: "deleted",
      },
      select: { generationId: true },
    });
    if (tombstones.some((node) => node.generationId === null)) {
      return { suppressed: true, scope: "job" };
    }
    if (generationId && tombstones.some((node) => node.generationId === generationId)) {
      return { suppressed: true, scope: "generation" };
    }

    // Find the durable placement before validating attribution, but never return it until
    // source/thread binding has been checked and any pending primary anchor has been repaired.
    let existing: CanvasJobPlacementNode | null = null;
    if (generationIndex === 0) {
      const primary = await tx.canvasNode.findFirst({
        where: {
          ownerId: input.ownerId,
          projectId: input.projectId,
          genJobId: input.genJobId,
          status: { not: "deleted" },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: NODE_SELECT,
      });
      if (primary && (primary.generationId === null || primary.generationId === generationId)) {
        existing = primary;
      }
    }
    if (!existing) {
      existing = await tx.canvasNode.findFirst({
        where: {
          ownerId: input.ownerId,
          projectId: input.projectId,
          genJobId: input.genJobId,
          status: { not: "deleted" },
          ...(generationId ? { generationId } : {}),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: NODE_SELECT,
      });
    }

    if (job.threadId && input.threadId && job.threadId !== input.threadId) {
      return { error: "Thread does not belong to that job." };
    }
    if (!job.threadId && existing?.threadId && input.threadId && existing.threadId !== input.threadId) {
      return { error: "Thread does not belong to that job." };
    }
    let threadId: string | null = null;
    const attributedThreadId = job.threadId ?? existing?.threadId ?? input.threadId ?? null;
    if (attributedThreadId) {
      const thread = await tx.chatThread.findFirst({
        where: {
          id: attributedThreadId,
          ownerId: input.ownerId,
          projectId: input.projectId,
          deletedAt: null,
        },
        select: { id: true },
      });
      threadId = thread?.id ?? null;
    }

    // ── BATCH IDENTITY AND PARENTAGE, BOTH READ OFF THE PAID JOB (#603 T4 · spec #599 D5) ──
    //
    // Not one of these four facts is taken from the caller any more. They used to arrive as a
    // single `sourceNodeId` the browser chose, and this function then ENFORCED the wrong one of
    // its meanings: for any output past the first it demanded that the "source" be the batch's
    // own primary card, and refused the write otherwise ("Source node does not match that job.").
    // That rule made a plain four-image press look like a family of one parent and three
    // children — to the canvas, to the lineage tree, to the compare gate, and to Otto. The four
    // outputs of one press came out of that press together; none of them came out of another
    // (root map 根 3·A).
    //
    // WHERE this card sits in the batch and HOW BIG the batch is are the job's own record, in the
    // order the job recorded it. Neither is ever recounted from what is on the board.
    const batchSize = job.generationIds.length || null;
    const batchIndex = generationIndex >= 0 ? generationIndex : null;

    // MADE FROM: only a job that was conditioned on an earlier output has a parent, and it is the
    // JOB's parent, so every card of the batch shares it. Resolved here from the job's own row —
    // if that output has no card yet (the browser can see a generation finish before its card is
    // repaired), this stays null and the settlement fills it in when the card exists. A missing
    // line for a moment is honest; a line to the wrong card is not.
    let madeFromNodeId: string | null = null;
    if (job.sourceGenerationId) {
      const source = await tx.canvasNode.findFirst({
        where: {
          ownerId: input.ownerId,
          projectId: input.projectId,
          generationId: job.sourceGenerationId,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      madeFromNodeId = source?.id ?? null;
    }

    // LAYOUT ANCHOR: which card of THIS batch this one was placed around. Pure arrangement, and
    // only a sibling has one — the anchor is what everything else is measured from.
    let layoutAnchorNodeId: string | null = null;
    if (generationIndex > 0) {
      const anchor = await tx.canvasNode.findFirst({
        where: {
          ownerId: input.ownerId,
          projectId: input.projectId,
          genJobId: input.genJobId,
          OR: [
            { generationId: job.generationIds[0] ?? null },
            { generationId: null },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      layoutAnchorNodeId = anchor?.id ?? null;
    }

    if (existing) {
      const data: {
        generationId?: string;
        status?: string;
        batchIndex?: number | null;
        batchSize?: number | null;
        layoutAnchorNodeId?: string | null;
        madeFromNodeId?: string | null;
        threadId?: string | null;
      } = {};
      if (generationIndex === 0 && existing.generationId !== generationId && generationId) {
        data.generationId = generationId;
      }
      if (generationId && input.status === "done" && existing.status !== "done") {
        data.status = "done";
      }
      // A card placed while the job was in flight has no position yet — it gets one the moment
      // the job names an output for it, and never from anywhere else.
      if (batchIndex !== null && existing.batchIndex !== batchIndex) data.batchIndex = batchIndex;
      if (batchSize !== null && existing.batchSize !== batchSize) data.batchSize = batchSize;
      if (existing.layoutAnchorNodeId !== layoutAnchorNodeId) data.layoutAnchorNodeId = layoutAnchorNodeId;
      if (existing.madeFromNodeId !== madeFromNodeId) data.madeFromNodeId = madeFromNodeId;
      if (existing.threadId !== threadId) data.threadId = threadId;
      if (Object.keys(data).length) {
        // THE TOMBSTONE RULE, AT THE WRITE (#602 r2, judge P2). `existing` was read a few dozen
        // lines up with `status: { not: "deleted" }`, and the advisory job lock above makes the
        // read-then-write hard to interleave — but "hard" is not the same as "cannot", and a rule
        // that lives only in a read is a rule the database is not keeping. A card the merchant
        // removed may never come back, so the predicate is spelled again here.
        const written = await tx.canvasNode.updateMany({
          where: { id: existing.id, ownerId: input.ownerId, projectId: input.projectId, status: { not: "deleted" } },
          data,
        });
        const node = written.count === 1
          ? await tx.canvasNode.findFirst({ where: { id: existing.id, ownerId: input.ownerId }, select: NODE_SELECT })
          : null;
        // Nothing matched (or the row went away): the card was tombstoned between the read above
        // and this write, and a deletion is a durable owner instruction — report it as suppressed
        // rather than resurrecting it.
        if (!node) return { suppressed: true, scope: "generation" };
        return { inserted: false, node };
      }
      return { inserted: false, node: existing };
    }

    const node = await tx.canvasNode.create({
      data: {
        id: newId(),
        ownerId: input.ownerId,
        projectId: input.projectId,
        type: input.type,
        x: input.x,
        y: input.y,
        w: input.w,
        h: input.h,
        text: input.text ?? null,
        prompt: input.prompt ?? null,
        generationId,
        genJobId: input.genJobId,
        status: input.status ?? "done",
        batchIndex,
        batchSize,
        layoutAnchorNodeId,
        madeFromNodeId,
        threadId,
      },
      select: NODE_SELECT,
    });
    return { inserted: true, node };
  });
}

/** Tombstone one Canvas card under the same job lock used by every placement writer. */
export async function tombstoneCanvasNode(
  ownerId: string,
  projectId: string,
  id: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const node = await tx.canvasNode.findFirst({
      where: { id, ownerId, projectId, status: { not: "deleted" } },
      select: { id: true, genJobId: true, generationId: true },
    });
    if (!node) return false;

    if (node.genJobId) {
      const lockKey = canvasJobPlacementLockKey(ownerId, projectId, node.genJobId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;
    }

    // Preserve the intent observed when Delete was pressed. If a result repair completed
    // while this call waited for the job lock, an in-flight deletion must still remain the
    // job-wide (generationId=null) suppression marker.
    const result = await tx.canvasNode.updateMany({
      where: { id, ownerId, projectId, status: { not: "deleted" } },
      data: node.generationId === null
        ? { status: "deleted", generationId: null }
        : { status: "deleted" },
    });
    return result.count === 1;
  });
}

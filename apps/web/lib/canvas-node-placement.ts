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
  sourceNodeId?: string | null;
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
  sourceNodeId: string | null;
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
  sourceNodeId: true,
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

    let sourceNodeId: string | null = null;
    if (job.sourceGenerationId) {
      const candidateId = input.sourceNodeId ?? existing?.sourceNodeId ?? null;
      if (candidateId) {
        const candidate = await tx.canvasNode.findFirst({
          where: { id: candidateId, ownerId: input.ownerId, projectId: input.projectId },
          select: { id: true, generationId: true, genJobId: true },
        });
        let matchesSource = candidate?.generationId === job.sourceGenerationId;
        // The client can observe a completed source before its CanvasNode repair commits. In
        // that narrow race, the source node's own owner/project job is still durable proof.
        if (!matchesSource && candidate?.genJobId) {
          const sourceJob = await tx.genJob.findFirst({
            where: { id: candidate.genJobId, ownerId: input.ownerId, projectId: input.projectId },
            select: { generationIds: true },
          });
          matchesSource = sourceJob?.generationIds.includes(job.sourceGenerationId) ?? false;
        }
        if (!candidate || !matchesSource) {
          return { error: "Source node does not match that job." };
        }
        sourceNodeId = candidate.id;
      } else {
        const source = await tx.canvasNode.findFirst({
          where: {
            ownerId: input.ownerId,
            projectId: input.projectId,
            generationId: job.sourceGenerationId,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        sourceNodeId = source?.id ?? null;
      }
    } else if (generationIndex > 0) {
      const candidateId = input.sourceNodeId ?? existing?.sourceNodeId ?? null;
      if (candidateId) {
        const candidate = await tx.canvasNode.findFirst({
          where: { id: candidateId, ownerId: input.ownerId, projectId: input.projectId },
          select: { id: true, generationId: true, genJobId: true },
        });
        const primaryGenerationId = job.generationIds[0] ?? null;
        if (
          !candidate
          || candidate.genJobId !== input.genJobId
          || (candidate.generationId !== null && candidate.generationId !== primaryGenerationId)
        ) {
          return { error: "Source node does not match that job." };
        }
        sourceNodeId = candidate.id;
      } else {
        const primary = await tx.canvasNode.findFirst({
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
        sourceNodeId = primary?.id ?? null;
      }
    } else if (input.sourceNodeId ?? existing?.sourceNodeId) {
      return { error: "Source node does not match that job." };
    }

    if (existing) {
      const data: {
        generationId?: string;
        status?: string;
        sourceNodeId?: string | null;
        threadId?: string | null;
      } = {};
      if (generationIndex === 0 && existing.generationId !== generationId && generationId) {
        data.generationId = generationId;
      }
      if (generationId && input.status === "done" && existing.status !== "done") {
        data.status = "done";
      }
      if (existing.sourceNodeId !== sourceNodeId) data.sourceNodeId = sourceNodeId;
      if (existing.threadId !== threadId) data.threadId = threadId;
      if (Object.keys(data).length) {
        const node = await tx.canvasNode.update({
          where: { id: existing.id },
          data,
          select: NODE_SELECT,
        });
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
        sourceNodeId,
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

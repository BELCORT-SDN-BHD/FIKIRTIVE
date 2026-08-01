/**
 * Canvas settlement — the server writes a delivered generation job's whole batch of cards.
 *
 * WHY (#601 / #599 D3): a merchant who started a batch and closed the tab used to come back to a
 * half-empty board, because the CARDS were placed by the browser that happened to be watching.
 * Placing them is now the last step of the job's completion path, so the board is complete the
 * moment the job is delivered — whether or not any browser is open.
 *
 * WHAT THIS IS NOT — read this before touching it:
 *   - It NEVER creates or enqueues a GenJob, never calls a generation provider, never touches the
 *     credit ledger, and never reads or writes `spent` / `spentUsd` / `idempotencyKey` / the job's
 *     status. It is not a spend path. It runs strictly AFTER the job is terminal and its charge is
 *     settled, and its own failure leaves both untouched.
 *   - It never resurrects a card the merchant deleted: tombstones are honoured by the projection,
 *     and every write happens under the same per-job advisory lock the browser-side placement
 *     takes, so the two writers converge instead of racing.
 *
 * This file is only the I/O half. WHAT should be on the board is decided by the single pure
 * projection in `@fikirtive/core` (`planCanvasSettlement`) — so a card cannot mean one thing in
 * the tab that made it and another thing after a reload.
 *
 * SCOPE (#601 T2b): the delivered (DONE) path only. Projecting failed / cancelled / timed-out
 * terminals onto a card is T2c and lands with the code that writes them.
 */
import { newId, planCanvasSettlement, type CanvasRect, type SettlementCard } from "@fikirtive/core";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "./index.js";

export type CanvasSettlementOutcome = {
  /** "settled" = the board matches the job. The others are the honest reasons for doing nothing. */
  status: "settled" | "not-a-canvas-job" | "not-settled" | "nothing-to-place" | "job-missing" | "suppressed";
  /** Card ids the job owns after this run — anchor first, then siblings in batch order. */
  nodeIds: string[];
  created: number;
  updated: number;
};

type Tx = Prisma.TransactionClient;

const CARD_SELECT = {
  id: true, type: true, x: true, y: true, w: true, h: true, prompt: true,
  generationId: true, genJobId: true, status: true, sourceNodeId: true, threadId: true,
} as const;

/** Every writer for one paid job's cards shares this lock, browser-side or worker-side. */
export function canvasJobPlacementLockKey(ownerId: string, projectId: string, genJobId: string): string {
  return `canvas-job-placement:${ownerId}:${projectId}:${genJobId}`;
}

/**
 * Write every canvas card a delivered generation job owns, exactly once.
 *
 * Idempotent: run it again (a redelivery, the reaper's resume, or a browser that also placed the
 * cards) and the projection returns "keep" for everything, so nothing is written twice.
 */
export async function settleCanvasCardsForGenJob(
  genJobId: string,
  ownerId: string,
): Promise<CanvasSettlementOutcome> {
  const nothing = { nodeIds: [] as string[], created: 0, updated: 0 };
  const job = await prisma.genJob.findFirst({
    where: { id: genJobId, ownerId },
    select: {
      id: true, ownerId: true, projectId: true, threadId: true, status: true,
      kind: true, prompt: true, generationIds: true, sourceGenerationId: true,
    },
  });
  if (!job) return { status: "job-missing", ...nothing };
  // Cheap pre-check outside the lock: an unfinished job is the common case and must not queue
  // behind another writer only to be told there is nothing to do. The projection decides this
  // again inside the transaction from the same field, so this is an optimisation, not authority.
  if (job.status !== "DONE") return { status: "not-settled", ...nothing };

  return prisma.$transaction(async (tx) => {
    const lockKey = canvasJobPlacementLockKey(job.ownerId, job.projectId, job.id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;

    // Read the board INSIDE the lock: the job's own cards (tombstones included — deletion is a
    // durable instruction the projection must see) plus every live rectangle, so a batch nobody
    // ever placed can be given a free spot.
    const boardCards = await tx.canvasNode.findMany({
      where: { ownerId: job.ownerId, projectId: job.projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: CARD_SELECT,
    });
    const ownCards: SettlementCard[] = boardCards
      .filter((node) => node.genJobId === job.id)
      .map((node) => ({
        id: node.id, x: node.x, y: node.y, w: node.w, h: node.h,
        prompt: node.prompt, generationId: node.generationId,
        status: node.status, sourceNodeId: node.sourceNodeId,
      }));
    const occupied: CanvasRect[] = boardCards
      .filter((node) => node.status !== "deleted")
      .map((node) => ({ x: node.x, y: node.y, w: node.w, h: node.h }));

    const plan = planCanvasSettlement({
      job: {
        status: job.status,
        generationIds: job.generationIds,
        kind: job.kind === "VIDEO" ? "VIDEO" : "IMAGE",
        prompt: job.prompt,
        hasLiveThread: (await liveThreadId(tx, job)) !== null,
      },
      cards: ownCards,
      occupied,
    });
    if (plan.kind === "skip") return { status: plan.reason, ...nothing };

    const threadId = await liveThreadId(tx, job);
    const nodeIds: string[] = [];
    let created = 0;
    let updated = 0;
    // The anchor is always planned first, so by the time a sibling needs it, its id is known.
    let anchorNodeId: string | null = null;

    for (const entry of plan.cards) {
      if (entry.action === "keep") {
        nodeIds.push(entry.id);
        if (entry.role === "anchor") anchorNodeId = entry.id;
        continue;
      }
      if (entry.action === "update") {
        await tx.canvasNode.update({ where: { id: entry.id }, data: entry.patch });
        nodeIds.push(entry.id);
        if (entry.role === "anchor") anchorNodeId = entry.id;
        updated += 1;
        continue;
      }
      // "Made from" is a fact of the PAID JOB, never of a neighbouring card: only the anchor of a
      // job that was conditioned on an earlier output points at that output's card. A sibling
      // points at its batch anchor, which is layout, not lineage.
      const sourceNodeId = entry.role === "anchor"
        ? await sourceCardForJob(tx, job)
        : entry.layoutSourceNodeId ?? anchorNodeId;
      const node = await tx.canvasNode.create({
        data: {
          id: newId(),
          ownerId: job.ownerId,
          projectId: job.projectId,
          type: entry.type,
          x: entry.x,
          y: entry.y,
          w: entry.w,
          h: entry.h,
          text: null,
          prompt: entry.prompt,
          generationId: entry.generationId,
          genJobId: job.id,
          status: "done",
          sourceNodeId,
          threadId,
        },
        select: { id: true },
      });
      nodeIds.push(node.id);
      if (entry.role === "anchor") anchorNodeId = node.id;
      created += 1;
    }

    return { status: "settled" as const, nodeIds, created, updated };
  });
}

type JobFacts = { ownerId: string; projectId: string; threadId: string | null; sourceGenerationId: string | null };

/** The thread a card is attributed to — only when it is still live in this owner+project. A
 *  chat/canvas job has one; a storyboard/Gen-space job has none, and never sprouts a card. */
async function liveThreadId(tx: Tx, job: JobFacts): Promise<string | null> {
  if (!job.threadId) return null;
  const thread = await tx.chatThread.findFirst({
    where: { id: job.threadId, ownerId: job.ownerId, projectId: job.projectId, deletedAt: null },
    select: { id: true },
  });
  return thread?.id ?? null;
}

/** For a job made FROM an earlier output (an edit, or animating a still), that output's card. */
async function sourceCardForJob(tx: Tx, job: JobFacts): Promise<string | null> {
  if (!job.sourceGenerationId) return null;
  const source = await tx.canvasNode.findFirst({
    where: { ownerId: job.ownerId, projectId: job.projectId, generationId: job.sourceGenerationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return source?.id ?? null;
}

"use server";

import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { withCanvasLineage } from "./canvas-lineage-data";
import type { CanvasNodeLineage } from "./canvas-lineage";
import { freeCanvasRectForNewNode, placeCanvasJobNode, tombstoneCanvasNode } from "./canvas-node-placement";
import { getGenerationThumbs } from "./data";
import { censusCanvasJobCards, displayGenerationIdForCard } from "./otto-canvas-bridge-core";
import { canvasCardState, isCanvasCardRowStatus, OVERWRITABLE_CARD_STATUSES, type CanvasCardFace } from "./canvas-card-status";
import type { GenFailureReason } from "@fikirtive/core/gen-failure";

export type CanvasNodeDTO = {
  id: string; type: string; x: number; y: number; w: number; h: number;
  text: string | null; prompt: string | null; generationId: string | null;
  genJobId: string | null;
  /** What this card SAYS — derived by `canvasCardFace`, never the stored row word (#602 T3). */
  status: CanvasCardFace;
  /** WHY it rested, when its ending has a reason we can prove (#827). REQUIRED and closed: every
   *  card has one, and `unexplained` — the answer for every ordinary failure and for every card
   *  that ended before this existed — is a member of the set, not a missing field. Resolved from
   *  the job row, so it survives a reload and reads the same on another device. */
  failureReason: GenFailureReason;
  /** Batch identity as the server settled it — never re-derived from coordinates (#603 T4). */
  batchIndex: number | null;
  batchSize: number | null;
  /** Which card of the batch this one was arranged around. Layout only, never parentage. */
  layoutAnchorNodeId: string | null;
  /** The card this one's paid job was actually made FROM — the only thing that draws a line. */
  madeFromNodeId: string | null;
  threadId: string | null; url?: string | null; mediaWidth?: number | null; mediaHeight?: number | null;
  origin?: "otto" | null;
  /** When it was made, with what settings, at what cost (#547 B4). Null for text cards. */
  lineage?: CanvasNodeLineage | null;
};
export type CreateNodeInput = {
  projectId: string; type: "image" | "video" | "text";
  x: number; y: number; w: number; h: number;
  text?: string; prompt?: string; generationId?: string; genJobId?: string;
  /** A stored ROW word, not a face — validated against the same set the column's check enforces. */
  status?: string; threadId?: string;
};
export type CreatedCanvasNode = { id: string; x: number; y: number; w: number; h: number };
type CanvasNodeResolveStatus = "done" | "failed" | "cancelled" | "timeout" | "missing";

const SELECT = { id: true, type: true, x: true, y: true, w: true, h: true, text: true,
  prompt: true, generationId: true, genJobId: true, status: true,
  batchIndex: true, batchSize: true, layoutAnchorNodeId: true, madeFromNodeId: true,
  threadId: true } as const;
const RESOLVE_STATUSES = new Set<CanvasNodeResolveStatus>(["done", "failed", "cancelled", "timeout", "missing"]);

function canvasNodeOrigin(idempotencyKey: string | null | undefined): "otto" | null {
  return idempotencyKey?.startsWith("cowork:") ? "otto" : null;
}

async function ownedProject(projectId: string, ownerId: string) {
  return prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
}

/**
 * The board, as it stands. A PURE READ (#613 T2d).
 *
 * Opening a board used to finish it: it settled every delivered job whose cards looked incomplete,
 * and patched individual rows from whether a picture happened to resolve. Those were second and
 * third opinions about rows the job's own completion path already writes (#601 T2b / #612 T2c),
 * and a merchant must not get a different board because a tab happened to be open. A board that is
 * unfinished now stays unfinished until the one settlement finishes it — from the job's completion
 * path, or from the backfill sweep behind it (`findCanvasSettlementBacklog`), which covers both a
 * delivered job's missing outputs and a card that was never told how its job ended.
 */
export async function listCanvasNodes(projectId: string): Promise<CanvasNodeDTO[] | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (!(await ownedProject(projectId, gate.ownerId))) return { error: "Project not found." };
  const nodes = await prisma.canvasNode.findMany({ where: { ownerId: gate.ownerId, projectId }, select: SELECT });
  // Tombstones are read too — a deleted row is a durable suppression marker, and it keeps
  // chat/result recovery from resurrecting an item the owner deliberately removed.
  const linkedJobIds = [...new Set(nodes.map((n) => n.genJobId).filter((x): x is string => !!x))];
  const jobs = linkedJobIds.length
    ? await prisma.genJob.findMany({
      where: { id: { in: linkedJobIds }, ownerId: gate.ownerId, projectId },
      // `error` joins the read for #827: it is where the worker durably recorded WHY a refusal
      // happened, and without it a reloaded card can only ever show the generic resting face.
      // It is NEVER forwarded as text — `canvasCardState` hands it to the core whitelist, which
      // answers with a name from a closed set. That column doubles as an ops column.
      select: { id: true, generationIds: true, status: true, idempotencyKey: true, error: true },
    })
    : [];
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const visibleNodes = nodes.filter((node) => node.status !== "deleted");
  const genIds = [
    ...visibleNodes.map((n) => n.generationId).filter((x): x is string => !!x),
    ...jobs.flatMap((j) => j.generationIds),
  ];
  const thumbs = await getGenerationThumbs(gate.ownerId, genIds);

  // PURELY A READ from here down (#613 T2d). What each card SAYS is resolved for display — a
  // stored row that has not caught up still shows the merchant the truth — but nothing observed
  // while rendering is written back. A row is the settlement's to write: the job's completion path
  // writes it, and the backfill sweep writes it when that could not.
  // One rule, shared with the chat reader: a card that carries no output may only borrow one no
  // other live card of its job is showing, and only when it is that job's sole unbound card.
  const census = censusCanvasJobCards(visibleNodes);
  const resolved = visibleNodes.map((n) => {
    const job = n.genJobId ? jobById.get(n.genJobId) : null;
    const generationId = displayGenerationIdForCard({
      rowGenerationId: n.generationId,
      genJobId: n.genJobId,
      jobGenerationIds: job?.generationIds,
      census,
      thumbs,
    });
    const thumb = generationId ? thumbs[generationId] : undefined;
    const url = thumb?.src ?? null;
    const { face: status, failureReason } = canvasCardState({
      rowStatus: n.status,
      jobStatus: job?.status,
      jobError: job?.error,
      generationId,
      url,
    });
    return {
      ...n,
      generationId,
      status,
      failureReason,
      url,
      mediaWidth: thumb?.width ?? null,
      mediaHeight: thumb?.height ?? null,
      origin: canvasNodeOrigin(job?.idempotencyKey),
    };
  });

  return withCanvasLineage(gate.ownerId, projectId, resolved);
}

export async function createCanvasNode(input: CreateNodeInput): Promise<CreatedCanvasNode | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  // THE LAST UNVALIDATED WRITER (#602 T3). This is a server action, so `input.status` is a string
  // the browser chose, and for as long as this action has existed it went to the column unread.
  // Our own callers only ever send "pending" or "done", but "our callers behave" is not a rule the
  // database can keep — and a row carrying a word no renderer knows is exactly the eternal spinner
  // the state algebra closes. The check constraint is the durable guarantee; this is the same rule
  // said early, so a bad request gets an answer instead of a database error.
  if (input.status !== undefined && !isCanvasCardRowStatus(input.status)) return { error: "Invalid status." };
  if (!(await ownedProject(input.projectId, gate.ownerId))) return { error: "Project not found." };
  // Attribution is fail-closed: only stamp threadId when it names a live thread in THIS
  // owner+project; otherwise store null. Never trust a client-supplied threadId blindly.
  let threadId: string | null = null;
  if (input.threadId) {
    const t = await prisma.chatThread.findFirst({
      where: { id: input.threadId, ownerId: gate.ownerId, projectId: input.projectId, deletedAt: null },
      select: { id: true },
    });
    threadId = t ? t.id : null;
  }
  let generationId: string | null = null;
  if (input.generationId) {
    const g = await prisma.generation.findFirst({ where: { id: input.generationId, ownerId: gate.ownerId, projectId: input.projectId, deletedAt: null }, select: { id: true } });
    generationId = g ? g.id : null;
  }
  let genJobId: string | null = null;
  if (input.genJobId) {
    const j = await prisma.genJob.findFirst({ where: { id: input.genJobId, ownerId: gate.ownerId, projectId: input.projectId }, select: { id: true } });
    genJobId = j ? j.id : null;
  }
  if (genJobId && input.type !== "text") {
    const placement = await placeCanvasJobNode({
      ownerId: gate.ownerId,
      projectId: input.projectId,
      genJobId,
      type: input.type,
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      text: input.text ?? null,
      prompt: input.prompt ?? null,
      generationId,
      status: input.status,
      threadId,
    });
    return "error" in placement
      ? placement
      : "suppressed" in placement
        ? { error: "That canvas item was removed." }
      : {
        id: placement.node.id,
        x: placement.node.x,
        y: placement.node.y,
        w: placement.node.w,
        h: placement.node.h,
      };
  }

  // The unpaid placements — a text card, and Otto putting an existing generation on the board.
  // They go through the same "never cover a card that is already there" rule as a paid job's
  // card (#549): Otto's place tool has no board of its own to look at, so its default spot is
  // the board ORIGIN, which on any board that is not empty is the merchant's first picture.
  const id = newId();
  const rect = await prisma.$transaction(async (tx) => {
    const free = await freeCanvasRectForNewNode(tx, gate.ownerId, input.projectId, {
      x: input.x, y: input.y, w: input.w, h: input.h,
    });
    await tx.canvasNode.create({
      data: {
        id, ownerId: gate.ownerId, projectId: input.projectId, type: input.type,
        x: free.x, y: free.y, w: free.w, h: free.h,
        text: input.text ?? null, prompt: input.prompt ?? null,
        generationId, genJobId,
        status: input.status ?? "done",
        threadId,
      },
    });
    return free;
  });
  return { id, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

export async function moveCanvasNode(projectId: string, id: string, pos: { x: number; y: number; w: number; h: number }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const r = await prisma.canvasNode.updateMany({
    where: { id, ownerId: gate.ownerId, projectId, status: { not: "deleted" } },
    data: pos,
  });
  return r.count === 1 ? { ok: true as const } : { error: "Node not found." };
}

export async function updateTextNode(projectId: string, id: string, text: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const r = await prisma.canvasNode.updateMany({
    where: { id, ownerId: gate.ownerId, projectId, type: "text", status: { not: "deleted" } },
    data: { text },
  });
  return r.count === 1 ? { ok: true as const } : { error: "Node not found." };
}

/**
 * What the server did with a browser's report about a card (#612 r2).
 *
 * `applied: false` is not an error — it means the card had already come to rest, and `status` is
 * what it actually says. The caller is a tab that may be far behind; it needs the difference.
 */
export type ResolveCanvasNodeResult =
  | { ok: true; applied: true }
  | { ok: true; applied: false; status: string }
  | { error: string };

export async function resolveCanvasNode(
  projectId: string,
  id: string,
  input: { status: string; generationId?: string | null },
): Promise<ResolveCanvasNodeResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (!RESOLVE_STATUSES.has(input.status as CanvasNodeResolveStatus)) return { error: "Invalid status." };
  if (input.status === "done" && !input.generationId) return { error: "Generation required." };
  if (input.status !== "done" && input.generationId) return { error: "Generation only allowed for done status." };
  const node = await prisma.canvasNode.findFirst({
    where: {
      id,
      ownerId: gate.ownerId,
      projectId,
      type: { in: ["image", "video"] },
      status: { not: "deleted" },
    },
    select: { id: true, projectId: true, genJobId: true },
  });
  if (!node) {
    // DELETION IS AN ANSWER (#612 r4, judge P1). The lookup above walks past tombstones, so a card
    // the merchant removed in another tab came back as "Node not found" — indistinguishable from a
    // card that never existed, and therefore filed by the caller as "nobody knows". Nothing could
    // ever converge that: board reads omit tombstones too, so the only visible thing left was a
    // card being made that no longer exists. One read-only lookup makes the deletion sayable. The
    // WRITE predicate below is untouched — "deleted" was never in the overwritable set.
    const tombstone = await prisma.canvasNode.findFirst({
      where: { id, ownerId: gate.ownerId, projectId, status: "deleted" },
      select: { id: true },
    });
    if (tombstone) return { ok: true as const, applied: false as const, status: "deleted" };
    return { error: "Node not found." };
  }

  let generationId: string | null = null;
  if (input.generationId) {
    const g = await prisma.generation.findFirst({
      where: { id: input.generationId, ownerId: gate.ownerId, projectId: node.projectId, deletedAt: null },
      select: { id: true },
    });
    if (!g) return { error: "Generation not found." };
    if (node.genJobId) {
      const job = await prisma.genJob.findFirst({
        where: { id: node.genJobId, ownerId: gate.ownerId, projectId: node.projectId },
        select: { generationIds: true },
      });
      if (!job || !job.generationIds.includes(g.id)) {
        return { error: "Generation does not belong to this canvas job." };
      }
    }
    generationId = g.id;
  }

  // THE LATE-WRITE BARRIER (#612). This is the browser reporting what IT last saw, and a browser
  // can be arbitrarily far behind: a tab the merchant closed keeps polling, gives up, and sends
  // "timeout" for a card the server settled minutes ago. Applied as written that report knocked
  // the card back from done to timeout AND erased its generationId — the merchant's paid picture
  // came off the card, and the board then handed every orphaned card the batch's FIRST output, so
  // one image appeared four times and three appeared nowhere.
  //
  // Two clauses, two different invariants, and the FIRST is the one that matters (#612 r2, judge
  // P1): what may be overwritten is decided by the card's own STATE, not by whether it happens to
  // carry an output. Keying only on `generationId: null` protected delivered cards and nothing
  // else — a settled `failed` or `cancelled` card carries no output BY DESIGN, so a stale report
  // could still reopen a card the server had already finished. `generationId: null` stays beside
  // it as the independent promise that a resolve never erases or re-points a paid output.
  //
  // Both live in the WHERE, so the rule holds in the database rather than between the read above
  // and this write: a settlement landing in that window makes this match nothing. Zero rows means
  // the card is already settled with something better than this report — and the answer SAYS so,
  // because a browser that is not told it was refused paints the stale state anyway.
  const written = await prisma.canvasNode.updateMany({
    where: {
      id,
      ownerId: gate.ownerId,
      projectId: node.projectId,
      status: { in: [...OVERWRITABLE_CARD_STATUSES] },
      generationId: null,
    },
    data: { status: input.status, generationId },
  });
  if (written.count === 1) return { ok: true as const, applied: true as const };
  const settled = await prisma.canvasNode.findFirst({
    where: { id, ownerId: gate.ownerId, projectId: node.projectId },
    select: { status: true },
  });
  // "deleted" also covers the card being removed between these two reads — nothing to paint.
  return { ok: true as const, applied: false as const, status: settled?.status ?? "deleted" };
}

export async function deleteCanvasNode(projectId: string, id: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  // Keep a non-rendered tombstone so periodic Otto/GEN_RESULT recovery cannot recreate the
  // same paid output after the owner deliberately removes its card. Job-linked deletion uses
  // the exact placement lock, so a concurrent browser/bridge writer cannot pass the tombstone.
  const deleted = await tombstoneCanvasNode(gate.ownerId, projectId, id);
  return deleted ? { ok: true as const } : { error: "Node not found." };
}

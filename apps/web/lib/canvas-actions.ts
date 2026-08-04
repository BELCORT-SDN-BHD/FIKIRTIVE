"use server";

import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { withCanvasLineage } from "./canvas-lineage-data";
import type { CanvasNodeLineage } from "./canvas-lineage";
import { placeCanvasJobNode, tombstoneCanvasNode } from "./canvas-node-placement";
import { reconcileSettledCanvasJobs } from "./canvas-settlement-reconcile";
import { getGenerationThumbs } from "./data";
import { canvasNodeDisplayStatus, firstDisplayableGenerationId, settledCanvasNodeRepairPatch } from "./otto-canvas-bridge-core";

export type CanvasNodeDTO = {
  id: string; type: string; x: number; y: number; w: number; h: number;
  text: string | null; prompt: string | null; generationId: string | null;
  genJobId: string | null; status: string; sourceNodeId: string | null;
  threadId: string | null; url?: string | null; mediaWidth?: number | null; mediaHeight?: number | null;
  origin?: "otto" | null;
  /** When it was made, with what settings, at what cost (#547 B4). Null for text cards. */
  lineage?: CanvasNodeLineage | null;
};
export type CreateNodeInput = {
  projectId: string; type: "image" | "video" | "text";
  x: number; y: number; w: number; h: number;
  text?: string; prompt?: string; generationId?: string; genJobId?: string;
  status?: string; sourceNodeId?: string; threadId?: string;
};
export type CreatedCanvasNode = { id: string; x: number; y: number; w: number; h: number };
type CanvasNodeResolveStatus = "done" | "failed" | "timeout" | "missing";

const SELECT = { id: true, type: true, x: true, y: true, w: true, h: true, text: true,
  prompt: true, generationId: true, genJobId: true, status: true, sourceNodeId: true,
  threadId: true } as const;
const RESOLVE_STATUSES = new Set<CanvasNodeResolveStatus>(["done", "failed", "timeout", "missing"]);

function canvasNodeOrigin(idempotencyKey: string | null | undefined): "otto" | null {
  return idempotencyKey?.startsWith("cowork:") ? "otto" : null;
}

async function ownedProject(projectId: string, ownerId: string) {
  return prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
}

export async function listCanvasNodes(projectId: string): Promise<CanvasNodeDTO[] | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (!(await ownedProject(projectId, gate.ownerId))) return { error: "Project not found." };
  let nodes = await prisma.canvasNode.findMany({ where: { ownerId: gate.ownerId, projectId }, select: SELECT });
  // Tombstones are read too — a deleted row is a durable suppression marker, and it keeps
  // chat/result recovery from resurrecting an item the owner deliberately removed.
  const linkedJobIds = [...new Set(nodes.map((n) => n.genJobId).filter((x): x is string => !!x))];
  const jobs = linkedJobIds.length
    ? await prisma.genJob.findMany({
      where: { id: { in: linkedJobIds }, ownerId: gate.ownerId, projectId },
      select: { id: true, generationIds: true, status: true, idempotencyKey: true },
    })
    : [];
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  // Finish any delivered job whose cards are still incomplete — through the ONE settlement every
  // writer shares, so opening the board can never produce a different result from the worker
  // having settled it first. Re-read only when it actually wrote something; everything after this
  // point is display-only.
  if (await reconcileSettledCanvasJobs({ ownerId: gate.ownerId, cards: nodes, jobs })) {
    nodes = await prisma.canvasNode.findMany({ where: { ownerId: gate.ownerId, projectId }, select: SELECT });
  }
  const visibleNodes = nodes.filter((node) => node.status !== "deleted");
  const genIds = [
    ...visibleNodes.map((n) => n.generationId).filter((x): x is string => !!x),
    ...jobs.flatMap((j) => j.generationIds),
  ];
  const thumbs = await getGenerationThumbs(gate.ownerId, genIds);

  const repairs: Array<{
    id: string;
    status: string;
    generationId: string | null;
    data: NonNullable<ReturnType<typeof settledCanvasNodeRepairPatch>>;
  }> = [];
  const resolved = visibleNodes.map((n) => {
    const job = n.genJobId ? jobById.get(n.genJobId) : null;
    const generationId = n.generationId ?? firstDisplayableGenerationId(job?.generationIds, thumbs);
    const thumb = generationId ? thumbs[generationId] : undefined;
    const url = thumb?.src ?? null;
    const status = generationId && !url ? "missing" : canvasNodeDisplayStatus(n.status, job?.status, url);
    // A delivered job's rows belong to the settlement above — it has just run, with the whole
    // job in view. Repairing one of them here from a picture's availability would re-open the
    // second opinion this file was fixing: the two would disagree about which output the primary
    // card carries the moment one output's media is slow to resolve. Rows of a job that is NOT
    // delivered (a failed one) still get their display state repaired here; that projection is T2c.
    const patch = job?.status === "DONE"
      ? null
      : settledCanvasNodeRepairPatch(n.status, n.generationId, job?.status, generationId, url);
    if (patch) repairs.push({ id: n.id, status: n.status, generationId: n.generationId, data: patch });
    return {
      ...n,
      generationId,
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
        where: { id: r.id, ownerId: gate.ownerId, projectId, status: r.status, generationId: r.generationId },
        data: r.data,
      });
    }));
  }

  return withCanvasLineage(gate.ownerId, projectId, resolved);
}

export async function createCanvasNode(input: CreateNodeInput): Promise<CreatedCanvasNode | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
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
  let sourceNodeId: string | null = null;
  if (input.sourceNodeId) {
    const n = await prisma.canvasNode.findFirst({ where: { id: input.sourceNodeId, ownerId: gate.ownerId, projectId: input.projectId }, select: { id: true } });
    sourceNodeId = n ? n.id : null;
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
      sourceNodeId,
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

  const id = newId();
  await prisma.canvasNode.create({
    data: {
      id, ownerId: gate.ownerId, projectId: input.projectId, type: input.type,
      x: input.x, y: input.y, w: input.w, h: input.h,
      text: input.text ?? null, prompt: input.prompt ?? null,
      generationId, genJobId,
      status: input.status ?? "done", sourceNodeId,
      threadId,
    },
  });
  return { id, x: input.x, y: input.y, w: input.w, h: input.h };
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

export async function resolveCanvasNode(projectId: string, id: string, input: { status: string; generationId?: string | null }) {
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
  if (!node) return { error: "Node not found." };

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

  const r = await prisma.canvasNode.updateMany({
    where: {
      id,
      ownerId: gate.ownerId,
      projectId: node.projectId,
      status: { not: "deleted" },
    },
    data: { status: input.status, generationId },
  });
  return r.count === 1 ? { ok: true as const } : { error: "Node not found." };
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

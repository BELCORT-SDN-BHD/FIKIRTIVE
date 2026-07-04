"use server";

import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { getGenerationThumbs } from "./data";
import { canvasNodeDisplayStatus } from "./otto-canvas-bridge-core";

export type CanvasNodeDTO = {
  id: string; type: string; x: number; y: number; w: number; h: number;
  text: string | null; prompt: string | null; generationId: string | null;
  genJobId: string | null; status: string; sourceNodeId: string | null;
  threadId: string | null; url?: string | null;
};
export type CreateNodeInput = {
  projectId: string; type: "image" | "video" | "text";
  x: number; y: number; w: number; h: number;
  text?: string; prompt?: string; generationId?: string; genJobId?: string;
  status?: string; sourceNodeId?: string; threadId?: string;
};
type CanvasNodeResolveStatus = "done" | "failed" | "timeout" | "missing";

const SELECT = { id: true, type: true, x: true, y: true, w: true, h: true, text: true,
  prompt: true, generationId: true, genJobId: true, status: true, sourceNodeId: true,
  threadId: true } as const;
const RESOLVE_STATUSES = new Set<CanvasNodeResolveStatus>(["done", "failed", "timeout", "missing"]);

async function ownedProject(projectId: string, ownerId: string) {
  return prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
}

export async function listCanvasNodes(projectId: string): Promise<CanvasNodeDTO[] | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (!(await ownedProject(projectId, gate.ownerId))) return { error: "Project not found." };
  const nodes = await prisma.canvasNode.findMany({ where: { ownerId: gate.ownerId, projectId }, select: SELECT });
  const linkedJobIds = [...new Set(nodes.map((n) => n.genJobId).filter((x): x is string => !!x))];
  const jobs = linkedJobIds.length
    ? await prisma.genJob.findMany({
      where: { id: { in: linkedJobIds }, ownerId: gate.ownerId, projectId },
      select: { id: true, generationIds: true, status: true },
    })
    : [];
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const genIds = [
    ...nodes.map((n) => n.generationId).filter((x): x is string => !!x),
    ...jobs.map((j) => j.generationIds[0]).filter((x): x is string => !!x),
  ];
  const thumbs = await getGenerationThumbs(gate.ownerId, genIds);

  return nodes.map((n) => {
    const job = n.genJobId ? jobById.get(n.genJobId) : null;
    const generationId = n.generationId ?? job?.generationIds[0] ?? null;
    const url = generationId ? thumbs[generationId]?.src ?? null : null;
    const status = generationId && !url ? "missing" : canvasNodeDisplayStatus(n.status, job?.status, url);
    return { ...n, generationId, status, url };
  });
}

export async function createCanvasNode(input: CreateNodeInput): Promise<{ id: string } | { error: string }> {
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
    const g = await prisma.generation.findFirst({ where: { id: input.generationId, ownerId: gate.ownerId, deletedAt: null }, select: { id: true } });
    generationId = g ? g.id : null;
  }
  let sourceNodeId: string | null = null;
  if (input.sourceNodeId) {
    const n = await prisma.canvasNode.findFirst({ where: { id: input.sourceNodeId, ownerId: gate.ownerId }, select: { id: true } });
    sourceNodeId = n ? n.id : null;
  }
  let genJobId: string | null = null;
  if (input.genJobId) {
    const j = await prisma.genJob.findFirst({ where: { id: input.genJobId, ownerId: gate.ownerId }, select: { id: true } });
    genJobId = j ? j.id : null;
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
  return { id };
}

export async function moveCanvasNode(id: string, pos: { x: number; y: number; w: number; h: number }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const r = await prisma.canvasNode.updateMany({ where: { id, ownerId: gate.ownerId }, data: pos });
  return r.count === 1 ? { ok: true as const } : { error: "Node not found." };
}

export async function updateTextNode(id: string, text: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const r = await prisma.canvasNode.updateMany({ where: { id, ownerId: gate.ownerId, type: "text" }, data: { text } });
  return r.count === 1 ? { ok: true as const } : { error: "Node not found." };
}

export async function resolveCanvasNode(id: string, input: { status: string; generationId?: string | null }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (!RESOLVE_STATUSES.has(input.status as CanvasNodeResolveStatus)) return { error: "Invalid status." };
  if (input.status === "done" && !input.generationId) return { error: "Generation required." };
  if (input.status !== "done" && input.generationId) return { error: "Generation only allowed for done status." };
  const node = await prisma.canvasNode.findFirst({
    where: { id, ownerId: gate.ownerId, type: { in: ["image", "video"] } },
    select: { id: true, projectId: true },
  });
  if (!node) return { error: "Node not found." };

  let generationId: string | null = null;
  if (input.generationId) {
    const g = await prisma.generation.findFirst({
      where: { id: input.generationId, ownerId: gate.ownerId, projectId: node.projectId, deletedAt: null },
      select: { id: true },
    });
    if (!g) return { error: "Generation not found." };
    generationId = g.id;
  }

  const r = await prisma.canvasNode.updateMany({
    where: { id, ownerId: gate.ownerId },
    data: { status: input.status, generationId },
  });
  return r.count === 1 ? { ok: true as const } : { error: "Node not found." };
}

export async function deleteCanvasNode(id: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const r = await prisma.canvasNode.deleteMany({ where: { id, ownerId: gate.ownerId } });
  return r.count === 1 ? { ok: true as const } : { error: "Node not found." };
}

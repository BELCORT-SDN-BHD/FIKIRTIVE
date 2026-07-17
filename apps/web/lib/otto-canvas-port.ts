/**
 * makeOttoCanvasPort — the ctx.canvas port factory (W-B3-A; v2 hardening per codex TR1 item 1).
 *
 * Wraps the SAME owner-gated $0 canvas server actions the human UI uses (canvas-actions +
 * the display-only otto-canvas-bridge), adding the Otto-side hard line the UI doesn't need:
 *
 *  - place: a provided generationId must name a REAL generation in THIS owner+project —
 *    hard reject with a structured error, never silently degrade. (createCanvasNode's
 *    fail-closed nulling of unknown ids is right for the UI, which only passes ids it owns
 *    on screen; the model is not trusted the same way — a forged or cross-project id must
 *    fail loudly, not become an empty card.)
 *  - editText / remove: the node must belong to THIS project (canvas-actions scope these by
 *    owner only; an Otto thread is bound to exactly one project).
 *
 * $0 by construction: nothing here touches startGen / reserveCredits / the provider —
 * placing a node only references media that was ALREADY generated and charged.
 * NOT an action surface: no "use server", not *-actions — the parity scanner must not
 * discover this module (its capabilities are the manifest entries of the wrapped actions).
 */
import { prisma } from "@fikirtive/db";
import { listCanvasNodes, createCanvasNode, updateTextNode, resolveCanvasNode, deleteCanvasNode } from "./canvas-actions";
import { syncOttoCanvasNodes } from "./otto-canvas-bridge";

type PlaceInput = {
  type: "image" | "video" | "text";
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  prompt?: string;
  generationId?: string;
  sourceNodeId?: string;
};

export function makeOttoCanvasPort(ownerId: string, projectId: string) {
  /** Project binding: true only when the node exists in THIS owner+project. */
  const nodeInProject = async (id: string): Promise<boolean> => {
    const n = await prisma.canvasNode.findFirst({ where: { id, ownerId, projectId }, select: { id: true } });
    return !!n;
  };
  return {
    list: () => listCanvasNodes(projectId),
    sync: () => syncOttoCanvasNodes(projectId),
    place: async (input: PlaceInput) => {
      if (input.generationId) {
        const g = await prisma.generation.findFirst({
          where: { id: input.generationId, ownerId, projectId, deletedAt: null },
          select: { id: true },
        });
        if (!g) return { error: "That generationId is invalid or belongs to another project." };
      }
      return createCanvasNode({ projectId, ...input });
    },
    editText: async (id: string, text: string) => {
      if (!(await nodeInProject(id))) return { error: "Node not found." };
      return updateTextNode(projectId, id, text);
    },
    resolve: (id: string, input: { status: "done" | "failed" | "timeout" | "missing"; generationId?: string }) =>
      resolveCanvasNode(projectId, id, input),
    remove: async (id: string) => {
      if (!(await nodeInProject(id))) return { error: "Node not found." };
      return deleteCanvasNode(projectId, id);
    },
  };
}

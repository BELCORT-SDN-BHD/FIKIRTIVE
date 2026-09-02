"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import { CREATE_NAV_HREF } from "@fikirtive/core/navigation";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import { runAsUser } from "@fikirtive/db/principal";
import { newThreadTitle } from "./otto-canned-starters";

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CANVAS_NAME = 80;
const MAX_CREATE_PROMPT = 4000;

function identities(requestId: string) {
  return {
    projectId: `canvas_${requestId}`,
    threadId: `thread_${requestId}`,
    handoffId: `handoff_${requestId}`,
  };
}

function canvasName(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim().slice(0, MAX_CANVAS_NAME);
}

type CanvasConversationResult =
  | { projectId: string; threadId: string; handoffId: string }
  | { error: string };

/**
 * The one production entry from Create into a new Canvas.
 *
 * The browser supplies a UUID for retry identity, never an owner or record id. The server derives
 * all three durable ids from it, scopes every replay to the authenticated tenant, and commits the
 * Canvas, empty Conversation and first-turn handoff together. No generation or credit action runs
 * here; the existing Otto stream consumes the handoff after navigation.
 */
export async function createCanvasConversation(raw: unknown): Promise<CanvasConversationResult> {
  if (!raw || typeof raw !== "object") return { error: "Couldn't start that Canvas — please try again." };
  const input = raw as { prompt?: unknown; requestId?: unknown };
  const prompt = typeof input.prompt === "string" ? input.prompt.replace(/\s+/g, " ").trim() : "";
  if (!prompt) return { error: "Describe what you want to create." };
  if (prompt.length > MAX_CREATE_PROMPT || typeof input.requestId !== "string" || !REQUEST_ID.test(input.requestId)) {
    return { error: "Couldn't start that Canvas — please try again." };
  }

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<CanvasConversationResult> => {
    const { ownerId } = gate;
    const ids = identities(input.requestId as string);

    try {
      const result = await prisma.$transaction(async (tx) => {
        const prior = await tx.actionEvent.findFirst({
          where: { id: ids.handoffId, ownerId, type: "canvas.create-handoff" },
          select: { projectId: true, payload: true },
        });
        if (prior) {
          const payload = prior.payload as { threadId?: unknown } | null;
          if (prior.projectId !== ids.projectId || payload?.threadId !== ids.threadId) {
            return { error: "Couldn't start that Canvas — please try again." } as const;
          }
          const [project, thread] = await Promise.all([
            tx.project.findFirst({ where: { id: ids.projectId, ownerId, deletedAt: null }, select: { id: true } }),
            tx.chatThread.findFirst({ where: { id: ids.threadId, ownerId, projectId: ids.projectId, deletedAt: null }, select: { id: true } }),
          ]);
          if (!project || !thread) return { error: "Couldn't start that Canvas — please try again." } as const;
          return ids;
        }

        await tx.project.create({
          data: { id: ids.projectId, ownerId, name: canvasName(prompt) },
          select: { id: true },
        });
        await tx.chatThread.create({
          data: { id: ids.threadId, ownerId, projectId: ids.projectId, title: newThreadTitle(prompt) },
          select: { id: true },
        });
        await tx.actionEvent.create({
          data: {
            id: ids.handoffId,
            ownerId,
            projectId: ids.projectId,
            type: "canvas.create-handoff",
            payload: { prompt, threadId: ids.threadId },
          },
        });
        return ids;
      });
      if ("error" in result) return result;
      revalidatePath(CREATE_NAV_HREF);
      return result;
    } catch {
      return { error: "Couldn't start that Canvas — please try again." };
    }
  });
}

/** Read-only server seam used by the Canvas entry. It never trusts ids inside the payload. */
export async function getCanvasConversationHandoff(input: {
  ownerId: string;
  handoffId: string;
  projectId: string;
  threadId: string;
}): Promise<{ prompt: string } | null> {
  if (!input.handoffId.startsWith("handoff_") || !input.projectId || !input.threadId) return null;
  const row = await prisma.actionEvent.findFirst({
    where: {
      id: input.handoffId,
      ownerId: input.ownerId,
      projectId: input.projectId,
      type: "canvas.create-handoff",
    },
    select: { payload: true },
  });
  const payload = row?.payload as { prompt?: unknown; threadId?: unknown } | null | undefined;
  if (payload?.threadId !== input.threadId || typeof payload.prompt !== "string" || !payload.prompt.trim()) return null;
  return { prompt: payload.prompt };
}

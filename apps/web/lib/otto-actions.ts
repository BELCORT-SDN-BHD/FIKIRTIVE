/**
 * ottoTurn — Otto agent server action (Task 1.8a)
 *
 * NON-MONEY half: runs the Otto agent loop for a user message, persists conversation
 * state to ChatThread.ottoState, charges the turn's LLM cost via withLlmBudget,
 * and handles completed / interrupted (needs_approval) / maxTurns-exceeded gracefully.
 *
 * The generate tool is gated by needsApproval:true — it PARKS here and returns
 * "needs_approval". The actual spend (approve/resume) is Task 1.8b.
 *
 * Owner-scoped validation mirrors coworkTurn. Does NOT modify coworkTurn/coworkGenerate.
 */
import "server-only";
import { revalidatePath } from "next/cache";
import { prisma } from "@artlio/db";
import {
  newId,
  coworkTurnRequest,
  OTTO_MAX_STEPS,
} from "@artlio/core";
import { otto, withLlmBudget, OTTO_DEFAULT_MODEL, run, RunState, MaxTurnsExceededError } from "@artlio/otto";
import type { OttoContext, TokenUsage, AgentInputItem } from "@artlio/otto";
import { requireOwner } from "./auth-guard";
import { resolveDisabledModels } from "./model-registry";
import { startGen } from "./gen-actions";

// ---------------------------------------------------------------------------
// buildOttoContext — exported for 1.8b reuse
// ---------------------------------------------------------------------------

export async function buildOttoContext({
  ownerId,
  projectId,
  threadId,
  sourceGenerationId,
}: {
  ownerId: string;
  projectId: string;
  threadId: string;
  sourceGenerationId?: string | null;
}): Promise<OttoContext> {
  const disabledModels = Array.from(await resolveDisabledModels());
  return {
    orgId: ownerId,
    userId: ownerId,
    projectId,
    threadId,
    disabledModels,
    sourceGenerationId: sourceGenerationId ?? null,
    startGen,
  };
}

// ---------------------------------------------------------------------------
// mapOttoUsage — map SDK Usage to withLlmBudget's TokenUsage
// ---------------------------------------------------------------------------

export function mapOttoUsage(usage: {
  inputTokens: number;
  outputTokens: number;
  requestUsageEntries?: Array<{
    inputTokens: number;
    outputTokens: number;
    inputTokensDetails: Record<string, number>;
  }>;
}): TokenUsage {
  let cachedInputTokens = 0;
  if (usage.requestUsageEntries) {
    for (const entry of usage.requestUsageEntries) {
      cachedInputTokens += entry.inputTokensDetails?.cached_tokens ?? 0;
    }
  }
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: cachedInputTokens > 0 ? cachedInputTokens : undefined,
  };
}

// ---------------------------------------------------------------------------
// ottoTurn — the main server action
// ---------------------------------------------------------------------------

export async function ottoTurn(raw: unknown): Promise<
  | { threadId: string; status: "done"; reply: string }
  | { threadId: string; status: "needs_approval"; pendingCardIds: string[] }
  | { threadId: string; status: "degraded" }
  | { error: string }
> {
  const parsed = coworkTurnRequest.safeParse(raw);
  if (!parsed.success) return { error: "Say what you'd like to make." };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const { projectId, text, entityIds, variantSel, sourceGenerationId, replyToMessageId } = parsed.data;

  try {
    const OWNED = { ownerId, deletedAt: null } as const;

    // Validate the project is owned + live
    const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
    if (!project) return { error: "Project not found." };

    // Validate sourceGenerationId (owned + in-project + image-ext), else null
    let validSource: string | null = null;
    if (sourceGenerationId) {
      const g = await prisma.generation.findFirst({
        where: {
          id: sourceGenerationId,
          ...OWNED,
          projectId,
          asset: { ext: { in: ["png", "jpg", "jpeg", "webp"] } },
        },
        select: { id: true },
      });
      if (g) validSource = g.id;
    }

    // Resolve thread: new vs existing-owned-and-in-project
    const isNew = !parsed.data.threadId;
    const threadId = parsed.data.threadId ?? newId();
    let priorOttoState: string | null = null;

    if (!isNew) {
      const t = await prisma.chatThread.findFirst({
        where: { id: threadId, ...OWNED },
        select: { projectId: true, ottoState: true },
      });
      if (!t || t.projectId !== projectId) return { error: "Conversation not found." };
      priorOttoState = t.ottoState;
    }

    // Validate replyToMessageId (scoped, else null)
    let validReplyId: string | null = null;
    if (!isNew && replyToMessageId) {
      const qm = await prisma.chatMessage.findFirst({
        where: { id: replyToMessageId, threadId, ownerId, deletedAt: null },
        select: { id: true },
      });
      if (qm) validReplyId = qm.id;
    }

    // Compute next seq
    const last = isNew
      ? null
      : await prisma.chatMessage.findFirst({
          where: { threadId, ownerId },
          orderBy: { seq: "desc" },
          select: { seq: true },
        });
    let seq = last?.seq ?? 0;

    // Persist USER message first (create thread row first if new — FK ordering)
    if (isNew) {
      await prisma.chatThread.create({
        data: { id: threadId, ownerId, projectId, title: text.slice(0, 80) },
      });
    }
    await prisma.chatMessage.create({
      data: {
        id: newId(),
        threadId,
        ownerId,
        role: "USER",
        kind: "TEXT",
        seq: ++seq,
        text,
        payload: { entityIds, variantSel },
        replyToMessageId: validReplyId,
      },
    });

    // Build context
    const ctx = await buildOttoContext({ ownerId, projectId, threadId, sourceGenerationId: validSource });

    // Build run input: rehydrate prior state (multi-turn) or start fresh
    let runInput: string | AgentInputItem[];
    if (priorOttoState) {
      const priorState = await RunState.fromString(otto, priorOttoState);
      runInput = [...priorState.history, { role: "user", content: text } as AgentInputItem];
    } else {
      runInput = text;
    }

    // Run agent, metered
    const refId = `otto-turn:${threadId}:${seq}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let agentResult: any;

    try {
      agentResult = await withLlmBudget(
        { orgId: ownerId, refId, model: OTTO_DEFAULT_MODEL, paid: true, maxSteps: OTTO_MAX_STEPS },
        async () => {
          const r = await run(otto, runInput, { context: ctx, maxTurns: OTTO_MAX_STEPS });
          return { result: r, usage: mapOttoUsage(r.state.usage) };
        },
      );
    } catch (e) {
      if (e instanceof MaxTurnsExceededError) {
        // Graceful degrade — withLlmBudget already refunded the reservation on throw
        // NOTE: tokens used before the maxTurns error are not charged (under-charge edge case)
        const degradeText = "I got a bit tangled up — try asking again.";
        await prisma.chatMessage.create({
          data: {
            id: newId(),
            threadId,
            ownerId,
            role: "AGENT",
            kind: "TEXT",
            seq: ++seq,
            text: degradeText,
          },
        });
        revalidatePath("/", "layout");
        return { threadId, status: "degraded" };
      }
      // InsufficientCredits and other errors bubble to {error} contract
      throw e;
    }

    // agentResult is a RunResult from withLlmBudget; typed as any to avoid overload ambiguity
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = agentResult as any;

    // Persist the final ottoState
    const newOttoState = (result.state.toString() as string);

    /** Extract plain-text output from a RunResult's newItems (best-effort). */
    function extractText(r: any): string {
      if (r.finalOutput != null) return String(r.finalOutput);
      return (Array.isArray(r.newItems) ? (r.newItems as any[]) : [])
        .filter((it: any) => it.type === "message_output_item")
        .map((it: any) => {
          const content: any[] = it?.rawItem?.content ?? [];
          return content
            .filter((c: any) => c.type === "output_text")
            .map((c: any) => c.text ?? "")
            .join("");
        })
        .join("");
    }

    // Handle interruption (generate tool parked for approval)
    if (Array.isArray(result.interruptions) && result.interruptions.length > 0) {
      const pendingCardIds: string[] = [];
      for (const interruption of result.interruptions as any[]) {
        if ((interruption.rawItem as any)?.name === "generate") {
          try {
            const args = JSON.parse(interruption.arguments ?? "{}") as { cardId?: string };
            if (args.cardId) pendingCardIds.push(args.cardId);
          } catch {
            // malformed args — skip
          }
        }
      }

      // Persist any assistant text produced before the interruption
      const assistantText = extractText(result);
      if (assistantText) {
        await prisma.chatMessage.create({
          data: {
            id: newId(),
            threadId,
            ownerId,
            role: "AGENT",
            kind: "TEXT",
            seq: ++seq,
            text: assistantText,
          },
        });
      }

      // Persist paused ottoState
      await prisma.chatThread.update({
        where: { id: threadId },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      });

      revalidatePath("/", "layout");
      return { threadId, status: "needs_approval", pendingCardIds };
    }

    // Completed — persist Otto's final reply + ottoState
    const replyText = extractText(result);

    await prisma.$transaction([
      prisma.chatThread.update({
        where: { id: threadId },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      }),
      prisma.chatMessage.create({
        data: {
          id: newId(),
          threadId,
          ownerId,
          role: "AGENT",
          kind: "TEXT",
          seq: ++seq,
          text: replyText,
        },
      }),
    ]);

    revalidatePath("/", "layout");
    return { threadId, status: "done", reply: replyText };
  } catch {
    return { error: "Couldn't reach Otto — please try again." };
  }
}

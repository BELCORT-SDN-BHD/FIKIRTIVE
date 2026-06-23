/**
 * ottoTurn — Otto agent server action (Task 1.8a)
 * ottoApprove — approve a parked generate → resume → spend (Task 1.8b)
 *
 * NON-MONEY half (ottoTurn): runs the Otto agent loop for a user message, persists
 * conversation state to ChatThread.ottoState, charges the turn's LLM cost via
 * withLlmBudget, and handles completed / interrupted (needs_approval) / maxTurns-exceeded
 * gracefully. The generate tool is gated by needsApproval:true — it PARKS and returns
 * "needs_approval". The actual spend (approve/resume) is ottoApprove (Task 1.8b).
 *
 * MONEY half (ottoApprove): rehydrates the paused RunState, verifies + approves the
 * matching generate interruption (cardId binding), and resumes the run — which executes
 * generate.execute → ctx.startGen → real spend. Resume is metered via withLlmBudget.
 *
 * MONEY-SAFETY INVARIANTS (ottoApprove):
 *   - Spend goes ONLY through the resumed generate tool → ctx.startGen (never directly).
 *   - cardId binding: approves only the generate interruption whose arguments.cardId
 *     matches the approved cardId. Mismatch → reject, no approve, no spend.
 *   - Double-approve safe: if no pending interruption but a GenJob cowork:<cardId> already
 *     exists, returns it benignly (no second approve, no second spend).
 *   - Resume turn LLM cost is metered via withLlmBudget (reserve → settle).
 *   - Tenant-scoped: thread loaded owner-scoped; cross-tenant threadId/cardId rejected.
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
import { otto, withLlmBudget, OTTO_DEFAULT_MODEL, run, RunState, MaxTurnsExceededError, mapOttoUsage } from "@artlio/otto";
import type { OttoContext, AgentInputItem } from "@artlio/otto";
import { requireOwner } from "./auth-guard";
import { resolveDisabledModels } from "./model-registry";
import { startGen } from "./gen-actions";

// mapOttoUsage re-exported from @artlio/otto so existing callers that import
// it from this module continue to work (the canonical source is @artlio/otto).
export { mapOttoUsage } from "@artlio/otto";

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
        {
          orgId: ownerId,
          refId,
          model: OTTO_DEFAULT_MODEL,
          paid: true,
          maxSteps: OTTO_MAX_STEPS,
          usageOnError: (e) => (e instanceof MaxTurnsExceededError && (e as { state?: { usage?: unknown } }).state?.usage)
            ? mapOttoUsage((e as { state: { usage: Parameters<typeof mapOttoUsage>[0] } }).state.usage)
            : null,
        },
        async () => {
          const r = await run(otto, runInput, { context: ctx, maxTurns: OTTO_MAX_STEPS });
          return { result: r, usage: mapOttoUsage(r.state.usage) };
        },
      );
    } catch (e) {
      if (e instanceof MaxTurnsExceededError) {
        // Graceful degrade — withLlmBudget already settled actual usage (or refunded if no usage)
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
        // Accept either the SDK `.name` getter or the raw item name (robust to item-shape
        // differences between RunState.getInterruptions() items and RunResult.interruptions).
        const nm = (interruption as any).name ?? (interruption.rawItem as any)?.name;
        if (nm === "generate") {
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

// ---------------------------------------------------------------------------
// ottoApprove — approve a parked generate interruption and resume the run
// (Task 1.8b — MONEY half)
// ---------------------------------------------------------------------------

export async function ottoApprove(raw: unknown): Promise<
  | { ok: true; status: "done"; reply: string; genJobId?: string }
  | { ok: true; status: "needs_approval"; pendingCardIds: string[] }
  | { ok: true; status: "degraded" }
  | { ok: true; genJobId: string; status: string } // double-approve: existing job
  | { error: string }
> {
  // Inline validation (no zod dep in apps/web) — mirror brief schema
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>).threadId !== "string" ||
    typeof (raw as Record<string, unknown>).cardId !== "string" ||
    ((raw as Record<string, unknown>).threadId as string).length < 1 ||
    ((raw as Record<string, unknown>).threadId as string).length > 64 ||
    ((raw as Record<string, unknown>).cardId as string).length < 1 ||
    ((raw as Record<string, unknown>).cardId as string).length > 64
  ) {
    return { error: "Invalid approval request." };
  }
  const { threadId, cardId } = raw as { threadId: string; cardId: string };

  // Tenant scope: identity from requireOwner only, never from input
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  try {
    // Load thread owner-scoped (cross-tenant rejected)
    const thread = await prisma.chatThread.findFirst({
      where: { id: threadId, ownerId, deletedAt: null },
      select: { id: true, projectId: true, ottoState: true },
    });
    if (!thread) return { error: "Conversation not found." };
    if (!thread.ottoState) return { error: "Nothing to approve." };

    // Rehydrate the paused RunState
    const state = await RunState.fromString(otto, thread.ottoState);

    // Find the matching generate interruption (cardId binding)
    const interruptions = state.getInterruptions();
    const matchingInterruption = interruptions.find((item) => {
      // item.name uses the getter (toolName ?? rawItem.name)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const it = item as any;
      const toolName: string | undefined = it.name;
      if (toolName !== "generate") return false;
      try {
        const args = JSON.parse(it.arguments ?? "{}") as { cardId?: string };
        return args.cardId === cardId;
      } catch {
        return false;
      }
    });

    if (!matchingInterruption) {
      // No matching pending interruption — check if already generated (double-approve path)
      const existingJob = await prisma.genJob.findFirst({
        where: { ownerId, idempotencyKey: `cowork:${cardId}` },
        select: { id: true, status: true },
      });
      if (existingJob) {
        // Already approved/generating — return benignly, no second spend
        return { ok: true, genJobId: existingJob.id, status: existingJob.status };
      }
      return { error: "That card isn't awaiting approval." };
    }

    // Approve — mutates the rehydrated state in place; resume will execute the tool
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state.approve(matchingInterruption as any);

    // Build context — injects the real startGen port (spend path)
    const ctx = await buildOttoContext({
      ownerId,
      projectId: thread.projectId,
      threadId,
      sourceGenerationId: null,
    });

    // Resume the run, metered (LLM cost of this resume turn)
    const refId = `otto-approve:${threadId}:${cardId}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let agentResult: any;

    try {
      agentResult = await withLlmBudget(
        {
          orgId: ownerId,
          refId,
          model: OTTO_DEFAULT_MODEL,
          paid: true,
          maxSteps: OTTO_MAX_STEPS,
          usageOnError: (e) => (e instanceof MaxTurnsExceededError && (e as { state?: { usage?: unknown } }).state?.usage)
            ? mapOttoUsage((e as { state: { usage: Parameters<typeof mapOttoUsage>[0] } }).state.usage)
            : null,
        },
        async () => {
          // Resuming with the approved state — generate.execute runs → ctx.startGen → spend
          const r = await run(otto, state, { context: ctx, maxTurns: OTTO_MAX_STEPS });
          return { result: r, usage: mapOttoUsage(r.state.usage) };
        },
      );
    } catch (e) {
      if (e instanceof MaxTurnsExceededError) {
        const degradeText = "I got a bit tangled up — try asking again.";
        // Persist the degrade message so the user actually sees it (parity with ottoTurn),
        // plus the partial RunState if the SDK attached one.
        const seq = await prisma.chatMessage.findFirst({
          where: { threadId, ownerId },
          orderBy: { seq: "desc" },
          select: { seq: true },
        });
        await prisma.chatMessage.create({
          data: {
            id: newId(),
            threadId,
            ownerId,
            role: "AGENT",
            kind: "TEXT",
            seq: (seq?.seq ?? 0) + 1,
            text: degradeText,
          },
        });
        const errState = (e as { state?: { toString(): string } }).state;
        if (errState) {
          await prisma.chatThread.update({
            where: { id: threadId },
            data: { ottoState: errState.toString(), updatedAt: new Date() },
          });
        }
        revalidatePath("/", "layout");
        return { ok: true, status: "degraded" };
      }
      throw e;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = agentResult as any;

    // Reuse the shared extractText helper pattern from ottoTurn
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

    const newOttoState = result.state.toString() as string;

    // Handle another interruption (chained approval needed)
    if (Array.isArray(result.interruptions) && result.interruptions.length > 0) {
      const pendingCardIds: string[] = [];
      for (const interruption of result.interruptions as any[]) {
        // Accept either the SDK `.name` getter or the raw item name (robust to item-shape
        // differences between RunState.getInterruptions() items and RunResult.interruptions).
        const nm = (interruption as any).name ?? (interruption.rawItem as any)?.name;
        if (nm === "generate") {
          try {
            const args = JSON.parse(interruption.arguments ?? "{}") as { cardId?: string };
            if (args.cardId) pendingCardIds.push(args.cardId);
          } catch {
            // malformed args — skip
          }
        }
      }

      const assistantText = extractText(result);
      if (assistantText) {
        const seq = await prisma.chatMessage.findFirst({
          where: { threadId, ownerId },
          orderBy: { seq: "desc" },
          select: { seq: true },
        });
        await prisma.chatMessage.create({
          data: {
            id: newId(),
            threadId,
            ownerId,
            role: "AGENT",
            kind: "TEXT",
            seq: (seq?.seq ?? 0) + 1,
            text: assistantText,
          },
        });
      }

      await prisma.chatThread.update({
        where: { id: threadId },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      });

      revalidatePath("/", "layout");
      return { ok: true, status: "needs_approval", pendingCardIds };
    }

    // Completed — persist Otto's reply + updated ottoState
    const replyText = extractText(result);

    // Look up the GenJob created by the resumed generate (best-effort, for UI)
    const genJob = await prisma.genJob.findFirst({
      where: { ownerId, idempotencyKey: `cowork:${cardId}` },
      select: { id: true, status: true },
    });

    const seq = await prisma.chatMessage.findFirst({
      where: { threadId, ownerId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });

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
          seq: (seq?.seq ?? 0) + 1,
          text: replyText,
        },
      }),
    ]);

    revalidatePath("/", "layout");
    return {
      ok: true,
      status: "done",
      reply: replyText,
      ...(genJob ? { genJobId: genJob.id } : {}),
    };
  } catch {
    return { error: "Couldn't approve — please try again." };
  }
}

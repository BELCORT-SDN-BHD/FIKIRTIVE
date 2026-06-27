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
import { prisma } from "@fikirtive/db";
import {
  newId,
  coworkTurnRequest,
  OTTO_MAX_STEPS,
  GOAL_PRESETS,
  isGoalKey,
} from "@fikirtive/core";
import { otto, withLlmBudget, OTTO_DEFAULT_MODEL, run, RunState, MaxTurnsExceededError, mapOttoUsage, ottoSimpleModeBlock } from "@fikirtive/otto";
import type { OttoContext, AgentInputItem } from "@fikirtive/otto";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import { resolveDisabledModels } from "./model-registry";
import { startGen } from "./gen-actions";
import { getBrandContextText } from "./memory-actions";
import { fetchAndExtract } from "./brand-research";

// mapOttoUsage re-exported from @fikirtive/otto so existing callers that import
// it from this module continue to work (the canonical source is @fikirtive/otto).
export { mapOttoUsage } from "@fikirtive/otto";

/**
 * Safe one-line error summary for server logs. Logs name/message/statusCode only —
 * NOT the raw error, whose AI SDK provider fields (e.g. requestBodyValues) can carry
 * the full prompt, user text, and context into logs.
 */
function errSummary(e: unknown): string {
  if (!e || typeof e !== "object") return String(e);
  const x = e as { name?: unknown; message?: unknown; statusCode?: unknown };
  return [x.name, x.message, x.statusCode != null ? `status=${x.statusCode}` : null]
    .filter(Boolean)
    .join(" | ") || String(e);
}

// ---------------------------------------------------------------------------
// loadAvailableRefsForAgent — owner-scoped entity loader for the agent context
// ---------------------------------------------------------------------------

/** Returns the slim { id, name, type } shape the agent context needs.
 *  Best-effort: returns [] on any error so context injection never fails the turn. */
async function loadAvailableRefsForAgent(ownerId: string): Promise<{ id: string; name: string; type: string }[]> {
  try {
    const entities = await prisma.entity.findMany({
      // Only surface entities Otto can actually USE as a visual reference: one with no
      // reference image can't meaningfully be @-mentioned (nothing to condition on). This
      // also keeps ref-less test/junk entities out of Otto's @-suggestions (audit STUFF-7).
      where: { ownerId, deletedAt: null, referenceImages: { some: { deletedAt: null } } },
      select: { id: true, name: true, type: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    return entities.map((e) => ({ id: e.id, name: e.name, type: e.type }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// buildContextSystemMessage — compose the injected system message from OttoContext
// ---------------------------------------------------------------------------

export function buildContextSystemMessage(ctx: OttoContext): AgentInputItem | null {
  const parts: string[] = [];
  if (ctx.brandContext) parts.push(`What you know about the user's brand:\n${ctx.brandContext}`);
  if (ctx.availableRefs?.length) {
    parts.push(
      `Reusable items you can @-reference (use the id with tools): ${ctx.availableRefs.map((r) => `@${r.name} [${r.type}, id=${r.id}]`).join(", ")}`,
    );
  }
  if (ctx.simpleMode) parts.push(ottoSimpleModeBlock);
  if (ctx.activeJob) {
    const s = ctx.activeJob.status;
    const human =
      s === "DONE" ? "the last generation finished"
      : s === "FAILED" ? "the last generation FAILED — the user was automatically refunded, so they were NOT charged for it"
      : s === "GENERATING" ? "a generation is being made right now"
      : s === "QUEUED" ? "a generation is queued and about to start"
      : `the last generation status is ${s}`;
    parts.push(`Current generation status for this conversation: ${human}. Speak about generation progress ONLY based on this.`);
  }
  return parts.length ? ({ role: "system", content: parts.join("\n\n") } as AgentInputItem) : null;
}

// ---------------------------------------------------------------------------
// buildOttoContext — exported for 1.8b reuse
// ---------------------------------------------------------------------------

export async function buildOttoContext({
  ownerId,
  projectId,
  threadId,
  sourceGenerationId,
  simpleMode,
}: {
  ownerId: string;
  projectId: string;
  threadId: string;
  sourceGenerationId?: string | null;
  simpleMode?: boolean;
}): Promise<OttoContext> {
  const disabledModels = Array.from(await resolveDisabledModels());
  const [brandContext, availableRefs, activeJob] = await Promise.all([
    getBrandContextText(ownerId, null).catch(() => ""),
    loadAvailableRefsForAgent(ownerId),
    prisma.genJob.findFirst({
      where: { threadId, ownerId },
      orderBy: { createdAt: "desc" },
      select: { status: true, kind: true, error: true },
    }).catch(() => null),
  ]);
  return {
    orgId: ownerId,
    userId: ownerId,
    projectId,
    threadId,
    disabledModels,
    sourceGenerationId: sourceGenerationId ?? null,
    startGen,
    brandContext,
    availableRefs,
    simpleMode: simpleMode ?? false,
    activeJob,
    research: {
      fetchUrl: fetchAndExtract,
      // TODO(G3): wire a web-search API transport (needs a key)
    },
  };
}

// ---------------------------------------------------------------------------
// extractText / finalizeOttoRun — shared post-run persistence
//
// finalizeOttoRun is the EXACT post-run persistence ottoTurn performs after a
// (non-streaming) run completes, lifted verbatim so the streaming route handler
// (app/api/otto/stream/route.ts) can reuse it WITHOUT duplicating ~100 lines of
// money-adjacent CAS logic. Behavior is identical:
//   - interruption branch: CAS-write paused ottoState (existing) / plain update
//     (new) → stale on count 0 → persist partial assistant text → needs_approval
//   - completed branch: CAS-write ottoState (existing) / $transaction (new) →
//     stale on count 0 → persist assistant reply → done
// The CAS guard `updateMany({ where:{ id, ownerId, ottoState: priorOttoState }})`
// (count 0 ⇒ stale) is preserved. Does NOT call revalidatePath (caller-owned).
// ---------------------------------------------------------------------------

/** Extract plain-text output from a RunResult's newItems (best-effort). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractText(r: any): string {
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

export type FinalizeOttoRunResult =
  | { status: "needs_approval"; pendingCardIds: string[] }
  | { status: "done"; reply: string }
  | { status: "stale" };

/**
 * Persist a completed/interrupted Otto run, with the SAME CAS + seq semantics as
 * ottoTurn. `seqAfterUser` is the seq value AFTER the USER message was written;
 * the assistant message is created at `seqAfterUser + 1`.
 */
export async function finalizeOttoRun({
  ownerId,
  threadId,
  isNew,
  priorOttoState,
  result,
  seqAfterUser,
}: {
  ownerId: string;
  threadId: string;
  isNew: boolean;
  priorOttoState: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  seqAfterUser: number;
}): Promise<FinalizeOttoRunResult> {
  const newOttoState = result.state.toString() as string;
  let seq = seqAfterUser;

  // Handle interruption (generate tool parked for approval)
  if (Array.isArray(result.interruptions) && result.interruptions.length > 0) {
    const pendingCardIds: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // CAS: only write paused ottoState if no concurrent turn moved it (existing thread only)
    if (!isNew) {
      const { count: casCount } = await prisma.chatThread.updateMany({
        where: { id: threadId, ownerId, ottoState: priorOttoState },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      });
      if (casCount === 0) return { status: "stale" };
    } else {
      await prisma.chatThread.update({
        where: { id: threadId },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      });
    }

    // CAS won (or new thread) — persist any assistant text produced before the interruption
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

    return { status: "needs_approval", pendingCardIds };
  }

  // Completed — persist Otto's final reply + ottoState
  const replyText = extractText(result);

  if (!isNew) {
    // CAS: only write if no concurrent turn moved the state on
    const { count: casCount } = await prisma.chatThread.updateMany({
      where: { id: threadId, ownerId, ottoState: priorOttoState },
      data: { ottoState: newOttoState, updatedAt: new Date() },
    });
    if (casCount === 0) return { status: "stale" };
    await prisma.chatMessage.create({
      data: {
        id: newId(),
        threadId,
        ownerId,
        role: "AGENT",
        kind: "TEXT",
        seq: ++seq,
        text: replyText,
      },
    });
  } else {
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
  }

  return { status: "done", reply: replyText };
}

// ---------------------------------------------------------------------------
// ottoTurn — the main server action
// ---------------------------------------------------------------------------

export async function ottoTurn(raw: unknown): Promise<
  | { threadId: string; status: "done"; reply: string }
  | { threadId: string; status: "needs_approval"; pendingCardIds: string[] }
  | { threadId: string; status: "degraded" }
  | { threadId: string; status: "stale" }
  | { error: string }
> {
  const parsed = coworkTurnRequest.safeParse(raw);
  if (!parsed.success) return { error: "Say what you'd like to make." };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
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
    const ctx = await buildOttoContext({ ownerId, projectId, threadId, sourceGenerationId: validSource, simpleMode: parsed.data.simple });

    // Goal-intent seeding: on a new thread with a goalKey, append the preset's opening
    // to brandContext so buildContextSystemMessage injects it as a system message.
    if (isNew && parsed.data.goalKey && isGoalKey(parsed.data.goalKey)) {
      ctx.brandContext = [ctx.brandContext, `Goal for this conversation: ${GOAL_PRESETS[parsed.data.goalKey].opening}`]
        .filter(Boolean)
        .join("\n\n");
    }

    // Build run input: rehydrate prior state (multi-turn) or start fresh;
    // prepend a system message with brand context + available refs when present.
    const sys = buildContextSystemMessage(ctx);
    let runInput: AgentInputItem[];
    if (priorOttoState) {
      const priorState = await RunState.fromString(otto, priorOttoState);
      runInput = [...(sys ? [sys] : []), ...priorState.history, { role: "user", content: text } as AgentInputItem];
    } else {
      runInput = [...(sys ? [sys] : []), { role: "user", content: text } as AgentInputItem];
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

    // Persist the run (interruption / completed / stale) with CAS — shared with the
    // streaming route handler via finalizeOttoRun (identical behavior).
    const finalized = await finalizeOttoRun({ ownerId, threadId, isNew, priorOttoState, result, seqAfterUser: seq });
    revalidatePath("/", "layout");
    if (finalized.status === "stale") return { threadId, status: "stale" };
    if (finalized.status === "needs_approval") {
      return { threadId, status: "needs_approval", pendingCardIds: finalized.pendingCardIds };
    }
    return { threadId, status: "done", reply: finalized.reply };
  } catch (e) {
    // Log the real cause server-side: the generic client message hides it, and a swallowed
    // error here once masked an Anthropic 529 for hours. The client message stays generic.
    console.error("[ottoTurn] failed:", errSummary(e));
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
  | { ok: true; status: "stale" }
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
  if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
  const { ownerId } = gate;

  try {
    // Load thread owner-scoped (cross-tenant rejected)
    const thread = await prisma.chatThread.findFirst({
      where: { id: threadId, ownerId, deletedAt: null },
      select: { id: true, projectId: true, ottoState: true },
    });
    if (!thread) return { error: "Conversation not found." };
    if (!thread.ottoState) return { error: "Nothing to approve." };
    const priorOttoState = thread.ottoState;

    // Rehydrate the paused RunState
    const state = await RunState.fromString(otto, priorOttoState);

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

      // CAS: only write paused ottoState if no concurrent turn moved it
      const { count: casInterrupt } = await prisma.chatThread.updateMany({
        where: { id: threadId, ownerId, ottoState: priorOttoState },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      });
      if (casInterrupt === 0) { revalidatePath("/", "layout"); return { ok: true, status: "stale" }; }

      // CAS won — persist any assistant text produced before the interruption
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

      revalidatePath("/", "layout");
      return { ok: true, status: "needs_approval", pendingCardIds };
    }

    // Completed — persist Otto's reply + updated ottoState (CAS guard)
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

    const { count: casCompleted } = await prisma.chatThread.updateMany({
      where: { id: threadId, ownerId, ottoState: priorOttoState },
      data: { ottoState: newOttoState, updatedAt: new Date() },
    });
    if (casCompleted === 0) { revalidatePath("/", "layout"); return { ok: true, status: "stale" }; }
    await prisma.chatMessage.create({
      data: {
        id: newId(),
        threadId,
        ownerId,
        role: "AGENT",
        kind: "TEXT",
        seq: (seq?.seq ?? 0) + 1,
        text: replyText,
      },
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      status: "done",
      reply: replyText,
      ...(genJob ? { genJobId: genJob.id } : {}),
    };
  } catch (e) {
    console.error("[ottoApprove] failed:", errSummary(e));
    return { error: "Couldn't approve — please try again." };
  }
}

// ---------------------------------------------------------------------------
// createEmptyCoworkThread — create an empty thread shell (NO first turn, NO spend)
// so the streaming front door can stream the first message into a thread that
// already exists (the stream route's existing-thread branch then handles it:
// priorOttoState null, seq 0). Owner-scoped + project-validated, mirroring ottoTurn.
// (Task 6: founder-flagged streaming front door.)
// ---------------------------------------------------------------------------
export async function createEmptyCoworkThread(raw: unknown): Promise<{ id: string } | { error: string }> {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>).projectId !== "string" ||
    typeof (raw as Record<string, unknown>).title !== "string"
  ) {
    return { error: "Invalid request." };
  }
  const { projectId, title } = raw as { projectId: string; title: string };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  try {
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
    if (!project) return { error: "Project not found." };

    const id = newId();
    await prisma.chatThread.create({
      data: { id, ownerId, projectId, title: title.slice(0, 80) || "New campaign" },
    });
    return { id };
  } catch (e) {
    console.error("[createEmptyCoworkThread] failed:", errSummary(e));
    return { error: "Couldn't start a new conversation — please try again." };
  }
}

// ---------------------------------------------------------------------------
// deleteCoworkThread — soft-delete a conversation (owner-scoped)
// ---------------------------------------------------------------------------

export async function deleteCoworkThread(threadId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  try {
    await prisma.chatThread.updateMany({
      where: { id: threadId, ownerId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  } catch (e) {
    console.error("[deleteCoworkThread] failed:", errSummary(e));
    return { error: "Couldn't delete the conversation — please try again." };
  }
}

/**
 * POST /api/otto/stream — streaming Otto turn (Task 2).
 *
 * The streaming sibling of ottoTurn (lib/otto-actions.ts). It runs the Otto agent
 * with { stream: true } and bridges the agent's event stream to a Vercel AI SDK
 * UI-message stream (SSE). The NON-streaming concerns are mirrored verbatim:
 *   - owner gate (identity ONLY from requireOwner, never input)
 *   - project / sourceGenerationId / thread validation
 *   - USER-message persistence + thread create (FK ordering)
 *   - withLlmBudget reserve→settle metering (UNTOUCHED contract)
 *   - finalizeOttoRun CAS persistence (shared with ottoTurn; identical behavior)
 *
 * AI SDK part types used (ai@6.0.208 UIMessageChunk union — see otto-stream-bridge.ts):
 *   text:      'text-start' | 'text-delta' | 'text-end'   (shared id OTTO_TEXT_ID)
 *   reasoning: 'reasoning-start' | 'reasoning-delta' | 'reasoning-end'
 *   data:      'data-status' (live status), 'data-tool-propose' (inline card), 'data-error'
 * Response helper: createUIMessageStreamResponse({ stream }).
 *
 * MONEY-SAFETY: withLlmBudget RESERVES inside fn (inside the open SSE stream). If
 * the reserve throws InsufficientCredits, fn is NEVER called → ZERO spend. We persist
 * the typed failure beside the already-persisted USER turn, then write the same
 * 'data-error' part for the live client. On any other run failure withLlmBudget
 * refunds the whole reservation.
 * Usage is only known after the stream is fully drained, so fn drains the events,
 * awaits result.completed, THEN returns { result, usage } for settlement.
 */
import { NextRequest } from "next/server";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { prisma, InsufficientCredits } from "@fikirtive/db";
import {
  newId,
  coworkTurnRequest,
  displayCredits,
  GOAL_PRESETS,
  isGoalKey,
} from "@fikirtive/core";
import {
  otto,
  ottoInteractiveRuntime,
  runOttoTurn,
  withLlmBudget,
  run,
  MaxTurnsExceededError,
  buildUserTurn,
  sanitizeHistory,
  tryRestoreRunState,
} from "@fikirtive/otto";
import type { AgentInputItem } from "@fikirtive/otto";
import { requireOwner, resolveUserPrincipal } from "@/lib/auth-guard";
import { runAsUser } from "@fikirtive/db/principal";
import { isImpersonating } from "@/lib/better-auth/compat";
import {
  buildOttoContext,
  buildContextSystemMessage,
  finalizeOttoRun,
  validateOttoTurnReferences,
} from "@/lib/otto-actions";
import { bridgeEvent, stepEventOf, OTTO_TEXT_ID, OTTO_REASONING_ID } from "@/lib/otto-stream-bridge";
import type { OttoStatusData, OttoErrorData, OttoCostData } from "@/lib/otto-stream-bridge";
import { persistStreamTurnError, streamTurnErrorId, streamTurnErrorText } from "@/lib/otto-stream-errors";

/** Safe one-line error summary for logs (mirrors otto-actions.errSummary). */
function errSummary(e: unknown): string {
  if (!e || typeof e !== "object") return String(e);
  const x = e as { name?: unknown; message?: unknown; statusCode?: unknown };
  return [x.name, x.message, x.statusCode != null ? `status=${x.statusCode}` : null]
    .filter(Boolean)
    .join(" | ") || String(e);
}

/** What this turn actually cost, in DISPLAYED credits, read from the ledger after the turn
 *  settled (#555 — the merchant used to be charged for every turn with no number anywhere).
 *
 *  READ-ONLY: it sums the turn's own ledger rows (RESERVE + SETTLE/REFUND for this refId) and
 *  reports the net. It never reserves, settles, refunds, or changes any amount — withLlmBudget
 *  has already committed the money by the time this runs. A zero or negative net means the
 *  merchant was not charged (a free/mock turn, or a failure that refunded the hold), and a
 *  failed read means we simply don't claim a number: returns null and the UI shows nothing
 *  rather than an amount we can't stand behind. */
async function settledTurnCost(orgId: string, refId: string): Promise<number | null> {
  try {
    const sum = await prisma.creditLedger.aggregate({
      where: { orgId, refId },
      _sum: { balanceDelta: true },
    });
    const chargedInternal = -(sum._sum.balanceDelta ?? 0);
    if (!Number.isFinite(chargedInternal) || chargedInternal <= 0) return null;
    return displayCredits(chargedInternal);
  } catch (e) {
    console.error("[otto/stream] could not read the turn cost:", { refId, error: errSummary(e) });
    return null;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  // --- Parse + validate (mirror ottoTurn) ------------------------------------
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  const parsed = coworkTurnRequest.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Say what you'd like to make." }, { status: 400 });

  // Identity ONLY from the gate, never from input.
  const gate = await requireOwner();
  if ("error" in gate) return Response.json(gate, { status: 401 });
  if (await isImpersonating()) {
    return new Response("Paused while impersonating a customer.", { status: 403 });
  }
  const { ownerId } = gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<Response> => {

    const { projectId, text, entityIds, variantSel, sourceGenerationId, sourceGenerationIds, referenceVideoGenerationId, referenceVideoGenerationIds, replyToMessageId } = parsed.data;
    const OWNED = { ownerId, deletedAt: null } as const;

    // Pre-stream setup (validation + USER persist) runs BEFORE the SSE opens so a bad
    // request returns a normal JSON error rather than a half-open stream.
    let threadId: string;
    let isNew: boolean;
    let priorOttoState: string | null = null;
    let seqAfterUser: number;
    let userMessageId: string;
    let runInput: AgentInputItem[];
    let ctx: Awaited<ReturnType<typeof buildOttoContext>>;

    try {
      // Validate the project is owned + live
      const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
      if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

      const refs = await validateOttoTurnReferences({
        ownerId,
        projectId,
        sourceGenerationId,
        sourceGenerationIds,
        referenceVideoGenerationId,
        referenceVideoGenerationIds,
      });

      // Resolve thread: new vs existing-owned-and-in-project
      isNew = !parsed.data.threadId;
      threadId = parsed.data.threadId ?? newId();

      if (!isNew) {
        const t = await prisma.chatThread.findFirst({
          where: { id: threadId, ...OWNED },
          select: { projectId: true, ottoState: true },
        });
        if (!t || t.projectId !== projectId) return Response.json({ error: "Conversation not found." }, { status: 404 });
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
      userMessageId = newId();
      await prisma.chatMessage.create({
        data: {
          id: userMessageId,
          threadId,
          ownerId,
          role: "USER",
          kind: "TEXT",
          seq: ++seq,
          text,
          payload: { entityIds, variantSel, sourceGenerationIds: refs.sourceGenerationIds, referenceVideoGenerationIds: refs.referenceVideoGenerationIds },
          replyToMessageId: validReplyId,
        },
      });
      seqAfterUser = seq;

      // Build context (mirror ottoTurn)
      ctx = await buildOttoContext({
        ownerId,
        projectId,
        threadId,
        sourceGenerationIds: refs.sourceGenerationIds,
        referenceVideoGenerationIds: refs.referenceVideoGenerationIds,
        simpleMode: parsed.data.simple,
      });

      // Goal-intent seeding on a new thread with a goalKey
      if (!priorOttoState && parsed.data.goalKey && isGoalKey(parsed.data.goalKey)) {
        ctx.brandContext = [ctx.brandContext, `Goal for this conversation: ${GOAL_PRESETS[parsed.data.goalKey].opening}`]
          .filter(Boolean)
          .join("\n\n");
      }

      // Build run input: system message + (prior history | fresh) + user message
      const sys = buildContextSystemMessage(ctx);
      const userTurn = buildUserTurn(text, ctx.images);
      const priorState = priorOttoState ? await tryRestoreRunState(otto, priorOttoState) : null;
      if (priorState) {
        runInput = [...(sys ? [sys] : []), ...sanitizeHistory(priorState.history), userTurn];
      } else {
        // No prior state OR an unrestorable one (F24): start fresh — the turn still runs and its
        // normal state write self-heals ottoState to the current schema.
        runInput = [...(sys ? [sys] : []), userTurn];
      }
    } catch (e) {
      console.error("[otto/stream] setup failed:", errSummary(e));
      return Response.json({ error: "Couldn't reach Otto — please try again." }, { status: 500 });
    }

    // Key the reservation off the UNIQUE user-message id, not threadId:seq — seq is
    // read-max-then-insert with a non-unique index, so a concurrent turn could collide the
    // `otto-stream:threadId:seq` refId and the second reserveCredits would no-op (F27).
    const refId = `otto-stream:${userMessageId}`;

    // --- Open the UI-message stream and run the agent inside it -----------------
    const stream = createUIMessageStream({
      // Default onError masks server details; we surface a generic message to the client.
      onError: () => "Otto hit a snag — please try again.",
      execute: async ({ writer }) => {
        // Lazily open text/reasoning parts so we only frame what actually streams.
        let textOpen = false;
        let reasoningOpen = false;
        // #498: sticky per-turn flag — true once ANY model text-delta reached the
        // client. The synthesized fallback below keys off this, not off what the
        // post-run extraction saw, so fallback text can never render on top of
        // text the merchant already watched stream in.
        let textWasStreamed = false;
        const openText = () => { if (!textOpen) { writer.write({ type: "text-start", id: OTTO_TEXT_ID }); textOpen = true; } };
        const openReasoning = () => { if (!reasoningOpen) { writer.write({ type: "reasoning-start", id: OTTO_REASONING_ID }); reasoningOpen = true; } };
        const closeOpenParts = () => {
          if (textOpen) writer.write({ type: "text-end", id: OTTO_TEXT_ID });
          if (reasoningOpen) writer.write({ type: "reasoning-end", id: OTTO_REASONING_ID });
          textOpen = false;
          reasoningOpen = false;
        };

        // #555: report what THIS turn cost, once the ledger has settled it. Called on every
        // path that can leave a charge behind — including the MaxTurns degrade, which really
        // does bill the tokens it burned (round-1 review P2). Emits nothing when the net is
        // zero (a refunded failure) or unreadable, so the line never claims a phantom charge.
        const emitTurnCost = async () => {
          const credits = await settledTurnCost(ownerId, refId);
          if (credits !== null) {
            writer.write({ type: "data-cost", data: { credits } satisfies OttoCostData });
          }
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let agentResult: any;
        try {
          agentResult = await runOttoTurn(
            {
              orgId: ownerId,
              refId,
              input: runInput,
              stream: true,
              onStream: async (r) => {
                // stream:true → StreamedRunResult: AsyncIterable over RunStreamEvent.
                for await (const event of r) {
                  // Live step-trace narration (display-only): emit a data-step for each
                  // labelled tool boundary. Computed BEFORE the bridgeEvent `continue` so
                  // tool events that carry no other part still narrate. No spend impact.
                  const step = stepEventOf(event);
                  if (step) writer.write({ type: "data-step", data: step });

                  const part = bridgeEvent(event);
                  if (!part) continue;
                  if (part.type === "text-delta") {
                    openText();
                    // #498 round-4: only a NON-whitespace delta counts as "the merchant
                    // saw text". Some models emit a lone "\n" (or spaces) before parking;
                    // a whitespace-only stream shows nothing readable and must not
                    // suppress the synthesized fallback below.
                    if (part.delta.trim().length > 0) textWasStreamed = true;
                  }
                  else if (part.type === "reasoning-delta") openReasoning();
                  writer.write(part);
                }
              },
            },
            ctx,
            ottoInteractiveRuntime,
            { meter: withLlmBudget, runAgent: run, maxTurnsExceededError: MaxTurnsExceededError },
          );
        } catch (e) {
          // Reserve failed (InsufficientCredits): fn NEVER ran → ZERO spend. Persist the
          // exact typed failure so first-turn navigation/remount and refresh stay honest.
          if (e instanceof InsufficientCredits) {
            closeOpenParts();
            const error = { kind: "insufficient_credits", text: "You're out of credits." } satisfies OttoErrorData;
            try {
              await persistStreamTurnError({ ownerId, threadId, seqAfterUser, userMessageId, refId, error });
            } catch (persistError) {
              console.error("[otto/stream] failed to persist insufficient-credits TURN_ERROR:", {
                threadId,
                userMessageId,
                error: errSummary(persistError),
              });
            }
            writer.write({ type: "data-error", data: error });
            return;
          }
          // MaxTurns: withLlmBudget already settled actual usage (or refunded). Persist the
          // friendly degrade message (parity with ottoTurn) and surface a status part.
          if (e instanceof MaxTurnsExceededError) {
            closeOpenParts();
            const degradeText = "I got a bit tangled up — try asking again.";
            // Tools may have persisted cards mid-run at max(seq)+1 — the pre-run
            // seqAfterUser snapshot could collide (same fix as finalizeOttoRun).
            const lastMsg = await prisma.chatMessage.findFirst({
              where: { threadId, ownerId },
              orderBy: { seq: "desc" },
              select: { seq: true },
            });
            await prisma.chatMessage.create({
              data: { id: newId(), threadId, ownerId, role: "AGENT", kind: "TEXT", seq: Math.max(seqAfterUser, lastMsg?.seq ?? 0) + 1, text: degradeText },
            });
            // A tangled run still burned tokens and withLlmBudget already settled them —
            // the merchant paid for this turn, so it must show a cost like any other.
            await emitTurnCost();
            writer.write({ type: "data-status", data: { kind: "degraded", text: degradeText } satisfies OttoStatusData });
            return;
          }
          // Any other run failure: withLlmBudget refunded the reservation. Persist a
          // durable TURN_ERROR so reloads do not erase the failure, and give support
          // a safe reference id without exposing provider details.
          const errorId = streamTurnErrorId();
          const text = streamTurnErrorText(errorId);
          const error = { kind: "error", text } satisfies OttoErrorData;
          console.error("[otto/stream] run failed:", {
            errorId,
            threadId,
            userMessageId,
            refId,
            error: errSummary(e),
          });
          closeOpenParts();
          try {
            await persistStreamTurnError({ ownerId, threadId, seqAfterUser, userMessageId, refId, errorId, error });
          } catch (persistError) {
            console.error("[otto/stream] failed to persist TURN_ERROR:", { errorId, error: errSummary(persistError) });
          }
          // Normally the whole reservation was refunded here (net 0 → nothing is shown), but
          // a provider error that still reported usage settles a real charge — report it.
          await emitTurnCost();
          writer.write({ type: "data-error", data: error });
          return;
        }

        // Close any open text/reasoning parts before the final data parts.
        closeOpenParts();

        // The turn has settled by now (withLlmBudget settles before runOttoTurn returns), so
        // the ledger already knows what it cost. Say so in the conversation instead of leaving
        // the merchant to discover the charge in a moving balance.
        await emitTurnCost();

        // Persist the run (interruption / completed / stale) with the SAME CAS as ottoTurn.
        // userText picks the #498 fallback receipt's language (copy only).
        const finalized = await finalizeOttoRun({ ownerId, threadId, isNew, priorOttoState, result: agentResult, seqAfterUser, userText: text });

        if (finalized.status === "stale") {
          writer.write({ type: "data-status", data: { kind: "stale", text: "This conversation moved on — reload to continue." } satisfies OttoStatusData });
        } else if (finalized.status === "needs_approval") {
          // #498: a paused run must never be silent. When the model parked the gated
          // call(s) without narrating (the verbal-approval path), finalizeOttoRun
          // persisted a synthesized reply and returns it here — surface it live too.
          // `!textWasStreamed` makes "never renders twice" a checked invariant, not an
          // assumption: even if the post-run text extraction missed streamed text and
          // set fallbackReply anyway, nothing is written on top of what already streamed.
          if (finalized.fallbackReply && !textWasStreamed) {
            writer.write({ type: "text-start", id: OTTO_TEXT_ID });
            writer.write({ type: "text-delta", delta: finalized.fallbackReply, id: OTTO_TEXT_ID });
            writer.write({ type: "text-end", id: OTTO_TEXT_ID });
          }
          writer.write({ type: "data-status", data: { kind: "needs_approval", pendingCardIds: finalized.pendingCardIds } satisfies OttoStatusData });
        } else {
          writer.write({ type: "data-status", data: { kind: "done", threadId } satisfies OttoStatusData });
        }
      },
    });

    return createUIMessageStreamResponse({ stream });
  });
}

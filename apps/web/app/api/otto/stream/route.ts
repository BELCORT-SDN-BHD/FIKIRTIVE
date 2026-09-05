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
import { prisma, InsufficientCredits, SpendCapBlocked } from "@fikirtive/db";
import {
  newId,
  coworkTurnRequest,
  createProviderNameFilter,
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
  // ENGINE-A6 (spec §7.2④): the pair-aware history trim; the fold that follows it lives in
  // the engine (runtime.ts) and rides this turn's own reserve.
  trimHistoryToBudget,
  tryRestoreRunState,
} from "@fikirtive/otto";
import type { AgentInputItem, OttoRollingSummaryPort } from "@fikirtive/otto";
import { requireOwner, resolveUserPrincipal } from "@/lib/auth-guard";
import { runAsUser } from "@fikirtive/db/principal";
import { isImpersonating } from "@/lib/better-auth/compat";
import {
  buildOttoContext,
  buildContextSystemMessage,
  finalizeOttoRun,
  validateOttoTurnReferences,
  unavailableReferenceMessage,
  // ENGINE-A2 (spec §7.2②): the one turn-trace writer, shared with ottoTurn / ottoApprove.
  recordOttoTurnTrace,
  // ENGINE-A6 (spec §7.2④): the one rolling-summary writer, shared with ottoTurn — so the
  // tenant constraint on that write has a single place to be守.
  saveRollingSummary,
} from "@/lib/otto-actions";
import { bridgeEvent, stepEventOf, OTTO_TEXT_ID, OTTO_REASONING_ID } from "@/lib/otto-stream-bridge";
import type { OttoStatusData, OttoErrorData, OttoCostData } from "@/lib/otto-stream-bridge";
import { persistStreamTurnError, streamTurnErrorId, streamTurnErrorText } from "@/lib/otto-stream-errors";
import { ottoFailureMessage } from "@/lib/otto-error-copy";
import { newThreadTitle } from "@/lib/otto-canned-starters";
import { DEFAULT_THREAD_SURFACE } from "@/lib/otto-thread-surface";
import { consumeOttoTurnGate, OTTO_TURN_RATE_LIMIT_MESSAGE } from "@/lib/rate-limit-gates";

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
 *  READ-ONLY: it reads the turn's own ledger rows and reports their net. It never reserves,
 *  settles, refunds, or changes any amount — withLlmBudget has already committed the money by
 *  the time this runs.
 *
 *  A FINALIZER ROW IS REQUIRED (round-2 review P1③). An outstanding RESERVE with no SETTLE or
 *  REFUND is a hold, not a cost: its amount is the worst-case turn budget, so showing it would
 *  quote the merchant a number they were never charged. That is not hypothetical — if the
 *  settle transaction itself fails, the run throws and the route takes its generic-error path
 *  with a bare RESERVE still on the ledger. So: no finalizer → no number.
 *
 *  Returns null (and the UI shows nothing) whenever we cannot stand behind a figure: no
 *  finalizer yet, a non-positive net (a free/mock turn, or a failure that refunded the hold),
 *  or a failed read. */
async function settledTurnCost(orgId: string, refId: string): Promise<number | null> {
  try {
    const rows = await prisma.creditLedger.findMany({
      where: { orgId, refId },
      select: { kind: true, balanceDelta: true },
    });
    const finalized = rows.some((row) => row.kind === "SETTLE" || row.kind === "REFUND");
    if (!finalized) return null;
    const chargedInternal = -rows.reduce((sum, row) => sum + row.balanceDelta, 0);
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
  // The conversation gate, per tenant, per hour (2026-08-18). Credits bound what a turn can
  // SPEND — the reserve does that, and fails closed on its own — but nothing bounds how many
  // turns a stuck client can START, and each one is a real model call. Placed after the owner is
  // known and BEFORE the USER message is persisted or the stream opens, so a refusal writes
  // nothing and runs nothing. See OTTO_TURN_PER_TENANT_PER_HOUR: a bound on volume, never a price.
  if (!(await consumeOttoTurnGate(ownerId))) {
    return Response.json({ error: OTTO_TURN_RATE_LIMIT_MESSAGE }, { status: 429 });
  }
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<Response> => {

    const { projectId, text, entityIds, variantSel, sourceGenerationId, sourceGenerationIds, referenceVideoGenerationId, referenceVideoGenerationIds, replyToMessageId, surface, subjectRef, outletId } = parsed.data;
    const OWNED = { ownerId, deletedAt: null } as const;

    // Pre-stream setup (validation + USER persist) runs BEFORE the SSE opens so a bad
    // request returns a normal JSON error rather than a half-open stream.
    let threadId: string;
    let isNew: boolean;
    let priorOttoState: string | null = null;
    // ENGINE-A6 —— 这条对话此前折叠掉的旧轮。每一轮都回注,不只是发生裁剪的那一轮。
    let priorRollingSummary: string | null = null;
    let rollingSummaryPort: OttoRollingSummaryPort | undefined;
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
      // Codex QA-CRE-FE9-013 —— **静默丢弃到此为止**。挂上来的引用有一件取不到,这一轮就
      // 整轮不发:不建对话、不落 USER 消息、不开 SSE、不进 Otto、不铸卡、不预扣。它是一个
      // 普通的 JSON 400(在流打开之前),所以 composer 拿到的是一句可读的错误而不是半开的流,
      // 草稿与那几个附件都留在原地。上一版把取不到的滤成空数组继续跑,于是 Otto 按「没有产品
      // 参考」的前提铸卡、商家为一张不含指定产品的素材付了钱。
      if (refs.unavailable.length > 0) {
        return Response.json({ error: unavailableReferenceMessage(refs.unavailable) }, { status: 400 });
      }

      // Resolve thread: new vs existing-owned-and-in-project
      isNew = !parsed.data.threadId;
      threadId = parsed.data.threadId ?? newId();

      if (!isNew) {
        const t = await prisma.chatThread.findFirst({
          where: { id: threadId, ...OWNED },
          select: { projectId: true, ottoState: true, rollingSummary: true },
        });
        if (!t || t.projectId !== projectId) return Response.json({ error: "Conversation not found." }, { status: 404 });
        priorOttoState = t.ottoState;
        priorRollingSummary = t.rollingSummary;
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
      // #979:与 ottoTurn 同一条规矩、同一个函数 —— 产品自己写好的起手 chip 不算商家的
      // 命名(两个门都建对话,只在一个门上装守卫就等于没装)。
      //
      // FRONT-A14(判官 P2-2):这一扇门开出来的**一定是画布对话**,所以 `surface` 写死。
      // 请求体那一格 `surface` 不参与:它是 #879 step 1 的**页面位置**(下面原样写进
      // ChatMessage 那一行,那个语义不动),与「这条对话从哪个门开」只是重名。#879 step 2
      // 一落地、客户端如实上报 "campaign",拿它当线程来源就会 coerce 成 canvas —— 一个
      // 靠巧合才正确的值。侧栏面板永远先走 `createEmptyCoworkThread` 建线程再发第一句,
      // 所以它一次都不会走到这里。
      //
      // 注释写在 `create(` **上面**而不是里面:#979 那道命名守卫按「`chatThread.create(`
      // 起 10 行内必须看得见 title」扫全仓,把长注释塞进 data 里会把 title 挤出那扇窗,
      // 守卫就此空转。规矩是守卫的,不是注释的。
      if (isNew) {
        await prisma.chatThread.create({
          data: { id: threadId, ownerId, projectId, title: newThreadTitle(text), surface: DEFAULT_THREAD_SURFACE },
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
          // #879 step 1: page-context pins, written as-is when the caller sent them (else
          // NULL). Identity columns (actorId, visibility) are never set from a request —
          // there is no client-facing field for them.
          surface: surface ?? null,
          subjectRef: subjectRef ?? null,
          outletId: outletId ?? null,
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
        mediaReferences: refs.mediaReferences,
        turnText: text,
        simpleMode: parsed.data.simple,
      });

      // Goal-intent seeding on a new thread with a goalKey
      if (!priorOttoState && parsed.data.goalKey && isGoalKey(parsed.data.goalKey)) {
        ctx.brandContext = [ctx.brandContext, `Goal for this conversation: ${GOAL_PRESETS[parsed.data.goalKey].opening}`]
          .filter(Boolean)
          .join("\n\n");
      }

      // Build run input: system message + (prior history | fresh) + user message
      const sys = buildContextSystemMessage(ctx, priorRollingSummary);
      const userTurn = buildUserTurn(text, ctx.images);
      const priorState = priorOttoState ? await tryRestoreRunState(otto, priorOttoState) : null;
      if (priorState) {
        // ENGINE-A6(规格 §7.2④):成对感知地裁到预算以内,裁掉的那些轮交给引擎折进
        // rollingSummary —— 沿用本轮 refId,不新开钱路。
        // 端口在**这一轮裁掉了东西、或线程上已经有摘要**时都要传:折叠仍只在有裁掉的轮时发生
        // (引擎侧 `dropped.length > 0` 那道判据一个字没动,零裁剪的一轮照旧零调用零落盘),
        // 但⑥段的装配器要靠它看见「被折走的那部分对话」,否则装载集会在裁剪之后中途缩水。
        const { kept, dropped } = trimHistoryToBudget(sanitizeHistory(priorState.history));
        if (dropped.length > 0 || priorRollingSummary) {
          rollingSummaryPort = {
            dropped,
            priorSummary: priorRollingSummary,
            save: (summary: string) => saveRollingSummary(threadId, ownerId, summary),
          };
        }
        runInput = [...(sys ? [sys] : []), ...kept, userTurn];
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
        // #791-6 白标铁律 (streaming leg): scrubbing only the PERSISTED reply would let the
        // merchant watch an engine name stream in and then vanish on reload — worse than not
        // scrubbing. This filter holds back the tail so a name split across two deltas
        // ("seed" + "ance") cannot slip out one half at a time. It emits exactly what
        // extractText persists (both call the same core redaction).
        const providerFilter = createProviderNameFilter();
        // #810 P1-2: "Otto's thinking" is merchant-readable (components/otto/parts/
        // ReasoningPart.tsx opens it on click), and the model's raw reasoning went out
        // unscrubbed — the one path where the white-label rule had nothing but a prompt
        // instruction behind it. Reasoning is its OWN byte stream, so it gets its OWN filter:
        // one shared instance would interleave two texts inside a single hold-back buffer and
        // emit each in the other's context.
        const reasoningFilter = createProviderNameFilter();
        const openText = () => { if (!textOpen) { writer.write({ type: "text-start", id: OTTO_TEXT_ID }); textOpen = true; } };
        const openReasoning = () => { if (!reasoningOpen) { writer.write({ type: "reasoning-start", id: OTTO_REASONING_ID }); reasoningOpen = true; } };
        const closeOpenParts = () => {
          if (textOpen) {
            // Release whatever the scrubber is still holding before the part closes,
            // or the tail of the reply would never render.
            const tail = providerFilter.flush();
            if (tail) writer.write({ type: "text-delta", delta: tail, id: OTTO_TEXT_ID });
            writer.write({ type: "text-end", id: OTTO_TEXT_ID });
          }
          if (reasoningOpen) {
            const tail = reasoningFilter.flush();
            if (tail) writer.write({ type: "reasoning-delta", delta: tail, id: OTTO_REASONING_ID });
            writer.write({ type: "reasoning-end", id: OTTO_REASONING_ID });
          }
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
              // ENGINE-A2(规格 docs/specs/otto-engine.md §7.2②):这一门的落盘实现。
              // 与另外两门(ottoTurn / ottoApprove)共用 recordOttoTurnTrace —— 一个写入口,
              // 所以「不记商家内容」只有一处需要守。surface/threadId 来自已认证的会话。
              trace: { surface: "stream", threadId, sink: recordOttoTurnTrace },
              // ENGINE-A6 —— 本轮裁掉的旧轮(有才传)。
              rollingSummary: rollingSummaryPort,
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
                    // suppress the synthesized fallback below. Judged on the MODEL's delta,
                    // not on what the scrubber released this tick (the scrubber holds text
                    // back for a moment, and a held delta is still text the turn produced).
                    if (part.delta.trim().length > 0) textWasStreamed = true;
                    const safe = providerFilter.push(part.delta);
                    if (safe) writer.write({ ...part, delta: safe });
                    continue;
                  }
                  if (part.type === "reasoning-delta") {
                    openReasoning();
                    // Same rule, second stream (#810 P1-2): the merchant can read this.
                    const safe = reasoningFilter.push(part.delta);
                    if (safe) writer.write({ ...part, delta: safe });
                    continue;
                  }
                  writer.write(part);
                }
              },
            },
            ctx,
            ottoInteractiveRuntime,
            { meter: withLlmBudget, runAgent: run, maxTurnsExceededError: MaxTurnsExceededError },
          );
        } catch (e) {
          // Reserve failed (InsufficientCredits, or #524 SpendCapBlocked): fn NEVER ran →
          // ZERO spend. Persist the exact typed failure so first-turn navigation/remount and
          // refresh stay honest.
          if (e instanceof InsufficientCredits || e instanceof SpendCapBlocked) {
            closeOpenParts();
            // #791-7: name the two real numbers. "You're out of credits" was usually false —
            // a turn HOLDS a fixed amount up front, so a merchant
            // with 3.9 credits who had spent nothing was told they had none, with their own
            // balance on screen contradicting it. The balance travels on the error from
            // inside the failing reserve, so it is the number the refusal was judged against.
            const error = {
              // #524 — two refusals, two exits. Out of credits → Billing; over the merchant's
              // own spend cap → Settings. One kind for both would put a Top-up link under a
              // sentence that says the limit is theirs to move.
              kind: e instanceof SpendCapBlocked ? "spend_cap" : "insufficient_credits",
              // #810 P2-2: the sentence itself now comes from the shared mapper, which
              // ottoTurn/ottoApprove call too — one refusal, one wording, every entry.
              // (The fallback is unreachable inside this `instanceof` branch; it is here so
              // the mapper has one shape at every call site.)
              text: ottoFailureMessage(e, "Couldn't reach Otto — please try again."),
            } satisfies OttoErrorData;
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

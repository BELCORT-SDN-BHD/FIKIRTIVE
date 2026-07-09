/**
 * resumeOttoAfterGen — worker auto-resume: Otto asks a plain verdict after a generation finishes.
 *
 * Called from gen.ts AFTER appendCoworkResult (both success paths). Best-effort: never throws
 * to handleGen (the gen already succeeded). At-most-once: atomically claims GenJob.ottoVerdictAt
 * before the LLM call — a redelivery or duplicate finds count=0 and returns immediately.
 *
 * MONEY invariants:
 *  - The verdict turn IS metered (LLM token cost via withLlmBudget reserve→settle) — but as a
 *    SINGLE step: it reserves maxSteps:1 (one LLM call) and runs maxTurns:1, not OTTO_MAX_STEPS.
 *  - The verdict turn NEVER spends on generation. TWO independent guards: (1) it runs the tool-less
 *    `ottoVerdict` profile, so NO tool — generate or any write/spend — can be reached at all; and
 *    (2) startGen is not injected into OttoContext either (belt-and-suspenders). The interruption/
 *    park path below is therefore defensively unreachable in production, kept only as a safety net.
 *  - A throw AFTER the claim is swallowed (best-effort). withLlmBudget refunds the reservation
 *    on throw, so no credit charge on failure.
 */
import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
// `otto` (full toolset) is used ONLY to rehydrate the prior RunState (history extraction);
// `ottoVerdict` (tool-less, single-step) is the profile the verdict turn actually runs.
import { otto, ottoVerdict, withLlmBudget, OTTO_DEFAULT_MODEL, run, MaxTurnsExceededError, mapOttoUsage, sanitizeHistory, tryRestoreRunState, extractText } from "@fikirtive/otto";
import type { OttoContext } from "@fikirtive/otto";

export async function resumeOttoAfterGen(job: {
  id: string;
  threadId: string | null;
  ownerId: string;
  projectId: string;
}): Promise<void> {
  // Guard: non-cowork gen (no thread) → nothing to resume
  if (!job.threadId) return;

  // Guard: thread must exist, be owned, and have an active Otto conversation
  const thread = await prisma.chatThread.findFirst({
    where: { id: job.threadId, ownerId: job.ownerId, deletedAt: null },
    select: { ottoState: true },
  });
  if (!thread?.ottoState) return;
  const priorOttoState = thread.ottoState;

  // At-most-once claim: atomic update where ottoVerdictAt IS NULL.
  // Redelivery or concurrent winner → count=0 → return immediately.
  // MUST claim BEFORE the LLM call.
  const { count } = await prisma.genJob.updateMany({
    where: { id: job.id, ownerId: job.ownerId, ottoVerdictAt: null },
    data: { ottoVerdictAt: new Date() },
  });
  if (count === 0) return; // already claimed or redelivery

  // From here: best-effort. A throw is swallowed — the gen already succeeded.
  try {
    // Build a worker OttoContext: no startGen injected (verdict turn must not spend). Combined with
    // the tool-less ottoVerdict profile (the `generate` tool does not exist on it), the park path
    // below is defensively unreachable — kept only as a safety net.
    const ctx: OttoContext = {
      orgId: job.ownerId,
      // Worker has no session — only job.ownerId. userId is the owner/tenant scope (= orgId),
      // NOT a distinct verified per-user id. See OttoContext.userId doc.
      userId: job.ownerId,
      projectId: job.projectId,
      threadId: job.threadId,
      disabledModels: [],
      sourceGenerationId: null,
      // startGen intentionally NOT injected
    };

    // Rehydrate prior state. The verdict turn is a best-effort follow-up ("does this look right?"),
    // so an unrestorable state (schema bump / corruption, F24) must SKIP it, not crash the worker job.
    const state = await tryRestoreRunState(otto, thread.ottoState);
    if (!state) {
      console.warn(`[otto-resume] ${job.id}: prior run state unrestorable — skipping verdict turn`);
      return;
    }

    // Inject a system message telling Otto the generation finished.
    // We append it to the existing history as a user-turn (continuation pattern). sanitizeHistory
    // strips accumulated images (F25 leg 3 — the worker previously re-sent base64 dataURLs).
    const injectionMessage = "[The generation you queued has finished. Briefly ask the user, in their language, whether it meets their expectation and if they want any changes — a natural verdict question, not a sales pitch.]";
    const runInput = [...sanitizeHistory(state.history), { role: "user" as const, content: injectionMessage }];

    // Run metered (LLM token cost only — no generation spend)
    const refId = `otto-verdict:${job.id}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let agentResult: any;

    try {
      agentResult = await withLlmBudget(
        {
          orgId: job.ownerId,
          refId,
          model: OTTO_DEFAULT_MODEL,
          paid: true,
          // Single step: the verdict is one spoken sentence. Reserve exactly one LLM call, not
          // OTTO_MAX_STEPS — smaller hold, and no false InsufficientCredits from a 10-step reserve.
          maxSteps: 1,
          usageOnError: (e) => (e instanceof MaxTurnsExceededError && (e as { state?: { usage?: unknown } }).state?.usage)
            ? mapOttoUsage((e as { state: { usage: Parameters<typeof mapOttoUsage>[0] } }).state.usage)
            : null,
        },
        async () => {
          // Tool-less ottoVerdict profile, capped at a single turn: the verdict cannot loop across
          // billed turns and cannot reach any write/spend tool. Restoration still uses `otto`.
          const r = await run(ottoVerdict, runInput, { context: ctx, maxTurns: 1 });
          return { result: r, usage: mapOttoUsage(r.state.usage) };
        },
      );
    } catch (e) {
      if (e instanceof MaxTurnsExceededError) {
        // Graceful: swallow — no verdict this time (at-most-once already claimed)
        console.warn(`[otto-resume] ${job.id}: MaxTurnsExceeded — no verdict`);
        return;
      }
      // Other errors (InsufficientCredits, etc.) — swallow (best-effort)
      console.warn(`[otto-resume] ${job.id}: withLlmBudget threw — no verdict:`, e instanceof Error ? e.message : e);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = agentResult as any;
    const newOttoState: string = result.state.toString();

    // Text extraction: shared extractText (@fikirtive/otto run-output.ts) — was a local copy until 7-14b.

    // Determine next seq
    const lastMsg = await prisma.chatMessage.findFirst({
      where: { threadId: job.threadId, ownerId: job.ownerId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    let seq = lastMsg?.seq ?? 0;

    // Handle interruption (Otto parked a generate → no startGen → will park here)
    // Persist paused state + any assistant text produced before the interruption.
    if (Array.isArray(result.interruptions) && result.interruptions.length > 0) {
      // CAS: only write if no concurrent turn moved the state on
      const { count: casCount } = await prisma.chatThread.updateMany({
        where: { id: job.threadId, ownerId: job.ownerId, ottoState: priorOttoState },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      });
      if (casCount === 0) {
        console.log(`[otto-resume] ${job.id}: CAS miss (interruption) — thread moved on, skipping`);
        return;
      }
      const assistantText = extractText(result);
      if (assistantText) {
        await prisma.chatMessage.create({
          data: {
            id: newId(),
            threadId: job.threadId,
            ownerId: job.ownerId,
            role: "AGENT",
            kind: "TEXT",
            seq: ++seq,
            text: assistantText,
          },
        });
      }
      console.log(`[otto-resume] ${job.id}: parked (generate interrupted) — persisted paused state`);
      return;
    }

    // Completed — CAS the ottoState write; only persist verdict message if we won
    const verdictText = extractText(result);
    const { count: casCount } = await prisma.chatThread.updateMany({
      where: { id: job.threadId, ownerId: job.ownerId, ottoState: priorOttoState },
      data: { ottoState: newOttoState, updatedAt: new Date() },
    });
    if (casCount === 0) {
      console.log(`[otto-resume] ${job.id}: CAS miss — thread moved on, skipping verdict`);
      return;
    }
    await prisma.chatMessage.create({
      data: {
        id: newId(),
        threadId: job.threadId,
        ownerId: job.ownerId,
        role: "AGENT",
        kind: "TEXT",
        seq: ++seq,
        text: verdictText,
      },
    });
    console.log(`[otto-resume] ${job.id}: verdict persisted`);
  } catch (e) {
    // Best-effort: never throw to handleGen
    console.warn(`[otto-resume] ${job.id}: verdict failed (non-fatal):`, e instanceof Error ? e.message : e);
  }
}

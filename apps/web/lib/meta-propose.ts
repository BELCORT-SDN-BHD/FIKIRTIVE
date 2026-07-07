/**
 * metaPropose — web-side port implementation for proposeMetaAction skill (G7)
 *
 * Builds and persists an ACTION_CARD ChatMessage. Owner-validates every targetId
 * against fetchOwnerAdObjects, then calls buildMetaPlanCard to enrich the plan with
 * server-computed metadata (moneyClass, approval, etc.) that the LLM never touches.
 *
 * NOT "use server" — plain server module, called only from buildOttoContext port injection.
 */
import { prisma, Prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { fetchOwnerAdObjects } from "./meta-objects";
import { buildMetaPlanCard, type ProposeMetaActionInput } from "./meta-plan-card";
import { maybeAutoRun } from "./meta-write-actions";

export { type ProposeMetaActionInput };

export async function proposeMetaActionForOwner(
  ownerId: string,
  threadId: string,
  input: ProposeMetaActionInput,
): Promise<
  | { cardId: string; autoEligible: boolean; autoRan?: boolean }
  | { notConnected: true }
  | { needsReconnect: true }
  | { transientError: true }
  | { unknownTargets: string[] }
  | { invalidSteps: Array<{ targetId: string; reason: string }> }
> {
  // 1. Fetch the owner's ad objects (validates Meta connection + decrypts token server-side)
  const objectsResult = await fetchOwnerAdObjects(ownerId);
  if ("notConnected" in objectsResult) return { notConnected: true };
  if ("needsReconnect" in objectsResult) return { needsReconnect: true };
  if ("transientError" in objectsResult) return { transientError: true };
  const { objects } = objectsResult;

  // 2. Owner-validate every targetId — collect unknownTargets (do NOT persist if any)
  const knownIds = new Set(objects.map((o) => o.id));
  const unknownTargets = input.steps
    .map((s) => s.targetId)
    .filter((id) => !knownIds.has(id));
  if (unknownTargets.length > 0) return { unknownTargets };

  // 2b. MONEY-SAFETY (FIX A): a set_budget step is VALID only if BOTH the intent carries a
  //     positive dailyBudgetMinor AND the target currently HAS a positive daily budget (i.e. it
  //     is a daily-budget adset/campaign — never an ad, never a lifetime-budget object). REJECT
  //     anything else — do NOT clamp it to a money-safe budget_down that auto-zeroes the budget.
  const byId = new Map(objects.map((o) => [o.id, o] as const));
  const invalidSteps: Array<{ targetId: string; reason: string }> = [];
  for (const s of input.steps) {
    if (s.op !== "set_budget") continue;
    const amount = s.intent.dailyBudgetMinor;
    if (typeof amount !== "number" || !(amount > 0)) {
      invalidSteps.push({ targetId: s.targetId, reason: "missing-amount" });
      continue;
    }
    const obj = byId.get(s.targetId);
    const current = obj?.dailyBudgetMinor;
    if (typeof current !== "number" || !(current > 0)) {
      invalidSteps.push({ targetId: s.targetId, reason: "not-a-daily-budget-object" });
    }
  }
  if (invalidSteps.length > 0) return { invalidSteps };

  // 3. Read adsAutonomy from MetaConnection (default ASK)
  const conn = await prisma.metaConnection.findUnique({
    where: { ownerId },
    select: { adsAutonomy: true },
  });
  const mode: "ASK" | "AUTO" = conn?.adsAutonomy ?? "ASK";

  // 4. Build server-side enriched card payload (moneyClass, approval, etc. — LLM never sets these)
  const payload = buildMetaPlanCard(input, objects, mode, ownerId, new Date().toISOString());

  // 5. Persist ONE ChatMessage kind ACTION_CARD (next seq, role AGENT)
  const last = await prisma.chatMessage.findFirst({
    where: { threadId, ownerId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });

  const cardId = newId();
  await prisma.chatMessage.create({
    data: {
      id: cardId,
      threadId,
      ownerId,
      role: "AGENT",
      kind: "ACTION_CARD",
      seq: (last?.seq ?? 0) + 1,
      text: "",
      payload: payload as unknown as Prisma.InputJsonObject,
    },
  });

  // 6. AUTO path: if the card is auto-eligible, try to run it now. maybeAutoRun re-derives
  //    the authorization server-side (AUTO mode + every step money-safe) and never executes
  //    a spend step — so this is safe to call unconditionally on an autoEligible card.
  //    Guard: if the kill-switch is ON or a transient error occurs, degrade to autoRan:false
  //    (the card stays a normal pending proposal the user can approve manually). The card is
  //    already persisted above, so the proposal always survives a throw from maybeAutoRun.
  if (payload.autoEligible) {
    let autoRan = false;
    // FIX D: record the REAL auto outcome on the persisted card so the UI doesn't claim "handled
    // automatically" when the auto-run was actually refused/failed. Default to a refusal; overwrite
    // on a real run. A throw (e.g. kill-switch inside the executor) leaves the refusal outcome.
    let outcome: { ran: boolean; state?: "done" | "partial" | "failed"; reason?: string } = {
      ran: false,
      reason: "error",
    };
    try {
      const auto = await maybeAutoRun(ownerId, cardId);
      autoRan = auto.ran;
      outcome = auto.ran
        ? { ran: true, state: auto.state }
        : { ran: false, reason: auto.reason };
    } catch (err) {
      console.warn(
        `proposeMetaActionForOwner: maybeAutoRun threw (cardId=${cardId}); degrading to pending proposal.`,
        err instanceof Error ? err.message : err,
      );
    }
    // Patch the persisted card payload with autoOutcome (mirrors how consumeApproval patches it).
    // maybeAutoRun may have stamped consumedAt; re-read so we don't clobber it.
    const fresh = await prisma.chatMessage.findFirst({
      where: { id: cardId, ownerId, kind: "ACTION_CARD" },
      select: { payload: true },
    });
    const freshPayload = (fresh?.payload as object | null) ?? payload;
    await prisma.chatMessage
      .update({
        where: { id: cardId },
        data: { payload: { ...freshPayload, autoOutcome: outcome } as unknown as Prisma.InputJsonObject },
      })
      .catch((err) => {
        console.warn(`proposeMetaActionForOwner: autoOutcome patch failed (cardId=${cardId}).`, err);
      });
    return { cardId, autoEligible: true, autoRan };
  }

  return { cardId, autoEligible: payload.autoEligible };
}

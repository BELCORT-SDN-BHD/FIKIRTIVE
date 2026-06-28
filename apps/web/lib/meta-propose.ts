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
  | { unknownTargets: string[] }
> {
  // 1. Fetch the owner's ad objects (validates Meta connection + decrypts token server-side)
  const objectsResult = await fetchOwnerAdObjects(ownerId);
  if ("notConnected" in objectsResult) return { notConnected: true };
  if ("needsReconnect" in objectsResult) return { needsReconnect: true };
  const { objects } = objectsResult;

  // 2. Owner-validate every targetId — collect unknownTargets (do NOT persist if any)
  const knownIds = new Set(objects.map((o) => o.id));
  const unknownTargets = input.steps
    .map((s) => s.targetId)
    .filter((id) => !knownIds.has(id));
  if (unknownTargets.length > 0) return { unknownTargets };

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
  if (payload.autoEligible) {
    const auto = await maybeAutoRun(ownerId, cardId);
    return { cardId, autoEligible: true, autoRan: auto.ran };
  }

  return { cardId, autoEligible: payload.autoEligible };
}

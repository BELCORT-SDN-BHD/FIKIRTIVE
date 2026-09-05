/**
 * meta-card-decline — the ONE business action behind "Deny" on Otto's two Meta cards
 * (ACTION_CARD / BUILD_CARD), spec `docs/specs/frontend-baseline.md` FRONT-A12.
 *
 * Why this file exists: before it, both cards' Deny buttons only flipped a React `useState`.
 * The merchant read "Plan declined — nothing was changed", refreshed, and the card was pending
 * again — a written "no" the server never heard. That is exactly the "假成功" FRONT-A12 forbids,
 * and it is worse than a missing button: the plan stayed approvable by anyone who reopened it.
 *
 * There is exactly ONE decline implementation and both callers reach it: the merchant's click
 * arrives through `ottoReject` (the same server action the universal APPROVAL_CARD Deny already
 * used), which dispatches here by card kind. No second business layer is created.
 *
 * A decline writes, in this order:
 *   ① the frozen card payload gains `declinedAt` AND `approval.consumedAt` — the second one is
 *      what makes the refusal structural: `verifyApproval` answers "consumed", so
 *      approveMetaActionPlan / approveAdBuild refuse a declined card even if the UI is stale.
 *   ② a deterministic decline message in the conversation (no LLM, no external write).
 *   ③ an ActionEvent(approval.declined) audit row.
 * Nothing external is touched — declining a Meta plan/build creates and cancels nothing at Meta,
 * because nothing had been created yet.
 */
import "server-only";
import { prisma, Prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import type { Approval } from "./meta-approval";
import { declineTextFor, isDeclinedPayload, type MetaCardKind } from "./meta-card-decline-view";

/** How a Meta card can already be settled when a decline arrives. */
export type MetaCardResolution = "approved" | "declined" | "expired";

export type MetaCardDeclineResult =
  | { ok: true; status: "done"; reply: string }
  | { ok: true; alreadyResolved: true; resolution: MetaCardResolution }
  | { error: string };

/** The minimum a declinable card payload must carry. Both MetaActionCardPayload and
 *  MetaAdBuildCardPayload satisfy it; kept structural so this module owns no card schema. */
type DeclinablePayload = {
  approval?: Approval;
  declinedAt?: string;
  autoOutcome?: { ran?: boolean } | null;
  buildOutcome?: { built?: boolean } | null;
};

/** Did this card already run (auto or approved)? Then a decline is a lie, not a refusal. */
function alreadyRan(p: DeclinablePayload): boolean {
  return p.autoOutcome?.ran === true || p.buildOutcome?.built === true;
}

/**
 * declineMetaCard — decline an ACTION_CARD / BUILD_CARD, owner-scoped.
 *
 * `ownerId` is the caller's server-resolved principal — never a client parameter. The card is
 * loaded with `ownerId` in the WHERE clause, so another org's card is simply not found: a
 * cross-tenant decline cannot move a row, and cannot even learn the card exists.
 *
 * Idempotent: a card that is already declined / consumed / run answers `alreadyResolved` and
 * writes nothing more (no second message, no second audit row).
 */
export async function declineMetaCard(args: {
  ownerId: string;
  threadId: string;
  cardId: string;
  kind: MetaCardKind;
}): Promise<MetaCardDeclineResult> {
  const { ownerId, threadId, cardId, kind } = args;

  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, ownerId, deletedAt: null },
    select: { id: true, projectId: true },
  });
  if (!thread) return { error: "Conversation not found." };

  const message = await prisma.chatMessage.findFirst({
    where: { id: cardId, threadId, ownerId, kind, deletedAt: null },
    select: { id: true, payload: true },
  });
  if (!message || !message.payload) return { error: "That card isn't awaiting approval." };

  const payload = message.payload as unknown as DeclinablePayload;
  if (isDeclinedPayload(payload)) {
    return { ok: true, alreadyResolved: true, resolution: "declined" };
  }
  if (alreadyRan(payload) || typeof payload.approval?.consumedAt === "string") {
    return { ok: true, alreadyResolved: true, resolution: "approved" };
  }
  const expiresAt = payload.approval?.expiresAt;
  if (typeof expiresAt === "string" && Date.now() > Date.parse(expiresAt)) {
    // Honest terminal state: an expired ask was never declined, it just stopped being askable.
    // Still stamp it so the card stops offering Approve, but call it what it is.
    await stampDeclined(cardId, ownerId, payload, { expired: true });
    return { ok: true, alreadyResolved: true, resolution: "expired" };
  }

  // Read-check-write, the same discipline the approve gates use for their single-use consume
  // stamp (meta-write-actions.ts consumeApproval). It is safe here for a stronger reason than
  // there: a decline creates nothing, so the worst a lost race can do is let an approve that
  // already started finish — and that path is serialised by the MetaActionExecution unique index.
  await stampDeclined(cardId, ownerId, payload, { expired: false });

  const reply = declineTextFor(kind);
  const seqRow = await prisma.chatMessage.findFirst({
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
      seq: (seqRow?.seq ?? 0) + 1,
      text: reply,
    },
  });
  await prisma.actionEvent
    .create({
      data: {
        id: newId(),
        ownerId,
        projectId: thread.projectId,
        type: "approval.declined",
        payload: { cardId, cardKind: kind },
      },
    })
    .catch(() => {});

  return { ok: true, status: "done", reply };
}

/** Stamp the frozen payload: `declinedAt` for the UI, `approval.consumedAt` for the gate. */
async function stampDeclined(
  cardId: string,
  ownerId: string,
  payload: DeclinablePayload,
  opts: { expired: boolean },
): Promise<void> {
  const nowIso = new Date().toISOString();
  const next = {
    ...(payload as Record<string, unknown>),
    ...(opts.expired ? {} : { declinedAt: nowIso }),
    ...(payload.approval
      ? { approval: { ...payload.approval, consumedAt: payload.approval.consumedAt ?? nowIso } }
      : {}),
  };
  await prisma.chatMessage.updateMany({
    where: { id: cardId, ownerId },
    data: { payload: next as unknown as Prisma.InputJsonObject },
  });
}

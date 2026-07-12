/**
 * approval-card-settle — the human-button side of the ONE-approval-object weld (B0-29,
 * NODE-275 收口4).
 *
 * The B4 spec freezes: "skill 与人工按钮消费同一 ApprovalRequest，无第二套" — the APPROVAL_CARD
 * ChatMessage IS that request object (card-carrier equivalence). Otto's path already consumes the
 * card (ottoApprove: hash check → CAS pending→approved → resume). Before this module the HUMAN
 * Approve button only ran the server action and left the pending ask dangling; now the shared
 * approveScheduledPost action calls settlePendingApprovalCards after a successful approve, so
 * WHICHEVER surface grants consent, the same card object is settled.
 *
 * Same CAS discipline as otto-actions' consumeApprovalCard: each update pins
 * payload.status="pending" in the WHERE, so a concurrent ottoApprove and button click race
 * resolves each card exactly once (the loser's update counts 0 — idempotent).
 */
import "server-only";
import { prisma } from "@fikirtive/db";
import type { Prisma } from "@fikirtive/db";
import { asApprovalCardPayload } from "./approval-card-view";

/**
 * Settle every PENDING approval card bound to (toolName, ref) for this owner. Returns how many
 * cards were settled. Belt-and-braces: even if a settle is missed (crash between approve and
 * settle), ottoApprove's "ask gone but post approved" branch answers the stale card benignly.
 */
export async function settlePendingApprovalCards(args: {
  ownerId: string;
  toolName: string;
  ref: string;
  status: "approved" | "rejected";
}): Promise<number> {
  const pending = await prisma.chatMessage.findMany({
    where: {
      ownerId: args.ownerId,
      kind: "APPROVAL_CARD",
      deletedAt: null,
      AND: [
        { payload: { path: ["toolName"], equals: args.toolName } },
        { payload: { path: ["ref"], equals: args.ref } },
        { payload: { path: ["status"], equals: "pending" } },
      ],
    },
    select: { id: true, payload: true },
  });
  let settled = 0;
  for (const msg of pending) {
    const payload = asApprovalCardPayload(msg.payload);
    if (!payload) continue; // malformed payload: leave it; TTL expiry handles it
    const { count } = await prisma.chatMessage.updateMany({
      where: {
        id: msg.id,
        ownerId: args.ownerId,
        kind: "APPROVAL_CARD",
        AND: [{ payload: { path: ["status"], equals: "pending" } }],
      },
      data: { payload: { ...payload, status: args.status } as unknown as Prisma.InputJsonObject },
    });
    settled += count;
  }
  return settled;
}

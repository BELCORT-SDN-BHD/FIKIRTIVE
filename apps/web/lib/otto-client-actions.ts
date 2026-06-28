"use server";
/**
 * "use server" wrapper for otto-actions so client components (Cowork.tsx,
 * GenerateCard.tsx) can call ottoTurn / ottoApprove as Next.js Server Actions.
 * otto-actions.ts uses `import "server-only"` which prevents direct client import;
 * re-exports are not allowed in "use server" files, so we delegate via async wrappers.
 */
import {
  ottoTurn as _ottoTurn,
  ottoApprove as _ottoApprove,
  createEmptyCoworkThread as _createEmptyCoworkThread,
  deleteCoworkThread as _deleteCoworkThread,
} from "./otto-actions";
import { approveMetaActionPlan as _approveMetaActionPlan } from "./meta-write-actions";

export async function ottoTurn(raw: unknown) {
  return _ottoTurn(raw);
}

export async function ottoApprove(raw: unknown) {
  return _ottoApprove(raw);
}

export async function createEmptyCoworkThread(raw: unknown) {
  return _createEmptyCoworkThread(raw);
}

export async function deleteCoworkThread(threadId: string) {
  return _deleteCoworkThread(threadId);
}

/** Human-approve gate for a Meta ACTION_CARD plan (G7). The card UI calls this when the
 *  user clicks approve. requireOwner + impersonation-block + approval-binding live inside
 *  approveMetaActionPlan; this wrapper only crosses the client→server boundary. */
export async function approveMetaActionPlan(cardId: string) {
  return _approveMetaActionPlan(cardId);
}

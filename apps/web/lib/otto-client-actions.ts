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
import { approveMetaActionPlan as _approveMetaActionPlan, setAdsAutonomy as _setAdsAutonomy, setAdsWritesPaused as _setAdsWritesPaused } from "./meta-write-actions";
import { approveAdBuild as _approveAdBuild, launchAdDraft as _launchAdDraft } from "./meta-build-actions";

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

/** Human-approve gate for a Meta BUILD_CARD (G7 v2). The build card UI calls this when the
 *  user clicks approve. requireOwner + impersonation-block + kill-switch + approval-binding
 *  live inside approveAdBuild; this wrapper only crosses the client→server boundary. */
export async function approveAdBuild(cardId: string) {
  return _approveAdBuild(cardId);
}

/** Launch a built BUILD_CARD draft by creating a v1 ACTION_CARD that resumes the created
 *  campaign/adset/ad. The user then approves that ACTION_CARD via v1's spend gate. */
export async function launchAdDraft(cardId: string) {
  return _launchAdDraft(cardId);
}

/** Set the per-org autonomy mode ("ASK" | "AUTO"). Called from OttoConnections.tsx. */
export async function setAdsAutonomy(mode: "ASK" | "AUTO") {
  return _setAdsAutonomy(mode);
}

/** Toggle the kill-switch. paused=true → runApprovedPlan refuses all writes. */
export async function setAdsWritesPaused(paused: boolean) {
  return _setAdsWritesPaused(paused);
}

/**
 * approval-tools — the generalized approval matcher (B4 block spec §五 5.1·附, touchpoint ②).
 *
 * Before B4, the web ottoApprove matcher hard-filtered `toolName !== "generate"`, so any OTHER
 * approval-gated skill parked but could never be approved ("That card isn't awaiting approval.") —
 * the gate was in name only. This module generalizes it to a CLOSED SET derived from the registry:
 * exactly the skills whose `needsApproval` is machine-derived true. A new gated skill is covered
 * automatically; there is no second hand-maintained list to forget (fail-closed by construction).
 *
 * PURE (no DB/IO) so the matcher logic is unit-tested directly.
 */
import { allSkills } from "./registry.js";

/** The ONLY tool names ottoApprove / ottoReject will act on. Today: generate, approveScheduledPost,
 *  generateReferences — i.e. every registry skill with needsApproval=true. */
export const APPROVAL_TOOL_NAMES: ReadonlySet<string> = new Set(
  allSkills.filter((s) => s.needsApproval).map((s) => s.name),
);

/**
 * The binding ref for one gated tool's parked interruption — the value the client passes back as
 * `cardId` to ottoApprove/ottoReject. Per-tool because each anchors on a different argument:
 *   - generate: arguments.cardId (the pre-persisted GEN_CARD id + GenJob `cowork:` double-approve).
 *   - approveScheduledPost: arguments.scheduledPostId. This is the natural, idempotent anchor —
 *     the interruption is consumed on resume, and the underlying approveScheduledPost action is
 *     itself idempotent (re-approving a SCHEDULED post is refused by its state-machine gate), so a
 *     second approve of the same ref is a benign no-op, never a double publish (same M2 spirit as a
 *     consumed hash). The B0-29 ApprovalRequest payload-hash anchor lands with that row; this branch
 *     is safe without it.
 * Returns null for an unknown tool or a missing/blank ref.
 */
export function approvalRefOf(toolName: string, args: Record<string, unknown>): string | null {
  const pick = (k: string): string | null => {
    const v = args[k];
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  if (toolName === "generate") return pick("cardId");
  if (toolName === "approveScheduledPost") return pick("scheduledPostId");
  // generateReferences (debt-68, spend): the parked call carries no client-supplied card id, so anchor
  // the ref on the target element (entityId) — the same per-entity key startRefGen's in-flight guard
  // uses. The EXACT parked args (prompt/count/mode) are bound separately by the card's content hash
  // (readApprovalConsent → computeRefgenApprovalContentHash), so a same-entity arg-flip is caught there.
  if (toolName === "generateReferences") return pick("entityId");
  // runFactoryBatch (W-B3-F-P, spend): anchor the ref on the caller-stable batchId — the same
  // unique-by-convention (UUID guidance) id that keys the batch's per-cell idempotency
  // (batch:<batchId>:cell:<n>) and the GenerationBatch row, so the card and the spend share one
  // anchor. A batchId CAN still repeat across two parks with different content (the model may
  // reuse it; the orchestration layer only fails-closed on changed content at execute time), so
  // the EXACT parked args (mode/batchId/name/base/variants/cells) are additionally bound by the
  // card's content hash (readApprovalConsent → computeFactoryBatchApprovalContentHash) and every
  // matcher pins that hash — the same P2 ref-collision discipline as generateReferences.
  if (toolName === "runFactoryBatch") return pick("batchId");
  return null;
}

/** One approval-gated tool call parked for approval, plus its parsed arguments — the consent object
 *  the mint site binds (e.g. generateReferences hashes its exact prompt/count/mode from `args`). */
export type ApprovalInterruption = { toolName: string; ref: string; args: Record<string, unknown> };

/**
 * PURE: from a run's interruptions, return every approval-gated tool call with its binding ref.
 * Tolerant of item shape (RunResult.interruptions vs RunState.getInterruptions() items both expose
 * `.name` or `.rawItem.name` + `.arguments`). Skips non-gated tools and refless/malformed items.
 */
export function collectApprovalInterruptions(interruptions: unknown[]): ApprovalInterruption[] {
  const out: ApprovalInterruption[] = [];
  for (const value of interruptions ?? []) {
    if (!value || typeof value !== "object") continue;
    const it = value as { name?: string; rawItem?: { name?: string; arguments?: string }; arguments?: string };
    const toolName = it.name ?? it.rawItem?.name;
    if (!toolName || !APPROVAL_TOOL_NAMES.has(toolName)) continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(it.arguments ?? it.rawItem?.arguments ?? "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }
    const ref = approvalRefOf(toolName, args);
    if (ref) out.push({ toolName, ref, args });
  }
  return out;
}

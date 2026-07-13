/**
 * makeOttoRefgenPort — the ctx.refgen port factory (W-B3-G-P, debt-68/69).
 *
 * Wraps the SAME owner-gated reference-generation server actions the human element UI uses
 * (refgen-actions.startRefGen / deleteVariant). Identity is NOT threaded into the actions: each
 * re-derives the owner from the verified session via requireOwner() and is owner-scoped + fail-closed
 * on a missing/cross-owner id ("Element not found." / "Variant not found."). The ownerId parameter
 * scopes ONLY the port's own pre-gate read below.
 *
 * generate — the SPEND path (debt-68). A thin closure over startRefGen, the SOLE reference-generation
 * spend authority: it re-validates the request through the typed refGenRequest gate, derives the price
 * server-side (pricedRefgenCredits — the model can never set it), enforces the per-entity in-flight
 * guard + the RefGenJob_active_entity_variant_key race backstop, and reserves credits atomically with
 * the job insert. This port neither reserves credits, creates a RefGenJob, nor calls the provider — it
 * only forwards the request. The generateReferences skill that calls it is cost:"spend", so its
 * needsApproval is a machine-derived LITERAL true (the human approves before this runs).
 *
 * deleteVariant — the guarded $0 path (debt-69). deleteVariant soft-deletes a variant AND its tagged
 * reference images (paid outputs). The human UI deletes a variant from the element page; Otto has no
 * such surface, so the port fronts the delete with a deterministic, fail-closed active-job gate:
 * it refuses to delete a variant that still has ANY paid RefGenJob in flight (QUEUED/GENERATING) —
 * otherwise the running job would settle onto a tombstoned variant, wasting spend. There is NO
 * staleness/abandonment window here (fail-closed): a 15-minute window would be SHORTER than the
 * worker's own liveness window (REFGEN_STALE_MS 18min / queue expiry ~20min / reaper 25min), so a
 * 15-18-minute-old job that is still genuinely alive would be misjudged abandoned and let through —
 * the job then settles onto the tombstone (spend charged, product unreachable). No job blocks this
 * gate forever — materialized evidence (NODE-279⑤), worker reapStaleRefGenJobs
 * (apps/worker/src/jobs/refgen.ts:143, swept every 5min + at startup, apps/worker/src/index.ts:264-265;
 * windows REFGEN_REAP_MS = REFGEN_QUEUED_REAP_MS = 25min, refgen.ts:53-54):
 *   - stale GENERATING, no outputs (startedAt < now-25min) → FAILED + refund (refgen.ts:148-160);
 *   - stuck QUEUED, no outputs (createdAt < now-25min) whose pg-boss message is lost/dead-lettered
 *     → FAILED + refund (refgen.ts:165-181); a QUEUED job whose message is still live is skipped
 *     (F07-analog, refgen.ts:171,77-90) because pg-boss WILL deliver it — genuinely alive, so this
 *     gate refusing its delete is exactly the point (it terminates via normal settle, or its message
 *     expires to the DLQ at ~20min and the next sweep reaps it);
 *   - committed-but-stuck (outputs recorded) → resumed to DONE, not FAILED (refgen.ts:198-210).
 * Every QUEUED/GENERATING job therefore reaches a terminal state (settle, FAILED, or DONE), after
 * which this gate lets the delete proceed.
 * Fail-closed: if the count read fails, refuse (never "couldn't check, delete anyway").
 * Aligned with the makeOttoProjectsPort #271 precedent (destructive action touching paid work = Otto
 * deterministic hard-refuse, not model self-confirmation). The gate lives HERE, not inside
 * deleteVariant: the human UI's legitimate delete is untouched.
 *
 * NOT an action surface: no "use server", not *-actions — the parity scanner must not discover this
 * module (its capabilities are the manifest entries of the wrapped actions: startRefGen / deleteVariant).
 */
import { prisma } from "@fikirtive/db";
import { startRefGen, deleteVariant as deleteVariantAction } from "./refgen-actions";

export function makeOttoRefgenPort(ownerId: string) {
  return {
    // debt-68: forward to the sole spend authority. Only the four typed refGenRequest fields cross
    // (entityId/prompt/count/mode); model defaults to seedream inside the gate, price is server-owned.
    generate: (input: {
      entityId: string;
      prompt: string;
      count?: number;
      mode?: "BASE" | "REFSHEET";
    }): Promise<{ id: string } | { error: string }> =>
      startRefGen({
        entityId: input.entityId,
        prompt: input.prompt,
        count: input.count ?? 1,
        mode: input.mode ?? "REFSHEET",
      }),

    // debt-69: deterministic active-job pre-gate (see header), then delegate to the owner-scoped action.
    deleteVariant: async (variantId: string): Promise<{ ok: true } | { error: string }> => {
      let activeJobs: number;
      try {
        activeJobs = await prisma.refGenJob.count({
          where: {
            variantId,
            ownerId,
            // No updatedAt/staleness window: any live job hard-refuses regardless of age (see header).
            // A stuck job is released by the worker's reaper — reapStaleRefGenJobs, 25min windows,
            // apps/worker/src/jobs/refgen.ts:143 (evidence map in the header) — never by us.
            status: { in: ["QUEUED", "GENERATING"] },
          },
        });
      } catch {
        // Fail-closed: can't verify it's safe ⇒ refuse (never "couldn't check, delete anyway").
        return {
          error:
            "I couldn't verify that variant is safe to delete, so I won't remove it. Please try again in a moment, or delete it by hand on the element page.",
        };
      }
      if (activeJobs > 0) {
        return {
          error:
            "That variant still has a reference generation running — wait for it to finish (or cancel it) before deleting, so paid work isn't wasted.",
        };
      }
      return deleteVariantAction(variantId);
    },
  };
}

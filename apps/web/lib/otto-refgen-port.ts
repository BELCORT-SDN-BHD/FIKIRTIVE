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
 * the job then settles onto the tombstone (spend charged, product unreachable). Unlock model
 * (NODE-279⑤ materialized evidence, honest version): the Otto-side delete is hard-refused for as
 * long as the variant has ANY active job — fail-closed BY DESIGN, not a liveness guarantee. A
 * TYPICAL stuck job is released by the worker reaper, reapStaleRefGenJobs
 * (apps/worker/src/jobs/refgen.ts:143; windows REFGEN_REAP_MS = REFGEN_QUEUED_REAP_MS = 25min,
 * refgen.ts:53-54; swept every 5min + at startup, apps/worker/src/index.ts:264-265): stale
 * GENERATING / orphaned QUEUED without outputs → FAILED + refund (refgen.ts:148-160, 165-181);
 * committed-but-stuck → resumed to DONE (refgen.ts:198-210) — so the usual worst case is
 * ~25min window + one 5min sweep. EXTREME cases can extend the blockage: a persistently failing
 * pg-boss liveness read makes hasLiveRefGenMessage assume "live" every sweep and skip the QUEUED
 * reap (fail-safe, refgen.ts:85-88), and a persistently failing committed-resume just retries
 * next sweep (refgen.ts:201-209). That prolonged refusal is an ACCEPTED fail-closed posture for
 * Otto: the human UI delete path is not fronted by this gate and stays available.
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
            // No updatedAt/staleness window: any active job hard-refuses regardless of age (see
            // header). A typical stuck job is released by the worker's reaper (reapStaleRefGenJobs,
            // apps/worker/src/jobs/refgen.ts:143) — never by us; extreme reaper failure modes can
            // prolong the refusal (accepted fail-closed posture, human UI delete unaffected).
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

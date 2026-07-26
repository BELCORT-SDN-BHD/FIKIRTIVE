import { prisma } from "@fikirtive/db";
import { FOUNDER_OWNER_ID, knownDisabledSet } from "@fikirtive/core";

/** Worker-side admin-disabled model ids. EMPTY set on any DB fault — fail-closed-
 *  to-typed-menu: a config-read hiccup must never fail a legitimate already-queued
 *  job (the typed superRefine that admitted the job is the authority). This check
 *  exists ONLY to catch a job that was QUEUED before an emergency disable.
 *
 *  #463: intentionally NOT wrapped in a principal frame. ModelRegistryOverlay is platform-wide
 *  founder config (tenant-guard-exempt), and this runs INSIDE a tenant-scoped gen handler —
 *  wrapping it would either re-label platform config as tenant data or shadow the caller's
 *  scope. It reads the ambient frame it happens to run in and never widens it. Do not flag it
 *  as a missing system context. */
export async function workerDisabledModels(): Promise<Set<string>> {
  try {
    const rows = await prisma.modelRegistryOverlay.findMany({
      where: { ownerId: FOUNDER_OWNER_ID, enabled: false },
      select: { modelId: true },
    });
    return knownDisabledSet(rows.map((r) => r.modelId));
  } catch (e) {
    console.warn("[worker] workerDisabledModels DB read failed; treating nothing as disabled:", e instanceof Error ? e.message : e);
    return new Set();
  }
}

import { prisma } from "@artlio/db";
import { FOUNDER_OWNER_ID, knownDisabledSet } from "@artlio/core";

/** Worker-side admin-disabled model ids. EMPTY set on any DB fault — fail-closed-
 *  to-typed-menu: a config-read hiccup must never fail a legitimate already-queued
 *  job (the typed superRefine that admitted the job is the authority). This check
 *  exists ONLY to catch a job that was QUEUED before an emergency disable. */
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

import "server-only";
import { prisma } from "@fikirtive/db";
import { FOUNDER_OWNER_ID, knownDisabledSet } from "@fikirtive/core";

/** The set of admin-disabled model ids (overlay rows with enabled=false). Returns
 *  an EMPTY set on any DB fault — fail-closed-to-typed-menu (a config hiccup must
 *  never block a legitimate generation; the typed gate stays the authority). The
 *  read is uncached so an emergency disable propagates immediately (like the P1a
 *  runtime-config reads). */
export async function resolveDisabledModels(): Promise<Set<string>> {
  try {
    const rows = await prisma.modelRegistryOverlay.findMany({
      where: { ownerId: FOUNDER_OWNER_ID, enabled: false },
      select: { modelId: true },
    });
    return knownDisabledSet(rows.map((r) => r.modelId));
  } catch (e) {
    console.warn("resolveDisabledModels DB read failed; treating nothing as disabled:", e instanceof Error ? e.message : e);
    return new Set();
  }
}

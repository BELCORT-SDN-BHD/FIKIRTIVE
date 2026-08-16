/**
 * Pure runtime-config helpers (OPT-6 P1a). No prisma — core stays pure. The DB
 * read-through lives in apps/web/lib/runtime-config.ts; this file owns ONLY the
 * clamp (the safety primitive) for the vision caps. (The cowork_provider knob
 * and its transport/money-lock this file used to also own were removed
 * wholesale — ADR 0003, docs/adr/0003-single-provider-byteplus.md — the
 * transport switch itself had already died with the legacy cowork planner
 * actions, batch-3 7-10, with no production caller left.)
 */

export const VISION_DEFAULTS = { maxImages: 3, maxBytes: 4_000_000 } as const;
export const VISION_CEILINGS = { maxImages: 8, maxBytes: 16_000_000 } as const;

export function clampVisionInts(raw: { maxImages?: unknown; maxBytes?: unknown }): { maxImages: number; maxBytes: number } {
  const clamp = (v: unknown, def: number, max: number): number => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : def;
  };
  return {
    maxImages: clamp(raw.maxImages, VISION_DEFAULTS.maxImages, VISION_CEILINGS.maxImages),
    maxBytes: clamp(raw.maxBytes, VISION_DEFAULTS.maxBytes, VISION_CEILINGS.maxBytes),
  };
}

/** Merge a (possibly null) DB vision-config row over the env baseline. The env
 *  kill-switch (env.enabled=false) is a HARD override the DB cannot countermand;
 *  caps are clamped. Pure — the web layer supplies env (from coworkVisionConfig)
 *  and the raw DB row. */
export function mergeVisionConfig(
  env: { enabled: boolean; policy: "C"; maxImages: number; maxBytes: number },
  db: { enabled?: unknown; maxImages?: unknown; maxBytes?: unknown } | null,
): { enabled: boolean; policy: "C"; maxImages: number; maxBytes: number } {
  if (!db) return env;
  const enabled = env.enabled && db.enabled !== false;
  const { maxImages, maxBytes } = clampVisionInts({ maxImages: db.maxImages ?? env.maxImages, maxBytes: db.maxBytes ?? env.maxBytes });
  return { enabled, policy: "C", maxImages, maxBytes };
}

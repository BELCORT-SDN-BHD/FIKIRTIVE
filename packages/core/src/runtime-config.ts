/**
 * Pure runtime-config helpers (OPT-6 P1a). No prisma — core stays pure. The DB
 * read-through lives in apps/web/lib/runtime-config.ts; this file owns ONLY the
 * clamp (the safety primitive) and the env-free transport switch (one source of
 * truth for createTransport's behavior). Keep the loud-throw on a set provider
 * with a missing credential — a stray key must never silently spend.
 */
import { MockTransport, FalTransport, ModalTransport } from "./cowork-transport.js";
import type { CoworkTransport } from "./cowork.js";

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

export interface TransportConfig { provider?: string; falKey?: string; modalEndpoint?: string; modalKey?: string; }

export function createTransportFromConfig(cfg: TransportConfig): CoworkTransport {
  if (cfg.provider === "fal") {
    if (!cfg.falKey) throw new Error("COWORK_PROVIDER=fal but FAL_KEY is not set");
    return new FalTransport(cfg.falKey);
  }
  if (cfg.provider === "modal") {
    if (!cfg.modalEndpoint || !cfg.modalKey) throw new Error("COWORK_PROVIDER=modal but MODAL_LLM_ENDPOINT or MODAL_LLM_KEY is not set");
    return new ModalTransport(cfg.modalEndpoint, cfg.modalKey);
  }
  return new MockTransport();
}

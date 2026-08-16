import "server-only";
import { prisma } from "@fikirtive/db";
import { coworkVisionConfig, mergeVisionConfig } from "@fikirtive/core";

/** Config keys = a fixed code-side enum (the only writable keys). */
export const CONFIG_KEYS = { vision: "vision" } as const;

/** Raw read of one config row; null on absent OR any DB fault (fail-closed,
 *  never throws — callers fall back to env/code defaults). */
async function readConfig(key: string): Promise<Record<string, unknown> | null> {
  try {
    const row = await prisma.runtimeConfig.findUnique({ where: { key }, select: { valueJson: true } });
    return (row?.valueJson as Record<string, unknown>) ?? null;
  } catch (e) {
    console.warn(`resolveConfig(${key}) DB read failed; using env/default:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Vision config: env emergency off-switch ALWAYS wins; otherwise DB caps over
 *  env, both clamped. Empty table → exact env default (DEFAULT-ON preserved). */
export async function resolveVisionConfig(): Promise<{ enabled: boolean; policy: "C"; maxImages: number; maxBytes: number }> {
  const env = coworkVisionConfig();
  const db = await readConfig(CONFIG_KEYS.vision);
  return mergeVisionConfig(env, db);
}

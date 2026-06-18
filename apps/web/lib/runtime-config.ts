import "server-only";
import { prisma } from "@artlio/db";
import {
  coworkVisionConfig, mergeVisionConfig, createTransportFromConfig,
  MockTransport, type CoworkTransport,
} from "@artlio/core";

/** Config keys = a fixed code-side enum (the only writable keys). */
export const CONFIG_KEYS = { vision: "vision", coworkProvider: "cowork_provider" } as const;

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

/** Per-request transport: DB provider over env, built via the pure switch, with a
 *  fail-closed catch → Mock. Resolve ONCE per action and reuse the instance. */
export async function getTransport(): Promise<CoworkTransport> {
  const db = await readConfig(CONFIG_KEYS.coworkProvider);
  const provider = (typeof db?.provider === "string" ? db.provider : undefined) ?? process.env.COWORK_PROVIDER;
  try {
    return createTransportFromConfig({
      provider,
      falKey: process.env.FAL_KEY,
      modalEndpoint: process.env.MODAL_LLM_ENDPOINT,
      modalKey: process.env.MODAL_LLM_KEY,
    });
  } catch (e) {
    console.warn(`getTransport: provider=${provider} unbuildable; falling back to mock:`, e instanceof Error ? e.message : e);
    return new MockTransport();
  }
}

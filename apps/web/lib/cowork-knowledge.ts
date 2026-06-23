import "server-only";
/**
 * cowork knowledge read (Phase 0B). The per-(family × mode) directive lookup the
 * enhancePrompt skill will consume in Phase 1, plus the admin grid's list read.
 * R6: read FRESH on every call — no in-process TTL cache — so a founder edit
 * takes effect on the very next Enhance across every process. The point-read is
 * dwarfed by the paid LLM call, so freshness costs nothing.
 */
import { prisma } from "@fikirtive/db";
import { FOUNDER_OWNER_ID, modelDirectiveRules, type ModelFamily, type GenMode, type ModelDirectiveRules } from "@fikirtive/core";

/** The enhance read: the directive text ONLY when the cell exists, is enabled,
 *  and is non-empty; otherwise undefined → the skill uses its family-neutral
 *  base prompt (a missing/disabled directive never blocks Enhance). */
export async function getEnhanceDirective(family: ModelFamily, mode: GenMode): Promise<string | undefined> {
  const row = await prisma.modelDirective.findUnique({
    where: { ownerId_family_mode: { ownerId: FOUNDER_OWNER_ID, family, mode } },
    select: { directive: true, enabled: true },
  });
  if (!row || !row.enabled) return undefined;
  const d = row.directive.trim();
  return d.length ? d : undefined;
}

export type DirectiveRow = {
  family: string;
  mode: string;
  directive: string;
  rules: unknown;
  notes: string;
  confidence: string;
  enabled: boolean;
  source: string;
  updatedAt: Date;
};

/** Every founder-owned directive, for the admin grid (it fills the full
 *  family×mode matrix, leaving unseeded cells blank). */
export async function listDirectives(): Promise<DirectiveRow[]> {
  return prisma.modelDirective.findMany({
    where: { ownerId: FOUNDER_OWNER_ID },
    orderBy: [{ family: "asc" }, { mode: "asc" }],
    select: {
      family: true, mode: true, directive: true, rules: true,
      notes: true, confidence: true, enabled: true, source: true, updatedAt: true,
    },
  });
}

/** Guardian's cast-severity read (R6 fresh): the founder-tuned multi-character
 *  handling for (family, mode). undefined → no rule (Guardian won't block on
 *  multi-character; "LTX warns, Kling does not" is data, not code). */
export async function getCastRule(family: ModelFamily, mode: GenMode): Promise<"warn" | "block" | undefined> {
  const row = await prisma.modelDirective.findUnique({
    where: { ownerId_family_mode: { ownerId: FOUNDER_OWNER_ID, family, mode } },
    select: { rules: true, enabled: true },
  });
  if (!row || !row.enabled) return undefined;
  const parsed = modelDirectiveRules.safeParse(row.rules);
  return parsed.success ? parsed.data.castSeverity : undefined;
}

/** All enabled cells' parsed rules, keyed family→mode — threaded to the composer
 *  so promptCoach lints offline at $0 (no per-keystroke server round-trip). */
export async function getRulesMap(): Promise<Record<string, Record<string, ModelDirectiveRules>>> {
  const rows = await prisma.modelDirective.findMany({
    where: { ownerId: FOUNDER_OWNER_ID, enabled: true },
    select: { family: true, mode: true, rules: true },
  });
  const map: Record<string, Record<string, ModelDirectiveRules>> = {};
  for (const r of rows) {
    const parsed = modelDirectiveRules.safeParse(r.rules);
    if (!parsed.success) continue;
    (map[r.family] ??= {})[r.mode] = parsed.data;
  }
  return map;
}

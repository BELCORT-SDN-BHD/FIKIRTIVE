"use server";
import { requireOwner } from "./auth-guard";
import { fetchOwnerAdPerformance } from "./meta-performance";

/** Reporting windows accepted at this boundary — the SAME set the Otto skills constrain via zod
 *  (meta-expert / meta-ad-performance / meta-insights). This action is a callable Server Action, so
 *  it must validate the preset itself; the UI/skill schemas don't protect a direct POST. */
const DATE_PRESETS = ["last_7d", "last_14d", "last_30d", "last_90d"] as const;

/** Read the session owner's per-ad performance. Single action layer: the P1b human panel
 *  and the Otto metaPerformance port both resolve to fetchOwnerAdPerformance. $0 read-only.
 *  requireOwner() returns { email, ownerId } | { error }. */
export async function getAdPerformance(datePreset: string) {
  const gate = await requireOwner();
  if ("error" in gate) return { error: gate.error };
  if (!(DATE_PRESETS as readonly string[]).includes(datePreset)) {
    return { error: "Invalid date range." };
  }
  return fetchOwnerAdPerformance(gate.ownerId, datePreset);
}

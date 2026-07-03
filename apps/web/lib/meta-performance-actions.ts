"use server";
import { requireOwner } from "./auth-guard";
import { fetchOwnerAdPerformance } from "./meta-performance";

/** Read the session owner's per-ad performance. Single action layer: the P1b human panel
 *  and the Otto metaPerformance port both resolve to fetchOwnerAdPerformance. $0 read-only.
 *  requireOwner() returns { email, ownerId } | { error }. */
export async function getAdPerformance(datePreset: string) {
  const gate = await requireOwner();
  if ("error" in gate) return { error: gate.error };
  return fetchOwnerAdPerformance(gate.ownerId, datePreset);
}

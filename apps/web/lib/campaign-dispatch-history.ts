/**
 * campaign-dispatch-history — "has this campaign plan entry already cost the merchant money?"
 *
 * ONE answer, three readers: the undo guard and the remove guard in campaign-actions, and the
 * campaign detail read that greys those buttons out before the merchant reaches for them. A
 * second hand-written copy of this rule is exactly how #744 shipped a guarded Undo next to an
 * unguarded Remove.
 *
 * A plain module (no server-action directive) so every reader can import it. It reads only; it
 * never writes, prices, or moves a credit.
 *
 * WHY IT DOES NOT ASK "WHICH PROJECTS ARE IN THIS CAMPAIGN"
 * Grouping is editable: `setCampaignGrouping` can move a project out of a campaign at any time,
 * and the generations it already paid for stay exactly where they are. Asking the CURRENT
 * grouping would therefore forget a charge the moment a merchant un-grouped its project — the
 * charge is still real, so the guard must still see it. Instead this asks the durable record:
 * `orchestrateBatch` creates the GenerationBatch row (id = the campaign+project batch id) BEFORE
 * it dispatches any cell, so every project that ever hosted this campaign's generation is
 * discoverable from batch ids alone, whatever the grouping says today.
 */
import type { PrismaClient } from "@fikirtive/db";
import {
  campaignEntryLogicalPrefix,
  campaignLegacyCellPrefixes,
  deriveCampaignBatchId,
} from "./campaign-gen-identity";

/** The subset of the client this module needs — so a transaction client works too. */
export type DispatchHistoryClient = Pick<PrismaClient, "project" | "generationBatch" | "genJob">;

/** Projects that ever hosted a generation batch for this campaign, grouped or not. */
async function projectsWithCampaignBatches(
  db: DispatchHistoryClient,
  ownerId: string,
  campaignId: string,
): Promise<string[]> {
  const projects = await db.project.findMany({ where: { ownerId }, select: { id: true } });
  const projectByBatchId = new Map(
    projects.map((project) => [deriveCampaignBatchId(campaignId, project.id), project.id]),
  );
  if (projectByBatchId.size === 0) return [];
  const batches = await db.generationBatch.findMany({
    where: { ownerId, id: { in: [...projectByBatchId.keys()] } },
    select: { id: true },
  });
  return batches
    .map((batch) => projectByBatchId.get(batch.id))
    .filter((projectId): projectId is string => projectId !== undefined);
}

/**
 * Which of these plan entries have already been dispatched for generation.
 *
 * An entry counts as dispatched when a GenJob exists under its stable per-entry key, OR when the
 * batch carries pre-stable-id POSITIONAL history at all — those rows name a cell index, not an
 * entry, so "not mine" is unprovable and every entry in that batch is treated as charged.
 *
 * Errors are NOT swallowed. A read that failed is not the same answer as "nothing was charged",
 * and a guard that confuses the two hands out a refund-free rewrite of paid history (#656).
 * Callers run this inside their own transaction and translate a throw into a refusal.
 */
export async function dispatchedCampaignEntryIds(
  db: DispatchHistoryClient,
  ownerId: string,
  campaignId: string,
  entryIds: readonly string[],
): Promise<Set<string>> {
  const dispatched = new Set<string>();
  if (entryIds.length === 0) return dispatched;

  for (const projectId of await projectsWithCampaignBatches(db, ownerId, campaignId)) {
    const legacy = await db.genJob.findFirst({
      where: {
        ownerId,
        projectId,
        OR: campaignLegacyCellPrefixes(campaignId, projectId).map((prefix) => ({
          idempotencyKey: { startsWith: prefix },
        })),
      },
      select: { id: true },
    });
    if (legacy) {
      for (const entryId of entryIds) dispatched.add(entryId);
      return dispatched;
    }

    for (const entryId of entryIds) {
      if (dispatched.has(entryId)) continue;
      const job = await db.genJob.findFirst({
        where: {
          ownerId,
          projectId,
          idempotencyKey: { startsWith: campaignEntryLogicalPrefix(campaignId, projectId, entryId) },
        },
        select: { id: true },
      });
      if (job) dispatched.add(entryId);
    }
  }
  return dispatched;
}

/** Single-entry form of {@link dispatchedCampaignEntryIds}. Throws on a read failure. */
export async function campaignEntryWasDispatched(
  db: DispatchHistoryClient,
  ownerId: string,
  campaignId: string,
  entryId: string,
): Promise<boolean> {
  return (await dispatchedCampaignEntryIds(db, ownerId, campaignId, [entryId])).has(entryId);
}

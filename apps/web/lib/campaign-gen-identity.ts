/**
 * campaign-gen-identity — how a campaign plan entry is named on the paid path.
 *
 * A plain module (no server-action directive) so both readers can import it:
 *   - campaign-generation-confirm, which DISPATCHES approved entries under these identities;
 *   - campaign-actions, which must ask "has this entry already been dispatched?" before it
 *     lets a merchant undo an approval (#712).
 *
 * It derives identity only. It never reads the database, never prices anything and never moves
 * a credit — startGen remains the sole spend authority.
 */
import { createHash } from "node:crypto";
import { stableCellLogicalPrefix } from "./factory-batch";

/**
 * The batch id is DERIVED on the server from (campaignId, projectId), never supplied by the
 * client. This is a money-safety choice: every confirmation of the same campaign into the same
 * project shares one batch id. Each cell then adds its persisted entry id to its logical-key
 * derivation, making reorder/re-filter drift harmless without trusting the client.
 */
export function deriveCampaignBatchId(campaignId: string, projectId: string): string {
  return createHash("sha256")
    .update("campaign-gen-batch-v1")
    .update("\0")
    .update(campaignId)
    .update("\0")
    .update(projectId)
    .digest("hex")
    .slice(0, 32);
}

/**
 * The GenJob.idempotencyKey prefix this campaign entry dispatches under, in this project.
 * Any row whose key starts with it is a dispatch of THIS entry — i.e. work that has already
 * been through startGen's reserve.
 */
export function campaignEntryLogicalPrefix(
  campaignId: string,
  projectId: string,
  entryId: string,
): string {
  return stableCellLogicalPrefix(deriveCampaignBatchId(campaignId, projectId), entryId);
}

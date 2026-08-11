import { PUBLISHING_AVAILABLE, publishSurfaceCopy } from "@fikirtive/core/schedule-draft";

/**
 * Why the auto-publish switch cannot be turned on, in the merchant's own words.
 *
 * #851: the old sentence was "Connect Instagram or Facebook first — auto-publish unlocks once Meta
 * approves publishing." Both halves of that are a promise the product cannot keep right now — no
 * account can be connected at all, so "connect first" points at a door that does not open, and
 * "unlocks once approved" describes a sequence that is not running. While publishing is off, this
 * hint says what the rest of the publish surfaces say, from the same authority; the day publishing
 * is switched back on it returns to the connection sentence, which is true again.
 */
export const AUTO_PUBLISH_GATE_HINT = PUBLISHING_AVAILABLE
  ? "Connect Instagram or Facebook first — auto-publish unlocks once Meta approves publishing."
  : `${publishSurfaceCopy().fact} ${publishSurfaceCopy().real}`;

const META_PUBLISH_CHANNEL_IDS = new Set(["instagram", "facebook"]);

export function canAutoPublish(
  connectedChannelIds: readonly string[],
  canPublish: boolean,
): boolean {
  return canPublish && connectedChannelIds.some((id) => META_PUBLISH_CHANNEL_IDS.has(id));
}

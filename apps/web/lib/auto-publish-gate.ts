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

/**
 * What the auto-publish switch says about itself — on BOTH sides of its own gate.
 *
 * #851: this switch has two gates and only one of them was ever spoken. `workspaceCanAutoPublish`
 * is about THIS merchant's own connection; `PUBLISHING_AVAILABLE` is about whether the product can
 * send at all. Every surface used to describe the enabled branch as a working send unconditionally
 * ("Publish approved posts automatically at their time" / "Auto-publish sends them without you
 * watching"), because the only question asked was the workspace one. A workspace that did have a
 * connected account would therefore read a send promise on the same screen whose banner says
 * nothing goes out — the exact contradiction this ticket exists to remove.
 *
 * The product-wide fact outranks the workspace one: while publishing is off there is no position
 * of this switch that can honestly be described as sending, so both branches fall back to the
 * preview truth. The day PUBLISHING_AVAILABLE is flipped, the enabled branch speaks again — from
 * the same authority as the Schedule screen, the approval card and Otto, with no second wording
 * anywhere to find and edit.
 */
export function autoPublishHint(workspaceCanAutoPublish: boolean): string {
  return PUBLISHING_AVAILABLE && workspaceCanAutoPublish
    ? publishSurfaceCopy(true).why
    : AUTO_PUBLISH_GATE_HINT;
}

const META_PUBLISH_CHANNEL_IDS = new Set(["instagram", "facebook"]);

export function canAutoPublish(
  connectedChannelIds: readonly string[],
  canPublish: boolean,
): boolean {
  return canPublish && connectedChannelIds.some((id) => META_PUBLISH_CHANNEL_IDS.has(id));
}

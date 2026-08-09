/**
 * social-labels — the ONE place social publishing turns a stored machine value into the words a
 * merchant reads: which network a post goes out on, and where that post is in its life.
 *
 * #822 is #728's root cause in a second vocabulary family. CRM's messaging channel got its single
 * map; the social publishing family never got one, so the campaign detail page printed the column
 * straight — `instagram: Autumn menu` and `needs_attention · Fri 3 Oct` — while the product
 * already knew the right words in two OTHER places: `approval-card-view` kept a private
 * `{ instagram: "Instagram", facebook: "Facebook" }`, and `schedule-view.statusPill` kept its own
 * status wording for the schedule pills. Three copies of two facts, and the copy the campaign page
 * happened to have was none of them. This module is the definition; both of those read it.
 *
 * Deliberately NOT merged into crm-labels: that file is CRM's vocabulary (conversations,
 * broadcasts, consent) over CRM's tables. A post's network and a conversation's channel are
 * different facts that happen to share the column name `channel` — folding them together would
 * invite exactly the drift both files exist to stop.
 *
 * Two rules, the same two crm-labels keeps:
 *   1. no merchant-facing string is ever a raw stored token;
 *   2. nothing here invents a state — only values the product can actually store get wording.
 *
 * Pure presentation: no data access, no authority over what is true.
 */

/** Turn a stored token into ordinary words: `NEEDS_ATTENTION` → `Needs attention`. */
function humanize(token: string): string {
  const words = token.replaceAll("_", " ").trim().toLowerCase();
  return words.length === 0 ? words : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

// ── Social platform ──────────────────────────────────────────────────────────────────────────

/**
 * How each network is spelled where a merchant reads it. The stored column is a plain String and
 * the set grows without a migration (`schedule-posts` already accepts one the schema comment does
 * not mention), so an unrecognized value is humanized rather than replaced by a placeholder: a
 * network the merchant chose is still a real answer, it is just one this build has no brand
 * spelling for.
 */
const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
};

export function socialPlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? humanize(platform);
}

// ── Scheduled post status ────────────────────────────────────────────────────────────────────

/**
 * The seven states `ScheduledPost.status` can hold. `NEEDS_ATTENTION` is the one that made the
 * missing map visible: lowercasing the column, which is what the campaign page did, printed
 * `needs_attention` at the merchant.
 */
const POST_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  PUBLISHING: "Publishing",
  PUBLISHED: "Published",
  NEEDS_ATTENTION: "Needs attention",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export function scheduledPostStatusLabel(status: string): string {
  return POST_STATUS_LABELS[status] ?? humanize(status);
}

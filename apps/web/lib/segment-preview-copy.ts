/**
 * Pure presentation copy for the CRM segment preview (#496 display honesty).
 *
 * A merchant-reported (asserted) opt-out carries no verified evidence, so it never joins
 * the verified exclusion count and never changes selection or send semantics. These
 * helpers only make that split visible: verified opt-outs are excluded, reported
 * opt-outs stay included and are always labeled as unverified.
 */

export type SegmentPreviewCounts = {
  matchedCount: number;
  contactableCount: number;
  knownOptOutCount: number;
  assertedOptOutCount: number;
};

export type SegmentContactStatus = {
  label: string;
  variant: "success" | "warning";
};

/** Verified facts line: matches, contactable estimate, and verified opt-out exclusions. */
export function segmentCountsLine(counts: SegmentPreviewCounts): string {
  return `${counts.matchedCount} matched · ${counts.contactableCount} contactable · ${counts.knownOptOutCount} verified opt-out excluded`;
}

/** Reported (asserted) opt-outs are shown separately and are never counted as excluded. */
export function reportedOptOutLine(counts: SegmentPreviewCounts): string {
  return `${counts.assertedOptOutCount} reported opt-out (unverified, still included)`;
}

/**
 * Per-row status. A verified opt-out always wins the label; a reported opt-out only
 * annotates a row that stays included.
 */
export function contactStatusBadge(contact: {
  contactable: boolean;
  assertedOptOut: boolean;
}): SegmentContactStatus {
  if (!contact.contactable) return { label: "Verified opt-out excluded", variant: "warning" };
  if (contact.assertedOptOut) {
    return { label: "Included · reported opt-out (unverified)", variant: "warning" };
  }
  return { label: "Included", variant: "success" };
}

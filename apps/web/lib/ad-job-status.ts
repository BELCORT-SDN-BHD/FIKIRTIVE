export type AdJobStatus = "processing" | "failed";

/** Which Otto jobs appear as STATUS CARDS in Library → Ads, and how.
 *
 *  CANCELLED answers null, so a job the merchant stopped shows no card at all (#602 T3). That is
 *  the right answer here: the list exists to surface work that is still running or that went
 *  wrong, and a cancel is neither — the merchant made the decision and the thread already carries
 *  "Cancelled — you weren't charged." While cancelling wrote FAILED, that same job appeared here
 *  as a red "Didn't go through" card with a "Retry with Otto" button, apologising for something
 *  they chose. `getMyAdJobs` does not query CANCELLED rows either, so this is belt and braces. */
export function adJobStatusFromGenStatus(s: string): AdJobStatus | null {
  if (s === "QUEUED" || s === "GENERATING") return "processing";
  if (s === "FAILED") return "failed";
  return null; // DONE / CANCELLED: finished media tiles, or nothing at all
}

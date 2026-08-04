export type ThreadBadge = "working" | "failed" | "done" | null;

/** Map a thread's latest GenJob status to a nav badge.
 *
 *  CANCELLED gets NO badge, on purpose (#602 T3): the rail's badges are for things that happened
 *  to a merchant's work, and a job they stopped themselves is not news to them. It must certainly
 *  not be the red "failed" badge — which is exactly what it was while cancelling wrote FAILED. */
export function threadBadgeFromJobStatus(status: string | null | undefined): ThreadBadge {
  if (status === "QUEUED" || status === "GENERATING") return "working";
  if (status === "FAILED") return "failed";
  if (status === "DONE") return "done";
  return null;
}

export type ThreadBadge = "working" | "failed" | "done" | null;

/** Map a thread's latest GenJob status to a nav badge. */
export function threadBadgeFromJobStatus(status: string | null | undefined): ThreadBadge {
  if (status === "QUEUED" || status === "GENERATING") return "working";
  if (status === "FAILED") return "failed";
  if (status === "DONE") return "done";
  return null;
}

export type AdJobStatus = "processing" | "failed";

export function adJobStatusFromGenStatus(s: string): AdJobStatus | null {
  if (s === "QUEUED" || s === "GENERATING") return "processing";
  if (s === "FAILED") return "failed";
  return null; // DONE etc. show as finished media tiles, not job cards
}

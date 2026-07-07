/**
 * run-output — extract the plain-text output of a completed/interrupted Otto run.
 *
 * THE single source for post-run text extraction (batch-3 7-14b unified three
 * byte-identical copies: web ottoTurn/finalizeOttoRun, web ottoApprove, worker
 * otto-resume). Pure — no DB, no SDK import; callers pass the RunResult-shaped
 * object. Prefers `finalOutput` when present, else concatenates the
 * message_output_item output_text chunks from `newItems`.
 */
/** Extract plain-text output from a RunResult's newItems (best-effort). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractText(r: any): string {
  if (r.finalOutput != null) return String(r.finalOutput);
  return (Array.isArray(r.newItems) ? (r.newItems as any[]) : [])
    .filter((it: any) => it.type === "message_output_item")
    .map((it: any) => {
      const content: any[] = it?.rawItem?.content ?? [];
      return content
        .filter((c: any) => c.type === "output_text")
        .map((c: any) => c.text ?? "")
        .join("");
    })
    .join("");
}

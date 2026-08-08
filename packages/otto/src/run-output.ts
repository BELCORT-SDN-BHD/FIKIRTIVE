/**
 * run-output — extract the plain-text output of a completed/interrupted Otto run.
 *
 * THE single source for post-run text extraction (batch-3 7-14b unified three
 * byte-identical copies: web ottoTurn/finalizeOttoRun, web ottoApprove). Pure —
 * no DB, no SDK import; callers pass the RunResult-shaped
 * object. Prefers `finalOutput` when present, else concatenates the
 * message_output_item output_text chunks from `newItems`.
 *
 * #791-6 白标铁律: the extracted text is also PROVIDER-SCRUBBED here, because this is the
 * one place every merchant-visible Otto reply passes through before it is persisted
 * (finalizeOttoRun, ottoApprove). Otto knows the engine names — its own prompt skills are
 * named after them — so "never say the provider" cannot rest on the prompt alone.
 *
 * #498 P2a: the result is TRIMMED — a whitespace-only model output IS no output.
 * Every "did the model say anything?" decision downstream (finalizeOttoRun's
 * fallback receipt, ottoApprove's chained receipt) keys off
 * this one extraction, so trimming here keeps blank narration from suppressing
 * the never-silent fallbacks without duplicating a trim at each decision site.
 */
import { redactProviderNames } from "@fikirtive/core";

/** Extract plain-text output from a RunResult's newItems (best-effort, trimmed, scrubbed). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractText(r: any): string {
  if (r.finalOutput != null) return redactProviderNames(String(r.finalOutput).trim());
  return redactProviderNames((Array.isArray(r.newItems) ? (r.newItems as any[]) : [])
    .filter((it: any) => it.type === "message_output_item")
    .map((it: any) => {
      const content: any[] = it?.rawItem?.content ?? [];
      return content
        .filter((c: any) => c.type === "output_text")
        .map((c: any) => c.text ?? "")
        .join("");
    })
    .join("")
    .trim());
}

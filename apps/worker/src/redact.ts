/**
 * Error sanitizers for anything that gets PERSISTED to a job's `error` column —
 * those strings surface verbatim in the admin UI (/admin/system, /admin/audit).
 *
 * The leak we close: a failed ffmpeg/whisper subprocess error (execa) leads with
 * the full escaped command line, and that argv contains `-i <presigned R2 URL>`
 * carrying a live X-Amz download signature for owner media. Persisting/rendering
 * it exposes a working download credential + internal storage paths. storage.ts's
 * `ffmpegInput()` even documents the invariant: "Worker-only — never log argv
 * containing this URL." Full detail still goes to console.error (server logs only).
 */

// #791-6: the provider-name pattern lives in @fikirtive/core so Otto's reply path scrubs with
// the SAME definition this error path does. Imported (not just re-exported) because
// sanitizeError below calls it; re-exported because this module's callers and tests have
// always reached it through redact.ts.
import { redactProviderNames } from "@fikirtive/core";

export { redactProviderNames };

const URL_RE = /https?:\/\/[^\s'"`]+/gi;

/** Redact signed media URLs (incl. their X-Amz signature query) from a console/log line. */
export function scrubUrls(s: string): string {
  return s.replace(URL_RE, "<redacted-url>");
}

/**
 * Build a safe error string for PERSISTENCE/UI. Never contains argv, signed URLs,
 * or signatures. An execa subprocess error collapses to a structured exit summary
 * (its `.message` is the full command line, which the worker doesn't buffer stderr
 * for anyway). Every other error is URL-scrubbed + length-capped.
 */
export function sanitizeError(err: unknown, max = 300): string {
  if (err && typeof err === "object") {
    const e = err as { exitCode?: number; timedOut?: boolean; signal?: string };
    if (e.timedOut || typeof e.exitCode === "number" || e.signal) {
      const bits: string[] = [];
      if (e.timedOut) bits.push("timed out");
      if (typeof e.exitCode === "number") bits.push(`exit code ${e.exitCode}`);
      if (e.signal) bits.push(`signal ${e.signal}`);
      return `media subprocess failed (${bits.join(", ") || "unknown error"})`;
    }
  }
  const raw = err instanceof Error ? err.message : String(err);
  return redactProviderNames(scrubUrls(raw)).slice(0, max);
}

import "server-only";
// #791-6: the pattern used to live here AND in apps/worker/src/redact.ts, kept in step by a
// test that compared the two literals byte for byte. Both now read the ONE definition in
// @fikirtive/core, which Otto's reply path also uses — a rule enforced in three places was
// one edit away from meaning three different things.
import { redactProviderNames } from "@fikirtive/core/provider-secrecy";

export { redactProviderNames };

const URL_RE = /https?:\/\/[^\s'"`]+/gi;

/** Defense for old persisted rows as well as newly returned server-action errors. */
export function sanitizeUserError(value: unknown, max = 300): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  return redactProviderNames(raw.replace(URL_RE, "<redacted-url>")).slice(0, max);
}

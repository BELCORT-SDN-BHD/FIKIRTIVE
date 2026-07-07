import "server-only";
import { prisma } from "@fikirtive/db";

/**
 * classifyMetaGraphError — THE one classifier for a thrown Meta Graph error (F37).
 *
 * Only a REAL token failure (Meta code 190/102) reports needsReconnect — and 190
 * additionally marks the stored connection expired. Anything else (network blip,
 * Graph 5xx, rate limit — code 4/17/32 are type OAuthException too, so we branch
 * on code, not type) is transientError, so the UI offers a retry instead of a
 * redundant OAuth. Shared by every owner-scoped Meta fetcher's catch block —
 * do not fork per-file copies (batch-3 7-14a unified six drifted ones).
 */
export async function classifyMetaGraphError(
  ownerId: string,
  e: unknown,
): Promise<{ needsReconnect: true } | { transientError: true }> {
  const code = (e as { metaError?: { code?: number } })?.metaError?.code;
  if (code === 190 || code === 102) {
    if (code === 190) {
      await prisma.metaConnection.update({ where: { ownerId }, data: { status: "expired" } }).catch(() => {});
    }
    return { needsReconnect: true };
  }
  return { transientError: true };
}

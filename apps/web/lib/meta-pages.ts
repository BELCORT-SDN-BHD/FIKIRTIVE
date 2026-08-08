import { prisma } from "@fikirtive/db";
import { decryptToken } from "./token-encryption";
import { listPages } from "./meta-graph";
import { classifyMetaGraphError } from "./meta-errors";

export type MetaPage = { id: string; name: string };

/** Owner-scoped read of the owner's Facebook Pages.
 *  Plain server fn — NOT a "use server" action — so there is no IDOR surface. Token stays here. */
export async function fetchOwnerPages(
  ownerId: string,
): Promise<{ pages: MetaPage[] } | { needsReconnect: true } | { transientError: true } | { notConnected: true } | { needsPageScope: true }> {
  // #741 r5 P1: this read was outside every try/catch, so a database blip made this function THROW
  // — and each of its callers (the channel adapters, the approve path, Otto's port) is written to
  // receive one of the result shapes below, not an exception. A read we could not perform is
  // `transientError`: we did not find out. Reporting it as `notConnected` would be the ticket's
  // original lie told by the storage layer instead of the platform.
  let conn: Awaited<ReturnType<typeof prisma.metaConnection.findUnique>>;
  try {
    conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
  } catch {
    return { transientError: true };
  }
  if (!conn) return { notConnected: true };

  if (conn.canManagePages === false) return { needsPageScope: true };

  let token: string;
  try {
    token = decryptToken(conn.accessTokenEnc);
  } catch {
    return { needsReconnect: true };
  }

  try {
    const pages = await listPages(token);
    return { pages };
  } catch (e) {
    return classifyMetaGraphError(ownerId, e);
  }
}

import { prisma } from "@fikirtive/db";
import { decryptToken } from "./token-encryption";
import { listPages } from "./meta-graph";

export type MetaPage = { id: string; name: string };

/** Owner-scoped read of the owner's Facebook Pages.
 *  Plain server fn — NOT a "use server" action — so there is no IDOR surface. Token stays here. */
export async function fetchOwnerPages(
  ownerId: string,
): Promise<{ pages: MetaPage[] } | { needsReconnect: true } | { notConnected: true } | { needsPageScope: true }> {
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
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
    const code = (e as { metaError?: { code?: number } })?.metaError?.code;
    if (code === 190) {
      await prisma.metaConnection.update({ where: { ownerId }, data: { status: "expired" } }).catch(() => {});
    }
    return { needsReconnect: true };
  }
}

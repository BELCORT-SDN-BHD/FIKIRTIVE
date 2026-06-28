import { prisma } from "@fikirtive/db";
import { decryptToken } from "./token-encryption";
import { metaGraphGet, getAccountInsights, type AccountMetrics } from "./meta-graph";

export type AccountInsights = { accountId: string; name: string; metrics: AccountMetrics };

/** Owner-scoped insights for all of the owner's connected ad accounts. Plain server fn (NOT a
 *  "use server" action) — reachable only server-side, so it carries no IDOR surface. Token stays here. */
export async function fetchOwnerInsights(
  ownerId: string,
  datePreset: string,
): Promise<{ accounts: AccountInsights[] } | { needsReconnect: true } | { notConnected: true }> {
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
  if (!conn) return { notConnected: true };
  let token: string;
  try {
    token = decryptToken(conn.accessTokenEnc);
  } catch {
    return { needsReconnect: true };
  }
  try {
    const list = await metaGraphGet(token, "me/adaccounts", { fields: "name,account_id" });
    const accountsRaw: { id: string; name: string }[] = (list.data ?? []).map((a: Record<string, unknown>) => ({
      id: String(a.id ?? `act_${a.account_id ?? ""}`),
      name: String(a.name ?? ""),
    }));
    const accounts: AccountInsights[] = [];
    for (const a of accountsRaw) {
      const metrics = await getAccountInsights(token, a.id, datePreset);
      if (metrics) accounts.push({ accountId: a.id, name: a.name, metrics });
    }
    return { accounts };
  } catch {
    await prisma.metaConnection.update({ where: { ownerId }, data: { status: "expired" } }).catch(() => {});
    return { needsReconnect: true };
  }
}

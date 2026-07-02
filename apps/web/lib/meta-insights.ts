import { prisma } from "@fikirtive/db";
import { decryptToken } from "./token-encryption";
import { metaGraphGet, getAccountInsights, getAccountInsightsSeries, type AccountMetrics, type DailyMetric } from "./meta-graph";

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
  } catch (e) {
    // Only mark expired on a real Meta auth error (code 190) — a transient 5xx/rate-limit
    // shouldn't force every user to reconnect. (Mirrors getMyAdAccounts in meta-actions.ts.)
    const code = (e as { metaError?: { code?: number } })?.metaError?.code;
    if (code === 190) {
      await prisma.metaConnection.update({ where: { ownerId }, data: { status: "expired" } }).catch(() => {});
    }
    return { needsReconnect: true };
  }
}

/** Owner-scoped daily insights series (Analytics Phase A). Mirrors fetchOwnerInsights exactly —
 *  same conn lookup / token decrypt / code-190 needsReconnect handling — but fetches a per-day
 *  series per account and merges by date (summing metrics), returned sorted date asc. Read-only. */
export async function fetchOwnerInsightsSeries(
  ownerId: string,
  datePreset: string,
): Promise<{ series: DailyMetric[] } | { needsReconnect: true } | { notConnected: true }> {
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
    const byDate = new Map<string, DailyMetric>();
    for (const a of accountsRaw) {
      const days = await getAccountInsightsSeries(token, a.id, datePreset);
      for (const day of days) {
        const prev = byDate.get(day.date);
        if (prev) {
          prev.spend += day.spend;
          prev.reach += day.reach;
          prev.impressions += day.impressions;
          prev.clicks += day.clicks;
        } else {
          byDate.set(day.date, { ...day });
        }
      }
    }
    const series = [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date));
    return { series };
  } catch (e) {
    // Only mark expired on a real Meta auth error (code 190) — a transient 5xx/rate-limit
    // shouldn't force every user to reconnect. (Mirrors getMyAdAccounts in meta-actions.ts.)
    const code = (e as { metaError?: { code?: number } })?.metaError?.code;
    if (code === 190) {
      await prisma.metaConnection.update({ where: { ownerId }, data: { status: "expired" } }).catch(() => {});
    }
    return { needsReconnect: true };
  }
}

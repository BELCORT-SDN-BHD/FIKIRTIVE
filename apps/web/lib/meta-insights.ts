import { prisma } from "@fikirtive/db";
import { decryptToken } from "./token-encryption";
import { metaGraphGet, getAccountInsights, getAccountInsightsSeries, type AccountMetrics, type DailyMetric } from "./meta-graph";
import { classifyMetaGraphError } from "./meta-errors";

/** One ad account's insight totals. `currency` is the ISO code those totals are denominated
 *  in — Meta reports currency on the ad ACCOUNT node only (see the listCampaigns note in
 *  meta-graph.ts), so the account list is its single source, the same one Connections reads.
 *  null when Meta reported none; readers must then show a bare number, never a guessed code.
 *  #692: currency travels WITH the metrics so no consumer can add two currencies together. */
export type AccountInsights = { accountId: string; name: string; currency: string | null; metrics: AccountMetrics };

/** Ad-account currency as Meta reported it; absent or empty → null (unknown, never guessed). */
function readCurrency(raw: unknown): string | null {
  if (raw == null) return null;
  const code = String(raw).trim();
  return code === "" ? null : code;
}

/** Owner-scoped insights for all of the owner's connected ad accounts. Plain server fn (NOT a
 *  "use server" action) — reachable only server-side, so it carries no IDOR surface. Token stays here.
 *
 *  `accounts` only carries the accounts that HAD an insights row for `datePreset` — `getAccountInsights`
 *  returns null for an account that ran nothing, and that account is dropped below. So `accounts.length`
 *  answers "who reported delivery in this period", NOT "does this Meta login own any ad account".
 *  `adAccountCount` answers the second question: it is the length of the raw `me/adaccounts` list,
 *  before the insights filter. A reader that tells a merchant what to do next needs both, and they
 *  differ exactly for the merchant who owns ad accounts but paused them (判官 2026-09-05 P1-1). */
export async function fetchOwnerInsights(
  ownerId: string,
  datePreset: string,
): Promise<{ accounts: AccountInsights[]; adAccountCount: number } | { needsReconnect: true } | { transientError: true } | { notConnected: true }> {
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
  if (!conn) return { notConnected: true };
  let token: string;
  try {
    token = decryptToken(conn.accessTokenEnc);
  } catch {
    return { needsReconnect: true };
  }
  try {
    // `currency` must be REQUESTED here — without it Meta returns none and every downstream
    // reader is left with a bare number it cannot label (#692).
    const list = await metaGraphGet(token, "me/adaccounts", { fields: "name,account_id,currency" });
    const accountsRaw: { id: string; name: string; currency: string | null }[] = (list.data ?? []).map((a: Record<string, unknown>) => ({
      id: String(a.id ?? `act_${a.account_id ?? ""}`),
      name: String(a.name ?? ""),
      currency: readCurrency(a.currency),
    }));
    const accounts: AccountInsights[] = [];
    for (const a of accountsRaw) {
      const metrics = await getAccountInsights(token, a.id, datePreset);
      if (metrics) accounts.push({ accountId: a.id, name: a.name, currency: a.currency, metrics });
    }
    return { accounts, adAccountCount: accountsRaw.length };
  } catch (e) {
    return classifyMetaGraphError(ownerId, e);
  }
}

/** Owner-scoped daily insights series (Analytics Phase A). Mirrors fetchOwnerInsights exactly —
 *  same conn lookup / token decrypt / classifyMetaGraphError handling — but fetches a per-day
 *  series per account and merges by date (summing metrics), returned sorted date asc. Read-only.
 *  #692 NOTE: the merged `spend` adds every account's daily spend regardless of currency, so it
 *  is NOT safe to display as money. Only the count fields (reach/impressions/clicks) are shown;
 *  a money reader must use fetchOwnerInsights, where each account keeps its own currency. */
export async function fetchOwnerInsightsSeries(
  ownerId: string,
  datePreset: string,
): Promise<{ series: DailyMetric[] } | { needsReconnect: true } | { transientError: true } | { notConnected: true }> {
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
    return classifyMetaGraphError(ownerId, e);
  }
}

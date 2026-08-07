import { prisma } from "@fikirtive/db";
import { decryptToken } from "./token-encryption";
import { metaGraphGet, getAdInsights, getAdCreative, type AdCreative, type AdInsightsRow } from "./meta-graph";
import { classifyMetaGraphError } from "./meta-errors";

export const MAX_ADS = 25;

export type OwnerAdRow = {
  adId: string; adName: string | null; accountId: string;
  /** ISO code the money in `metrics` is denominated in — from the ad ACCOUNT (Meta's only
   *  source for it), null when Meta reported none. #692: it travels with the row so no reader
   *  can display a bare figure or rank one currency's money against another's. */
  currency: string | null;
  metrics: Record<string, string | null>; creative: AdCreative | null;
};
export type OwnerAdPerformance = {
  ads: OwnerAdRow[]; truncated: boolean;
  organic: { status: "pending_permission" } | { posts: [] };
  datePreset: string; fetchedAt: string;
};

const metricsOf = (r: AdInsightsRow): Record<string, string | null> => ({
  spend: r.spend, impressions: r.impressions, reach: r.reach, frequency: r.frequency,
  clicks: r.clicks, ctr: r.ctr, cpc: r.cpc, cpm: r.cpm, purchaseRoas: r.purchaseRoas,
});

/** Read the owner's per-ad performance + creative. $0 read-only. Bounded to MAX_ADS by spend
 *  (truncated flag stays honest). Organic is scope-gated: pending_permission until App Review + reconnect. */
export async function fetchOwnerAdPerformance(
  ownerId: string, datePreset: string,
): Promise<OwnerAdPerformance | { needsReconnect: true } | { transientError: true } | { notConnected: true }> {
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
  if (!conn) return { notConnected: true };
  let token: string;
  try { token = decryptToken(conn.accessTokenEnc); } catch { return { needsReconnect: true }; }

  let all: (AdInsightsRow & { accountId: string; currency: string | null })[];
  try {
    // `currency` must be requested — Meta reports it on the ad ACCOUNT node only, and without
    // it every per-ad money figure downstream is unlabelable (#692).
    const accountsRes: { data?: { id: string; account_id?: string; currency?: string }[] } =
      await metaGraphGet(token, "me/adaccounts", { fields: "id,account_id,currency" });
    const accounts = accountsRes.data ?? [];

    all = [];
    for (const a of accounts) {
      const accountId = String(a.id ?? `act_${a.account_id}`);
      const currency = a.currency == null || String(a.currency).trim() === "" ? null : String(a.currency).trim();
      const rows = await getAdInsights(token, accountId, datePreset);
      for (const r of rows) all.push({ ...r, accountId, currency });
    }
  } catch (e) {
    return classifyMetaGraphError(ownerId, e);
  }

  // #692: spend is only comparable WITHIN one currency, so ranking happens inside per-currency
  // runs and never across them. Groups are ordered by code (unknown first) for a stable list.
  const byCurrency = new Map<string, typeof all>();
  for (const r of all) {
    const key = r.currency ?? "";
    const group = byCurrency.get(key);
    if (group) group.push(r);
    else byCurrency.set(key, [r]);
  }
  const groups = [...byCurrency.entries()]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([, rows]) => rows.slice().sort((x, y) => Number(y.spend ?? 0) - Number(x.spend ?? 0)));

  // Fill the MAX_ADS budget round-robin across the runs. A single global "top by spend" would
  // let whichever currency happens to have the larger numbers crowd the others off the page —
  // an artefact of the exchange rate, not of how the ads performed.
  const counts = groups.map(() => 0);
  const deepest = groups.reduce((m, g) => Math.max(m, g.length), 0);
  let taken = 0;
  for (let depth = 0; depth < deepest && taken < MAX_ADS; depth++) {
    for (const [g, group] of groups.entries()) {
      if (taken >= MAX_ADS) break;
      if (depth >= group.length) continue;
      counts[g] = depth + 1;
      taken++;
    }
  }
  const top = groups.flatMap((group, g) => group.slice(0, counts[g]!));
  const truncated = all.length > top.length;

  const ads: OwnerAdRow[] = await Promise.all(top.map(async (r) => ({
    adId: r.adId, adName: r.adName, accountId: r.accountId, currency: r.currency,
    metrics: metricsOf(r), creative: await getAdCreative(token, r.adId).catch(() => null),
  })));

  const hasOrganicScope = /pages_read_engagement|instagram_manage_insights/.test(conn.scope ?? "");
  const organic: OwnerAdPerformance["organic"] = hasOrganicScope ? { posts: [] } : { status: "pending_permission" };

  return { ads, truncated, organic, datePreset, fetchedAt: new Date().toISOString() };
}

import { prisma } from "@fikirtive/db";
import { decryptToken } from "./token-encryption";
import { metaGraphGet, getAdInsights, getAdCreative, type AdCreative, type AdInsightsRow } from "./meta-graph";

export const MAX_ADS = 25;

export type OwnerAdRow = {
  adId: string; adName: string | null; accountId: string;
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
): Promise<OwnerAdPerformance | { needsReconnect: true } | { notConnected: true }> {
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
  if (!conn) return { notConnected: true };
  let token: string;
  try { token = decryptToken(conn.accessTokenEnc); } catch { return { needsReconnect: true }; }

  let all: (AdInsightsRow & { accountId: string })[];
  try {
    const accountsRes: { data?: { id: string; account_id?: string }[] } =
      await metaGraphGet(token, "me/adaccounts", { fields: "id,account_id" });
    const accounts = accountsRes.data ?? [];

    all = [];
    for (const a of accounts) {
      const accountId = String(a.id ?? `act_${a.account_id}`);
      const rows = await getAdInsights(token, accountId, datePreset);
      for (const r of rows) all.push({ ...r, accountId });
    }
  } catch (e) {
    if ((e as { metaError?: { code?: number } })?.metaError?.code === 190) {
      await prisma.metaConnection.update({ where: { ownerId }, data: { status: "expired" } }).catch(() => {});
    }
    return { needsReconnect: true };
  }
  const sorted = all.slice().sort((x, y) => Number(y.spend ?? 0) - Number(x.spend ?? 0));
  const top = sorted.slice(0, MAX_ADS);
  const truncated = sorted.length > MAX_ADS;

  const ads: OwnerAdRow[] = await Promise.all(top.map(async (r) => ({
    adId: r.adId, adName: r.adName, accountId: r.accountId,
    metrics: metricsOf(r), creative: await getAdCreative(token, r.adId).catch(() => null),
  })));

  const hasOrganicScope = /pages_read_engagement|instagram_manage_insights/.test(conn.scope ?? "");
  const organic: OwnerAdPerformance["organic"] = hasOrganicScope ? { posts: [] } : { status: "pending_permission" };

  return { ads, truncated, organic, datePreset, fetchedAt: new Date().toISOString() };
}

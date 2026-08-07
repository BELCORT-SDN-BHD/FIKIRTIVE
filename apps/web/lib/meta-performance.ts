import { prisma } from "@fikirtive/db";
import { decryptToken } from "./token-encryption";
import { metaGraphGet, getAdInsights, getAdCreative, type AdCreative, type AdInsightsRow } from "./meta-graph";
import { classifyMetaGraphError } from "./meta-errors";
import { moneyBucketKey } from "./analytics-view";

export const MAX_ADS = 25;

export type OwnerAdRow = {
  adId: string; adName: string | null; accountId: string;
  /** The ad account's display name, null when Meta reported none. #692 r2: a run of ads we
   *  could not label has to say WHICH account it is, because such runs are per-account and
   *  there can be several. */
  accountName: string | null;
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

  let all: (AdInsightsRow & { accountId: string; accountName: string | null; currency: string | null })[];
  try {
    // `currency` must be requested — Meta reports it on the ad ACCOUNT node only, and without
    // it every per-ad money figure downstream is unlabelable (#692). `name` rides along so a
    // run we cannot label can still say which account it is (#692 r2).
    const accountsRes: { data?: { id: string; account_id?: string; currency?: string; name?: string }[] } =
      await metaGraphGet(token, "me/adaccounts", { fields: "id,account_id,currency,name" });
    const accounts = accountsRes.data ?? [];

    const text = (v: unknown): string | null => {
      if (v == null) return null;
      const t = String(v).trim();
      return t === "" ? null : t;
    };

    all = [];
    for (const a of accounts) {
      const accountId = String(a.id ?? `act_${a.account_id}`);
      const rows = await getAdInsights(token, accountId, datePreset);
      for (const r of rows) all.push({ ...r, accountId, accountName: text(a.name), currency: text(a.currency) });
    }
  } catch (e) {
    return classifyMetaGraphError(ownerId, e);
  }

  // #692: spend is only comparable WITHIN one money bucket, so ranking happens inside a bucket
  // and never across them. moneyBucketKey is the Analytics family's single authority: accounts
  // share a bucket only when they share a KNOWN currency, and each account whose currency Meta
  // never reported gets a bucket of its own (#692 r2) — "Meta didn't say" is not a shared
  // denomination. Labelled buckets sort first (by code), then the unlabelled ones (by account).
  const byBucket = new Map<string, typeof all>();
  for (const r of all) {
    const key = moneyBucketKey(r);
    const group = byBucket.get(key);
    if (group) group.push(r);
    else byBucket.set(key, [r]);
  }
  const groups = [...byBucket.entries()]
    .sort(([x], [y]) => {
      const xUnlabelled = x.startsWith("unknown:");
      const yUnlabelled = y.startsWith("unknown:");
      if (xUnlabelled !== yUnlabelled) return xUnlabelled ? 1 : -1;
      return x.localeCompare(y);
    })
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
    adId: r.adId, adName: r.adName, accountId: r.accountId, accountName: r.accountName, currency: r.currency,
    metrics: metricsOf(r), creative: await getAdCreative(token, r.adId).catch(() => null),
  })));

  const hasOrganicScope = /pages_read_engagement|instagram_manage_insights/.test(conn.scope ?? "");
  const organic: OwnerAdPerformance["organic"] = hasOrganicScope ? { posts: [] } : { status: "pending_permission" };

  return { ads, truncated, organic, datePreset, fetchedAt: new Date().toISOString() };
}

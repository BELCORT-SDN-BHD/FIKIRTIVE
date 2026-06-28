import { META_GRAPH_VERSION } from "./meta-oauth";

/** Write Graph POST. Throws on a non-200 or a Meta `error` body (carries `metaError`). */
export async function metaGraphPost(token: string, path: string, body: Record<string, string | number>): Promise<any> {
  const u = `https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) params[k] = String(v);
  const r = await fetch(u, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const j = await r.json();
  if (!r.ok || j?.error) {
    const e = new Error(j?.error?.message || "graph error");
    (e as { metaError?: unknown }).metaError = j?.error;
    throw e;
  }
  return j;
}

/** Read-only Graph GET. Throws on a non-200 or a Meta `error` body (carries `metaError`). */
export async function metaGraphGet(token: string, path: string, params: Record<string, string>): Promise<any> {
  const u = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok || j?.error) {
    const e = new Error(j?.error?.message || "graph error");
    (e as { metaError?: unknown }).metaError = j?.error;
    throw e;
  }
  return j;
}

export type AccountMetrics = {
  spend: string | null; impressions: string | null; reach: string | null; frequency: string | null;
  clicks: string | null; ctr: string | null; cpc: string | null; cpm: string | null; purchaseRoas: string | null;
};

const INSIGHTS_FIELDS = "spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,purchase_roas";

/** Read-only account insights for one ad account. Returns null when there's no data row. */
export async function getAccountInsights(token: string, adAccountId: string, datePreset: string): Promise<AccountMetrics | null> {
  const j = await metaGraphGet(token, `${adAccountId}/insights`, { fields: INSIGHTS_FIELDS, date_preset: datePreset });
  const d = (j.data ?? [])[0] as Record<string, unknown> | undefined;
  if (!d) return null;
  const s = (k: string): string | null => (d[k] == null ? null : String(d[k]));
  const roas = Array.isArray(d.purchase_roas)
    ? ((d.purchase_roas[0] as { value?: unknown } | undefined)?.value ?? null)
    : (d.purchase_roas ?? null);
  return {
    spend: s("spend"), impressions: s("impressions"), reach: s("reach"), frequency: s("frequency"),
    clicks: s("clicks"), ctr: s("ctr"), cpc: s("cpc"), cpm: s("cpm"),
    purchaseRoas: roas == null ? null : String(roas),
  };
}

export async function listCampaigns(token: string, accountId: string) {
  // NOTE: `currency` is intentionally NOT requested — Meta does not return it on campaign nodes
  // (it would come back ""). Currency is sourced from the ad ACCOUNT in meta-objects.ts.
  const j = await metaGraphGet(token, `${accountId}/campaigns`, { fields: "name,effective_status,daily_budget,lifetime_budget,start_time,stop_time,account_id" });
  return j.data ?? [];
}

export async function listAdSets(token: string, accountId: string) {
  // `currency` intentionally omitted — sourced from the ad account (see listCampaigns note).
  const j = await metaGraphGet(token, `${accountId}/adsets`, { fields: "name,effective_status,daily_budget,lifetime_budget,start_time,end_time,account_id" });
  return j.data ?? [];
}

export async function listAds(token: string, accountId: string) {
  const j = await metaGraphGet(token, `${accountId}/ads`, { fields: "name,effective_status,account_id" });
  return j.data ?? [];
}

/** List Facebook Pages the user manages (requires pages_show_list scope). */
export async function listPages(token: string): Promise<{ id: string; name: string }[]> {
  const j = await metaGraphGet(token, "me/accounts", { fields: "id,name" });
  return (j.data ?? []).map((p: Record<string, unknown>) => ({
    id: String(p.id ?? ""),
    name: String(p.name ?? ""),
  }));
}

/** Exchange an OAuth code → a long-lived token (server-side; uses META_APP_SECRET).
 *  Also fetches debug_token to surface what scopes Meta ACTUALLY granted. */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<{ token: string; expiresAt: Date | null; grantedScopes: string[] } | { error: string }> {
  const appId = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!appId || !secret) return { error: "not_configured" };

  const sr = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, client_secret: secret, code }).toString(),
  });
  const sj = await sr.json().catch(() => ({}));
  if (!sr.ok || !sj.access_token) return { error: "exchange" };

  const lr = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "fb_exchange_token", client_id: appId, client_secret: secret, fb_exchange_token: sj.access_token }).toString(),
  });
  const lj = await lr.json().catch(() => ({}));
  if (!lr.ok || !lj.access_token) return { error: "exchange" };

  const expiresAt = typeof lj.expires_in === "number" ? new Date(Date.now() + lj.expires_in * 1000) : null;

  // Fetch the actually-granted scopes via debug_token (never trust what we requested).
  const dr = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/debug_token?input_token=${encodeURIComponent(lj.access_token)}&access_token=${encodeURIComponent(`${appId}|${secret}`)}`,
  );
  const dj = await dr.json().catch(() => ({}));
  const grantedScopes: string[] = Array.isArray(dj?.data?.scopes) ? dj.data.scopes : [];

  return { token: lj.access_token, expiresAt, grantedScopes };
}

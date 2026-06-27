import { META_GRAPH_VERSION } from "./meta-oauth";

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

/** Exchange an OAuth code → a long-lived token (server-side; uses META_APP_SECRET). */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<{ token: string; expiresAt: Date | null } | { error: string }> {
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
  return { token: lj.access_token, expiresAt };
}

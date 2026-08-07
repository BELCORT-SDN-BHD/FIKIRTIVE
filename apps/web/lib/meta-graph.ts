import { META_GRAPH_VERSION } from "./meta-oauth";

export type AdFile = { bytes: Buffer | Uint8Array; filename: string; contentType: string };

type MetaGraphResponse = {
  [key: string]: unknown;
  data?: Record<string, unknown>[];
  error?: { message?: string };
  paging?: { next?: string };
  id?: unknown;
  images?: Record<string, { hash?: string; url?: string }>;
  creative?: Record<string, unknown>;
};

function graphResponse(value: unknown): MetaGraphResponse {
  return typeof value === "object" && value !== null ? value as MetaGraphResponse : {};
}

/** Multipart POST to the Graph API. Same auth + `metaError`/code-190 contract as `metaGraphPost`. */
export async function metaGraphUpload(
  token: string,
  path: string,
  fields: Record<string, string>,
  file: AdFile,
): Promise<MetaGraphResponse> {
  const u = `https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`;
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append("source", new Blob([new Uint8Array(file.bytes)], { type: file.contentType }), file.filename);
  const r = await fetch(u, {
    method: "POST",
    // Do NOT set Content-Type — browser/Node fetch sets multipart boundary automatically
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const j = graphResponse(await r.json());
  if (!r.ok || j?.error) {
    const e = new Error(j?.error?.message || "graph error");
    (e as { metaError?: unknown }).metaError = j?.error;
    throw e;
  }
  return j;
}

/**
 * Upload an image to a Meta ad account. Returns the `image_hash`.
 * @param token - OAuth access token
 * @param accountId - Ad account ID, e.g. "act_123456"
 * @param file - Image file to upload
 */
export async function uploadAdImage(token: string, accountId: string, file: AdFile): Promise<string> {
  const j = await metaGraphUpload(token, `${accountId}/adimages`, {}, file);
  // Meta response: { images: { <filename>: { hash, url } } }
  const entry = j?.images ? (Object.values(j.images)[0] as { hash?: string } | undefined) : undefined;
  if (!entry?.hash) throw new Error("adimages: unexpected Meta response shape");
  return String(entry.hash);
}

/**
 * Upload a video to a Meta ad account. Returns the `video_id`.
 * @param token - OAuth access token
 * @param accountId - Ad account ID, e.g. "act_123456"
 * @param file - Video file to upload
 */
export async function uploadAdVideo(token: string, accountId: string, file: AdFile): Promise<string> {
  const j = await metaGraphUpload(token, `${accountId}/advideos`, {}, file);
  // Meta response: { id }
  return String(j.id);
}

/** Write Graph POST. Throws on a non-200 or a Meta `error` body (carries `metaError`). */
export async function metaGraphPost(token: string, path: string, body: Record<string, string | number>): Promise<MetaGraphResponse> {
  const u = `https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) params[k] = String(v);
  const r = await fetch(u, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const j = graphResponse(await r.json());
  if (!r.ok || j?.error) {
    const e = new Error(j?.error?.message || "graph error");
    (e as { metaError?: unknown }).metaError = j?.error;
    throw e;
  }
  return j;
}

/** Read-only Graph GET. Throws on a non-200 or a Meta `error` body (carries `metaError`). */
export async function metaGraphGet<T extends MetaGraphResponse = MetaGraphResponse>(
  token: string,
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const fixture = metaGraphFixture(path, params);
  if (fixture) return fixture as T;

  const u = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const j = graphResponse(await r.json());
  if (!r.ok || j?.error) {
    const e = new Error(j?.error?.message || "graph error");
    (e as { metaError?: unknown }).metaError = j?.error;
    throw e;
  }
  return j as T;
}

function metaGraphFixture(path: string, params: Record<string, string>): MetaGraphResponse | null {
  if (process.env.NODE_ENV === "production" || process.env.META_GRAPH_MOCK !== "fixture") return null;

  if (path === "me/adaccounts") {
    // #692: the two accounts deliberately use DIFFERENT currencies. Meta lets one person hold
    // ad accounts in several currencies, and that is exactly the case a walkthrough has to be
    // able to see — with both on MYR, a cross-currency sum looked correct on screen.
    return {
      data: [
        { id: "act_qa_1", account_id: "act_qa_1", name: "Kaia Cafe QA Ads", currency: "MYR", account_status: 1 },
        { id: "act_qa_2", account_id: "act_qa_2", name: "Night Market QA Ads", currency: "SGD", account_status: 1 },
      ],
    };
  }

  if (path === "me/accounts") {
    return { data: [{ id: "qa_page_1", name: "Kaia Cafe QA Page" }] };
  }

  if (path.endsWith("/insights")) {
    if (params.level === "ad") {
      const secondAccount = path.startsWith("act_qa_2");
      return {
        data: [
          { ad_id: secondAccount ? "ad_qa_3" : "ad_qa_1", ad_name: secondAccount ? "Night Market Carousel" : "Iced Latte Launch", spend: secondAccount ? "22.70" : "31.20", impressions: secondAccount ? "7810" : "9120", reach: secondAccount ? "5900" : "6400", frequency: "1.43", clicks: secondAccount ? "188" : "286", ctr: secondAccount ? "2.41" : "3.14", cpc: secondAccount ? "0.12" : "0.11", cpm: secondAccount ? "2.91" : "3.42", purchase_roas: [{ value: secondAccount ? "2.9" : "3.8" }] },
          { ad_id: secondAccount ? "ad_qa_4" : "ad_qa_2", ad_name: secondAccount ? "Retail Reorder Reminder" : "Weekend Brunch Offer", spend: secondAccount ? "10.40" : "18.40", impressions: secondAccount ? "4080" : "6210", reach: secondAccount ? "3120" : "4880", frequency: "1.27", clicks: secondAccount ? "98" : "141", ctr: secondAccount ? "2.40" : "2.27", cpc: "0.13", cpm: secondAccount ? "2.55" : "2.96", purchase_roas: [{ value: secondAccount ? "2.6" : "2.4" }] },
        ],
      };
    }

    if (params.time_increment === "1") {
      const base = path.startsWith("act_qa_2") ? 2 : 1;
      return {
        data: [
          { date_start: "2026-06-28", spend: String(8 * base), reach: String(2400 * base), impressions: String(3600 * base), clicks: String(72 * base) },
          { date_start: "2026-06-29", spend: String(11 * base), reach: String(2900 * base), impressions: String(4300 * base), clicks: String(94 * base) },
          { date_start: "2026-06-30", spend: String(15 * base), reach: String(3400 * base), impressions: String(5200 * base), clicks: String(128 * base) },
        ],
      };
    }

    return {
      data: [{
        spend: path.startsWith("act_qa_2") ? "33.10" : "48.75",
        impressions: path.startsWith("act_qa_2") ? "11890" : "18342",
        reach: path.startsWith("act_qa_2") ? "9020" : "12840",
        frequency: "1.43",
        clicks: path.startsWith("act_qa_2") ? "286" : "412",
        ctr: path.startsWith("act_qa_2") ? "2.41" : "2.25",
        cpc: "0.12",
        cpm: "2.66",
        purchase_roas: [{ value: path.startsWith("act_qa_2") ? "2.9" : "3.1" }],
      }],
    };
  }

  if (/^ad_qa_[1-4]$/.test(path)) {
    const titles: Record<string, string> = {
      ad_qa_1: "Iced Latte Launch",
      ad_qa_2: "Weekend Brunch Offer",
      ad_qa_3: "Night Market Carousel",
      ad_qa_4: "Retail Reorder Reminder",
    };
    return {
      creative: {
        body: path === "ad_qa_1" ? "Try the new iced latte today." : "Book a weekend brunch table.",
        title: titles[path] ?? "QA ad",
        video_id: null,
      },
    };
  }

  if (path.endsWith("/campaigns")) {
    return { data: [{ id: "cmp_qa_1", name: "QA Launch Campaign", effective_status: "ACTIVE", account_id: path.split("/")[0] }] };
  }
  if (path.endsWith("/adsets")) {
    return { data: [{ id: "set_qa_1", name: "QA Prospecting", effective_status: "ACTIVE", account_id: path.split("/")[0] }] };
  }
  if (path.endsWith("/ads")) {
    return { data: [{ id: "ad_qa_1", name: "Iced Latte Launch", effective_status: "ACTIVE", account_id: path.split("/")[0] }] };
  }

  throw new Error(`Meta graph fixture missing path: ${path}`);
}

/** F37: paginate a Graph list edge — follow `paging.next` (a full cursor URL) up to a hard page
 *  cap so lists longer than one page (Meta defaults to 25) aren't silently truncated. Best-effort:
 *  a mid-pagination error returns what was collected so far rather than discarding page 1.
 *  Requests limit=100 to minimize round-trips. */
export async function metaGraphGetAll(token: string, path: string, params: Record<string, string>, maxPages = 10): Promise<Record<string, unknown>[]> {
  const first = await metaGraphGet(token, path, { limit: "100", ...params });
  let out = first.data ?? [];
  let next: string | undefined = first.paging?.next;
  for (let i = 1; i < maxPages && next; i++) {
    const r = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
    const j = graphResponse(await r.json());
    if (!r.ok || j?.error) break;
    out = out.concat(j.data ?? []);
    next = j.paging?.next;
  }
  return out;
}

export type AccountMetrics = {
  spend: string | null; impressions: string | null; reach: string | null; frequency: string | null;
  clicks: string | null; ctr: string | null; cpc: string | null; cpm: string | null; purchaseRoas: string | null;
};

const INSIGHTS_FIELDS = "spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,purchase_roas";

/** Extract the 9 metric fields from an insights row (unwraps array purchase_roas). */
export function readMetricFields(d: Record<string, unknown>): AccountMetrics {
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

/** Read-only account insights for one ad account. Returns null when there's no data row. */
export async function getAccountInsights(token: string, adAccountId: string, datePreset: string): Promise<AccountMetrics | null> {
  const j = await metaGraphGet(token, `${adAccountId}/insights`, { fields: INSIGHTS_FIELDS, date_preset: datePreset });
  const d = (j.data ?? [])[0] as Record<string, unknown> | undefined;
  if (!d) return null;
  return readMetricFields(d);
}

export type AdInsightsRow = AccountMetrics & { adId: string; adName: string | null };

/** Per-ad performance for one ad account (level=ad). Paginated; ads_read scope covers this. */
export async function getAdInsights(token: string, adAccountId: string, datePreset: string): Promise<AdInsightsRow[]> {
  const rows = await metaGraphGetAll(token, `${adAccountId}/insights`, {
    level: "ad", fields: `ad_id,ad_name,${INSIGHTS_FIELDS}`, date_preset: datePreset,
  });
  return rows.map((d: Record<string, unknown>) => ({
    adId: String(d.ad_id ?? ""), adName: (d.ad_name as string | undefined) ?? null, ...readMetricFields(d),
  }));
}

export type AdCreative = { imageUrl: string | null; body: string | null; title: string | null; videoId: string | null };

/** Read one ad's creative (image/copy). ads_read covers it. null when the node has no creative. */
export async function getAdCreative(token: string, adId: string): Promise<AdCreative | null> {
  const j = await metaGraphGet(token, adId, { fields: "creative{image_url,thumbnail_url,body,title,video_id}" });
  const c = (j?.creative ?? null) as Record<string, unknown> | null;
  if (!c) return null;
  return {
    imageUrl: (c.image_url as string) ?? (c.thumbnail_url as string) ?? null,
    body: (c.body as string) ?? null, title: (c.title as string) ?? null, videoId: (c.video_id as string) ?? null,
  };
}

export async function listCampaigns(token: string, accountId: string) {
  // NOTE: `currency` is intentionally NOT requested — Meta does not return it on campaign nodes
  // (it would come back ""). Currency is sourced from the ad ACCOUNT in meta-objects.ts.
  // F37: paginate so accounts with >25 campaigns aren't silently truncated.
  return metaGraphGetAll(token, `${accountId}/campaigns`, { fields: "name,effective_status,daily_budget,lifetime_budget,start_time,stop_time,account_id" });
}

export async function listAdSets(token: string, accountId: string) {
  // `currency` intentionally omitted — sourced from the ad account (see listCampaigns note).
  return metaGraphGetAll(token, `${accountId}/adsets`, { fields: "name,effective_status,daily_budget,lifetime_budget,start_time,end_time,account_id" });
}

export async function listAds(token: string, accountId: string) {
  return metaGraphGetAll(token, `${accountId}/ads`, { fields: "name,effective_status,account_id" });
}

/** List Facebook Pages the user manages (requires pages_show_list scope). */
export async function listPages(token: string): Promise<{ id: string; name: string }[]> {
  const data = await metaGraphGetAll(token, "me/accounts", { fields: "id,name" });
  return data.map((p: Record<string, unknown>) => ({
    id: String(p.id ?? ""),
    name: String(p.name ?? ""),
  }));
}

/** Exchange an OAuth code → a long-lived token (server-side; uses META_APP_SECRET).
 *  Also fetches debug_token to surface what scopes Meta ACTUALLY granted. */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<{ token: string; expiresAt: Date | null; grantedScopes: string[]; metaUserId: string | null } | { error: string }> {
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
  // debug_token also returns the app-scoped Meta user id — store it so the Meta
  // data-deletion callback (/api/meta/data-deletion) can match this connection.
  // #573:数字型 id 只在 JS 能精确表示时才收。Meta 的 app-scoped id 已逼近 2^53-1,
  // 超界的未加引号整数在 JSON.parse 那一步就被悄悄取整(…993 → …992),String() 存下的
  // 是一个 data-deletion 回调永远匹配不到的假 id —— 正是本票要消灭的「删不掉的连接」。
  // 存错比不存更坏:这里 fail-closed 返回 null,上游 meta-actions 退回 "incomplete",
  // 一行都不写。字符串 id(Meta 的常规形态)原样保留,不做长度判断。
  const uid = dj?.data?.user_id;
  const metaUserId =
    typeof uid === "string"
      ? uid
      : typeof uid === "number" && Number.isSafeInteger(uid) && uid > 0
        ? String(uid)
        : null;

  return { token: lj.access_token, expiresAt, grantedScopes, metaUserId };
}

/** One day of ad-account metrics (Analytics Phase A). Numbers coerced; missing → 0. */
export type DailyMetric = { date: string; spend: number; reach: number; impressions: number; clicks: number };

export function parseDailyRows(data: unknown[]): DailyMetric[] {
  const out: DailyMetric[] = [];
  const n = (v: unknown): number => { const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0; return Number.isFinite(x) ? x : 0; };
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue;
    const d = raw as Record<string, unknown>;
    if (typeof d.date_start !== "string") continue;
    out.push({ date: d.date_start, spend: n(d.spend), reach: n(d.reach), impressions: n(d.impressions), clicks: n(d.clicks) });
  }
  return out;
}

/** Read-only daily series for one ad account — same insights edge with time_increment=1. */
export async function getAccountInsightsSeries(token: string, adAccountId: string, datePreset: string): Promise<DailyMetric[]> {
  const j = await metaGraphGet(token, `${adAccountId}/insights`, {
    fields: "spend,reach,impressions,clicks", date_preset: datePreset, time_increment: "1", limit: "500",
  });
  return parseDailyRows((j.data ?? []) as unknown[]);
}

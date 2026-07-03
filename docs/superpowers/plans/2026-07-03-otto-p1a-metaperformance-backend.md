# Otto P1a · metaPerformance 后端数据层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 建 Otto 读**逐条广告表现 + 真实素材**的后端数据层:`getAdInsights`(`level=ad`)+ `getAdCreative` 抓取 → `fetchOwnerAdPerformance` 按 org 编排(有界、错误处理、organic 权限门)→ `ctx.metaPerformance` 端口 + `metaAdPerformance` read skill + `getAdPerformance` server action(单一动作层,供 P1b 人工面复用)。全程**只读 $0**。

**Architecture:** 复用现成 Meta 管道范式(`fetchOwnerInsights` 的 connection→decrypt→me/adaccounts→per-account 循环 + code-190→expired 处理),平移到逐条。skill 只调端口(不 import web lib)。付费逐条 = live 可测;**organic = 端口现在就 aware,但按 granted scope 门控 —— 未授权返回 `{status:"pending_permission"}` 哨兵,真 organic fetch(IG/FB 帖 insights)推迟到 scope 可实测时再建**(spec §7「未实测不宣称」+ [[efficiency-conscience-meaning]])。

**Tech Stack:** TS(apps/web ESM,`@fikirtive/otto` 端口/skill)· vitest · 无新依赖 · Meta Graph(`ads_read` 已覆盖 `level=ad` + creative,无需新 scope)。

## Global Constraints

- **只读 $0,零钱路**:全 GET;不触任何 write 端点;不新建 spend path;money-path 文件零 diff。
- **反捏造(spec §5)**:数字带 `来源+周期(datePreset)+抓取时间(fetchedAt)`;**有界 top-N 广告,截断即在返回里明说(`truncated: true`),不静默丢**;organic 未授权 = `pending_permission`,**绝不返回假 organic 数字**。
- **租户铁幕(宪法 6)**:`fetchOwnerAdPerformance(ownerId, ...)` 全程 ownerId 作用域;server action 用 `requireOwner()`,永不信客户端 org;端口从 context 的 ownerId 闭包取。
- **审批数学(宪法 4)**:`metaAdPerformance` skill = `cost:free / effect:read / reach:external` → `needsApproval=false`(镜像 `metaInsights`)。
- **双模 · 单一动作层(宪法 7)**:`fetchOwnerAdPerformance` = 唯一实现;端口(Otto)与 `getAdPerformance` action(P1b 人工面)都调它。新 action + skill **登记 Parity Manifest**。
- **端口纪律**:skill 只调 `ctx.metaPerformance`,不 import `apps/web`。`packages/otto` 不 import prisma/pg。
- **语言**:代码英文;skill description 英文;本 plan 华语。
- **构建闸**:结束 `pnpm --filter @fikirtive/otto build` + `pnpm --filter @fikirtive/web build` 均 EXIT 0(#105)。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `apps/web/lib/meta-graph.ts` | 加 `readMetricFields` 抽取器(DRY)、`getAdInsights`(level=ad)、`getAdCreative`;类型 `AdInsightsRow`/`AdCreative` | 改 |
| `apps/web/lib/meta-performance.ts` | `fetchOwnerAdPerformance(ownerId, datePreset)` 编排(有界 + 错误 + organic 门) + 类型 `OwnerAdPerformance` | 建 |
| `apps/web/lib/meta-performance-actions.ts` | `getAdPerformance(datePreset)` server action(requireOwner 包装,供 P1b) | 建 |
| `packages/otto/src/context.ts` | `OttoContext.metaPerformance?` 端口类型 | 改 |
| `packages/otto/src/skills/meta-ad-performance.ts` | `metaAdPerformanceSkill`(free/read/external)+ input/execute | 建 |
| `packages/otto/src/registry.ts` | 注册 `metaAdPerformanceSkill` | 改 |
| `apps/web/lib/otto-actions.ts` | `buildOttoContext` 注入 `metaPerformance` 端口 | 改 |
| `docs/design/2026-07-03-harmony-02-parity-manifest.md` | 登记 `getAdPerformance` action ↔ `metaAdPerformance` skill | 改 |

---

### Task 1: `getAdInsights`(level=ad)+ `getAdCreative` + 类型(meta-graph.ts)

**Files:**
- Modify: `apps/web/lib/meta-graph.ts`
- Test: `apps/web/lib/meta-graph.test.ts`(若无则建)

**Interfaces:**
- Consumes: 现成 `metaGraphGet`(:77)、`metaGraphGetAll`(:95)、`AccountMetrics`(:110)、`INSIGHTS_FIELDS`(:115)。
- Produces:
  - `function readMetricFields(d: Record<string, unknown>): AccountMetrics` — 抽取现 `getAccountInsights` 内联的 s()/roas 解析(DRY;`getAccountInsights` 改用它)。
  - `type AdInsightsRow = AccountMetrics & { adId: string; adName: string | null }`
  - `function getAdInsights(token: string, adAccountId: string, datePreset: string): Promise<AdInsightsRow[]>` — `${adAccountId}/insights` + `level=ad` + `fields=ad_id,ad_name,${INSIGHTS_FIELDS}`,经 `metaGraphGetAll` 分页。
  - `type AdCreative = { imageUrl: string | null; body: string | null; title: string | null; videoId: string | null }`
  - `function getAdCreative(token: string, adId: string): Promise<AdCreative | null>` — `metaGraphGet(token, adId, { fields: "creative{image_url,thumbnail_url,body,title,video_id}" })`。

- [ ] **Step 1: Write the failing test**

`apps/web/lib/meta-graph.test.ts`(追加或新建;mock `global.fetch`):
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { getAdInsights, getAdCreative, readMetricFields } from "./meta-graph";

function mockFetchOnce(json: unknown, ok = true) {
  return vi.spyOn(global, "fetch" as never).mockResolvedValueOnce({ ok, json: async () => json } as never);
}
afterEach(() => vi.restoreAllMocks());

describe("readMetricFields", () => {
  it("extracts metric strings and unwraps array purchase_roas", () => {
    const m = readMetricFields({ spend: "12.5", ctr: "1.2", purchase_roas: [{ value: "3.1" }], clicks: 4 });
    expect(m.spend).toBe("12.5");
    expect(m.ctr).toBe("1.2");
    expect(m.purchaseRoas).toBe("3.1");
    expect(m.clicks).toBe("4");
    expect(m.reach).toBeNull();
  });
});

describe("getAdInsights (level=ad)", () => {
  it("requests level=ad + ad_id/ad_name and maps rows", async () => {
    const fetchSpy = mockFetchOnce({ data: [{ ad_id: "a1", ad_name: "Ad One", spend: "10", ctr: "0.9" }] });
    const rows = await getAdInsights("TOK", "act_1", "last_30d");
    expect(rows).toEqual([{ adId: "a1", adName: "Ad One", spend: "10", ctr: "0.9",
      impressions: null, reach: null, frequency: null, clicks: null, cpc: null, cpm: null, purchaseRoas: null }]);
    const url = (fetchSpy.mock.calls[0]![0] as string);
    expect(url).toContain("level=ad");
    expect(url).toContain("ad_id");
  });
});

describe("getAdCreative", () => {
  it("returns creative fields, falling back thumbnail→image", async () => {
    mockFetchOnce({ creative: { thumbnail_url: "http://t", body: "buy now", title: "T", video_id: "v1" } });
    expect(await getAdCreative("TOK", "a1")).toEqual({ imageUrl: "http://t", body: "buy now", title: "T", videoId: "v1" });
  });
  it("returns null when the ad has no creative", async () => {
    mockFetchOnce({ id: "a1" });
    expect(await getAdCreative("TOK", "a1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/meta-graph.test.ts`
Expected: FAIL(函数未定义)。

- [ ] **Step 3: Implement in `apps/web/lib/meta-graph.ts`**

在 `AccountMetrics` 与 `getAccountInsights` 之间插入抽取器,并重构 `getAccountInsights` 用它:
```ts
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
```
把 `getAccountInsights`(:118)的内联解析(:122-130)替换为 `return readMetricFields(d);`(仅该函数,别动其它)。追加:
```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/meta-graph.test.ts` → PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/meta-graph.ts apps/web/lib/meta-graph.test.ts
git commit -m "feat(meta): per-ad insights (level=ad) + ad creative read + DRY metric extractor"
```

---

### Task 2: `fetchOwnerAdPerformance` 编排(有界 + 错误 + organic 门)

**Files:**
- Create: `apps/web/lib/meta-performance.ts`
- Test: `apps/web/lib/meta-performance.test.ts`

**Interfaces:**
- Consumes: `getAdInsights`/`getAdCreative`/`AdCreative`(Task 1)、`metaGraphGet`;`prisma.metaConnection`、`decryptToken`(镜像 `meta-insights.ts:9-42` 的 lookup/decrypt/me-adaccounts/code-190 模式)。
- Produces:
  - `type OwnerAdRow = { adId: string; adName: string | null; accountId: string; metrics: Record<string, string | null>; creative: AdCreative | null }`
  - `type OwnerAdPerformance = { ads: OwnerAdRow[]; truncated: boolean; organic: { status: "pending_permission" } | { posts: [] }; datePreset: string; fetchedAt: string }`
  - `const MAX_ADS = 25`
  - `function fetchOwnerAdPerformance(ownerId: string, datePreset: string): Promise<OwnerAdPerformance | { needsReconnect: true } | { notConnected: true }>`
  - 逻辑:①`prisma.metaConnection.findUnique({where:{ownerId}})` 无 → `{notConnected:true}`;②`decryptToken` throw → `{needsReconnect:true}`;③`metaGraphGet(token,"me/adaccounts",{fields:"account_id"})`(catch code 190 → 置 `status:"expired"` + `{needsReconnect:true}`);④逐账户 `getAdInsights` 汇总;⑤按 `Number(spend??0)` 降序取 `MAX_ADS`,`truncated = total > MAX_ADS`;⑥top 广告并发 `getAdCreative`(`.catch(()=>null)`);⑦organic 门:`hasOrganicScope = /pages_read_engagement|instagram_manage_insights/.test(conn.scope)` —— **false → `organic:{status:"pending_permission"}`(本块唯一分支);true → 现留 `{posts:[]}`(真 organic fetch 待 scope 可验证时另建,见 plan 头)**;⑧`fetchedAt = new Date().toISOString()`。

- [ ] **Step 1: Write the failing test**

`apps/web/lib/meta-performance.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findUnique: vi.fn(), decryptToken: vi.fn(), metaGraphGet: vi.fn(), getAdInsights: vi.fn(), getAdCreative: vi.fn(),
}));
vi.mock("@fikirtive/db", () => ({ prisma: { metaConnection: { findUnique: h.findUnique, update: vi.fn() } } }));
vi.mock("./token-encryption", () => ({ decryptToken: h.decryptToken }));
vi.mock("./meta-graph", () => ({ metaGraphGet: h.metaGraphGet, getAdInsights: h.getAdInsights, getAdCreative: h.getAdCreative }));

import { fetchOwnerAdPerformance, MAX_ADS } from "./meta-performance";

beforeEach(() => { vi.clearAllMocks(); h.decryptToken.mockReturnValue("TOK"); });

describe("fetchOwnerAdPerformance", () => {
  it("notConnected when no MetaConnection", async () => {
    h.findUnique.mockResolvedValue(null);
    expect(await fetchOwnerAdPerformance("o1", "last_30d")).toEqual({ notConnected: true });
  });

  it("needsReconnect when the token won't decrypt", async () => {
    h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read" });
    h.decryptToken.mockImplementation(() => { throw new Error("bad"); });
    expect(await fetchOwnerAdPerformance("o1", "last_30d")).toEqual({ needsReconnect: true });
  });

  it("returns per-ad rows + creative, organic pending when scope absent", async () => {
    h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read,ads_management" });
    h.metaGraphGet.mockResolvedValue({ data: [{ id: "act_1" }] });
    h.getAdInsights.mockResolvedValue([{ adId: "a1", adName: "One", spend: "10", ctr: "1.0",
      impressions: null, reach: null, frequency: null, clicks: null, cpc: null, cpm: null, purchaseRoas: null }]);
    h.getAdCreative.mockResolvedValue({ imageUrl: "http://i", body: "b", title: "t", videoId: null });
    const r = await fetchOwnerAdPerformance("o1", "last_30d");
    if ("needsReconnect" in r || "notConnected" in r) throw new Error("unexpected");
    expect(r.ads).toHaveLength(1);
    expect(r.ads[0]).toMatchObject({ adId: "a1", accountId: "act_1", creative: { imageUrl: "http://i" } });
    expect(r.ads[0]!.metrics.spend).toBe("10");
    expect(r.truncated).toBe(false);
    expect(r.organic).toEqual({ status: "pending_permission" });
    expect(r.datePreset).toBe("last_30d");
  });

  it("bounds to MAX_ADS by spend and flags truncated", async () => {
    h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read" });
    h.metaGraphGet.mockResolvedValue({ data: [{ id: "act_1" }] });
    const many = Array.from({ length: MAX_ADS + 5 }, (_, i) => ({ adId: `a${i}`, adName: null, spend: String(i),
      impressions: null, reach: null, frequency: null, clicks: null, ctr: null, cpc: null, cpm: null, purchaseRoas: null }));
    h.getAdInsights.mockResolvedValue(many);
    h.getAdCreative.mockResolvedValue(null);
    const r = await fetchOwnerAdPerformance("o1", "last_30d");
    if ("needsReconnect" in r || "notConnected" in r) throw new Error("unexpected");
    expect(r.ads).toHaveLength(MAX_ADS);
    expect(r.truncated).toBe(true);
    expect(r.ads[0]!.adId).toBe(`a${MAX_ADS + 4}`); // highest spend first
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/meta-performance.test.ts` → FAIL(模块未建)。

- [ ] **Step 3: Implement `apps/web/lib/meta-performance.ts`**

```ts
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

  let accountsRes: { data?: { id: string }[] };
  try {
    accountsRes = await metaGraphGet(token, "me/adaccounts", { fields: "account_id" });
  } catch (e) {
    if ((e as { metaError?: { code?: number } })?.metaError?.code === 190) {
      await prisma.metaConnection.update({ where: { ownerId }, data: { status: "expired" } });
      return { needsReconnect: true };
    }
    throw e;
  }
  const accounts = accountsRes.data ?? [];

  const all: (AdInsightsRow & { accountId: string })[] = [];
  for (const a of accounts) {
    const rows = await getAdInsights(token, a.id, datePreset);
    for (const r of rows) all.push({ ...r, accountId: a.id });
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
```

- [ ] **Step 4: Run tests → PASS**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/meta-performance.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/meta-performance.ts apps/web/lib/meta-performance.test.ts
git commit -m "feat(meta): fetchOwnerAdPerformance — bounded per-ad perf+creative, organic scope-gated"
```

---

### Task 3: `metaPerformance` 端口类型 + `getAdPerformance` action + context 注入

**Files:**
- Modify: `packages/otto/src/context.ts`(加端口类型)
- Create: `apps/web/lib/meta-performance-actions.ts`(server action)
- Modify: `apps/web/lib/otto-actions.ts`(注入端口)
- Test: `apps/web/lib/meta-performance-actions.test.ts`

**Interfaces:**
- Consumes: `fetchOwnerAdPerformance`(Task 2);`requireOwner`(既有,`otto-actions.ts` 同款);`OttoContext`(context.ts)。
- Produces:
  - `context.ts`:在 `metaInsights` 端口(:73-79)旁加
    ```ts
    metaPerformance?: {
      getAds(datePreset: string): Promise<
        | { ads: { adId: string; adName: string | null; accountId: string; metrics: Record<string, string | null>; creative: { imageUrl: string | null; body: string | null; title: string | null; videoId: string | null } | null }[]; truncated: boolean; organic: { status: "pending_permission" } | { posts: [] }; datePreset: string; fetchedAt: string }
        | { needsReconnect: true }
        | { notConnected: true }
      >;
    };
    ```
  - `meta-performance-actions.ts`:`async function getAdPerformance(datePreset)` = `requireOwner()`(from `./auth-guard`,返回 `{email,ownerId}|{error}`;`"error" in gate` → 回 `{error}`)→ `fetchOwnerAdPerformance(gate.ownerId, datePreset)`(单一动作层:P1b 人工面调它)。
  - `otto-actions.ts`:`buildOttoContext` 端口注入块(:188-191)加 `metaPerformance: { getAds: (p: string) => fetchOwnerAdPerformance(ownerId, p) }`;顶部 import `fetchOwnerAdPerformance`。

- [ ] **Step 1: Write the failing test**(server action owner-scoping)

`apps/web/lib/meta-performance-actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const h = vi.hoisted(() => ({ requireOwner: vi.fn(), fetch: vi.fn() }));
vi.mock("./auth-guard", () => ({ requireOwner: h.requireOwner }));
vi.mock("./meta-performance", () => ({ fetchOwnerAdPerformance: h.fetch }));
import { getAdPerformance } from "./meta-performance-actions";
beforeEach(() => vi.clearAllMocks());

describe("getAdPerformance (server action)", () => {
  it("scopes to the session owner (gate.ownerId), never a client-supplied org", async () => {
    h.requireOwner.mockResolvedValue({ ownerId: "owner-session", email: "o@x.com" });
    h.fetch.mockResolvedValue({ ads: [], truncated: false, organic: { status: "pending_permission" }, datePreset: "last_30d", fetchedAt: "t" });
    const r = await getAdPerformance("last_30d");
    expect(h.fetch).toHaveBeenCalledWith("owner-session", "last_30d");
    expect(r).toMatchObject({ ads: [] });
  });
  it("returns the auth error without fetching when the session is unauthorized", async () => {
    h.requireOwner.mockResolvedValue({ error: "unauthorized" });
    const r = await getAdPerformance("last_30d");
    expect(h.fetch).not.toHaveBeenCalled();
    expect(r).toEqual({ error: "unauthorized" });
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/meta-performance-actions.test.ts`

- [ ] **Step 3: Implement**

`apps/web/lib/meta-performance-actions.ts`(镜像既有 read action 的 `"use server"`/`requireOwner` 姿势):
```ts
"use server";
import { requireOwner } from "./auth-guard";
import { fetchOwnerAdPerformance } from "./meta-performance";

/** Read the session owner's per-ad performance. Single action layer: the P1b human panel
 *  and the Otto metaPerformance port both resolve to fetchOwnerAdPerformance. $0 read-only.
 *  requireOwner() returns { email, ownerId } | { error }. */
export async function getAdPerformance(datePreset: string) {
  const gate = await requireOwner();
  if ("error" in gate) return { error: gate.error };
  return fetchOwnerAdPerformance(gate.ownerId, datePreset);
}
```
`packages/otto/src/context.ts`:插入上面的 `metaPerformance?` 端口类型(紧邻 `metaInsights`)。
`apps/web/lib/otto-actions.ts`:顶部加 `import { fetchOwnerAdPerformance } from "./meta-performance";`;注入块加：
```ts
metaPerformance: { getAds: (p: string) => fetchOwnerAdPerformance(ownerId, p) },
```

- [ ] **Step 4: Run tests → PASS** + `pnpm --filter @fikirtive/otto build`(端口类型编译)EXIT 0。

- [ ] **Step 5: Commit**

```bash
git add packages/otto/src/context.ts apps/web/lib/meta-performance-actions.ts apps/web/lib/meta-performance-actions.test.ts apps/web/lib/otto-actions.ts
git commit -m "feat(otto): metaPerformance port + getAdPerformance action (single action layer) + inject"
```

---

### Task 4: `metaAdPerformance` read skill + 注册 + CATALOG

> **Parity Manifest 说明:** 机器版 `packages/otto/src/parity-manifest.ts` + `check-parity.sh` **尚未建**(harmony 交付物,CI 未引用;现有 `metaInsights` 也无登记处)。故本 Task **不编那份 harmony 设计文档**(宪法层,founder/总审查员 维护)。parity 配对 `getAdPerformance` ↔ `meta-ad-performance`(读的对等)由 orchestrator 记进 P 块 spec §8 + ledger,待 manifest 落地时随分区回填。

**Files:**
- Create: `packages/otto/src/skills/meta-ad-performance.ts`
- Modify: `packages/otto/src/registry.ts`
- Modify: `packages/otto/src/skills/CATALOG.md`(由 `pnpm --filter @fikirtive/otto run catalog` 生成)
- Test: `packages/otto/src/skills/meta-ad-performance.test.ts`

**Interfaces:**
- Consumes: `defineOttoSkill`(skill.ts:68)、`OttoContext.metaPerformance`(Task 3)、`RunContext`(镜像 `meta-insights.ts:33-45`)。
- Produces:
  - `metaAdPerformanceSkill = defineOttoSkill({ name: "meta-ad-performance", cost: "free", effect: "read", reach: "external", description, parameters, execute })` → `needsApproval=false`。
  - `metaAdPerformanceInput = z.object({ datePreset: z.enum(["last_7d","last_14d","last_30d","last_90d"]).default("last_30d") })`。
  - `executeMetaAdPerformance(input, runContext)`:`ctx.metaPerformance?` 缺 → NOT_CONNECTED 消息;`getAds`;`"notConnected"|"needsReconnect" in res` → NOT_CONNECTED;否则回 `{ datePreset, fetchedAt, truncated, organic, ads }`。

- [ ] **Step 1: Write the failing test**

`packages/otto/src/skills/meta-ad-performance.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { metaAdPerformanceSkill, executeMetaAdPerformance } from "./meta-ad-performance.js";

describe("metaAdPerformanceSkill gate", () => {
  it("is a free external read → no approval", () => {
    expect(metaAdPerformanceSkill.cost).toBe("free");
    expect(metaAdPerformanceSkill.effect).toBe("read");
    expect(metaAdPerformanceSkill.reach).toBe("external");
    expect(metaAdPerformanceSkill.needsApproval).toBe(false);
  });
});

describe("executeMetaAdPerformance", () => {
  it("messages when the port is absent (not connected)", async () => {
    const r = await executeMetaAdPerformance({ datePreset: "last_30d" }, { context: {} as never });
    expect(JSON.stringify(r)).toMatch(/connect/i);
  });
  it("passes through ads + truncated + organic honestly", async () => {
    const ctx = { metaPerformance: { getAds: async () => ({ ads: [{ adId: "a1", adName: "One", accountId: "act_1", metrics: { ctr: "1.0" }, creative: null }], truncated: true, organic: { status: "pending_permission" }, datePreset: "last_30d", fetchedAt: "t" }) } };
    const r = await executeMetaAdPerformance({ datePreset: "last_30d" }, { context: ctx as never }) as Record<string, unknown>;
    expect(r.truncated).toBe(true);
    expect(r.organic).toEqual({ status: "pending_permission" });
    expect((r.ads as unknown[]).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/meta-ad-performance.test.ts`

- [ ] **Step 3: Implement skill**(镜像 `meta-insights.ts` 结构)

`packages/otto/src/skills/meta-ad-performance.ts`:
```ts
import { z } from "zod";
import type { RunContext } from "@openai/agents";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const NOT_CONNECTED = "Meta isn't connected yet, so I can't read your per-ad performance. Connect Meta in Settings first.";

export const metaAdPerformanceInput = z.object({
  datePreset: z.enum(["last_7d", "last_14d", "last_30d", "last_90d"]).default("last_30d")
    .describe("Reporting window for the per-ad performance numbers."),
});
export type MetaAdPerformanceInput = z.infer<typeof metaAdPerformanceInput>;

export async function executeMetaAdPerformance(
  input: MetaAdPerformanceInput, runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.metaPerformance) return { message: NOT_CONNECTED };
  const res = await ctx.metaPerformance.getAds(input.datePreset);
  if ("notConnected" in res || "needsReconnect" in res) return { message: NOT_CONNECTED };
  return { datePreset: res.datePreset, fetchedAt: res.fetchedAt, truncated: res.truncated, organic: res.organic, ads: res.ads };
}

export const metaAdPerformanceSkill = defineOttoSkill({
  name: "meta-ad-performance",
  cost: "free", effect: "read", reach: "external",
  description:
    "Read the user's PER-AD Meta performance (each ad's spend/reach/CTR/CPC/ROAS + its creative image & copy) " +
    "so you can tell which specific ads/creatives are winning vs losing. Read-only, $0, no approval. " +
    "Numbers are point-in-time — always cite the datePreset + fetchedAt. If organic is pending_permission, " +
    "say organic post performance isn't available yet (awaiting Meta permission) — never invent organic numbers.",
  parameters: metaAdPerformanceInput,
  execute: executeMetaAdPerformance,
});
```

- [ ] **Step 4: Register + CATALOG**

`registry.ts`:import `metaAdPerformanceSkill` + 加入 `allSkills`。
Run: `pnpm --filter @fikirtive/otto run catalog`(重生成 CATALOG.md)。
(Parity Manifest 机器文件未建 → 不编 harmony 设计文档;配对由 orchestrator 记 spec/ledger,见 Task 4 头说明。)

- [ ] **Step 5: Run tests + build**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/meta-ad-performance.test.ts` → PASS。
Run: `pnpm --filter @fikirtive/otto build && pnpm --filter @fikirtive/web build` → 两个 EXIT 0。

- [ ] **Step 6: Commit**

```bash
git add packages/otto/src/skills/meta-ad-performance.ts packages/otto/src/registry.ts packages/otto/src/skills/CATALOG.md packages/otto/src/skills/meta-ad-performance.test.ts
git commit -m "feat(otto): meta-ad-performance read skill (per-ad winners/losers) + registry"
```

---

### Task 5: 整片 P1a review(money $0 + 反捏造 + 双模 parity)

> orchestrator 派 fresh reviewer 审整支 P1a。**非 TDD,是门槛。**

- [ ] **Step 1:** Money:全链只读 GET,无 write 端点,无 spend path,money-path 文件零 diff;`getAdPerformance` action 只读。
- [ ] **Step 2:** 反捏造:`truncated` 如实标截断;organic 未授权 = `pending_permission`,无假 organic 数字;每条广告数字带 accountId,返回带 `datePreset`+`fetchedAt`(来源/周期/时间可追)。
- [ ] **Step 3:** 租户:`fetchOwnerAdPerformance` 全 ownerId 作用域;action 用 requireOwner;端口从 context ownerId 闭包;不信客户端 org。
- [ ] **Step 4:** 双模/parity:`fetchOwnerAdPerformance` 单一实现,端口 + action 都调它;skill=free/read/external 不审批;Parity Manifest 已登记。
- [ ] **Step 5:** 端口纪律:skill 只调 `ctx.metaPerformance`;`packages/otto` 无 prisma/pg;`ads_read` 覆盖 level=ad + creative(无新 scope)。build 两包 EXIT 0。
- [ ] **Step 6:** Critical/Important → fix subagent 修;全清 → P1a done。

---

## Self-Review

**1. Spec coverage:** spec §4 P1「metaPerformance 端口(付费逐条 + organic 权限门 + 素材,有界只读)」→ Task 1(逐条+creative)、Task 2(编排+有界+organic 门)、Task 3(端口+action+注入)、Task 4(skill+注册+parity);人工面 = P1b(不在本 plan)。宪法第 7 条单一动作层/读对等/parity → Task 3/4/5。反捏造 truncated/pending → Task 2/5。✅
**2. Placeholder scan:** 无 TBD;`requireOwner` = `./auth-guard`(`{email,ownerId}|{error}`,已写死);Parity Manifest 文件已确认存在,格式 = 实现时按其表登记;organic 真 fetch 推迟 = 明示决策(pending_permission 是当前 scope 下的完整诚实行为)。
**3. Type consistency:** `AdInsightsRow`/`AdCreative`(Task1)→ `OwnerAdRow`/`OwnerAdPerformance`(Task2)→ 端口类型(Task3)→ skill 透传(Task4)字段一致;`getAds(datePreset)` 端口方法名贯穿 Task3/4。✅

# Design spec — G6b · Meta analytics (read-only insights + Otto skill)

Date: 2026-06-28
Status: founder green-lit autonomous build ("你先冲，我这里自己来"); batch-review at the end.
Branch: `claude/otto-g6b-meta-insights` (off `claude/otto-g6a-meta-connect` — stacks on the G6a connector PR #61). Second slice of G6.

## 1. What this is

On top of the G6a connection, **Otto reads + analyses your Meta ad performance** — read-only. Two surfaces:
1. **`metaInsights` Otto skill** (free/read/external, like `researchWeb`): in chat, "how are my ads doing?"
   → Otto pulls the connected account's metrics and tells you what's working / what to fix.
2. **A light insights summary** on the Connections view: the key metrics per connected account (last 30d), at a glance.

Grounded in a real read (Kaia Cafe, last 30d): impressions 64,312 · reach 35,316 · CTR 2.76% · CPC MYR0.71 ·
**results/ROAS "Not available"** (no conversion tracking) — exactly the kind of insight Otto surfaces.

Still **read-only, zero ad spend**; owner-scoped; the token never leaves the server (G6a invariants).

## 2. Scope (G6b)

1. **Read client + owner-scoped fetch** — `getAccountInsights` (Graph `/act_<id>/insights`, GET) + `fetchOwnerInsights(ownerId, datePreset)` (load connection → decrypt → insights for the owner's accounts) + `getMetaInsights(datePreset?)` server action (the UI wrapper).
2. **`metaInsights` port + Otto skill** — `OttoContext.metaInsights` port; wired in `buildOttoContext`; a `metaInsights` skill (free/read/external) registered in the registry.
3. **Insights summary on the Connections view** — per-account metric cards (last 30d).

### Out of scope (later)
- ❌ Meta WRITE (campaigns/budgets — real spend), TikTok/Lazada/Shopee, publish.
- ❌ Campaign/ad-level drill-down, charts/trends, custom date pickers beyond a small preset set, the web-search half of research.
- ❌ Any spend/credit/fal change; any token-to-client exposure.

## 3. Current-stack seams (verified — reuse)

- **G6a connection** — `MetaConnection` (owner-scoped, encrypted token), `decryptToken`, the read-only Graph
  client (`metaGraphGet` — GET + `Authorization: Bearer`), `requireOwner`. G6b reuses all of these.
- **The external-read skill + port pattern** — `packages/otto/src/skills/research-web.ts` (free/read/external,
  reaches outside ONLY via `ctx.research`), `OttoContext.research` port (`context.ts:36`), wired in
  `buildOttoContext` (`apps/web/lib/otto-actions.ts`). The registry (`packages/otto/src/registry.ts`) — add
  one line. `metaInsights` mirrors this exactly.
- **Real Meta insights field set** (from a live probe): `spend, impressions, reach, frequency, clicks, ctr,
  cpc, cpm, purchase_roas, actions` — values may be `"Not available"`/absent (handle gracefully).

## 4. Architecture

### 4.1 Read client + owner-scoped fetch (`meta-graph.ts`, server-only; NOT `"use server"`)
- `getAccountInsights(token, adAccountId, datePreset): Promise<AccountMetrics | null>` — `metaGraphGet(token,
  \`\${adAccountId}/insights\`, { fields: "spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,purchase_roas", date_preset })`;
  map `data[0]` → `AccountMetrics` (each field a string or null; null when absent/"Not available"). `adAccountId`
  is the account's `id` (already `act_<num>`).
- `fetchOwnerInsights(ownerId, datePreset): Promise<{ accounts: AccountInsights[] } | { needsReconnect: true } | { notConnected: true }>` —
  load `MetaConnection` (none → `notConnected`); decrypt (fail → `needsReconnect`); list the owner's ad
  accounts (reuse the G6a `/me/adaccounts` read); for each, `getAccountInsights`; return
  `[{ accountId, name, metrics }]`. A Graph auth error → `{ needsReconnect: true }`. **This is a plain
  server function (NOT an exported server action), so it's reachable only server-side** — no IDOR surface.
  `type AccountMetrics = { spend, impressions, reach, frequency, clicks, ctr, cpc, cpm, purchaseRoas: string | null }`.
  `type AccountInsights = { accountId: string; name: string; metrics: AccountMetrics }`.

### 4.2 Server action + skill port
- `meta-actions.ts` (`"use server"`): `getMetaInsights(datePreset?: string): Promise<{ accounts } | { needsReconnect } | { notConnected } | { error }>` — `requireOwner` → `fetchOwnerInsights(gate.ownerId, datePreset ?? "last_30d")`. **Never returns the token.** (The UI calls this.)
- `OttoContext` (`packages/otto/src/context.ts`): add
  `metaInsights?: { get(datePreset: string): Promise<{ accounts: AccountInsights[] } | { needsReconnect: true } | { notConnected: true }> }`.
- `buildOttoContext` (`apps/web/lib/otto-actions.ts`): wire `metaInsights: { get: (dp) => fetchOwnerInsights(ownerId, dp) }` (ownerId from the verified context — no client identity).
- **`metaInsights` skill** (`packages/otto/src/skills/meta-insights.ts`): `defineOttoSkill({ name:"meta-insights",
  cost:"free", effect:"read", reach:"external", parameters: z.object({ datePreset: z.enum(["last_7d","last_14d","last_30d","last_90d"]).default("last_30d") }), execute })`.
  `execute` → if `!ctx.metaInsights` return a graceful "not available" message; else `ctx.metaInsights.get(input.datePreset)`;
  map `notConnected`/`needsReconnect` to a plain message telling the user to connect Meta; else return the
  metrics (Otto analyses them in its reply). Register in `registry.ts` (one line).

### 4.3 Insights summary on the Connections view
`OttoConnections.tsx` — when connected, call `getMetaInsights("last_30d")` and render a small metric summary
per account (spend · impressions · reach · CTR · CPC · ROAS-or-"no conversion tracking"). Reuses the existing
connected/needsReconnect states. No new view.

## 5. Money / safety
- **Read-only, zero spend.** Only GET insights via the existing Bearer-header client; no write/POST to ad data;
  no credit/fal path. The skill is `free/read/external` (needsApproval = false, correct).
- **Token never to client.** `getMetaInsights`/the skill return only mapped metric strings; the decrypted token
  stays inside `fetchOwnerInsights`. `fetchOwnerInsights(ownerId,…)` is NOT an exported server action (no IDOR).
- **Owner-scoped.** `getMetaInsights` gates `requireOwner`; the skill port uses the verified `ctx.orgId`;
  insights are only ever the caller's own connected accounts.

## 6. Testing
- **Unit (mock fetch + prisma):** `getAccountInsights` maps a Graph insights response (+ null/"Not available"
  → null); `fetchOwnerInsights` → `notConnected` (no row) / `needsReconnect` (decrypt or auth error) / mapped
  accounts; `getMetaInsights` returns metrics and **no token** in the JSON (assert `JSON.stringify` excludes the
  token + `accessTokenEnc`); the `metaInsights` skill is `free/read/external` and returns a graceful message when
  the port is absent / not connected.
- **Build:** full `pnpm -r build` → `├ ƒ /otto` + `Done`; `tsc` 0.
- **Manual (needs the deployed Meta App + a connected account — local mock):** chat "how are my ads doing?" →
  Otto reads + analyses; Connections shows the metric summary.

## 7. Open questions
None blocking. v1 pulls account-level only (campaign/ad drill-down + trends are follow-ups). Date presets limited
to a small set. Spend currency comes from the account (G6a already surfaces it).

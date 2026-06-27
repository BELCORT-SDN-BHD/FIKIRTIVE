# Design spec — G6a · Connect Meta (multi-tenant, read-only)

Date: 2026-06-28
Status: approved by founder (design); autonomous build, batch-review at the end.
Branch: `claude/otto-g6a-meta-connect` (off `main` = ca913d7). First slice of G6 (connectors).

## 1. What this is

A **multi-tenant, read-only Meta (Facebook) Ads OAuth connector**. A new **Connections** view has a
**"Connect Meta"** button; any user authorizes Otto to READ their ad data; Otto stores *their* token
(encrypted, owner-scoped) and shows *their* connected ad accounts. This slice is the **plumbing** —
it proves the OAuth → token → read-call pipe end-to-end. **Analytics (Otto pulling + analysing the
numbers) is the next slice, G6b.**

This is the most **security-sensitive** build in the project (a stored OAuth token grants access to a
user's ad accounts), so the design is conservative: read-only scope, encrypted at rest, CSRF-safe,
owner-scoped, token never leaves the server.

Founder decisions (brainstorming): multi-tenant ("每个 user 都能连自己的") · **read-only first**
(`ads_read`, no ad spend) · G6a = connect + list accounts (analytics → G6b) · the one prerequisite is
BELCORT creating a Meta App.

## 2. Scope (G6a)

1. **`MetaConnection` model** (one per owner) + migration.
2. **`token-encryption.ts`** — AES-256-GCM encrypt/decrypt at rest (net-new; no util exists).
3. **OAuth flow** — `/api/meta/authorize` (build the Meta consent URL, CSRF `state`) + `/api/meta/callback`
   (verify state, exchange code → long-lived token, store encrypted, owner-scoped).
4. **`MetaGraphClient`** (server-only) — read-only Graph GET; `getMyAdAccounts` (`/me/adaccounts`).
5. **Server actions** (`meta-actions.ts`) — `getMetaConnection` (status + accounts, **never** the token),
   `disconnectMeta` (delete the row).
6. **`OttoConnections`** view + nav entry (`OttoViewKey` += `"connections"`).

### Out of scope (later)
- ❌ Analytics / insights / Otto skill (G6b).
- ❌ Meta **WRITE** (create campaign/audience/catalog → real ad spend) — far later, separately gated.
- ❌ TikTok / Lazada / Shopee connectors; social-publish.
- ❌ Token auto-refresh (v1 surfaces "reconnect" on expiry); deauthorization webhook.

## 3. Current-stack seams (verified — reuse)

- **`requireOwner()`** (`apps/web/lib/auth-guard.ts`) works in **route handlers** (proven by
  `app/api/otto/stream/route.ts`, `app/files/[...key]/route.ts`). The OAuth routes gate with it;
  identity comes ONLY from the session, never the OAuth payload.
- **Env / base URL** — `BETTER_AUTH_URL` is the canonical origin → redirect URI =
  `${BETTER_AUTH_URL}/api/meta/callback`. `BETTER_AUTH_SECRET` already exists (reused as the `state`
  HMAC key). New env (BELCORT sets): `META_APP_ID`, `META_APP_SECRET`, `TOKEN_ENCRYPTION_KEY` (32-byte hex).
- **Owner-scoped Prisma model convention** — `id`/`ownerId`/`organization @relation`/`@@index([ownerId,…])`
  (mirror `BrandKit`/`ChatThread`). Migrations = hand-written SQL dirs.
- **Nav/view pattern** — `OttoViewKey` (`OttoApp.tsx:44`) + `OttoNav` `NAV_ITEMS` + `OttoView` branch
  (used 6×). No existing Meta/Facebook code (net-new).

## 4. Architecture

### 4.1 `MetaConnection` (Prisma, owner-scoped, one-per-owner)
```
model MetaConnection {
  id             String   @id
  ownerId        String   @unique
  organization   Organization @relation(fields: [ownerId], references: [id])
  metaUserId     String?
  accessTokenEnc String              // AES-256-GCM ciphertext (iv:tag:ct), never plaintext
  tokenExpiresAt DateTime?
  scope          String              // "ads_read"
  status         String   @default("active") // "active" | "expired"
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```
One Meta login per owner. **Disconnect = hard-delete** the row (purge the token), not soft-delete.
Re-connect = upsert by `ownerId`.

### 4.2 `token-encryption.ts` (`apps/web/lib/`, server-only)
`encryptToken(plain: string): string` / `decryptToken(enc: string): string` using `node:crypto`
AES-256-GCM. Key = `Buffer.from(TOKEN_ENCRYPTION_KEY, "hex")` (must be 32 bytes). Format =
`base64(iv) . base64(authTag) . base64(ciphertext)` (random 12-byte IV per call). A tampered
ciphertext fails the GCM auth tag → `decryptToken` throws. Pure given the env key.

### 4.3 OAuth `state` (CSRF) — `meta-oauth.ts` (`apps/web/lib/`, server-only, pure helpers)
`signState(ownerId): string` = `base64url({ownerId, nonce, ts}) + "." + HMAC_SHA256(payload, BETTER_AUTH_SECRET)`.
`verifyState(state): { ownerId } | null` — recompute HMAC (constant-time compare), reject if mismatch
or `ts` older than 10 min. Also `buildAuthorizeUrl(redirectUri, state)` (pure): the Meta consent URL
with `client_id`, `redirect_uri`, `scope=ads_read`, `response_type=code`, `state`.

### 4.4 Route handlers
- **`GET /api/meta/authorize`** — `requireOwner` (→ `/login` on error). If `META_APP_ID` unset → redirect
  `…?view=connections&error=not_configured`. Else `state = signState(ownerId)` → redirect to
  `buildAuthorizeUrl(redirectUri, state)`.
- **`GET /api/meta/callback`** — `requireOwner`. Read `code`,`state`. `verifyState(state)` → reject (redirect
  `…&error=state`) if null OR `state.ownerId !== ownerId`. Exchange `code` → short-lived token
  (`oauth/access_token`, server-side with `META_APP_SECRET`), then short → long-lived
  (`grant_type=fb_exchange_token`); read `expires_in`. Optionally `GET /me` for `metaUserId`. Encrypt
  the long-lived token; `upsert` `MetaConnection` for `ownerId` (status `active`, scope `ads_read`).
  Redirect `…?view=connections&connected=meta`. Any exchange error → redirect `…&error=exchange`.

### 4.5 `MetaGraphClient` (`apps/web/lib/meta-graph.ts`, server-only)
`metaGraphGet(token, path, params): Promise<any>` → `fetch` `https://graph.facebook.com/${VERSION}/${path}`
with `access_token` + params, JSON parse, throw on non-200. **Read-only** (GET only; no POST/DELETE).
`getMyAdAccounts(ownerId): Promise<{accounts} | {error} | {needsReconnect}>` — load the owner's
`MetaConnection`, decrypt the token, `metaGraphGet(token, "me/adaccounts", {fields:"name,account_status,currency,account_id"})`,
map to `{ id, name, currency, status }[]`. On a Meta auth error (expired/invalid token) → set
`status="expired"`, return `{ needsReconnect: true }`.

### 4.6 Server actions — `apps/web/lib/meta-actions.ts` (`"use server"`)
- `getMetaConnection(): Promise<{ connected: boolean; status?: string; accounts?: {id,name,currency,status}[]; needsReconnect?: boolean } | {error}>` — `requireOwner`; if no row → `{connected:false}`; else call `getMyAdAccounts`. **Never returns the token.**
- `disconnectMeta(): Promise<{ok:true}|{error}>` — `requireOwner`; `deleteMany({where:{ownerId}})`.

### 4.7 `OttoConnections` view + nav
`apps/web/components/otto/OttoConnections.tsx` (client): on mount calls `getMetaConnection()`.
- Not connected → a "Connect Meta" button = `<a href="/api/meta/authorize">`.
- Connected → list ad accounts (name · status · currency) + a "Disconnect" button (`disconnectMeta` → refresh).
- `needsReconnect` → a "Reconnect" prompt. Reads `?connected`/`?error` query for a toast.
Nav: `OttoViewKey` += `"connections"`; `OttoNav` item (`IconLink`) after `account`; `OttoView` branch.

## 5. Money / safety
- **Zero spend.** Scope is `ads_read` only — the connector can READ ad data, never create/modify ads or
  spend ad budget. No fal/credit path touched. (Meta WRITE is a separate, far-later, gated PR.)
- **Token security.** Encrypted at rest (AES-256-GCM); decrypted only server-side at the moment of a
  Graph call; **never** serialized to the client (server actions return account names/status only).
- **CSRF + owner binding.** Signed `state` (HMAC, 10-min TTL) + `requireOwner` on both routes + the
  `state.ownerId === session.ownerId` check. The stored connection is keyed by the **session** ownerId,
  never the OAuth response. Each owner's connection + accounts are fully isolated.
- **Scope minimization, no write tools.** The Graph client is GET-only.

## 6. Testing
- **Unit (mockable locally — no Meta App needed):** `token-encryption` round-trip + tamper→throw +
  wrong-length key→throw; `signState`/`verifyState` (valid, tampered→null, expired→null); `getMetaConnection`
  never includes the token + owner-scoped; `disconnectMeta` deletes only the owner's row; `getMyAdAccounts`
  maps a mocked Graph response + flips to `needsReconnect` on a mocked auth error; `buildAuthorizeUrl`
  contains `scope=ads_read` + the redirect; the callback stores the token under the `requireOwner`
  ownerId (mocked `fetch` for the exchange) and encrypts it.
- **Build:** `pnpm --filter @fikirtive/db run build` after the schema; full `pnpm -r build` → `├ ƒ /otto` + `Done`; `tsc` 0.
- **Manual (needs BELCORT's Meta App + a deployed callback — local is mock):** click Connect Meta → Meta
  consent → callback → Connections shows the ad accounts → Disconnect removes them.

## 7. Open questions
None blocking. Graph API version pinned to a recent stable const (`META_GRAPH_VERSION = "v21.0"`),
overridable later. Long-lived-token auto-refresh and a deauth webhook are deferred follow-ups.

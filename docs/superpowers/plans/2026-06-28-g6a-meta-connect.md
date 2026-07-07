# G6a — Connect Meta (read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A multi-tenant, read-only Meta OAuth connector — users connect their Meta account, Otto stores the token encrypted+owner-scoped and lists their ad accounts.

**Architecture:** All security-critical logic (AES-256-GCM token crypto, HMAC OAuth `state`, code→token exchange, owner-scoped storage, the read-only Graph client) lives in unit-tested libs; the two route handlers and the Connections UI are thin wiring over them. Read-only scope (`ads_read`) — no ad spend possible.

**Tech Stack:** Next.js App Router route handlers, Prisma 7.8 + Postgres, `node:crypto` (AES-256-GCM + HMAC), Better Auth (`requireOwner` in route handlers), Meta Graph API v21.0, vitest 3.2 (fetch + prisma mocked).

## Global Constraints

- **Read-only, zero spend** — OAuth scope is `ads_read` ONLY; the Graph client is GET-only (no POST/DELETE, no write tools). No fal/credit/spend file is touched. Meta WRITE is a separate, far-later, gated PR.
- **Token security** — the access token is encrypted at rest (AES-256-GCM); decrypted ONLY server-side at the moment of a Graph call; NEVER returned to the client (server actions return account names/status only).
- **Owner-scoped + CSRF-safe** — the stored connection is keyed by the **session** `ownerId` (`requireOwner`), never the OAuth payload; the signed `state` is verified AND `state.ownerId === session.ownerId` is checked on callback.
- **Scope string is exactly `"ads_read"`**; **Graph version is exactly `"v21.0"`** (a shared const `META_GRAPH_VERSION`).
- **New env (BELCORT sets; NOT committed):** `META_APP_ID`, `META_APP_SECRET`, `TOKEN_ENCRYPTION_KEY` (32-byte hex = 64 hex chars). Reuse existing `BETTER_AUTH_SECRET` (state HMAC key) + `BETTER_AUTH_URL` (redirect-URI base).
- **After the schema change, rebuild the db package** — `pnpm --filter @fikirtive/db run build` (not just generate).
- **Test runner** — `cd apps/web && pnpm exec vitest run <path>`.
- **Build gate** — `pnpm -r build` shows `├ ƒ /otto` + `Done`; grep the log.
- **Verification boundary** — the LIVE OAuth round-trip needs BELCORT's Meta App + a deployed callback (local is mock). Unit tests mock `fetch` (the Graph exchange) + prisma; that's the automated coverage.

---

### Task 1: `MetaConnection` model + `token-encryption.ts`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (new `MetaConnection` model + the `Organization` back-relation)
- Create: `packages/db/prisma/migrations/20260628140000_meta_connection/migration.sql`
- Create: `apps/web/lib/token-encryption.ts`
- Test: `apps/web/lib/__tests__/token-encryption.test.ts`

**Interfaces:**
- Produces: `encryptToken(plain: string): string` / `decryptToken(enc: string): string` (AES-256-GCM, key from `TOKEN_ENCRYPTION_KEY`). `MetaConnection` Prisma model (one per owner, `ownerId @unique`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/__tests__/token-encryption.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { encryptToken, decryptToken } from "../token-encryption";

beforeAll(() => {
  // 32-byte key as 64 hex chars
  process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);
});

describe("token-encryption (AES-256-GCM)", () => {
  it("round-trips a token", () => {
    const t = "EAAB_long_lived_meta_token_xyz";
    expect(decryptToken(encryptToken(t))).toBe(t);
  });
  it("produces a different ciphertext each call (random IV)", () => {
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });
  it("throws on a tampered ciphertext (GCM auth)", () => {
    const enc = encryptToken("secret");
    const parts = enc.split(".");
    const ct = Buffer.from(parts[2], "base64"); ct[0] ^= 0xff; // flip a byte
    const tampered = [parts[0], parts[1], ct.toString("base64")].join(".");
    expect(() => decryptToken(tampered)).toThrow();
  });
  it("throws when the key is the wrong length", () => {
    const prev = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = "abcd"; // too short
    expect(() => encryptToken("x")).toThrow();
    process.env.TOKEN_ENCRYPTION_KEY = prev;
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/token-encryption.test.ts`
Expected: FAIL — cannot find module `../token-encryption`.

- [ ] **Step 3: Implement `token-encryption.ts`**

Create `apps/web/lib/token-encryption.ts`:

```ts
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const k = Buffer.from(hex, "hex");
  if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  return k;
}

/** Encrypt → "base64(iv).base64(tag).base64(ciphertext)" with a random 12-byte IV per call. */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

/** Decrypt; throws if the key is wrong or the ciphertext/tag was tampered (GCM auth). */
export function decryptToken(enc: string): string {
  const parts = enc.split(".");
  if (parts.length !== 3) throw new Error("malformed ciphertext");
  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const ct = Buffer.from(parts[2], "base64");
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/token-encryption.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the Prisma model + migration**

In `packages/db/prisma/schema.prisma`, add the model (place near the other owner-scoped models):

```prisma
// G6a: a user's connected Meta (Facebook) Ads account. One per owner. The access token is
// AES-256-GCM encrypted at rest (apps/web/lib/token-encryption.ts) and never leaves the server.
model MetaConnection {
  id             String   @id
  ownerId        String   @unique
  organization   Organization @relation(fields: [ownerId], references: [id])
  metaUserId     String?
  accessTokenEnc String   // encrypted; never plaintext, never sent to the client
  tokenExpiresAt DateTime?
  scope          String   // "ads_read"
  status         String   @default("active") // "active" | "expired"
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

Add the back-relation to the `Organization` model (find `model Organization` and add a field alongside its other relations):

```prisma
  metaConnection MetaConnection?
```

Create `packages/db/prisma/migrations/20260628140000_meta_connection/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "MetaConnection" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "metaUserId" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MetaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetaConnection_ownerId_key" ON "MetaConnection"("ownerId");

-- AddForeignKey
ALTER TABLE "MetaConnection" ADD CONSTRAINT "MetaConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 6: Rebuild the db package**

Run: `pnpm --filter @fikirtive/db run build`
Expected: "Generated Prisma Client" + clean tsc.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260628140000_meta_connection apps/web/lib/token-encryption.ts apps/web/lib/__tests__/token-encryption.test.ts
git commit -m "feat(g6a): MetaConnection model + AES-256-GCM token encryption"
```

---

### Task 2: `meta-oauth.ts` — signed `state` + authorize-URL builder

**Files:**
- Create: `apps/web/lib/meta-oauth.ts`
- Test: `apps/web/lib/__tests__/meta-oauth.test.ts`

**Interfaces:**
- Produces: `META_GRAPH_VERSION` (`"v21.0"`); `signState(ownerId, now?): string`; `verifyState(state, now?): { ownerId: string } | null`; `buildAuthorizeUrl(appId, redirectUri, state): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/__tests__/meta-oauth.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { signState, verifyState, buildAuthorizeUrl, META_GRAPH_VERSION } from "../meta-oauth";

beforeAll(() => { process.env.BETTER_AUTH_SECRET = "test-secret-123"; });

describe("OAuth state (HMAC, CSRF)", () => {
  it("round-trips the ownerId", () => {
    const s = signState("org_abc");
    expect(verifyState(s)).toEqual({ ownerId: "org_abc" });
  });
  it("rejects a tampered payload", () => {
    const s = signState("org_abc");
    const dot = s.lastIndexOf(".");
    const bad = "x" + s.slice(1, dot) + s.slice(dot); // mutate payload, keep sig
    expect(verifyState(bad)).toBeNull();
  });
  it("rejects a tampered signature", () => {
    const s = signState("org_abc");
    expect(verifyState(s.slice(0, -2) + "zz")).toBeNull();
  });
  it("rejects an expired state (>10 min)", () => {
    const t0 = 1_000_000_000_000;
    const s = signState("org_abc", t0);
    expect(verifyState(s, t0 + 11 * 60 * 1000)).toBeNull();
    expect(verifyState(s, t0 + 5 * 60 * 1000)).toEqual({ ownerId: "org_abc" });
  });
  it("rejects malformed input", () => {
    expect(verifyState("garbage")).toBeNull();
  });
});

describe("buildAuthorizeUrl", () => {
  it("requests ads_read with the redirect + state", () => {
    const u = new URL(buildAuthorizeUrl("APPID", "https://app/api/meta/callback", "STATE"));
    expect(u.hostname).toBe("www.facebook.com");
    expect(u.pathname).toContain(META_GRAPH_VERSION);
    expect(u.searchParams.get("client_id")).toBe("APPID");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app/api/meta/callback");
    expect(u.searchParams.get("scope")).toBe("ads_read");
    expect(u.searchParams.get("state")).toBe("STATE");
    expect(u.searchParams.get("response_type")).toBe("code");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/meta-oauth.test.ts`
Expected: FAIL — cannot find module `../meta-oauth`.

- [ ] **Step 3: Implement `meta-oauth.ts`**

Create `apps/web/lib/meta-oauth.ts`:

```ts
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export const META_GRAPH_VERSION = "v21.0";
const STATE_TTL_MS = 10 * 60 * 1000;

function stateSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set");
  return s;
}
function hmac(data: string): string {
  return createHmac("sha256", stateSecret()).update(data).digest("base64url");
}

/** Signed CSRF state: base64url({o,n,t}) + "." + HMAC. */
export function signState(ownerId: string, now: number = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ o: ownerId, n: randomBytes(8).toString("hex"), t: now }),
  ).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

/** Verify the state's HMAC + TTL; returns { ownerId } or null. Constant-time signature compare. */
export function verifyState(state: string, now: number = Date.now()): { ownerId: string } | null {
  const dot = state.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: { o?: string; t?: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed.o || typeof parsed.t !== "number") return null;
  if (now - parsed.t > STATE_TTL_MS) return null;
  return { ownerId: parsed.o };
}

/** The Meta OAuth consent URL — read-only ads_read scope. */
export function buildAuthorizeUrl(appId: string, redirectUri: string, state: string): string {
  const u = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", "ads_read");
  u.searchParams.set("response_type", "code");
  return u.toString();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/meta-oauth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/meta-oauth.ts apps/web/lib/__tests__/meta-oauth.test.ts
git commit -m "feat(g6a): signed OAuth state (HMAC CSRF) + ads_read authorize URL builder"
```

---

### Task 3: Graph client + server actions (`meta-graph.ts`, `meta-actions.ts`)

**Files:**
- Create: `apps/web/lib/meta-graph.ts` (token exchange + read-only Graph GET)
- Create: `apps/web/lib/meta-actions.ts` (`"use server"` — connect/read/disconnect)
- Test: `apps/web/lib/__tests__/meta-actions.test.ts`

**Interfaces:**
- Consumes: `encryptToken`/`decryptToken` (Task 1), `META_GRAPH_VERSION` (Task 2).
- Produces:
  - `exchangeCodeForToken(code, redirectUri): Promise<{ token: string; expiresAt: Date | null } | { error: string }>`
  - `metaGraphGet(token, path, params): Promise<any>` (GET only)
  - `completeMetaConnect(ownerId, code, redirectUri): Promise<{ ok: true } | { error: string }>`
  - `getMetaConnection(): Promise<{ connected: boolean; status?: string; accounts?: MetaAdAccount[]; needsReconnect?: boolean } | { error: string }>`
  - `disconnectMeta(): Promise<{ ok: true } | { error: string }>`
  - `type MetaAdAccount = { id: string; name: string; currency: string; status: string }`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/__tests__/meta-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockFindUnique, mockUpsert, mockUpdate, mockDeleteMany, mockFetch } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: { metaConnection: { findUnique: mockFindUnique, upsert: mockUpsert, update: mockUpdate, deleteMany: mockDeleteMany } },
}));
vi.mock("@fikirtive/core", () => ({ newId: () => "mc-1" }));
// Encrypt/decrypt are real (deterministic round-trip under a fixed key set below).

import { completeMetaConnect, getMetaConnection, disconnectMeta } from "../meta-actions";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);
  process.env.BETTER_AUTH_SECRET = "s";
  process.env.META_APP_ID = "APPID";
  process.env.META_APP_SECRET = "APPSECRET";
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
  vi.stubGlobal("fetch", mockFetch);
});

function jsonRes(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

describe("completeMetaConnect", () => {
  it("exchanges the code, encrypts the long-lived token, upserts owner-scoped", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonRes({ access_token: "short" }))               // short-lived
      .mockResolvedValueOnce(jsonRes({ access_token: "LONGTOKEN", expires_in: 5184000 })); // long-lived
    mockUpsert.mockResolvedValue({ id: "mc-1" });
    const res = await completeMetaConnect("u1", "the-code", "https://app/api/meta/callback");
    expect(res).toEqual({ ok: true });
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where).toEqual({ ownerId: "u1" });
    // the stored token is ENCRYPTED, not the plaintext
    expect(call.create.accessTokenEnc).not.toContain("LONGTOKEN");
    expect(call.create.scope).toBe("ads_read");
    expect(call.create.status).toBe("active");
  });
  it("returns an error when the exchange fails", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes({ error: { message: "bad" } }, false));
    expect(await completeMetaConnect("u1", "x", "https://app/cb")).toEqual({ error: "exchange" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("getMetaConnection", () => {
  it("returns connected:false when there is no row", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await getMetaConnection()).toEqual({ connected: false });
  });
  it("returns accounts and NEVER the token", async () => {
    // first findUnique: status row; second findUnique (inside getMyAdAccounts): full row with enc token
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique
      .mockResolvedValueOnce({ status: "active" })
      .mockResolvedValueOnce({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch.mockResolvedValueOnce(jsonRes({ data: [{ account_id: "act_1", name: "Kaia Cafe", currency: "MYR", account_status: 1 }] }));
    const res = await getMetaConnection();
    expect(res).toEqual({ connected: true, status: "active", accounts: [{ id: "act_1", name: "Kaia Cafe", currency: "MYR", status: "1" }] });
    expect(JSON.stringify(res)).not.toContain("LONGTOKEN");
    expect(JSON.stringify(res)).not.toContain("accessTokenEnc");
  });
  it("flags needsReconnect + marks expired on a Graph auth error", async () => {
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique
      .mockResolvedValueOnce({ status: "active" })
      .mockResolvedValueOnce({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch.mockResolvedValueOnce(jsonRes({ error: { message: "invalid token", code: 190 } }, false));
    mockUpdate.mockResolvedValue({});
    const res = await getMetaConnection();
    expect(res).toEqual({ connected: true, status: "expired", needsReconnect: true });
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: "u1" }, data: { status: "expired" } }));
  });
});

describe("disconnectMeta", () => {
  it("deletes only the caller's row", async () => {
    mockDeleteMany.mockResolvedValue({ count: 1 });
    expect(await disconnectMeta()).toEqual({ ok: true });
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { ownerId: "u1" } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/meta-actions.test.ts`
Expected: FAIL — cannot find module `../meta-actions`.

- [ ] **Step 3: Implement `meta-graph.ts`**

Create `apps/web/lib/meta-graph.ts`:

```ts
import { META_GRAPH_VERSION } from "./meta-oauth";

/** Read-only Graph GET. Throws on a non-200 or a Meta `error` body (carries `metaError`). */
export async function metaGraphGet(token: string, path: string, params: Record<string, string>): Promise<any> {
  const u = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  const r = await fetch(u.toString());
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

  const shortUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
  shortUrl.searchParams.set("client_id", appId);
  shortUrl.searchParams.set("redirect_uri", redirectUri);
  shortUrl.searchParams.set("client_secret", secret);
  shortUrl.searchParams.set("code", code);
  const sr = await fetch(shortUrl.toString());
  const sj = await sr.json().catch(() => ({}));
  if (!sr.ok || !sj.access_token) return { error: "exchange" };

  const longUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", appId);
  longUrl.searchParams.set("client_secret", secret);
  longUrl.searchParams.set("fb_exchange_token", sj.access_token);
  const lr = await fetch(longUrl.toString());
  const lj = await lr.json().catch(() => ({}));
  if (!lr.ok || !lj.access_token) return { error: "exchange" };

  const expiresAt = typeof lj.expires_in === "number" ? new Date(Date.now() + lj.expires_in * 1000) : null;
  return { token: lj.access_token, expiresAt };
}
```

- [ ] **Step 4: Implement `meta-actions.ts`**

Create `apps/web/lib/meta-actions.ts`:

```ts
"use server";

import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { encryptToken, decryptToken } from "./token-encryption";
import { exchangeCodeForToken, metaGraphGet } from "./meta-graph";

export type MetaAdAccount = { id: string; name: string; currency: string; status: string };

/** Called by the callback route AFTER requireOwner + verifyState. Owner id is the SESSION owner. */
export async function completeMetaConnect(
  ownerId: string,
  code: string,
  redirectUri: string,
): Promise<{ ok: true } | { error: string }> {
  const ex = await exchangeCodeForToken(code, redirectUri);
  if ("error" in ex) return ex;
  const enc = encryptToken(ex.token);
  const data = { accessTokenEnc: enc, tokenExpiresAt: ex.expiresAt, scope: "ads_read", status: "active" };
  await prisma.metaConnection.upsert({
    where: { ownerId },
    update: data,
    create: { id: newId(), ownerId, ...data },
  });
  return { ok: true };
}

/** Read-only: the owner's connected ad accounts via their decrypted token. Never returns the token. */
async function getMyAdAccounts(ownerId: string): Promise<{ accounts: MetaAdAccount[] } | { needsReconnect: true }> {
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
  if (!conn) return { needsReconnect: true };
  let token: string;
  try {
    token = decryptToken(conn.accessTokenEnc);
  } catch {
    return { needsReconnect: true };
  }
  try {
    const j = await metaGraphGet(token, "me/adaccounts", { fields: "name,account_status,currency,account_id" });
    const accounts: MetaAdAccount[] = (j.data ?? []).map((a: Record<string, unknown>) => ({
      id: String(a.account_id ?? a.id ?? ""),
      name: String(a.name ?? ""),
      currency: String(a.currency ?? ""),
      status: String(a.account_status ?? ""),
    }));
    return { accounts };
  } catch {
    await prisma.metaConnection.update({ where: { ownerId }, data: { status: "expired" } }).catch(() => {});
    return { needsReconnect: true };
  }
}

export async function getMetaConnection(): Promise<
  { connected: boolean; status?: string; accounts?: MetaAdAccount[]; needsReconnect?: boolean } | { error: string }
> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId: gate.ownerId }, select: { status: true } });
  if (!conn) return { connected: false };
  const res = await getMyAdAccounts(gate.ownerId);
  if ("needsReconnect" in res) return { connected: true, status: "expired", needsReconnect: true };
  return { connected: true, status: conn.status, accounts: res.accounts };
}

export async function disconnectMeta(): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  await prisma.metaConnection.deleteMany({ where: { ownerId: gate.ownerId } });
  return { ok: true };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/meta-actions.test.ts`
Expected: PASS (exchange/encrypt/upsert; token never serialized; needsReconnect on auth error; owner-scoped disconnect).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/meta-graph.ts apps/web/lib/meta-actions.ts apps/web/lib/__tests__/meta-actions.test.ts
git commit -m "feat(g6a): read-only Graph client + connect/read/disconnect actions (token never leaves server)"
```

---

### Task 4: OAuth route handlers (`/api/meta/authorize` + `/api/meta/callback`)

**Files:**
- Create: `apps/web/app/api/meta/authorize/route.ts`
- Create: `apps/web/app/api/meta/callback/route.ts`

**Interfaces:**
- Consumes: `requireOwner` (`@/lib/auth-guard`), `signState`/`verifyState`/`buildAuthorizeUrl` (Task 2), `completeMetaConnect` (Task 3).

> Thin wiring; no unit test (route handlers call `requireOwner` + redirect). Verified by `tsc` + the build gate + manual OAuth (needs the Meta App).

- [ ] **Step 1: Implement `/api/meta/authorize`**

Create `apps/web/app/api/meta/authorize/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-guard";
import { signState, buildAuthorizeUrl } from "@/lib/meta-oauth";

export async function GET(req: NextRequest) {
  const base = process.env.BETTER_AUTH_URL ?? new URL(req.url).origin;
  const gate = await requireOwner();
  if ("error" in gate) return NextResponse.redirect(new URL("/login", base));
  const appId = process.env.META_APP_ID;
  if (!appId) return NextResponse.redirect(new URL("/otto?view=connections&error=not_configured", base));
  const redirectUri = new URL("/api/meta/callback", base).href;
  return NextResponse.redirect(buildAuthorizeUrl(appId, redirectUri, signState(gate.ownerId)));
}
```

- [ ] **Step 2: Implement `/api/meta/callback`**

Create `apps/web/app/api/meta/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-guard";
import { verifyState } from "@/lib/meta-oauth";
import { completeMetaConnect } from "@/lib/meta-actions";

export async function GET(req: NextRequest) {
  const base = process.env.BETTER_AUTH_URL ?? new URL(req.url).origin;
  const gate = await requireOwner();
  if ("error" in gate) return NextResponse.redirect(new URL("/login", base));

  const sp = new URL(req.url).searchParams;
  const code = sp.get("code");
  const state = sp.get("state");
  const back = new URL("/otto?view=connections", base);

  if (!code || !state) {
    back.searchParams.set("error", "missing");
    return NextResponse.redirect(back);
  }
  const verified = verifyState(state);
  if (!verified || verified.ownerId !== gate.ownerId) {
    back.searchParams.set("error", "state");
    return NextResponse.redirect(back);
  }
  const redirectUri = new URL("/api/meta/callback", base).href;
  const res = await completeMetaConnect(gate.ownerId, code, redirectUri);
  if ("error" in res) {
    back.searchParams.set("error", res.error);
    return NextResponse.redirect(back);
  }
  back.searchParams.set("connected", "meta");
  return NextResponse.redirect(back);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: 0 errors. (Confirm `NextRequest`/`NextResponse` import path matches existing route handlers, e.g. `app/api/otto/stream/route.ts`; adapt if the repo uses a different signature.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/meta/authorize/route.ts apps/web/app/api/meta/callback/route.ts
git commit -m "feat(g6a): /api/meta/authorize + /api/meta/callback (requireOwner + state-verified, owner-scoped)"
```

---

### Task 5: `OttoConnections` view + nav + initial-view wiring + final build gate

**Files:**
- Create: `apps/web/components/otto/OttoConnections.tsx`
- Modify: `apps/web/components/otto/OttoApp.tsx` (`OttoViewKey` += `"connections"`; accept an optional `initialView`)
- Modify: `apps/web/components/otto/OttoNav.tsx` (icon + NavItem)
- Modify: `apps/web/components/otto/OttoView.tsx` (branch)
- Modify: `apps/web/app/otto/page.tsx` (read `?view=` → pass `initialView` so the OAuth redirect lands on Connections)

**Interfaces:**
- Consumes: `getMetaConnection` / `disconnectMeta` / `MetaAdAccount` (Task 3).

> View + integration wiring. Verified by `tsc` + the full build gate.

- [ ] **Step 1: Implement `OttoConnections`**

Create `apps/web/components/otto/OttoConnections.tsx`:

```tsx
"use client";
import React, { useEffect, useState } from "react";
import { getMetaConnection, disconnectMeta, type MetaAdAccount } from "@/lib/meta-actions";

type State =
  | { phase: "loading" }
  | { phase: "disconnected" }
  | { phase: "connected"; status?: string; accounts: MetaAdAccount[] }
  | { phase: "reconnect" };

export default function OttoConnections() {
  const [state, setState] = useState<State>({ phase: "loading" });

  async function load() {
    setState({ phase: "loading" });
    const res = await getMetaConnection();
    if ("error" in res || !res.connected) return setState({ phase: "disconnected" });
    if (res.needsReconnect) return setState({ phase: "reconnect" });
    setState({ phase: "connected", status: res.status, accounts: res.accounts ?? [] });
  }
  useEffect(() => { void load(); }, []);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "var(--space-5)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-body)" }}>Connections</h2>
        <p style={{ margin: "var(--space-1) 0 var(--space-4)", color: "var(--text-muted)", fontSize: 14 }}>
          Connect your ad accounts so Otto can read your performance. Read-only — Otto can&rsquo;t spend or change your ads.
        </p>

        <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", background: "var(--surface-card)", padding: "var(--space-4)" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-body)" }}>Meta (Facebook & Instagram Ads)</div>

          {state.phase === "loading" && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Checking…</p>}

          {state.phase === "disconnected" && (
            <a href="/api/meta/authorize" className="al-btn al-btn-primary al-btn-sm" style={{ display: "inline-block", marginTop: "var(--space-2)", textDecoration: "none" }}>
              Connect Meta
            </a>
          )}

          {state.phase === "reconnect" && (
            <div style={{ marginTop: "var(--space-2)" }}>
              <p style={{ color: "var(--danger, #d65a5a)", fontSize: 13 }}>Your Meta connection expired.</p>
              <a href="/api/meta/authorize" className="al-btn al-btn-primary al-btn-sm" style={{ display: "inline-block", textDecoration: "none" }}>Reconnect</a>
            </div>
          )}

          {state.phase === "connected" && (
            <div style={{ marginTop: "var(--space-2)" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: "var(--space-2)" }}>Connected · {state.accounts.length} ad account{state.accounts.length === 1 ? "" : "s"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                {state.accounts.map((a) => (
                  <div key={a.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text-body)", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span>{a.name || a.id}</span>
                    <span style={{ color: "var(--text-muted)" }}>{a.currency}{a.status ? ` · ${a.status}` : ""}</span>
                  </div>
                ))}
              </div>
              <button type="button" className="al-btn al-btn-sm" style={{ marginTop: "var(--space-3)" }} onClick={async () => { await disconnectMeta(); void load(); }}>
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the view key + initialView in `OttoApp`**

In `apps/web/components/otto/OttoApp.tsx`:
- Change the `OttoViewKey` union (line ~44) to add `"connections"` after `"account"`:

```ts
export type OttoViewKey = "otto" | "stuff" | "library" | "templates" | "discover" | "memory" | "account" | "connections";
```

- Add an optional `initialView?: OttoViewKey` to `OttoAppProps`, destructure it, and seed the view state with it:

```tsx
  const [view, setView] = useState<OttoViewKey>(initialView ?? "otto");
```

- [ ] **Step 3: Add the nav item in `OttoNav`**

In `apps/web/components/otto/OttoNav.tsx`, add an icon near the others:

```tsx
function IconLink() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
```

And add to `NAV_ITEMS` after the `account` entry:

```tsx
  { key: "connections", label: "Connections", icon: <IconLink /> },
```

- [ ] **Step 4: Add the view branch in `OttoView`**

In `apps/web/components/otto/OttoView.tsx`, import + branch alongside the other view blocks (before the `view === "otto"` return):

```tsx
import OttoConnections from "./OttoConnections";
```
```tsx
  if (view === "connections") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OttoConnections />
      </div>
    );
  }
```

- [ ] **Step 5: Pass `initialView` from the `/otto` page**

In `apps/web/app/otto/page.tsx`, read the `view` search param and pass it so the OAuth redirect lands on Connections. The page is an async server component; find where it `return <OttoApp … />` and add `initialView`:

```tsx
// near the top of the default export, alongside the existing props gathering:
//   export default async function OttoPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
// (if the signature doesn't already take searchParams, add it)
  const sp = await searchParams;
  const VALID = ["otto", "stuff", "library", "templates", "discover", "memory", "account", "connections"] as const;
  const initialView = (VALID as readonly string[]).includes(sp?.view ?? "") ? (sp!.view as (typeof VALID)[number]) : undefined;
```
and add `initialView={initialView}` to the `<OttoApp … />` props.

> Read the real `OttoPage` signature first; if it already destructures `searchParams`, reuse it. If it does not accept `searchParams`, add the param per the Next.js App Router page convention.

- [ ] **Step 6: Typecheck + full suite**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit` → 0 errors.
Run: `cd apps/web && pnpm exec vitest run` → the 3 new G6a test files pass; the only failures are the pre-existing `DATABASE_URL` integration tests (`require-owner`, `tenant-guard`, `files route`, `isolation`).

- [ ] **Step 7: Full monorepo build gate**

Run (repo root `/Users/winnin/Desktop/fikirtive/.claude/worktrees/otto-g2-editor`): `pnpm -r build 2>&1 | tee /tmp/g6a-build.log; grep -E "ƒ /otto|Done|error TS|Failed to compile" /tmp/g6a-build.log`
Expected: shows `├ ƒ /otto` + `Done`, no `error TS` / `Failed to compile`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/otto/OttoConnections.tsx apps/web/components/otto/OttoApp.tsx apps/web/components/otto/OttoNav.tsx apps/web/components/otto/OttoView.tsx apps/web/app/otto/page.tsx
git commit -m "feat(g6a): Connections view + nav + ?view= initial-view wiring; build-verified"
```

---

## Self-Review

**Spec coverage:** §2.1 model → Task 1. §2.2 token-encryption → Task 1. §2.3 OAuth flow → Task 2 (state/url) + Task 4 (routes). §2.4 MetaGraphClient → Task 3. §2.5 server actions → Task 3. §2.6 Connections view + nav → Task 5. §5 money/safety → read-only scope (`ads_read` in Task 2), token encrypted (Task 1) + never serialized (Task 3 test asserts no token in output), owner-scoped + state+ownerId check (Tasks 3/4). §6 testing → Tasks 1-3 carry unit tests; Tasks 4-5 build-gated. All covered.

**Placeholder scan:** No TBD/TODO; every code step has complete code. The "read the real signature first" notes (Task 4 NextRequest, Task 5 OttoPage searchParams) are drift guards against the one unknown (the exact page/route signatures), not missing content.

**Type consistency:** `encryptToken`/`decryptToken` (Task 1) consumed by Task 3. `signState`/`verifyState`/`buildAuthorizeUrl`/`META_GRAPH_VERSION` (Task 2) consumed by Tasks 3/4. `exchangeCodeForToken`/`metaGraphGet` (Task 3 meta-graph) consumed by `completeMetaConnect`/`getMyAdAccounts` (Task 3 meta-actions). `completeMetaConnect(ownerId, code, redirectUri)` (Task 3) called by the callback route (Task 4). `getMetaConnection`/`disconnectMeta`/`MetaAdAccount` (Task 3) consumed by `OttoConnections` (Task 5). `OttoViewKey` gains `"connections"` (Task 5) consumed by the NavItem + OttoView branch + the page's `initialView`.

**Security note:** the one test that most matters — `getMetaConnection` returning accounts but `JSON.stringify(res)` containing neither `LONGTOKEN` nor `accessTokenEnc` (Task 3) — directly pins the "token never reaches the client" invariant. The owner-scoping is pinned by the upsert `where: { ownerId }`, the `deleteMany where ownerId`, and the callback's `state.ownerId === gate.ownerId` check.

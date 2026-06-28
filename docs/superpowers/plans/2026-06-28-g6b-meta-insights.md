# G6b — Meta analytics (insights + skill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the G6a connection, let Otto read + analyse the user's Meta ad performance (read-only) via a `metaInsights` skill + a light insights summary on the Connections view.

**Architecture:** A read-only `/insights` Graph call + an owner-scoped `fetchOwnerInsights` (a plain server fn in a NON-`"use server"` module, so it's reachable only server-side — no IDOR), surfaced two ways: a `getMetaInsights` server action (UI) and an `OttoContext.metaInsights` port (the `metaInsights` skill). Reuses G6a's encrypted token, Graph client, and owner-scoping.

**Tech Stack:** Next.js (server actions + route already exist), Prisma, the G6a Meta libs, `@openai/agents` skill (free/read/external, mirrors `researchWeb`), vitest (fetch + prisma mocked).

## Global Constraints

- **Read-only, zero spend** — only GET `/insights` via the existing Bearer-header Graph client; no write/POST to ad data; no credit/fal/spend path touched. The skill is `cost:"free", effect:"read", reach:"external"` (needsApproval = false).
- **Token never to client** — `getMetaInsights`/the skill return only mapped metric strings; the decrypted token stays inside `fetchOwnerInsights`. A test pins that `JSON.stringify(result)` contains neither the token nor `accessTokenEnc`.
- **No IDOR** — `fetchOwnerInsights(ownerId, …)` lives in `apps/web/lib/meta-insights.ts` which has **NO `"use server"` directive**, so it is a plain server function (not a client-callable action). Only `getMetaInsights` (a `"use server"` export) is client-reachable, and it derives ownerId from `requireOwner` (no ownerId param).
- **Owner-scoped** — `getMetaInsights` gates `requireOwner`; the skill port uses the verified `ctx.orgId`.
- **Reuse G6a** — `MetaConnection`, `decryptToken`, `metaGraphGet` (GET + Bearer), `META_GRAPH_VERSION`. Do not duplicate the token/crypto logic.
- **Test runner** — `cd apps/web && pnpm exec vitest run <path>` (web); `cd packages/otto && pnpm exec vitest run <path>` (the skill).
- **Build gate** — `pnpm -r build` shows `├ ƒ /otto` + `Done`; grep the log.
- **Verification boundary** — live insights need the deployed Meta App + a connected account (local is mock); unit tests mock `fetch` + prisma.

---

### Task 1: Insights read client + owner-scoped fetch + server action

**Files:**
- Modify: `apps/web/lib/meta-graph.ts` (add `getAccountInsights`)
- Create: `apps/web/lib/meta-insights.ts` (NO `"use server"` — `fetchOwnerInsights`)
- Modify: `apps/web/lib/meta-actions.ts` (add `getMetaInsights` action)
- Test: `apps/web/lib/__tests__/meta-insights.test.ts`

**Interfaces:**
- Produces:
  - `type AccountMetrics = { spend: string | null; impressions: string | null; reach: string | null; frequency: string | null; clicks: string | null; ctr: string | null; cpc: string | null; cpm: string | null; purchaseRoas: string | null }`
  - `type AccountInsights = { accountId: string; name: string; metrics: AccountMetrics }`
  - `getAccountInsights(token, adAccountId, datePreset): Promise<AccountMetrics | null>` (meta-graph.ts)
  - `fetchOwnerInsights(ownerId, datePreset): Promise<{ accounts: AccountInsights[] } | { needsReconnect: true } | { notConnected: true }>` (meta-insights.ts)
  - `getMetaInsights(datePreset?): Promise<{ accounts: AccountInsights[] } | { needsReconnect: true } | { notConnected: true } | { error: string }>` (meta-actions.ts, `"use server"`)

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/__tests__/meta-insights.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockFindUnique, mockUpdate, mockFetch } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: { metaConnection: { findUnique: mockFindUnique, update: mockUpdate } },
}));

import { getMetaInsights } from "../meta-actions";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
  vi.stubGlobal("fetch", mockFetch);
});
function jsonRes(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

describe("getMetaInsights", () => {
  it("returns notConnected when there's no row", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await getMetaInsights()).toEqual({ notConnected: true });
  });

  it("maps account insights and never leaks the token", async () => {
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique.mockResolvedValue({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch
      // /me/adaccounts
      .mockResolvedValueOnce(jsonRes({ data: [{ account_id: "1", name: "Kaia Cafe", currency: "MYR", account_status: 1, id: "act_1" }] }))
      // act_1/insights
      .mockResolvedValueOnce(jsonRes({ data: [{ spend: "120.50", impressions: "64312", reach: "35316", frequency: "1.82", clicks: "1775", ctr: "2.76", cpc: "0.71", cpm: "19.56" }] }));
    const res = await getMetaInsights("last_30d");
    if (!("accounts" in res)) throw new Error("expected accounts");
    expect(res.accounts[0].name).toBe("Kaia Cafe");
    expect(res.accounts[0].metrics.impressions).toBe("64312");
    expect(res.accounts[0].metrics.purchaseRoas).toBeNull(); // absent → null
    expect(JSON.stringify(res)).not.toContain("LONGTOKEN");
    expect(JSON.stringify(res)).not.toContain("accessTokenEnc");
  });

  it("returns needsReconnect on a Graph auth error", async () => {
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique.mockResolvedValue({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch.mockResolvedValueOnce(jsonRes({ error: { message: "invalid", code: 190 } }, false));
    mockUpdate.mockResolvedValue({});
    expect(await getMetaInsights("last_30d")).toEqual({ needsReconnect: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/meta-insights.test.ts`
Expected: FAIL — `getMetaInsights` not exported.

- [ ] **Step 3: Add `getAccountInsights` to `meta-graph.ts`**

Append to `apps/web/lib/meta-graph.ts`:

```ts
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
```

- [ ] **Step 4: Create `meta-insights.ts` (`fetchOwnerInsights`)**

Create `apps/web/lib/meta-insights.ts` (NO `"use server"` directive):

```ts
import { prisma } from "@fikirtive/db";
import { decryptToken } from "./token-encryption";
import { metaGraphGet, getAccountInsights, type AccountMetrics } from "./meta-graph";

export type AccountInsights = { accountId: string; name: string; metrics: AccountMetrics };

/** Owner-scoped insights for all of the owner's connected ad accounts. Plain server fn (NOT a
 *  "use server" action) — reachable only server-side, so it carries no IDOR surface. Token stays here. */
export async function fetchOwnerInsights(
  ownerId: string,
  datePreset: string,
): Promise<{ accounts: AccountInsights[] } | { needsReconnect: true } | { notConnected: true }> {
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
  if (!conn) return { notConnected: true };
  let token: string;
  try {
    token = decryptToken(conn.accessTokenEnc);
  } catch {
    return { needsReconnect: true };
  }
  try {
    const list = await metaGraphGet(token, "me/adaccounts", { fields: "name,account_id" });
    const accountsRaw: { id: string; name: string }[] = (list.data ?? []).map((a: Record<string, unknown>) => ({
      id: String(a.id ?? `act_${a.account_id ?? ""}`),
      name: String(a.name ?? ""),
    }));
    const accounts: AccountInsights[] = [];
    for (const a of accountsRaw) {
      const metrics = await getAccountInsights(token, a.id, datePreset);
      if (metrics) accounts.push({ accountId: a.id, name: a.name, metrics });
    }
    return { accounts };
  } catch {
    await prisma.metaConnection.update({ where: { ownerId }, data: { status: "expired" } }).catch(() => {});
    return { needsReconnect: true };
  }
}
```

- [ ] **Step 5: Add the `getMetaInsights` action**

In `apps/web/lib/meta-actions.ts`, add the import and the action:

```ts
import { fetchOwnerInsights, type AccountInsights } from "./meta-insights";
```
```ts
export async function getMetaInsights(
  datePreset?: string,
): Promise<{ accounts: AccountInsights[] } | { needsReconnect: true } | { notConnected: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return fetchOwnerInsights(gate.ownerId, datePreset ?? "last_30d");
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/meta-insights.test.ts`
Expected: PASS. Then `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit` → 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/meta-graph.ts apps/web/lib/meta-insights.ts apps/web/lib/meta-actions.ts apps/web/lib/__tests__/meta-insights.test.ts
git commit -m "feat(g6b): read-only Meta insights — getAccountInsights + owner-scoped fetchOwnerInsights + getMetaInsights"
```

---

### Task 2: `metaInsights` OttoContext port + skill + wiring

**Files:**
- Modify: `packages/otto/src/context.ts` (add the `metaInsights` port)
- Create: `packages/otto/src/skills/meta-insights.ts`
- Modify: `packages/otto/src/registry.ts` (register the skill)
- Modify: `apps/web/lib/otto-actions.ts` (`buildOttoContext` — wire the port)
- Test: `packages/otto/src/skills/meta-insights.test.ts`

**Interfaces:**
- Consumes: `fetchOwnerInsights` (Task 1) for the wiring; the `defineOttoSkill`/`OttoContext` patterns (mirror `research-web.ts`).
- Produces: `OttoContext.metaInsights?: { get(datePreset: string): Promise<{ accounts: AccountInsights[] } | { needsReconnect: true } | { notConnected: true }> }`; `metaInsightsSkill`.

- [ ] **Step 1: Write the failing skill test**

Create `packages/otto/src/skills/meta-insights.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { metaInsightsSkill } from "./meta-insights.js";

function ctx(over: Record<string, unknown> = {}) {
  return { context: { orgId: "u1", userId: "u1", projectId: "p1", threadId: "t1", disabledModels: [], ...over } } as any;
}

describe("metaInsights skill", () => {
  it("is free/read/external (no approval)", () => {
    expect(metaInsightsSkill.spec.cost).toBe("free");
    expect(metaInsightsSkill.spec.effect).toBe("read");
    expect(metaInsightsSkill.spec.reach).toBe("external");
  });
  it("returns a graceful message when the port is absent", async () => {
    const out = await metaInsightsSkill.spec.execute({ datePreset: "last_30d" }, ctx());
    expect(JSON.stringify(out).toLowerCase()).toContain("connect");
  });
  it("tells the user to connect when notConnected", async () => {
    const out = await metaInsightsSkill.spec.execute(
      { datePreset: "last_30d" },
      ctx({ metaInsights: { get: async () => ({ notConnected: true }) } }),
    );
    expect(JSON.stringify(out).toLowerCase()).toContain("connect");
  });
  it("returns the metrics when connected", async () => {
    const accounts = [{ accountId: "act_1", name: "Kaia Cafe", metrics: { spend: "120", impressions: "64312", reach: "35316", frequency: "1.82", clicks: "1775", ctr: "2.76", cpc: "0.71", cpm: "19.56", purchaseRoas: null } }];
    const out = await metaInsightsSkill.spec.execute(
      { datePreset: "last_30d" },
      ctx({ metaInsights: { get: async () => ({ accounts }) } }),
    );
    expect(JSON.stringify(out)).toContain("64312");
  });
});
```

> Confirm the `defineOttoSkill` return shape first (`research-web.ts` — whether tests read `skill.spec.execute`/`skill.spec.cost` or a different accessor). Adapt the test's accessor to match how `research-web.test.ts` (if present) reads the skill; keep the assertions.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/otto && pnpm exec vitest run src/skills/meta-insights.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the port to `OttoContext`**

In `packages/otto/src/context.ts`, add inside the `OttoContext` interface (near the `research` port):

```ts
  /** Meta analytics port (G6b) — injected by the web caller; reads the owner's connected ad-account
   *  performance. Skills reach it ONLY via ctx.metaInsights, never importing meta-insights.ts. */
  metaInsights?: {
    get(datePreset: string): Promise<
      | { accounts: { accountId: string; name: string; metrics: Record<string, string | null> }[] }
      | { needsReconnect: true }
      | { notConnected: true }
    >;
  };
```

- [ ] **Step 4: Create the skill**

Create `packages/otto/src/skills/meta-insights.ts` (mirror `research-web.ts`):

```ts
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";

const NOT_CONNECTED = "Meta isn't connected yet. Ask the user to open Connections and click Connect Meta, then try again.";

export const metaInsightsInput = z.object({
  datePreset: z.enum(["last_7d", "last_14d", "last_30d", "last_90d"]).default("last_30d")
    .describe("The reporting window for the ad performance numbers."),
});

export const metaInsightsSkill = defineOttoSkill({
  name: "meta-insights",
  cost: "free",
  effect: "read",
  reach: "external",
  description: "Read the user's connected Meta (Facebook/Instagram) ad-account performance (spend, reach, CTR, CPC, ROAS) so you can analyse it. Read-only.",
  parameters: metaInsightsInput,
  execute: async (input, runContext) => {
    const ctx = runContext?.context;
    if (!ctx?.metaInsights) return { message: NOT_CONNECTED };
    const res = await ctx.metaInsights.get(input.datePreset);
    if ("notConnected" in res || "needsReconnect" in res) return { message: NOT_CONNECTED };
    if (res.accounts.length === 0) return { message: "Meta is connected but no ad accounts returned data for this window." };
    return { datePreset: input.datePreset, accounts: res.accounts };
  },
});
```

> Match the exact `defineOttoSkill` call shape used by `research-web.ts` (field names, the `execute(input, runContext)` signature). Adapt if it differs.

- [ ] **Step 5: Register the skill**

In `packages/otto/src/registry.ts`: add `import { metaInsightsSkill } from "./skills/meta-insights.js";` and add `metaInsightsSkill,` to the `allSkills` array (after `researchWebSkill`).

- [ ] **Step 6: Wire the port in `buildOttoContext`**

In `apps/web/lib/otto-actions.ts`, add the import and the port to the returned context object (next to the `research` port):

```ts
import { fetchOwnerInsights } from "./meta-insights";
```
```ts
    metaInsights: { get: (datePreset: string) => fetchOwnerInsights(ownerId, datePreset) },
```

(Use the same `ownerId` the function already has in scope for the other ports.)

- [ ] **Step 7: Run skill tests + typecheck**

Run: `cd packages/otto && pnpm exec vitest run src/skills/meta-insights.test.ts` → PASS.
Run: `cd packages/otto && pnpm exec tsc -p tsconfig.json --noEmit` → 0 errors.
Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit` → 0 errors (the buildOttoContext wiring typechecks against the new port).

- [ ] **Step 8: Commit**

```bash
git add packages/otto/src/context.ts packages/otto/src/skills/meta-insights.ts packages/otto/src/skills/meta-insights.test.ts packages/otto/src/registry.ts apps/web/lib/otto-actions.ts
git commit -m "feat(g6b): metaInsights skill + OttoContext port wired to owner-scoped insights"
```

---

### Task 3: Insights summary on the Connections view + final build gate

**Files:**
- Modify: `apps/web/components/otto/OttoConnections.tsx` (render the metric summary when connected)

**Interfaces:**
- Consumes: `getMetaInsights` (Task 1).

> View wiring. Verified by `tsc` + the full build gate.

- [ ] **Step 1: Add the insights summary**

In `apps/web/components/otto/OttoConnections.tsx`, after the connected-state account list loads, fetch + show last-30d metrics. Add to the imports: `getMetaInsights` from `@/lib/meta-actions`, and an `AccountInsights` type import if exported. In the `connected` render branch, load insights on mount (a second `useEffect`/state) and render a compact per-account summary row: spend · impressions · reach · CTR · CPC · and either ROAS or "no conversion tracking" when `purchaseRoas` is null. Keep it small; reuse the existing card styling. Read the current `OttoConnections.tsx` first and slot the summary under the account list; if insights returns `needsReconnect`/`notConnected`, just skip the summary (the existing connection UI already handles those states).

Concretely, add near the top:
```tsx
import { getMetaInsights } from "@/lib/meta-actions";
```
add state `const [insights, setInsights] = useState<{ accountId: string; name: string; metrics: Record<string, string | null> }[] | null>(null);`
and, when `state.phase === "connected"`, a `useEffect` that calls `getMetaInsights("last_30d")` and `if ("accounts" in res) setInsights(res.accounts)`. Render each account's metrics under its row:
```tsx
{insights?.find((i) => i.accountId === a.id) && (() => {
  const m = insights.find((i) => i.accountId === a.id)!.metrics;
  return (
    <div style={{ fontSize: 12, color: "var(--text-muted)", paddingLeft: 2, marginTop: 2 }}>
      {m.spend ? `Spent ${m.spend}` : "—"} · {m.impressions ?? "—"} impr · CTR {m.ctr ?? "—"}% · CPC {m.cpc ?? "—"} · {m.purchaseRoas ? `ROAS ${m.purchaseRoas}` : "no conversion tracking"}
    </div>
  );
})()}
```
(Adapt to the real `OttoConnections.tsx` structure — it currently maps `state.accounts`; render the metric line within that map.)

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit` → 0 errors.

- [ ] **Step 3: Full suite + build gate**

Run: `cd apps/web && pnpm exec vitest run` → the G6b test file + the G6a files pass; the only failures are the pre-existing `DATABASE_URL` tests.
Run: `cd packages/otto && pnpm exec vitest run` → all green (incl. the new skill test).
Run (repo root): `pnpm -r build 2>&1 | tee /tmp/g6b-build.log; grep -E "ƒ /otto|Done|error TS|Failed to compile" /tmp/g6b-build.log` → shows `├ ƒ /otto` + `Done`, no `error TS`/`Failed to compile`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/otto/OttoConnections.tsx
git commit -m "feat(g6b): show last-30d ad performance summary per connected account; build-verified"
```

---

## Self-Review

**Spec coverage:** §2.1 read client + owner fetch + action → Task 1. §2.2 port + skill + wiring → Task 2. §2.3 Connections summary → Task 3. §5 money/safety → read-only GET (Task 1), skill free/read/external (Task 2 test), token-never-to-client (Task 1 test asserts no token in JSON), `fetchOwnerInsights` in a non-`"use server"` module = no IDOR (Task 1), owner-scoped (`requireOwner` in `getMetaInsights`, `ctx.orgId` in the port). §6 testing → Tasks 1-2 carry unit tests; Task 3 build-gated. All covered.

**Placeholder scan:** No TBD/TODO; complete code in each step. The "confirm the defineOttoSkill/research-web shape" and "adapt to the real OttoConnections structure" notes are drift guards against the two unknowns (the skill accessor + the exact view structure), not missing content.

**Type consistency:** `AccountMetrics`/`AccountInsights` (Task 1) flow into `fetchOwnerInsights` → `getMetaInsights` → the port/skill (Task 2) → the view (Task 3). `getMetaInsights(datePreset?)` returns `{accounts}|{needsReconnect}|{notConnected}|{error}` consumed by the view; the port returns the same minus `{error}` (the skill maps notConnected/needsReconnect to one message). `metaInsightsSkill` (Task 2) registered in `registry.ts`. The `OttoContext.metaInsights.get(datePreset)` signature matches the `buildOttoContext` wiring (`fetchOwnerInsights(ownerId, datePreset)`) and the skill's `ctx.metaInsights.get(input.datePreset)` call.

**Security note:** the IDOR class from G6a is structurally avoided — `fetchOwnerInsights` is in a NON-`"use server"` module (plain server fn, not a client action), and the only client-reachable export (`getMetaInsights`) takes no ownerId and gates `requireOwner`. The token-never-to-client invariant is pinned by the Task 1 test asserting `JSON.stringify` excludes the token + `accessTokenEnc`.

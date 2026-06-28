# G7 v1 — Otto Manages Existing Meta Ads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Otto manage a user's existing Meta ads (pause / resume / budget± / reschedule) on their real Meta account, gated by deterministic Separation-of-Duties controls and a per-org autonomy mode.

**Architecture:** Otto only *proposes* (two ungated skills: read + draft-a-plan-card). The single Meta writer is a trusted **server action** that the LLM cannot call. A pure policy function decides auto-vs-ask from `(autonomy mode, server-computed money-class)`. Plan-level batch approval: one ACTION_CARD lists many steps, approved once, executed by faithful replay with per-step idempotency. Mirrors the existing `propose`→`generate` seam.

**Tech Stack:** TypeScript, Next.js (apps/web), Prisma/Postgres (packages/db), `@openai/agents` Otto framework (packages/otto), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-28-g7-otto-ad-write-v1-design.md`. **Research:** `docs/superpowers/specs/2026-06-28-g7-agent-authz-research.md`.

## Global Constraints

- **Money safety is paramount.** Meta spend is the user's real ad money (NOT the FIKIRTIVE credit ledger). Never call `reserveCredits`/`startGen` here.
- **SoD invariant:** the LLM never sets current-state, money-class, or triggers execution. The server fetches live current values, computes money-class, and is the only executor. Enforcement lives in deterministic code, never in the prompt.
- **`requireOwner` first line** of every server action; `ownerId`/`userId`/`orgId` are NEVER tool/skill parameters or action params (the `defineOttoSkill` factory throws on identity params; server actions resolve identity from session).
- **Fail-closed everywhere:** unknown money-class → `spend` (ask); unknown mode → `ASK`; kill-switch on → refuse.
- **Skills reach the outside world ONLY through injected `ctx` ports** (CI-fenced). A skill must never import `meta-graph`/the write client.
- **Never rotate prod `TOKEN_ENCRYPTION_KEY`.**
- **Money-class taxonomy (server-computed):** `pause`=safe, `budget_down`=safe, `resume`=spend, `budget_up`=spend, `reschedule`=spend.
- Tests mock the Meta Graph client — **no real Meta calls in tests.**
- Run tests with: `pnpm --filter @fikirtive/otto test` (otto) and `pnpm --filter @fikirtive/web test` (web). Typecheck: `pnpm -w typecheck` (or the repo's pre-push check).
- Regenerate the skill catalog after adding/removing a skill: `pnpm --filter @fikirtive/otto run catalog`.

---

## File Structure

**New files:**
- `apps/web/lib/meta-action-policy.ts` — pure: `AdOp`, `MoneyClass`, `AutonomyMode`, `Decision`, `classifyMoneyClass`, `policyDecision`.
- `apps/web/lib/meta-objects.ts` — owner-scoped object reads (sibling of `meta-insights.ts` `fetchOwnerInsights`).
- `apps/web/lib/meta-approval.ts` — pure: `canonicalizeSteps`, `hashSteps`, `buildApproval`, `verifyApproval`.
- `apps/web/lib/meta-write-actions.ts` — `'use server'` executor: `approveMetaActionPlan`, `runApprovedPlan` (the only Meta writer), `setAdsAutonomy`, `setAdsWritesPaused`.
- `packages/otto/src/skills/meta-list-objects.ts` — read skill.
- `packages/otto/src/skills/propose-meta-action.ts` — draft skill.
- `packages/otto/src/skills/propose-meta-action.helpers.ts` — pure `buildMetaPlanCard` + payload types.
- `apps/web/components/otto/OttoActionPlanCard.tsx` — the plan card UI.

**Modified files:**
- `packages/db/prisma/schema.prisma` (+ migration) · `packages/otto/src/context.ts` · `packages/otto/src/registry.ts` · `apps/web/lib/meta-graph.ts` · `apps/web/lib/meta-oauth.ts` · `apps/web/lib/meta-actions.ts` · `apps/web/lib/otto-actions.ts` · `apps/web/lib/otto-client-actions.ts` · `apps/web/lib/types.ts` · `apps/web/lib/otto-ui-messages.ts` · `apps/web/lib/otto-inject-helpers.ts` · `apps/web/components/otto/OttoConnections.tsx` · `apps/web/components/otto/OttoConversation.tsx` · `apps/web/components/studio/Cowork.tsx` · `apps/worker/src/otto-resume.ts` · `scripts/check-skill-imports.sh`.

---

# PHASE A — Foundation (no Meta writes; each task testable in isolation)

## Task 1: DB schema — autonomy, kill-switch, ACTION_CARD, execution-idempotency table

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_g7_ad_write/migration.sql` (Prisma generates; hand-edit the partial-unique index)

**Interfaces:**
- Produces: `enum AdsAutonomy { ASK AUTO }`; `MetaConnection.adsAutonomy AdsAutonomy @default(ASK)`; `MetaConnection.adsWritesPaused Boolean @default(false)`; `MetaConnection.canWrite Boolean @default(false)`; `ChatMessageKind.ACTION_CARD`; `model MetaActionExecution { id, ownerId, cardId, stepIndex, status, appliedValue, createdAt }`.

- [ ] **Step 1: Add the enum + MetaConnection columns**

In `schema.prisma`, near the other enums add:
```prisma
enum AdsAutonomy {
  ASK
  AUTO
}
```
On `model MetaConnection` add (after `status`):
```prisma
  adsAutonomy    AdsAutonomy @default(ASK)   // per-org Ask/Auto; lost on disconnect → resets to ASK
  adsWritesPaused Boolean    @default(false) // kill-switch: when true, executor refuses all writes
  canWrite       Boolean    @default(false)  // true only if Meta actually granted ads_management
```

- [ ] **Step 2: Add `ACTION_CARD` to the message-kind enum**

Find `enum ChatMessageKind` and add `ACTION_CARD` as a new value alongside `GEN_CARD`.

- [ ] **Step 3: Add the execution-idempotency model**

```prisma
model MetaActionExecution {
  id           String   @id
  ownerId      String
  cardId       String
  stepIndex    Int
  status       String   // PENDING | APPLYING | APPLIED | FAILED
  appliedValue Json?
  createdAt    DateTime @default(now())
}
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @fikirtive/db exec prisma migrate dev --name g7_ad_write --create-only`
Expected: a new migration folder with `migration.sql`.

- [ ] **Step 5: Hand-add the all-status partial-unique index**

Append to the generated `migration.sql` (Prisma can't express a partial-unique; mirror `GenJob_cowork_idempotency_once`):
```sql
CREATE UNIQUE INDEX "MetaActionExecution_step_once"
  ON "MetaActionExecution" ("ownerId", "cardId", "stepIndex");
```

- [ ] **Step 6: Apply + regenerate client**

Run: `pnpm --filter @fikirtive/db exec prisma migrate dev`
Expected: migration applies; `prisma generate` runs; no errors.

- [ ] **Step 7: Commit**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(g7): db — adsAutonomy/kill-switch/canWrite + ACTION_CARD + MetaActionExecution"
```

---

## Task 2: Pure policy + money-class (`meta-action-policy.ts`)

**Files:**
- Create: `apps/web/lib/meta-action-policy.ts`
- Test: `apps/web/lib/__tests__/meta-action-policy.test.ts`

**Interfaces:**
- Produces:
  - `type AdOp = "pause" | "resume" | "budget_up" | "budget_down" | "reschedule"`
  - `type MoneyClass = "safe" | "spend"`
  - `type AutonomyMode = "ASK" | "AUTO"`
  - `type Decision = "auto" | "ask"`
  - `function classifyMoneyClass(op: AdOp): MoneyClass`
  - `function policyDecision(mode: AutonomyMode, moneyClass: MoneyClass): Decision`

- [ ] **Step 1: Write the failing test**

`apps/web/lib/__tests__/meta-action-policy.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { classifyMoneyClass, policyDecision, type AdOp } from "../meta-action-policy";

describe("classifyMoneyClass", () => {
  it("pause and budget_down are safe", () => {
    expect(classifyMoneyClass("pause")).toBe("safe");
    expect(classifyMoneyClass("budget_down")).toBe("safe");
  });
  it("resume, budget_up, reschedule are spend (reschedule fail-safe)", () => {
    expect(classifyMoneyClass("resume")).toBe("spend");
    expect(classifyMoneyClass("budget_up")).toBe("spend");
    expect(classifyMoneyClass("reschedule")).toBe("spend");
  });
  it("unknown op falls back to spend", () => {
    expect(classifyMoneyClass("bogus" as AdOp)).toBe("spend");
  });
});

describe("policyDecision", () => {
  it("AUTO + safe → auto", () => {
    expect(policyDecision("AUTO", "safe")).toBe("auto");
  });
  it("everything else → ask", () => {
    expect(policyDecision("AUTO", "spend")).toBe("ask");
    expect(policyDecision("ASK", "safe")).toBe("ask");
    expect(policyDecision("ASK", "spend")).toBe("ask");
  });
  it("unknown mode → ask (fail-closed)", () => {
    expect(policyDecision("bogus" as never, "safe")).toBe("ask");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module '../meta-action-policy'`). Run: `pnpm --filter @fikirtive/web test meta-action-policy`

- [ ] **Step 3: Implement**

`apps/web/lib/meta-action-policy.ts`:
```ts
// Pure, deterministic policy. The ONLY place "auto vs ask" is decided. Consulted by trusted
// server code (the executor), never by the LLM. Founder-readable rule table (priority ③).
export type AdOp = "pause" | "resume" | "budget_up" | "budget_down" | "reschedule";
export type MoneyClass = "safe" | "spend";
export type AutonomyMode = "ASK" | "AUTO";
export type Decision = "auto" | "ask";

const SAFE_OPS: ReadonlySet<AdOp> = new Set<AdOp>(["pause", "budget_down"]);

/** Money-class from the (server-resolved) op. Unknown → spend (fail-safe). */
export function classifyMoneyClass(op: AdOp): MoneyClass {
  return SAFE_OPS.has(op) ? "safe" : "spend";
}

/** auto ONLY for AUTO mode + a money-safe op. Everything else asks. Unknown mode → ask. */
export function policyDecision(mode: AutonomyMode, moneyClass: MoneyClass): Decision {
  return mode === "AUTO" && moneyClass === "safe" ? "auto" : "ask";
}
```

- [ ] **Step 4: Run it — expect PASS.** Run: `pnpm --filter @fikirtive/web test meta-action-policy`

- [ ] **Step 5: Commit**
```bash
git add apps/web/lib/meta-action-policy.ts apps/web/lib/__tests__/meta-action-policy.test.ts
git commit -m "feat(g7): pure money-class + auto/ask policy (fail-closed)"
```

---

## Task 3: Meta Graph object readers + owner-scoped read impl

**Files:**
- Modify: `apps/web/lib/meta-graph.ts` (add `listCampaigns`, `listAdSets`, `listAds`)
- Create: `apps/web/lib/meta-objects.ts` (owner-scoped `fetchOwnerAdObjects`)
- Test: `apps/web/lib/__tests__/meta-objects.test.ts`

**Interfaces:**
- Consumes: `metaGraphGet(token, path, params)` (existing, `meta-graph.ts`), `decryptToken` (`token-encryption.ts`), `prisma.metaConnection` (keyed by `ownerId`).
- Produces:
  - `type MetaAdObject = { id: string; level: "campaign" | "adset" | "ad"; name: string; status: string; dailyBudgetMinor?: number; lifetimeBudgetMinor?: number; startTime?: string; endTime?: string; currency: string; accountId: string }`
  - `async function fetchOwnerAdObjects(ownerId: string): Promise<{ objects: MetaAdObject[] } | { needsReconnect: true } | { notConnected: true }>`

- [ ] **Step 1: Write the failing test** (mock `meta-graph` + `prisma`)

`apps/web/lib/__tests__/meta-objects.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../meta-graph", () => ({
  listCampaigns: vi.fn(), listAdSets: vi.fn(), listAds: vi.fn(),
}));
vi.mock("../token-encryption", () => ({ decryptToken: () => "tok" }));
vi.mock("@fikirtive/db", () => ({ prisma: { metaConnection: { findUnique: vi.fn() } } }));

import { fetchOwnerAdObjects } from "../meta-objects";
import * as graph from "../meta-graph";
import { prisma } from "@fikirtive/db";

beforeEach(() => vi.clearAllMocks());

it("returns notConnected when no MetaConnection", async () => {
  (prisma.metaConnection.findUnique as any).mockResolvedValue(null);
  expect(await fetchOwnerAdObjects("org1")).toEqual({ notConnected: true });
});

it("maps adsets with budget + schedule", async () => {
  (prisma.metaConnection.findUnique as any).mockResolvedValue({ accessTokenEnc: "e" });
  (graph.listCampaigns as any).mockResolvedValue([{ id: "c1", name: "C", effective_status: "ACTIVE", account_id: "act_1", currency: "USD" }]);
  (graph.listAdSets as any).mockResolvedValue([{ id: "s1", name: "S", effective_status: "PAUSED", daily_budget: "2000", start_time: "t", account_id: "act_1", currency: "USD" }]);
  (graph.listAds as any).mockResolvedValue([]);
  const res = await fetchOwnerAdObjects("org1");
  expect("objects" in res && res.objects.find(o => o.level === "adset")).toMatchObject({
    id: "s1", status: "PAUSED", dailyBudgetMinor: 2000, currency: "USD",
  });
});

it("returns needsReconnect on code-190", async () => {
  (prisma.metaConnection.findUnique as any).mockResolvedValue({ accessTokenEnc: "e" });
  (graph.listCampaigns as any).mockRejectedValue({ metaError: { code: 190 } });
  expect(await fetchOwnerAdObjects("org1")).toEqual({ needsReconnect: true });
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `pnpm --filter @fikirtive/web test meta-objects`

- [ ] **Step 3: Add Graph readers to `meta-graph.ts`**

Mirror the existing `getAccountInsights` (same `metaGraphGet(token, path, params)` shape, same `metaError`/code-190 contract). Add:
```ts
export async function listCampaigns(token: string, accountId: string) {
  const j = await metaGraphGet(token, `${accountId}/campaigns`, { fields: "name,effective_status,daily_budget,lifetime_budget,start_time,stop_time,account_id,currency" });
  return j.data ?? [];
}
export async function listAdSets(token: string, accountId: string) {
  const j = await metaGraphGet(token, `${accountId}/adsets`, { fields: "name,effective_status,daily_budget,lifetime_budget,start_time,end_time,account_id,currency" });
  return j.data ?? [];
}
export async function listAds(token: string, accountId: string) {
  const j = await metaGraphGet(token, `${accountId}/ads`, { fields: "name,effective_status,account_id" });
  return j.data ?? [];
}
```
(Note: `account_id` from `me/adaccounts` is needed — fetch the owner's ad accounts first via the existing `getMyAdAccounts`-style call, then iterate. Reuse the account-listing already in `meta-actions.ts`.)

- [ ] **Step 4: Implement `meta-objects.ts`**

Mirror `fetchOwnerInsights` in `meta-insights.ts` (owner-scoped connection lookup → `decryptToken` → graph calls → map → friendly variants). Map raw Meta fields to `MetaAdObject` (budgets parsed as integer minor units; `level` set per source; `endTime` from `end_time`/`stop_time`). On `metaError.code === 190` return `{ needsReconnect: true }` (and best-effort mark connection `expired`, as `getMyAdAccounts` does). **Plain server fn — NOT `'use server'`.**

- [ ] **Step 5: Run it — expect PASS.** Run: `pnpm --filter @fikirtive/web test meta-objects`

- [ ] **Step 6: Commit**
```bash
git add apps/web/lib/meta-graph.ts apps/web/lib/meta-objects.ts apps/web/lib/__tests__/meta-objects.test.ts
git commit -m "feat(g7): owner-scoped Meta object readers (campaigns/adsets/ads)"
```

---

## Task 4: `metaListObjects` read skill + context port + register

**Files:**
- Modify: `packages/otto/src/context.ts` (add `metaAds` read port)
- Create: `packages/otto/src/skills/meta-list-objects.ts`
- Modify: `packages/otto/src/registry.ts`
- Modify: `apps/web/lib/otto-actions.ts` (`buildOttoContext` injects `metaAds`)
- Test: `packages/otto/src/skills/meta-list-objects.test.ts`

**Interfaces:**
- Consumes: `defineOttoSkill` (`../skill.js`), `OttoContext` (`../context.js`), `fetchOwnerAdObjects` (Task 3, injected via port).
- Produces: `OttoContext.metaAds?: { list(): Promise<{ objects: MetaAdObject[] } | { needsReconnect: true } | { notConnected: true }> }`; `export const metaListObjects` (the `.tool`); `metaListObjectsSkill`.

- [ ] **Step 1: Add the port to `context.ts`** — alongside the existing `metaInsights` port:
```ts
  metaAds?: {
    list(): Promise<{ objects: MetaAdObject[] } | { needsReconnect: true } | { notConnected: true }>;
  };
```
(Import/define the `MetaAdObject` type in/for the otto package — re-declare a minimal structural type to avoid a web→otto import.)

- [ ] **Step 2: Write the failing test** (mirror `meta-insights.test.ts`)

`packages/otto/src/skills/meta-list-objects.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { metaListObjectsSkill, executeMetaListObjects } from "./meta-list-objects";

it("gate: free/read/external → ungated", () => {
  expect(metaListObjectsSkill.cost).toBe("free");
  expect(metaListObjectsSkill.effect).toBe("read");
  expect(metaListObjectsSkill.reach).toBe("external");
  expect(metaListObjectsSkill.needsApproval).toBe(false);
});

it("returns a NOT_CONNECTED message when the port is missing", async () => {
  const res = await executeMetaListObjects({}, { context: {} as any });
  expect(JSON.stringify(res)).toMatch(/connect/i);
});

it("returns objects from the port", async () => {
  const ctx = { metaAds: { list: async () => ({ objects: [{ id: "s1", level: "adset", name: "S", status: "PAUSED", currency: "USD", accountId: "act_1" }] }) } };
  const res: any = await executeMetaListObjects({}, { context: ctx as any });
  expect(res.objects?.[0]?.id).toBe("s1");
});
```

- [ ] **Step 3: Run it — expect FAIL.** Run: `pnpm --filter @fikirtive/otto test meta-list-objects`

- [ ] **Step 4: Implement the skill** (copy shape from `meta-insights.ts`)

`packages/otto/src/skills/meta-list-objects.ts` — `cost:"free", effect:"read", reach:"external"`, empty-ish zod input, `execute` calls `ctx.metaAds?.list()`, returns friendly NOT_CONNECTED string when the port is missing or returns `notConnected`/`needsReconnect`, else `{ objects }`. Export `executeMetaListObjects`, `metaListObjectsSkill`, and `export const metaListObjects = metaListObjectsSkill.tool;`.

- [ ] **Step 5: Register** in `registry.ts`: `import { metaListObjects } from "./skills/meta-list-objects.js"` and add to `allSkills`.

- [ ] **Step 6: Inject the port** in `buildOttoContext` (`apps/web/lib/otto-actions.ts`): `metaAds: { list: () => fetchOwnerAdObjects(orgId) }` (orgId from the verified session, same source as the existing `metaInsights` injection).

- [ ] **Step 7: Run otto tests + regenerate catalog**

Run: `pnpm --filter @fikirtive/otto test meta-list-objects` → PASS.
Run: `pnpm --filter @fikirtive/otto run catalog` (CATALOG.md now lists `meta-list-objects`).

- [ ] **Step 8: Commit**
```bash
git add packages/otto/src/context.ts packages/otto/src/skills/meta-list-objects.ts packages/otto/src/skills/meta-list-objects.test.ts packages/otto/src/registry.ts packages/otto/src/skills/CATALOG.md apps/web/lib/otto-actions.ts
git commit -m "feat(g7): metaListObjects read skill + metaAds port"
```

---

## Task 5: Scope upgrade — request `ads_management`, persist granted scopes + `canWrite`

**Files:**
- Modify: `apps/web/lib/meta-oauth.ts` (`buildAuthorizeUrl` scope)
- Modify: `apps/web/lib/meta-actions.ts` (`completeMetaConnect`, `getMetaConnection`)
- Test: `apps/web/lib/__tests__/meta-oauth.test.ts`, `apps/web/lib/__tests__/meta-actions.test.ts` (extend)

**Interfaces:**
- Produces: `getMetaConnection` result gains `adsAutonomy: "ASK"|"AUTO"`, `canWrite: boolean`, `adsWritesPaused: boolean`. `completeMetaConnect` persists `canWrite` from Meta `granted_scopes`.

- [ ] **Step 1: Test — authorize URL requests `ads_management`**

Extend `meta-oauth.test.ts`:
```ts
it("authorize url requests ads_management + ads_read", () => {
  const url = buildAuthorizeUrl({ /* existing args */ } as any);
  expect(url).toContain("ads_management");
  expect(url).toContain("ads_read");
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `pnpm --filter @fikirtive/web test meta-oauth`

- [ ] **Step 3: Implement** — in `buildAuthorizeUrl`, change the hardcoded scope to `scope=ads_read,ads_management` (request both; the user may still decline write).

- [ ] **Step 4: Test — `completeMetaConnect` records `canWrite` from granted scopes**

Extend `meta-actions.test.ts`: when `exchangeCodeForToken` returns granted scopes including `ads_management` → stored `canWrite:true`; when only `ads_read` → `canWrite:false`. Stub the token exchange to expose granted scopes (read them from the token-debug or the OAuth response, per `exchangeCodeForToken`'s contract).

- [ ] **Step 5: Run — expect FAIL.** Run: `pnpm --filter @fikirtive/web test meta-actions`

- [ ] **Step 6: Implement**
- `completeMetaConnect`: parse the actually-granted scopes; set `data.canWrite = granted.includes("ads_management")`; store the granted scope string in `data.scope` (stop writing the literal `"ads_read"`); seed `adsAutonomy: "ASK"` on the create branch.
- `getMetaConnection`: extend the `select` to include `adsAutonomy, canWrite, adsWritesPaused, status` and return them.

- [ ] **Step 7: Run web tests — expect PASS.** Run: `pnpm --filter @fikirtive/web test meta-oauth meta-actions`

- [ ] **Step 8: Commit**
```bash
git add apps/web/lib/meta-oauth.ts apps/web/lib/meta-actions.ts apps/web/lib/__tests__/meta-oauth.test.ts apps/web/lib/__tests__/meta-actions.test.ts
git commit -m "feat(g7): request ads_management + persist granted scopes/canWrite"
```

---

## Task 6: Extend the CI fence to Meta writes

**Files:**
- Modify: `scripts/check-skill-imports.sh`
- Test: a temporary fixture skill that imports `meta-graph` must make the fence exit non-zero.

**Interfaces:** none (CI script).

- [ ] **Step 1: Reproduce the gap** — create a throwaway `packages/otto/src/skills/_fence_probe.ts` containing `import { metaGraphGet } from "../../../../apps/web/lib/meta-graph";` then run `bash scripts/check-skill-imports.sh` — it currently **passes** (the gap).

- [ ] **Step 2: Add Meta to the hard-fail grep**

In `check-skill-imports.sh`, extend the `hard=$(...)` pattern to also catch Meta-write reach:
```bash
hard=$(grep -rnE "from \"@fikirtive/generation\"|reserveCredits|meta-graph|metaGraphPost" "$DIR" --include='*.ts' 2>/dev/null \
  | grep -v '\.test\.ts' | grep -vE ':\s*(\*|//)' || true)
```
Update the FAIL message to mention "or the Meta Graph client".

- [ ] **Step 3: Run — expect FAIL (non-zero) with the probe present.** Run: `bash scripts/check-skill-imports.sh; echo "exit=$?"` → exit=1.

- [ ] **Step 4: Delete the probe; run — expect PASS.** Remove `_fence_probe.ts`; `bash scripts/check-skill-imports.sh; echo "exit=$?"` → exit=0.

- [ ] **Step 5: Commit**
```bash
git add scripts/check-skill-imports.sh
git commit -m "feat(g7): CI fence — skills/* may not import the Meta Graph client"
```

---

# PHASE B — The write loop (the core)

## Task 7: Meta Graph write primitive `metaGraphPost`

**Files:**
- Modify: `apps/web/lib/meta-graph.ts`
- Test: `apps/web/lib/__tests__/meta-graph.test.ts` (extend or create)

**Interfaces:**
- Produces: `async function metaGraphPost(token: string, path: string, body: Record<string, string | number>): Promise<any>` — mirrors `metaGraphGet`'s auth header + `metaError`/code-190 error contract, POST with form body.

- [ ] **Step 1: Write the failing test** (mock `fetch`)
```ts
it("metaGraphPost posts form body with bearer token + throws metaError on Meta error", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
  vi.stubGlobal("fetch", fetchMock);
  const r = await metaGraphPost("tok", "s1", { status: "PAUSED" });
  expect(r).toEqual({ success: true });
  const [url, init] = fetchMock.mock.calls[0];
  expect(init.method).toBe("POST");
});
```
Add a second case: a non-ok response with `{ error: { code: 190 } }` → throws with `.metaError.code === 190`.

- [ ] **Step 2: Run — expect FAIL.** Run: `pnpm --filter @fikirtive/web test meta-graph`

- [ ] **Step 3: Implement** — copy `metaGraphGet`'s structure (base URL, version, access-token, the `metaError` throw shape) but `method:"POST"` with `body: new URLSearchParams({...stringified})` and `access_token` in the body/header per the existing GET pattern.

- [ ] **Step 4: Run — expect PASS.** Run: `pnpm --filter @fikirtive/web test meta-graph`

- [ ] **Step 5: Commit**
```bash
git add apps/web/lib/meta-graph.ts apps/web/lib/__tests__/meta-graph.test.ts
git commit -m "feat(g7): metaGraphPost write primitive (mirrors metaGraphGet error contract)"
```

---

## Task 8: Approval binding (`meta-approval.ts`)

**Files:**
- Create: `apps/web/lib/meta-approval.ts`
- Test: `apps/web/lib/__tests__/meta-approval.test.ts`

**Interfaces:**
- Produces:
  - `type PlanStep = { index: number; op: AdOp; targetId: string; targetValue: Record<string, unknown> }`
  - `type Approval = { paramHash: string; boundActor: string; expiresAt: string; consumedAt?: string }`
  - `function canonicalizeSteps(steps: PlanStep[]): string` (stable: sort keys, normalize numbers)
  - `function hashSteps(steps: PlanStep[]): string` (sha256 of canonical form)
  - `function buildApproval(steps: PlanStep[], actor: string, nowIso: string, ttlMs: number): Approval`
  - `function verifyApproval(a: Approval, steps: PlanStep[], actor: string, nowIso: string): { ok: true } | { ok: false; reason: "hash" | "expired" | "consumed" | "actor" }`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { hashSteps, buildApproval, verifyApproval } from "../meta-approval";

const steps = [{ index: 0, op: "budget_up" as const, targetId: "s1", targetValue: { dailyBudgetMinor: 2000 } }];

it("hash is stable regardless of key order / number formatting", () => {
  const a = hashSteps(steps);
  const b = hashSteps([{ index: 0, op: "budget_up", targetId: "s1", targetValue: { dailyBudgetMinor: 2000.0 } } as any]);
  expect(a).toBe(b);
});
it("verify ok for the bound steps + actor within ttl", () => {
  const ap = buildApproval(steps, "org1", "2026-06-28T00:00:00Z", 60_000);
  expect(verifyApproval(ap, steps, "org1", "2026-06-28T00:00:30Z")).toEqual({ ok: true });
});
it("rejects edited steps (hash mismatch)", () => {
  const ap = buildApproval(steps, "org1", "2026-06-28T00:00:00Z", 60_000);
  const edited = [{ ...steps[0], targetValue: { dailyBudgetMinor: 9999 } }];
  expect(verifyApproval(ap, edited, "org1", "2026-06-28T00:00:30Z")).toEqual({ ok: false, reason: "hash" });
});
it("rejects expired", () => {
  const ap = buildApproval(steps, "org1", "2026-06-28T00:00:00Z", 60_000);
  expect(verifyApproval(ap, steps, "org1", "2026-06-28T00:02:00Z")).toEqual({ ok: false, reason: "expired" });
});
it("rejects consumed + wrong actor", () => {
  const ap = buildApproval(steps, "org1", "2026-06-28T00:00:00Z", 60_000);
  expect(verifyApproval({ ...ap, consumedAt: "x" }, steps, "org1", "2026-06-28T00:00:30Z")).toEqual({ ok: false, reason: "consumed" });
  expect(verifyApproval(ap, steps, "EVIL", "2026-06-28T00:00:30Z")).toEqual({ ok: false, reason: "actor" });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `pnpm --filter @fikirtive/web test meta-approval`

- [ ] **Step 3: Implement** — `canonicalizeSteps` does a deterministic JSON (recursively sort object keys; coerce numbers via `Number(x)` so `2000.0===2000`); `hashSteps` = `crypto.createHash("sha256").update(canonical).digest("hex")`; `buildApproval` sets `expiresAt = new Date(Date.parse(nowIso)+ttlMs).toISOString()`; `verifyApproval` checks actor, then `consumedAt`, then expiry (`nowIso > expiresAt`), then hash; returns the first failing reason.

- [ ] **Step 4: Run — expect PASS.** Run: `pnpm --filter @fikirtive/web test meta-approval`

- [ ] **Step 5: Commit**
```bash
git add apps/web/lib/meta-approval.ts apps/web/lib/__tests__/meta-approval.test.ts
git commit -m "feat(g7): bound/expiring/single-use approval (hash + verify + consume)"
```

---

## Task 9: `buildMetaPlanCard` pure helper + payload types

**Files:**
- Create: `packages/otto/src/skills/propose-meta-action.helpers.ts`
- Test: `packages/otto/src/skills/propose-meta-action.helpers.test.ts`

**Interfaces:**
- Consumes: `classifyMoneyClass` (re-declare a local copy OR a shared structural type — keep otto free of a web import; replicate the tiny `SAFE_OPS` set here with a test asserting parity).
- Produces:
  - `type ProposeMetaActionInput = { planTitle: string; steps: Array<{ op: "pause"|"resume"|"set_budget"|"reschedule"; targetId: string; intent: { dailyBudgetMinor?: number; startTime?: string; endTime?: string } }> }`
  - `type MetaActionStep = { index; op: AdOp; targetId; targetName; currentValue; targetValue; moneyClass; evidence? }`
  - `type MetaActionCardPayload = { planTitle; steps: MetaActionStep[]; totalSpendImpactDisplay; autoEligible: boolean; approval: Approval }`
  - `function buildMetaPlanCard(input, currentObjects: MetaAdObject[], mode: AutonomyMode, actor: string, nowIso: string): MetaActionCardPayload`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { buildMetaPlanCard } from "./propose-meta-action.helpers";

const objects = [{ id: "s1", level: "adset", name: "Set 1", status: "ACTIVE", dailyBudgetMinor: 1000, currency: "USD", accountId: "act_1" }] as any;

it("resolves set_budget→budget_up (spend) when target>current; → ask not auto even in AUTO", () => {
  const card = buildMetaPlanCard(
    { planTitle: "p", steps: [{ op: "set_budget", targetId: "s1", intent: { dailyBudgetMinor: 2000 } }] },
    objects, "AUTO", "org1", "2026-06-28T00:00:00Z");
  expect(card.steps[0].op).toBe("budget_up");
  expect(card.steps[0].moneyClass).toBe("spend");
  expect(card.autoEligible).toBe(false); // any spend step → whole plan asks
});

it("pause is safe → autoEligible true in AUTO", () => {
  const card = buildMetaPlanCard(
    { planTitle: "p", steps: [{ op: "pause", targetId: "s1", intent: {} }] },
    objects, "AUTO", "org1", "2026-06-28T00:00:00Z");
  expect(card.steps[0].op).toBe("pause");
  expect(card.steps[0].moneyClass).toBe("safe");
  expect(card.autoEligible).toBe(true);
  expect(card.approval.paramHash).toBeTruthy();
});

it("set_budget→budget_down is safe", () => {
  const card = buildMetaPlanCard(
    { planTitle: "p", steps: [{ op: "set_budget", targetId: "s1", intent: { dailyBudgetMinor: 500 } }] },
    objects, "AUTO", "org1", "2026-06-28T00:00:00Z");
  expect(card.steps[0].op).toBe("budget_down");
  expect(card.autoEligible).toBe(true);
});

it("unknown target id is dropped/flagged, never executable", () => {
  expect(() => buildMetaPlanCard(
    { planTitle: "p", steps: [{ op: "pause", targetId: "NOPE", intent: {} }] },
    objects, "ASK", "org1", "2026-06-28T00:00:00Z")).toThrow(/unknown target/i);
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `pnpm --filter @fikirtive/otto test propose-meta-action.helpers`

- [ ] **Step 3: Implement** — for each input step: find the matching object in `currentObjects` (throw `unknown target` if missing); snapshot `currentValue`; compute `targetValue`; **resolve the concrete op**: `set_budget` → `budget_up` if target>current else `budget_down`; `pause`/`resume`/`reschedule` map directly; classify money-class from the resolved op (local `SAFE_OPS = {pause,budget_down}`); build `evidence` from the object's known fields; compute `totalSpendImpactDisplay` (sum of budget deltas for spend steps); `autoEligible = mode==="AUTO" && steps.every(s => s.moneyClass==="safe")`; `approval = buildApproval(steps→PlanStep, actor, nowIso, ttl)`.

- [ ] **Step 4: Add a parity test** asserting the local `SAFE_OPS` equals the policy's classification for all 5 ops (guards drift from `meta-action-policy.ts`).

- [ ] **Step 5: Run — expect PASS.** Run: `pnpm --filter @fikirtive/otto test propose-meta-action.helpers`

- [ ] **Step 6: Commit**
```bash
git add packages/otto/src/skills/propose-meta-action.helpers.ts packages/otto/src/skills/propose-meta-action.helpers.test.ts
git commit -m "feat(g7): buildMetaPlanCard — server-resolved op/money-class/autoEligible/approval"
```

---

## Task 10: `proposeMetaAction` skill (persists the ACTION_CARD)

**Files:**
- Create: `packages/otto/src/skills/propose-meta-action.ts`
- Modify: `packages/otto/src/registry.ts`
- Modify: `packages/otto/src/context.ts` (the `metaAds` port gains a `currentObjects()` accessor if not already; reuse `list()`)
- Test: `packages/otto/src/skills/propose-meta-action.test.ts`

**Interfaces:**
- Consumes: `buildMetaPlanCard` (Task 9), `ctx.metaAds.list()` (Task 4), `prisma.chatMessage`, the org's `adsAutonomy` (read via a `ctx.metaAds.autonomy()` accessor — add it), `ctx.orgId`, `ctx.threadId`.
- Produces: `executeProposeMetaAction(input, runContext): Promise<{ cardId: string; autoEligible: boolean }>`; `proposeMetaActionSkill` (`cost:"free", effect:"write", reach:"internal"` → ungated); `export const proposeMetaAction = proposeMetaActionSkill.tool;`.

- [ ] **Step 1: Add `autonomy()` to the `metaAds` port** (`context.ts`): `autonomy(): Promise<"ASK"|"AUTO">`. Inject in `buildOttoContext` reading `MetaConnection.adsAutonomy` for `orgId` (default `"ASK"`).

- [ ] **Step 2: Write the failing test** (mirror `propose.test.ts`)
```ts
it("gate: free/write/internal → ungated", () => {
  expect(proposeMetaActionSkill.cost).toBe("free");
  expect(proposeMetaActionSkill.effect).toBe("write");
  expect(proposeMetaActionSkill.reach).toBe("internal");
  expect(proposeMetaActionSkill.needsApproval).toBe(false);
});
it("persists ONE ACTION_CARD with server-built payload", async () => {
  // mock prisma.chatMessage.create + ctx.metaAds.list()/autonomy()
  // assert kind==="ACTION_CARD", payload.steps length, payload.approval present, one create call
});
it("input carries no current values or money-class (LLM cannot set them)", () => {
  // assert the zod schema has no currentValue/moneyClass keys
});
```

- [ ] **Step 3: Run — expect FAIL.** Run: `pnpm --filter @fikirtive/otto test propose-meta-action`

- [ ] **Step 4: Implement** (copy DB shape from `propose.ts` `executePropose`): validate ownership by requiring every `targetId` to appear in `ctx.metaAds.list()`'s objects (else the skill returns a friendly "I can't find that ad" message — never persists an unowned target); read `mode = await ctx.metaAds.autonomy()`; `payload = buildMetaPlanCard(input, objects, mode, ctx.orgId, nowIso)`; persist ONE `ChatMessage` `kind:"ACTION_CARD"` (next `seq`, role `AGENT`, `payload`). Return `{ cardId, autoEligible: payload.autoEligible }`. Export the tool; **never import `meta-graph`** (fence).

- [ ] **Step 5: Register** in `registry.ts`.

- [ ] **Step 6: Run + catalog.** `pnpm --filter @fikirtive/otto test propose-meta-action` → PASS; `pnpm --filter @fikirtive/otto run catalog`.

- [ ] **Step 7: Commit**
```bash
git add packages/otto/src/skills/propose-meta-action.ts packages/otto/src/skills/propose-meta-action.test.ts packages/otto/src/registry.ts packages/otto/src/context.ts packages/otto/src/skills/CATALOG.md apps/web/lib/otto-actions.ts
git commit -m "feat(g7): proposeMetaAction skill — persists ACTION_CARD, owner-validated, ungated"
```

---

## Task 11: `runApprovedPlan` executor — the only Meta writer

**Files:**
- Create: `apps/web/lib/meta-write-actions.ts`
- Test: `apps/web/lib/__tests__/meta-write-actions.test.ts`

**Interfaces:**
- Consumes: `requireOwner` (`auth-guard.ts`), `isImpersonating` (`better-auth/compat.ts`), `decryptToken`, `metaGraphGet`/`metaGraphPost` (Tasks 3/7), `classifyMoneyClass`/`policyDecision` (Task 2), `prisma.metaConnection`/`prisma.metaActionExecution`/`prisma.chatMessage`, `MetaActionCardPayload` (Task 9).
- Produces: `async function runApprovedPlan(ownerId: string, cardId: string): Promise<{ results: Array<{ index; status: "APPLIED"|"SKIPPED"|"FAILED"|"NEEDS_CONFIRM"; reason?: string }> ; state: "done"|"partial"|"failed" }>` (internal, NOT `'use server'` — the shared step loop).

- [ ] **Step 1: Write failing tests** (mock prisma + graph). Cover:
```ts
// kill-switch: adsWritesPaused → throws/refuses, no graph calls
// per-step idempotency: a step already APPLIED in MetaActionExecution is skipped (no second metaGraphPost)
// live re-read recompute: a "budget_down" whose live current is now BELOW target → reclassified spend → in AUTO it is NOT applied (refused as needs-approval)
// pause applies: metaGraphPost called with { status: "PAUSED" }
// partial: step 2 throws → step 3 not attempted, state "partial", step1 APPLIED
// MAYBE-APPLIED: a row left APPLYING + live state ambiguous → NEEDS_CONFIRM, no re-post
```

- [ ] **Step 2: Run — expect FAIL.** Run: `pnpm --filter @fikirtive/web test meta-write-actions`

- [ ] **Step 3: Implement `runApprovedPlan`** (mirror the discipline of `startGen` in `gen-actions.ts`):
  1. Load `MetaConnection` for `ownerId`; if `adsWritesPaused` → throw `KILL_SWITCH`. If `!canWrite` → return `needsReconnect`.
  2. `token = decryptToken(...)`. Load the `ACTION_CARD` (owner-scoped) → `payload`.
  3. For each step in order:
     - Idempotency claim: `prisma.metaActionExecution.create({ id, ownerId, cardId, stepIndex, status:"PENDING" })` inside a try; on unique-violation, read the existing row — if `APPLIED` → `SKIPPED`; if `APPLYING` → reconcile (step 3d).
     - Update row → `APPLYING`.
     - **Live re-read** the object via `metaGraphGet`; recompute the resolved op + `classifyMoneyClass`; if `policyDecision(mode, moneyClass)==="ask"` AND this run is the AUTO path → mark `FAILED`/refused (auto must not apply a now-spend step). (The human-approve path already passed `verifyApproval`, so it proceeds.)
     - `metaGraphPost(token, targetId, bodyFor(op, targetValue))` (e.g. pause→`{status:"PAUSED"}`, resume→`{status:"ACTIVE"}`, budget→`{daily_budget|lifetime_budget}`, reschedule→`{start_time|end_time}`).
     - On success → row `APPLIED` (+ `appliedValue`), `ActionEvent` best-effort. On error → row `FAILED`, **stop the batch** (partial).
     - 3d reconcile (MAYBE-APPLIED): re-read live state; if it matches `targetValue` → treat APPLIED; if still ambiguous → `NEEDS_CONFIRM` (do not re-post).
  4. Aggregate `state`: all APPLIED/SKIPPED → `done`; any FAILED/NEEDS_CONFIRM with some applied → `partial`; first-step failure → `failed`.

- [ ] **Step 4: Run — expect PASS.** Run: `pnpm --filter @fikirtive/web test meta-write-actions`

- [ ] **Step 5: Commit**
```bash
git add apps/web/lib/meta-write-actions.ts apps/web/lib/__tests__/meta-write-actions.test.ts
git commit -m "feat(g7): runApprovedPlan — sole Meta writer (kill-switch, idempotency, live re-read, partial-stop)"
```

---

## Task 12: Approve action + auto-trigger + port injection (web only)

**Files:**
- Modify: `apps/web/lib/meta-write-actions.ts` (add `'use server'` `approveMetaActionPlan` + auto path)
- Modify: `apps/web/lib/otto-actions.ts` (`buildOttoContext` — NO metaWrite port needed since the skill never writes; ensure the auto-trigger runs server-side after a proposeMetaAction card)
- Modify: `apps/web/lib/otto-client-actions.ts` (surface `approveMetaActionPlan`)
- Modify: `apps/worker/src/otto-resume.ts` (assert it never writes Meta — no change beyond a guard comment/test)
- Test: `apps/web/lib/__tests__/meta-write-actions.test.ts` (extend)

**Interfaces:**
- Produces: `async function approveMetaActionPlan(cardId: string): Promise<{ ok: true; state } | { error: string }>` (`'use server'`): `requireOwner` → block `isImpersonating` → load card → `verifyApproval(payload.approval, steps, ownerId, nowIso)` → on ok, **consume** (set `payload.approval.consumedAt`, persisted) → `runApprovedPlan(ownerId, cardId)`.
- Produces: auto path: when `proposeMetaAction` returns `autoEligible:true`, the server (post-skill, in the turn flow, holding `requireOwner` context) calls `runApprovedPlan` directly — re-deriving `mode==="AUTO" && every step safe` server-side before doing so. (The client may also be the trigger; the server re-verifies regardless.)

- [ ] **Step 1: Write failing tests**
```ts
// approveMetaActionPlan: impersonating → blocked (no writes)
// approveMetaActionPlan: invalid/expired/consumed approval → error, no runApprovedPlan
// approveMetaActionPlan: valid → consumes approval (second call → "consumed" error) + runs
// auto path: AUTO + all-safe card → runApprovedPlan invoked with mode re-verified; a spend card never auto-runs
```

- [ ] **Step 2: Run — expect FAIL.** Run: `pnpm --filter @fikirtive/web test meta-write-actions`

- [ ] **Step 3: Implement** `approveMetaActionPlan` (`'use server'`) per the interface; the auto-trigger as a server fn `maybeAutoRun(ownerId, cardId)` called right after the propose card persists (re-reads mode + all-safe before running). Surface `approveMetaActionPlan` through `otto-client-actions.ts`.

- [ ] **Step 4: Guard the worker** — add a test in `apps/worker` asserting the worker resume context has no Meta-write capability (mirrors how `startGen` is withheld). No functional change; the executor lives in `apps/web/lib` and is never imported by the worker.

- [ ] **Step 5: Run — expect PASS.** Run: `pnpm --filter @fikirtive/web test meta-write-actions`

- [ ] **Step 6: Commit**
```bash
git add apps/web/lib/meta-write-actions.ts apps/web/lib/otto-actions.ts apps/web/lib/otto-client-actions.ts apps/worker/src/otto-resume.ts apps/web/lib/__tests__/meta-write-actions.test.ts
git commit -m "feat(g7): approveMetaActionPlan (bound, single-use) + server auto-trigger; worker stays write-free"
```

---

# PHASE C — UI + manageability

## Task 13: Thread `ACTION_CARD` through DTO + ui-messages + derive state

**Files:**
- Modify: `apps/web/lib/types.ts` (`ChatMessageDTO.kind` union)
- Modify: `apps/web/lib/otto-ui-messages.ts` (`placeholderTextFor`, `OttoUiMessageMetadata.kind`)
- Modify: `apps/web/lib/otto-inject-helpers.ts` (add `deriveActionState`)
- Test: `apps/web/lib/__tests__/otto-inject-helpers.test.ts` (extend)

**Interfaces:**
- Produces: `function deriveActionState(steps, executions): "pending"|"executing"|"done"|"partial"|"failed"` (multi-step analog of `deriveCardState`).

- [ ] **Step 1: Failing test for `deriveActionState`** — pending (no executions), executing (some APPLYING), done (all APPLIED), partial (some APPLIED + some FAILED), failed (first FAILED, none APPLIED).
- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @fikirtive/web test otto-inject-helpers`
- [ ] **Step 3: Implement** `deriveActionState`; add `"ACTION_CARD"` to `ChatMessageDTO.kind` and `OttoUiMessageMetadata.kind`; add an `ACTION_CARD` case to `placeholderTextFor` (e.g. "Otto prepared an action plan.").
- [ ] **Step 4: Run — expect PASS.** `pnpm --filter @fikirtive/web test otto-inject-helpers`
- [ ] **Step 5: Commit**
```bash
git add apps/web/lib/types.ts apps/web/lib/otto-ui-messages.ts apps/web/lib/otto-inject-helpers.ts apps/web/lib/__tests__/otto-inject-helpers.test.ts
git commit -m "feat(g7): thread ACTION_CARD through DTO/ui-messages + deriveActionState"
```

---

## Task 14: `OttoActionPlanCard` + MessageRow branches

**Files:**
- Create: `apps/web/components/otto/OttoActionPlanCard.tsx`
- Modify: `apps/web/components/otto/OttoConversation.tsx` (MessageRow `ACTION_CARD` branch)
- Modify: `apps/web/components/studio/Cowork.tsx` (MessageRow `ACTION_CARD` branch)

**Interfaces:**
- Consumes: `MetaActionCardPayload`, `approveMetaActionPlan` (`otto-client-actions.ts`), `deriveActionState`.

- [ ] **Step 1: Build the card** — model on `OttoPlanCard.tsx` (same Card shell + `ShieldCheck` copy). Render: `planTitle`; a list of steps each showing `targetName`, the change (`currentValue → targetValue`), a money-class badge (`safe`/`spend`), and `evidence`; the `totalSpendImpactDisplay`; then: if `autoEligible` and state≠pending → an "auto-running / done" status (no buttons); else an **Approve** + **Deny** pair. `approve()` calls `approveMetaActionPlan(cardId)` and re-polls state (mirror `OttoPlanCard.approve()` minus the `coworkGenerate` fallback).
- [ ] **Step 2: Wire MessageRow** — in both `OttoConversation.tsx` and `Cowork.tsx`, add `kind === "ACTION_CARD"` → `<OttoActionPlanCard .../>`.
- [ ] **Step 3: Manual smoke** — render a thread with a seeded `ACTION_CARD` row; confirm it shows steps + total + the right control (auto vs approve). (No real Meta call.)
- [ ] **Step 4: Commit**
```bash
git add apps/web/components/otto/OttoActionPlanCard.tsx apps/web/components/otto/OttoConversation.tsx apps/web/components/studio/Cowork.tsx
git commit -m "feat(g7): OttoActionPlanCard — steps + money badges + evidence + total + batch approve"
```

---

## Task 15: Connections UI — autonomy toggle + kill-switch

**Files:**
- Modify: `apps/web/lib/meta-write-actions.ts` (add `'use server'` `setAdsAutonomy(mode)`, `setAdsWritesPaused(paused)`)
- Modify: `apps/web/lib/otto-client-actions.ts` (surface both)
- Modify: `apps/web/components/otto/OttoConnections.tsx`
- Test: `apps/web/lib/__tests__/meta-write-actions.test.ts` (extend)

**Interfaces:**
- Produces: `setAdsAutonomy(mode: "ASK"|"AUTO"): Promise<{ ok: true } | { error: string }>`; `setAdsWritesPaused(paused: boolean): Promise<{ ok: true } | { error: string }>` (both `requireOwner` + `updateMany({where:{ownerId}})`, mirroring `updateMemory`).

- [ ] **Step 1: Failing tests** — `setAdsAutonomy("AUTO")` updates owner's row, owner-scoped, no throw on missing row; `requireOwner` enforced.
- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @fikirtive/web test meta-write-actions`
- [ ] **Step 3: Implement** both server actions (copy `updateMemory` shape: `requireOwner` → `prisma.metaConnection.updateMany({ where:{ ownerId }, data })` → `{ ok }`).
- [ ] **Step 4: UI** — in `OttoConnections.tsx` connected block (between accounts and Disconnect): an autonomy selector (Ask/Auto, with risk copy: "Auto lets Otto pause ads & lower budgets on its own — anything that spends still asks you") wired to `setAdsAutonomy`; a kill-switch toggle ("Pause all ad changes") wired to `setAdsWritesPaused`. Read current values from the extended `getMetaConnection` (Task 5). Hide both when `canWrite=false`, showing "Reconnect to let Otto manage ads."
- [ ] **Step 5: Run — expect PASS.** `pnpm --filter @fikirtive/web test meta-write-actions`
- [ ] **Step 6: Commit**
```bash
git add apps/web/lib/meta-write-actions.ts apps/web/lib/otto-client-actions.ts apps/web/components/otto/OttoConnections.tsx apps/web/lib/__tests__/meta-write-actions.test.ts
git commit -m "feat(g7): Connections — autonomy (Ask/Auto) + kill-switch toggles"
```

---

## Task 16: Full-suite verification + catalog + Otto instructions

**Files:**
- Modify: `packages/otto/src/instructions.ts` (teach Otto when to call `metaListObjects` / `proposeMetaAction`, and that it NEVER executes — only proposes)
- Modify: `packages/otto/src/skills/CATALOG.md` (regenerated)

- [ ] **Step 1: Add Otto instructions** — a short block: when the user asks to change their ads, call `metaListObjects` to see them, then `proposeMetaAction` with the target id(s) + intent; Otto never claims it executed — the plan card + the human/auto path do. Do NOT set current values, prices, or money-class.
- [ ] **Step 2: Regenerate catalog.** `pnpm --filter @fikirtive/otto run catalog` — confirm `meta-list-objects` + `propose-meta-action` present, the Meta writer ABSENT (it's not a skill).
- [ ] **Step 3: Full test + typecheck.**
Run: `pnpm --filter @fikirtive/otto test && pnpm --filter @fikirtive/web test`
Run: `pnpm -w typecheck`
Run: `bash scripts/check-skill-imports.sh; echo "fence exit=$?"` → 0
Expected: all green.
- [ ] **Step 4: Commit**
```bash
git add packages/otto/src/instructions.ts packages/otto/src/skills/CATALOG.md
git commit -m "feat(g7): Otto instructions for manage-ads (propose-only) + catalog"
```

---

## Self-Review (against the spec)

**Spec coverage:** §3 modes → Tasks 1,5,15. §4 ops + money-class → Tasks 2,9,11. §5 three components + walls → Tasks 4,10,11,12 + fence Task 6. §6 batch approval → Tasks 9,14. §7.1 bound approval → Task 8. §7.2 idempotency → Tasks 1,11. §7.3 reconcile/duplicate-confirm → Task 11. §7.4 partial-stop → Task 11. §7.5 kill-switch → Tasks 1,11,15. §8 data model → Task 1. §9 policy file → Task 2. §10 manageability → Tasks 4,15,16 (CATALOG + toggles). §11 scope upgrade → Task 5. §12 error handling → Task 11. §13 security/fence → Tasks 6,11,12. §14 testing → every task is TDD.

**Placeholder scan:** the only deliberately-cited "mirror the existing X" steps point at concrete files (the engineer reads them); all new signatures are defined in their task's Interfaces block.

**Type consistency:** `AdOp` (`pause|resume|budget_up|budget_down|reschedule`) is the resolved op everywhere (policy, helper, executor); the LLM-facing input op is `pause|resume|set_budget|reschedule` (resolved to `budget_up/down` server-side in Task 9) — this distinction is intentional and consistent across Tasks 9/10/11. `Approval` shape matches across Tasks 8/9/12. `MetaActionCardPayload`/`MetaActionStep` consistent across Tasks 9/11/13/14.

**Open items deferred to implementation (spec §16):** reschedule object-level bounds (Task 9 zod schema); approval hash canonicalization (Task 8, resolved); auto-trigger shares `runApprovedPlan` (Tasks 11/12, resolved: yes).

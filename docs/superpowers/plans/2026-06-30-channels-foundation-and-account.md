# Channel Foundation + Account/Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the extensible channel-provider seam (IG + FB connect adapters behind one `Channel` registry) and a scalable, config-driven Account/Settings page.

**Architecture:** A `Channel` interface + `channelRegistry` abstracts each platform; IG/FB reuse the existing single `MetaConnection` (one Meta OAuth grant backs both) and delegate to existing `meta-*` server functions. The Account page renders from a declarative section registry (Direction 1: one page + sticky left jump-nav), reusing existing account/billing/auth/meta actions and a new owner-scoped `settings` JSON store for new preferences.

**Tech Stack:** Next.js 16.2.9 (custom fork — read `node_modules/next/dist/docs` before any Next-specific code), React 19, Prisma + PostgreSQL, server actions (`"use server"` + `requireOwner()`), Vitest. Styling via the otto shell's `.fk` / `.fk.gb-skin` CSS tokens in `apps/web/app/otto/otto-theme.css` (NOT the shadcn `components/ui` set — avoid the dual-token clash; match the rest of OttoView).

## Global Constraints

- **gb is the default skin.** Coral (`--accent` / `--brand` in gb = ink; coral reserved) = **OTTO/agent only**. UI copy: **sentence case, no em-dashes**.
- **MONEY PATH UNTOUCHED.** Do NOT modify `packages/db/src/credits.ts`, `packages/core/src/spend.ts`, `packages/core/src/gen.ts`, `apps/web/lib/gen-actions.ts`, `refgen-actions.ts`, `cowork-actions.ts`, `apps/web/components/canvas/useCanvasGen.ts`, the worker gen/refgen jobs, or any idempotency index. The **spend cap** setting is **display + a soft signal surfaced to OTTO only** — it never alters reserve/settle/charge.
- **Owner = `Organization`** (`ownerId` → `Organization.id`). Every server action starts `const gate = await requireOwner(); if ("error" in gate) return gate; const { ownerId } = gate;`.
- **Tokens stay server-side.** Never send `accessTokenEnc` or a decrypted token to the client. Reuse `decryptToken` only inside server fns.
- **Reuse, don't reinvent:** `getMyAccount` (`lib/account-actions.ts`), `BuyPackButton` (`components/billing/BuyPackButton.tsx`), `signOutAction` (`lib/account-actions.ts`), `setAdsAutonomy` (`lib/meta-write-actions.ts`), `getMetaConnection` / `disconnectMeta` (`lib/meta-actions.ts`), `fetchOwnerPages` (`lib/meta-pages.ts`), `metaGraphGet` (`lib/meta-graph.ts`), `/api/meta/authorize`.
- **Verification per task:** `npx tsc --noEmit` (in `apps/web`) + the named unit test. UI tasks also: `npx next build` (exit 0) + a `/browse` screenshot on the dev server (`PORT=3007 pnpm --filter @fikirtive/web dev`, then the gstack browse binary). The Account view is auth-walled → screenshot via the existing `/skin-preview` harness pattern (add a `skin-preview/account` route reusing the real components with mock data) OR the authenticated browse session.

---

## File Structure

**Channel foundation (new):**
- `apps/web/lib/channels/types.ts` — `Channel`, `ChannelId`, `ChannelCapabilities`, `ChannelTarget`, `PostType`, `PublishMode`, result types.
- `apps/web/lib/channels/registry.ts` — `channelRegistry`, `listChannels()`, `getChannel(id)`.
- `apps/web/lib/channels/instagram.ts` — IG adapter (connect surface real; publish/insights stubs).
- `apps/web/lib/channels/facebook.ts` — FB adapter (connect surface real; publish/insights stubs).
- `apps/web/lib/channels/__tests__/registry.test.ts` — registry + capabilities tests.

**Owner settings (new + 1 schema change):**
- `packages/db/prisma/schema.prisma` — add `settings Json?` to `Organization`.
- `packages/db/prisma/migrations/<ts>_org_settings/migration.sql` — additive column.
- `apps/web/lib/owner-settings.ts` — `OwnerSettings` type + `DEFAULT_SETTINGS` + pure `mergeSettings()` + `getOwnerSettings()` / `setOwnerSetting()` server actions.
- `apps/web/lib/__tests__/owner-settings.test.ts` — `mergeSettings` pure tests.

**Account/Settings page (new + replace):**
- `apps/web/components/otto/settings/types.ts` — `SettingsSection`, `SettingsField` union.
- `apps/web/components/otto/settings/Switch.tsx` — small gb toggle (no shadcn switch exists).
- `apps/web/components/otto/settings/SettingsPage.tsx` — registry renderer (jump-nav + section cards + field rows).
- `apps/web/components/otto/settings/sections.tsx` — builds the `SettingsSection[]` from live data (Profile, Billing, Connections, OTTO, Notifications, Schedule defaults, Danger).
- `apps/web/components/otto/OttoAccount.tsx` — **replace** body to render `<SettingsPage .../>`.
- `apps/web/components/otto/OttoView.tsx` — account branch passes the extra props (channels, settings) through.
- `apps/web/app/otto/page.tsx` — load `getOwnerSettings()` + channel connection states; pass to `OttoApp` → `OttoView`.
- `apps/web/app/otto/otto-theme.css` — append `.fk.gb-skin` settings CSS (`.cv-settings*`).
- `apps/web/app/skin-preview/account/page.tsx` — dev harness to screenshot the page unauthenticated.

---

## Task 1: `Organization.settings` JSON column + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (the `Organization` model, ~line 545)
- Create: `packages/db/prisma/migrations/<timestamp>_org_settings/migration.sql`

**Interfaces:**
- Produces: `Organization.settings` (nullable `Json`) — read/written by Task 2's owner-settings store.

- [ ] **Step 1: Add the column to the schema**

In `Organization`, after `updatedAt`, add:

```prisma
  settings  Json?     // owner-scoped preferences (OwnerSettings shape); null = all defaults
```

- [ ] **Step 2: Write the additive migration**

Create `packages/db/prisma/migrations/20260630_org_settings/migration.sql`:

```sql
-- Additive only: owner preferences blob. NULL = defaults.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "settings" JSONB;
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `pnpm --filter @fikirtive/db exec prisma generate`
Expected: client regenerates with `settings` on `Organization`. (Do NOT run `migrate deploy` here — prod migrations run on deploy.)

- [ ] **Step 4: Typecheck the db package**

Run: `pnpm --filter @fikirtive/db build`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260630_org_settings/
git commit -m "feat(db): add Organization.settings JSON column (owner preferences)"
```

---

## Task 2: Owner settings store (`owner-settings.ts`)

**Files:**
- Create: `apps/web/lib/owner-settings.ts`
- Test: `apps/web/lib/__tests__/owner-settings.test.ts`

**Interfaces:**
- Consumes: `Organization.settings` (Task 1), `requireOwner` (`./auth-guard`), `prisma` (`@fikirtive/db`).
- Produces:
  - `type OwnerSettings` (see code), `DEFAULT_SETTINGS: OwnerSettings`
  - `mergeSettings(raw: unknown): OwnerSettings` (pure)
  - `getOwnerSettings(): Promise<OwnerSettings | { error: string }>`
  - `setOwnerSetting<K extends keyof OwnerSettings>(key: K, value: OwnerSettings[K]): Promise<{ ok: true } | { error: string }>`

- [ ] **Step 1: Write the failing test for `mergeSettings`**

Create `apps/web/lib/__tests__/owner-settings.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mergeSettings, DEFAULT_SETTINGS } from "../owner-settings";

describe("mergeSettings", () => {
  it("returns defaults for null/garbage", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });
  it("overlays known keys, ignores unknown, keeps defaults for missing", () => {
    const r = mergeSettings({ autoPublish: true, spendCapCredits: 50, bogus: 1 });
    expect(r.autoPublish).toBe(true);
    expect(r.spendCapCredits).toBe(50);
    expect(r.notifyEmail).toBe(DEFAULT_SETTINGS.notifyEmail);
    expect("bogus" in r).toBe(false);
  });
  it("coerces wrong types back to default (fail-safe)", () => {
    const r = mergeSettings({ autoPublish: "yes", spendCapCredits: "lots" });
    expect(r.autoPublish).toBe(DEFAULT_SETTINGS.autoPublish);
    expect(r.spendCapCredits).toBe(DEFAULT_SETTINGS.spendCapCredits);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd apps/web && npx vitest run lib/__tests__/owner-settings.test.ts`
Expected: FAIL (module not found / mergeSettings undefined).

- [ ] **Step 3: Implement `owner-settings.ts`**

```typescript
"use server";
import { prisma } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";
import { revalidatePath } from "next/cache";

export type OwnerSettings = {
  autoPublish: boolean;        // Schedule: auto-publish approved posts at their time
  spendCapCredits: number;     // OTTO soft cap (display + signal only; 0 = no cap)
  notifyEmail: boolean;        // email notifications
  notifyInApp: boolean;        // in-app notifications
  timezone: string;            // Schedule default tz (IANA)
  defaultPostTimes: string;    // comma-separated "HH:MM" defaults for Schedule
};

export const DEFAULT_SETTINGS: OwnerSettings = {
  autoPublish: false,
  spendCapCredits: 0,
  notifyEmail: true,
  notifyInApp: true,
  timezone: "Asia/Kuala_Lumpur",
  defaultPostTimes: "09:00,18:00",
};

// Pure: overlay a raw JSON blob onto defaults, dropping unknown keys + wrong types.
export function mergeSettings(raw: unknown): OwnerSettings {
  const out: OwnerSettings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof OwnerSettings)[]) {
    const v = r[k];
    if (typeof v === typeof DEFAULT_SETTINGS[k]) (out[k] as unknown) = v;
  }
  return out;
}

export async function getOwnerSettings(): Promise<OwnerSettings | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const org = await prisma.organization.findUnique({ where: { id: gate.ownerId }, select: { settings: true } });
  return mergeSettings(org?.settings ?? null);
}

export async function setOwnerSetting<K extends keyof OwnerSettings>(
  key: K, value: OwnerSettings[K],
): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  if (!(key in DEFAULT_SETTINGS)) return { error: "Unknown setting." };
  if (typeof value !== typeof DEFAULT_SETTINGS[key]) return { error: "Bad value." };
  const org = await prisma.organization.findUnique({ where: { id: gate.ownerId }, select: { settings: true } });
  const next = { ...mergeSettings(org?.settings ?? null), [key]: value };
  await prisma.organization.update({ where: { id: gate.ownerId }, data: { settings: next } });
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd apps/web && npx vitest run lib/__tests__/owner-settings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/web && npx tsc --noEmit` → clean.

```bash
git add apps/web/lib/owner-settings.ts apps/web/lib/__tests__/owner-settings.test.ts
git commit -m "feat(settings): owner-scoped settings store (getOwnerSettings/setOwnerSetting + pure mergeSettings)"
```

---

## Task 3: Channel seam — types + registry

**Files:**
- Create: `apps/web/lib/channels/types.ts`
- Create: `apps/web/lib/channels/registry.ts`
- Test: `apps/web/lib/channels/__tests__/registry.test.ts`

**Interfaces:**
- Produces:
  - `type ChannelId = string` and the `Channel`, `ChannelCapabilities`, `ChannelTarget`, `PostType`, `PublishMode`, `ConnectionStatus` types.
  - `channelRegistry: Record<ChannelId, Channel>`, `listChannels(): Channel[]`, `getChannel(id: ChannelId): Channel | undefined`.

- [ ] **Step 1: Write `types.ts`**

```typescript
import type { ReactNode } from "react";

export type ChannelId = string; // "instagram" | "facebook" | future ids — OPEN, never a closed enum
export type PostType = "feed-image" | "carousel" | "reel" | "story" | "text-link";
export type PublishMode = "auto" | "reminder";
export type ConnectionStatus = "connected" | "needs_reconnect" | "not_connected";

export type ChannelCapabilities = {
  postTypes: PostType[];
  maxMediaCount: number;
  supportsFirstComment: boolean;
  supportsNativeSchedule: boolean;
  rateLimitPer24h?: number;
};

export type ChannelTarget = { id: string; name: string };

// Minimal post shape the connect-phase needs (Schedule fleshes this out later).
export type ChannelPost = {
  caption: string;
  mediaUrls: string[];
  firstComment?: string;
  postType: PostType;
};

export interface Channel {
  id: ChannelId;
  label: string;
  icon: ReactNode;
  capabilities: ChannelCapabilities;

  connectionStatus(ownerId: string): Promise<ConnectionStatus>;
  /** OAuth start URL (the page links to it; no token handling client-side). */
  connectUrl(): string;
  disconnect(): Promise<{ ok: true } | { error: string }>;
  listTargets(ownerId: string): Promise<ChannelTarget[]>;

  // Filled by the Schedule/Analytics plans — stubbed now (throw "not implemented").
  autoPublishable(post: ChannelPost): PublishMode;
  publish(ownerId: string, target: ChannelTarget, post: ChannelPost): Promise<{ externalId: string } | { error: string }>;
  fetchAccountInsights(ownerId: string, target: ChannelTarget, range: string): Promise<unknown>;
  listPublishedPosts(ownerId: string, target: ChannelTarget, cursor?: string): Promise<unknown>;
  fetchPostInsights(ownerId: string, externalId: string): Promise<unknown>;
}
```

- [ ] **Step 2: Write the failing registry test**

Create `apps/web/lib/channels/__tests__/registry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { listChannels, getChannel } from "../registry";

describe("channelRegistry", () => {
  it("registers instagram and facebook", () => {
    const ids = listChannels().map((c) => c.id).sort();
    expect(ids).toEqual(["facebook", "instagram"]);
  });
  it("instagram declares its capabilities (carousel<=10, rate limit 25)", () => {
    const ig = getChannel("instagram")!;
    expect(ig.capabilities.maxMediaCount).toBe(10);
    expect(ig.capabilities.rateLimitPer24h).toBe(25);
    expect(ig.capabilities.postTypes).toContain("carousel");
  });
  it("getChannel returns undefined for an unknown id", () => {
    expect(getChannel("tiktok")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `cd apps/web && npx vitest run lib/channels/__tests__/registry.test.ts`
Expected: FAIL (registry not found). (Registry imports the adapters from Task 4 — this test goes green at the end of Task 4. That is the intended TDD order: write the registry shell now returning an empty registry so step 5 of THIS task passes the "module loads" bar, then Task 4 registers the adapters.)

- [ ] **Step 4: Write `registry.ts` (shell, adapters added in Task 4)**

```typescript
import type { Channel, ChannelId } from "./types";

// Adapters self-register by being imported here (Task 4 fills these in).
export const channelRegistry: Record<ChannelId, Channel> = {};

export function registerChannel(c: Channel): void { channelRegistry[c.id] = c; }
export function listChannels(): Channel[] { return Object.values(channelRegistry); }
export function getChannel(id: ChannelId): Channel | undefined { return channelRegistry[id]; }
```

- [ ] **Step 5: Typecheck + commit (test still red until Task 4 — that's expected)**

Run: `cd apps/web && npx tsc --noEmit` → clean.

```bash
git add apps/web/lib/channels/types.ts apps/web/lib/channels/registry.ts apps/web/lib/channels/__tests__/registry.test.ts
git commit -m "feat(channels): Channel interface + registry shell (extensible platform seam)"
```

---

## Task 4: Instagram + Facebook connect adapters

**Files:**
- Create: `apps/web/lib/channels/instagram.ts`
- Create: `apps/web/lib/channels/facebook.ts`
- Modify: `apps/web/lib/channels/registry.ts` (import the adapters so they register)

**Interfaces:**
- Consumes: `Channel` (Task 3), `registerChannel` (Task 3), `getMetaConnection` / `disconnectMeta` (`lib/meta-actions`), `fetchOwnerPages` (`lib/meta-pages`), `metaGraphGet` + token via existing fns. **IG + FB share the single `MetaConnection`** — both adapters read the same connection; "connected" = a MetaConnection row exists and is active.
- Produces: registered `instagram` + `facebook` channels.

- [ ] **Step 1: Write `facebook.ts`** (FB targets = FB pages via `fetchOwnerPages`)

```typescript
import type { Channel, ChannelPost, ChannelTarget, ConnectionStatus } from "./types";
import { getMetaConnection, disconnectMeta } from "../meta-actions";
import { fetchOwnerPages } from "../meta-pages";

const notImpl = () => { throw new Error("not implemented (filled by the Schedule/Analytics plan)"); };

async function metaStatus(): Promise<ConnectionStatus> {
  const c = await getMetaConnection();
  if ("error" in c || !c.connected) return "not_connected";
  return c.needsReconnect || c.status === "expired" ? "needs_reconnect" : "connected";
}

export const facebook: Channel = {
  id: "facebook",
  label: "Facebook",
  icon: null, // page supplies the brand glyph
  capabilities: { postTypes: ["feed-image", "text-link"], maxMediaCount: 1, supportsFirstComment: false, supportsNativeSchedule: true },
  connectionStatus: async () => metaStatus(),
  connectUrl: () => "/api/meta/authorize",
  disconnect: () => disconnectMeta(),
  listTargets: async (ownerId) => {
    const r = await fetchOwnerPages(ownerId);
    return "pages" in r ? r.pages.map((p) => ({ id: p.id, name: p.name })) : [];
  },
  autoPublishable: () => "auto",
  publish: notImpl, fetchAccountInsights: notImpl, listPublishedPosts: notImpl, fetchPostInsights: notImpl,
};
```

- [ ] **Step 2: Write `instagram.ts`** (IG targets = pages' linked `instagram_business_account`)

```typescript
import type { Channel, ChannelPost, ChannelTarget, ConnectionStatus } from "./types";
import { getMetaConnection, disconnectMeta } from "../meta-actions";
import { fetchOwnerPages } from "../meta-pages";

const notImpl = () => { throw new Error("not implemented (filled by the Schedule/Analytics plan)"); };

async function metaStatus(): Promise<ConnectionStatus> {
  const c = await getMetaConnection();
  if ("error" in c || !c.connected) return "not_connected";
  return c.needsReconnect || c.status === "expired" ? "needs_reconnect" : "connected";
}

export const instagram: Channel = {
  id: "instagram",
  label: "Instagram",
  icon: null,
  capabilities: { postTypes: ["feed-image", "carousel", "reel", "story"], maxMediaCount: 10, supportsFirstComment: true, supportsNativeSchedule: false, rateLimitPer24h: 25 },
  connectionStatus: async () => metaStatus(),
  connectUrl: () => "/api/meta/authorize",
  disconnect: () => disconnectMeta(),
  // IG business accounts hang off FB pages. For the connect surface we list the
  // pages as the targets; resolving page → instagram_business_account id is a
  // Schedule-plan concern (a single metaGraphGet on the page). Returning pages
  // here lets the Connections UI show "connected" + which pages back IG.
  listTargets: async (ownerId) => {
    const r = await fetchOwnerPages(ownerId);
    return "pages" in r ? r.pages.map((p) => ({ id: p.id, name: p.name })) : [];
  },
  autoPublishable: (post: ChannelPost) =>
    post.postType === "reel" || post.postType === "story" ? "reminder" : "auto",
  publish: notImpl, fetchAccountInsights: notImpl, listPublishedPosts: notImpl, fetchPostInsights: notImpl,
};
```

- [ ] **Step 3: Register them in `registry.ts`**

Append to `registry.ts`:

```typescript
import { instagram } from "./instagram";
import { facebook } from "./facebook";
registerChannel(instagram);
registerChannel(facebook);
```

- [ ] **Step 4: Run the Task-3 registry test, verify it passes**

Run: `cd apps/web && npx vitest run lib/channels/__tests__/registry.test.ts`
Expected: PASS (3 tests) — instagram + facebook registered, capabilities correct.

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/web && npx tsc --noEmit` → clean.

```bash
git add apps/web/lib/channels/
git commit -m "feat(channels): Instagram + Facebook connect adapters (reuse the shared Meta connection)"
```

---

## Task 5: Settings field types + `Switch` toggle

**Files:**
- Create: `apps/web/components/otto/settings/types.ts`
- Create: `apps/web/components/otto/settings/Switch.tsx`
- Modify: `apps/web/app/otto/otto-theme.css` (append `.cv-switch*`)

**Interfaces:**
- Produces: `SettingsField` (union), `SettingsSection`, and `<Switch checked onChange aria-label />`.

- [ ] **Step 1: Write `types.ts`**

```typescript
import type { ReactNode } from "react";

export type SettingsField =
  | { kind: "text"; id: string; label: string; hint?: string; value: string; readOnly?: boolean }
  | { kind: "toggle"; id: string; label: string; hint?: string; value: boolean; onToggle: (v: boolean) => void }
  | { kind: "number"; id: string; label: string; hint?: string; value: number; unit?: string; onSave: (v: number) => void }
  | { kind: "action"; id: string; label: string; hint?: string; button: string; onClick: () => void; tone?: "default" | "danger" }
  | { kind: "custom"; id: string; render: () => ReactNode };

export type SettingsSection = {
  id: string;
  title: string;
  subtitle?: string;
  danger?: boolean;
  fields: SettingsField[];
};
```

- [ ] **Step 2: Write `Switch.tsx`** (gb-styled; client component)

```tsx
"use client";
export function Switch({ checked, onChange, "aria-label": label }: { checked: boolean; onChange: (v: boolean) => void; "aria-label": string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      className={checked ? "cv-switch on" : "cv-switch"} onClick={() => onChange(!checked)} />
  );
}
```

- [ ] **Step 3: Append the CSS** to `apps/web/app/otto/otto-theme.css`:

```css
/* ── Settings toggle (no shadcn switch exists; gb-styled). */
.fk.gb-skin .cv-switch { width: 40px; height: 23px; border-radius: 999px; border: none; background: var(--border-strong); position: relative; cursor: pointer; transition: background var(--dur-fast) var(--ease-out); }
.fk.gb-skin .cv-switch::after { content: ""; position: absolute; top: 2.5px; left: 2.5px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: var(--shadow-sm); transition: left var(--dur-fast) var(--ease-out); }
.fk.gb-skin .cv-switch.on { background: var(--brand); }
.fk.gb-skin .cv-switch.on::after { left: 19.5px; }
```

- [ ] **Step 4: Typecheck + commit**

Run: `cd apps/web && npx tsc --noEmit` → clean.

```bash
git add apps/web/components/otto/settings/types.ts apps/web/components/otto/settings/Switch.tsx apps/web/app/otto/otto-theme.css
git commit -m "feat(settings): field types + gb Switch toggle"
```

---

## Task 6: `SettingsPage` renderer (Direction 1 — jump-nav + sections)

**Files:**
- Create: `apps/web/components/otto/settings/SettingsPage.tsx`
- Modify: `apps/web/app/otto/otto-theme.css` (append `.cv-settings*`)

**Interfaces:**
- Consumes: `SettingsSection`, `SettingsField` (Task 5), `Switch` (Task 5).
- Produces: `<SettingsPage sections={SettingsSection[]} />` — renders a sticky left jump-nav (one item per section title, smooth-scroll) + stacked section cards mapping each `SettingsField.kind` to a gb row.

- [ ] **Step 1: Write `SettingsPage.tsx`**

```tsx
"use client";
import { useState } from "react";
import type { SettingsSection, SettingsField } from "./types";
import { Switch } from "./Switch";

function FieldRow({ f }: { f: SettingsField }) {
  if (f.kind === "custom") return <div className="cv-set-row">{f.render()}</div>;
  return (
    <div className="cv-set-row">
      <div className="cv-set-lbl"><span>{f.label}</span>{"hint" in f && f.hint ? <span className="cv-set-hint">{f.hint}</span> : null}</div>
      {f.kind === "text" && <input className="cv-set-input" defaultValue={f.value} readOnly={f.readOnly} />}
      {f.kind === "toggle" && <Switch checked={f.value} onChange={f.onToggle} aria-label={f.label} />}
      {f.kind === "number" && (
        <span className="cv-set-num"><input className="cv-set-input cv-set-input-num" type="number" defaultValue={f.value}
          onBlur={(e) => f.onSave(Number(e.target.value))} />{f.unit ? <em>{f.unit}</em> : null}</span>
      )}
      {f.kind === "action" && <button className={f.tone === "danger" ? "cv-set-btn danger" : "cv-set-btn"} onClick={f.onClick}>{f.button}</button>}
    </div>
  );
}

export function SettingsPage({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  return (
    <div className="cv-settings">
      <nav className="cv-settings-nav">
        <h1>Settings</h1>
        {sections.map((s) => (
          <a key={s.id} href={`#sec-${s.id}`} className={s.id === active ? "on" + (s.danger ? " danger" : "") : (s.danger ? "danger" : "")}
            onClick={() => setActive(s.id)}>{s.title}</a>
        ))}
      </nav>
      <div className="cv-settings-body">
        {sections.map((s) => (
          <section key={s.id} id={`sec-${s.id}`} className="cv-set-sec">
            <h2>{s.title}</h2>{s.subtitle ? <p className="cv-set-sub">{s.subtitle}</p> : null}
            <div className={s.danger ? "cv-set-card danger" : "cv-set-card"}>{s.fields.map((f) => <FieldRow key={f.id} f={f} />)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Append the CSS** to `apps/web/app/otto/otto-theme.css` (gb tokens; sticky nav; cards):

```css
/* ── Account / Settings page (Direction 1: one page + sticky left jump-nav). */
.fk.gb-skin .cv-settings { display: flex; flex: 1; overflow: hidden; }
.fk.gb-skin .cv-settings-nav { width: 210px; flex: none; border-right: 1px solid var(--border-subtle); padding: 30px 16px; position: sticky; top: 0; }
.fk.gb-skin .cv-settings-nav h1 { font-size: 20px; font-weight: 700; margin-bottom: 16px; }
.fk.gb-skin .cv-settings-nav a { display: block; padding: 8px 11px; border-radius: 9px; font-size: 13.5px; color: var(--text-body); text-decoration: none; margin-bottom: 2px; }
.fk.gb-skin .cv-settings-nav a.on { background: var(--brand-tint); color: var(--brand-press); font-weight: 600; }
.fk.gb-skin .cv-settings-nav a.danger { color: #B4321E; }
.fk.gb-skin .cv-settings-body { flex: 1; overflow: auto; padding: 36px 44px; max-width: 760px; }
.fk.gb-skin .cv-set-sec { margin-bottom: 34px; scroll-margin-top: 24px; }
.fk.gb-skin .cv-set-sec h2 { font-size: 16px; font-weight: 700; }
.fk.gb-skin .cv-set-sub { font-size: 13px; color: var(--text-muted); margin: 2px 0 12px; }
.fk.gb-skin .cv-set-card { background: var(--surface-card); border: 1px solid var(--border-default); border-radius: 14px; padding: 4px 18px; }
.fk.gb-skin .cv-set-card.danger { border-color: #E7B7AE; }
.fk.gb-skin .cv-set-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 0; border-top: 1px solid var(--border-subtle); }
.fk.gb-skin .cv-set-row:first-child { border-top: none; }
.fk.gb-skin .cv-set-lbl { display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; font-weight: 500; }
.fk.gb-skin .cv-set-hint { font-size: 12px; color: var(--text-faint); font-weight: 400; }
.fk.gb-skin .cv-set-input { border: 1px solid var(--border-default); border-radius: 9px; padding: 7px 11px; font: inherit; font-size: 13.5px; color: var(--text-body); background: var(--surface-card); width: 240px; }
.fk.gb-skin .cv-set-input-num { width: 90px; }
.fk.gb-skin .cv-set-num { display: inline-flex; align-items: center; gap: 7px; color: var(--text-muted); font-size: 12.5px; }
.fk.gb-skin .cv-set-btn { height: 34px; padding: 0 14px; border-radius: 10px; font-size: 13px; font-weight: 600; border: 1px solid var(--border-default); background: var(--surface-card); color: var(--text-body); cursor: pointer; }
.fk.gb-skin .cv-set-btn.danger { border-color: #E7B7AE; color: #B4321E; }
```

- [ ] **Step 3: Typecheck + commit**

Run: `cd apps/web && npx tsc --noEmit` → clean.

```bash
git add apps/web/components/otto/settings/SettingsPage.tsx apps/web/app/otto/otto-theme.css
git commit -m "feat(settings): config-driven SettingsPage renderer (jump-nav + section cards)"
```

---

## Task 7: Build the sections from live data

**Files:**
- Create: `apps/web/components/otto/settings/sections.tsx`

**Interfaces:**
- Consumes: `SettingsSection`/`SettingsField` (Task 5), `Switch`, `AccountInfo` (`lib/account-actions`), `OwnerSettings` + `setOwnerSetting` (`lib/owner-settings`), `listChannels` (`lib/channels/registry`), `setAdsAutonomy` (`lib/meta-write-actions`), `signOutAction` (`lib/account-actions`), `BuyPackButton` (`components/billing/BuyPackButton`), `creditsLabel` (`lib/credit-format`).
- Produces: `buildSettingsSections(args): SettingsSection[]`.

- [ ] **Step 1: Write `sections.tsx`** (client; pure builder + custom renderers for balance/ledger/connections)

```tsx
"use client";
import type { SettingsSection } from "./types";
import type { AccountInfo } from "@/lib/account-actions";
import { signOutAction } from "@/lib/account-actions";
import type { OwnerSettings } from "@/lib/owner-settings";
import { setOwnerSetting } from "@/lib/owner-settings";
import { setAdsAutonomy } from "@/lib/meta-write-actions";
import { listChannels } from "@/lib/channels/registry";
import { BuyPackButton } from "@/components/billing/BuyPackButton";
import { creditsLabel } from "@/lib/credit-format";

type ChannelState = { id: string; label: string; status: "connected" | "needs_reconnect" | "not_connected"; targets: string[]; connectUrl: string };

export function buildSettingsSections(args: {
  account: AccountInfo;
  settings: OwnerSettings;
  channels: ChannelState[];
  adsAutonomy: "ASK" | "AUTO";
  onSettings: () => void; // router.refresh after a write
}): SettingsSection[] {
  const { account, settings, channels, adsAutonomy, onSettings } = args;
  const toggle = (k: keyof OwnerSettings) => async (v: boolean) => { await setOwnerSetting(k, v as never); onSettings(); };
  const num = (k: keyof OwnerSettings) => async (v: number) => { await setOwnerSetting(k, v as never); onSettings(); };

  return [
    { id: "profile", title: "Profile", subtitle: "Who you are on Fikirtive.", fields: [
      { kind: "text", id: "email", label: "Email", hint: "Used to sign in", value: account.email, readOnly: true },
      { kind: "custom", id: "signout", render: () => (
        <form action={signOutAction} style={{ marginLeft: "auto" }}><button className="cv-set-btn" type="submit">Sign out</button></form>) },
    ]},
    { id: "billing", title: "Billing and credits", subtitle: "Your balance and where credits went.", fields: [
      { kind: "custom", id: "balance", render: () => (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div><div className="cv-set-hint">Credit balance</div><div style={{ fontSize: 30, fontWeight: 800 }}>{creditsLabel(account.balance)}</div>
            {account.reserved > 0 ? <div className="cv-set-hint">{creditsLabel(account.reserved)} on hold</div> : null}</div>
          <BuyPackButton priceId={process.env.NEXT_PUBLIC_STRIPE_PACK_PRICE_ID ?? ""} label="Buy credits" />
        </div>) },
      { kind: "custom", id: "ledger", render: () => (
        <div style={{ width: "100%" }}>{account.recent.slice(0, 8).map((a) => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5 }}>
            <span style={{ color: "var(--text-body)" }}>{a.label}</span>
            <span style={{ color: a.delta > 0 ? "#15803D" : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{a.delta > 0 ? "+" : ""}{a.delta}</span>
          </div>))}</div>) },
    ]},
    { id: "connections", title: "Connections", subtitle: "Connect Instagram and Facebook so OTTO can publish and read results.", fields:
      channels.map((c) => ({ kind: "custom" as const, id: `conn-${c.id}`, render: () => (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div><div className="cv-set-lbl">{c.label}</div>
            <div className="cv-set-hint">{c.status === "connected" ? (c.targets.join(", ") || "Connected") : c.status === "needs_reconnect" ? "Reconnect needed" : "Not connected"}</div></div>
          {c.status === "connected"
            ? <a className="cv-set-btn" href={c.connectUrl}>Manage</a>
            : <a className="cv-set-btn" href={c.connectUrl}>{c.status === "needs_reconnect" ? "Reconnect" : "Connect"}</a>}
        </div>) })) },
    { id: "otto", title: "OTTO behavior", subtitle: "How much OTTO does on its own.", fields: [
      { kind: "toggle", id: "ads", label: "Ask before ad spend", hint: "OTTO checks with you before spending on ads", value: adsAutonomy === "ASK",
        onToggle: async (v) => { await setAdsAutonomy(v ? "ASK" : "AUTO"); onSettings(); } },
      { kind: "toggle", id: "autopub", label: "Auto-publish posts", hint: "Publish approved posts automatically at their time", value: settings.autoPublish, onToggle: toggle("autoPublish") },
      { kind: "number", id: "cap", label: "Spend cap", hint: "OTTO pauses a task over this many credits (0 = no cap)", value: settings.spendCapCredits, unit: "credits", onSave: num("spendCapCredits") },
    ]},
    { id: "notifications", title: "Notifications", fields: [
      { kind: "toggle", id: "nemail", label: "Email", value: settings.notifyEmail, onToggle: toggle("notifyEmail") },
      { kind: "toggle", id: "ninapp", label: "In-app", value: settings.notifyInApp, onToggle: toggle("notifyInApp") },
    ]},
    { id: "schedule", title: "Schedule defaults", fields: [
      { kind: "text", id: "tz", label: "Time zone", value: settings.timezone },
      { kind: "text", id: "times", label: "Default posting times", hint: "Comma-separated, e.g. 09:00,18:00", value: settings.defaultPostTimes },
    ]},
    { id: "danger", title: "Danger zone", danger: true, fields: [
      { kind: "action", id: "del", label: "Delete account", hint: "Hides your workspace. Contact us to fully erase.", button: "Delete", tone: "danger",
        onClick: () => { if (confirm("Delete this account? This hides your workspace.")) location.assign("mailto:tao@belcort.com?subject=Delete%20my%20account"); } },
    ]},
  ];
}
```

> Note: `NEXT_PUBLIC_STRIPE_PACK_PRICE_ID` — confirm the real env var name used by the existing billing page; if packs are a list, render one `BuyPackButton` per pack. (Check `components/billing` usage during implementation.)

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: clean. (Fix import paths / the Stripe price prop against the real billing usage.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/otto/settings/sections.tsx
git commit -m "feat(settings): build sections from live data (profile/billing/connections/otto/notifications/schedule/danger)"
```

---

## Task 8: Wire the page (replace OttoAccount; thread data through)

**Files:**
- Modify: `apps/web/components/otto/OttoAccount.tsx` (render `SettingsPage` from built sections)
- Modify: `apps/web/components/otto/OttoView.tsx` (account branch passes new props)
- Modify: `apps/web/components/otto/OttoApp.tsx` (pass `settings` + `channels` + `adsAutonomy` down)
- Modify: `apps/web/app/otto/page.tsx` (load `getOwnerSettings()` + each channel's status/targets + adsAutonomy; pass down)

**Interfaces:**
- Consumes: everything above; `getOwnerSettings`, `listChannels`, `getMetaConnection`.

- [ ] **Step 1: Loader — in `app/otto/page.tsx`**, add to the parallel data load:

```typescript
import { getOwnerSettings } from "@/lib/owner-settings";
import { listChannels } from "@/lib/channels/registry";
// ...inside the component, after `ownerId` is known:
const settingsRes = await getOwnerSettings();
const settings = "error" in settingsRes ? undefined : settingsRes;
const channelStates = await Promise.all(listChannels().map(async (c) => ({
  id: c.id, label: c.label, connectUrl: c.connectUrl(),
  status: await c.connectionStatus(ownerId),
  targets: (await c.listTargets(ownerId)).map((t) => t.name),
})));
```
Pass `settings`, `channelStates`, and the existing `account.adsAutonomy` (from `getMetaConnection`, or default `"ASK"`) into `<OttoApp ... settings={settings} channels={channelStates} adsAutonomy={adsAutonomy} />`. Thread the three new props through `OttoApp` → `OttoView` (account branch) → `OttoAccount`. (Match the existing prop-drilling style; default each to safe empties.)

- [ ] **Step 2: Replace `OttoAccount.tsx` body**

```tsx
"use client";
import { useRouter } from "next/navigation";
import type { AccountInfo } from "@/lib/account-actions";
import type { OwnerSettings } from "@/lib/owner-settings";
import { DEFAULT_SETTINGS } from "@/lib/owner-settings";
import { SettingsPage } from "./settings/SettingsPage";
import { buildSettingsSections } from "./settings/sections";

type ChannelState = { id: string; label: string; status: "connected" | "needs_reconnect" | "not_connected"; targets: string[]; connectUrl: string };

export function OttoAccount({ account, settings, channels = [], adsAutonomy = "ASK" }: {
  account: AccountInfo | null; settings?: OwnerSettings; channels?: ChannelState[]; adsAutonomy?: "ASK" | "AUTO";
}) {
  const router = useRouter();
  if (!account) return <div className="cv-settings-body">Could not load your account.</div>;
  const sections = buildSettingsSections({ account, settings: settings ?? DEFAULT_SETTINGS, channels, adsAutonomy, onSettings: () => router.refresh() });
  return <SettingsPage sections={sections} />;
}
export default OttoAccount;
```

- [ ] **Step 3: Typecheck + build**

Run: `cd apps/web && npx tsc --noEmit` → clean.
Run: `cd apps/web && npx next build` → exit 0.

- [ ] **Step 4: Visual verify** — add `apps/web/app/skin-preview/account/page.tsx` rendering `<OttoAccount account={MOCK} settings={DEFAULT_SETTINGS} channels={[{id:"instagram",label:"Instagram",status:"connected",targets:["@bloomcoffee"],connectUrl:"#"},{id:"facebook",label:"Facebook",status:"not_connected",targets:[],connectUrl:"#"}]} adsAutonomy="ASK" />` inside the `fk gb-skin` wrapper (mirror `app/skin-preview/page.tsx`; `notFound()` in production). Then:

```bash
cd /Users/winnin/Desktop/artlio/.claude/worktrees/gracious-chandrasekhar-72f8c9
PORT=3007 pnpm --filter @fikirtive/web dev &  # wait for ready
B="$HOME/.claude/skills/gstack/browse/dist/browse"
$B viewport 1440x900; $B goto "http://localhost:3007/skin-preview/account"; $B wait --networkidle
$B screenshot "$SCRATCH/account-check.png"; $B console --errors
```
Expected: the settings page renders (left jump-nav: Profile / Billing and credits / Connections / OTTO behavior / Notifications / Schedule defaults / Danger zone), section cards, toggles, balance + ledger, connection rows; no console errors. Read the PNG; copy to `~/Desktop/fikirtive-account-built.png` for founder review.

- [ ] **Step 5: Money guard + commit**

Run (must be empty): `git status --porcelain -- packages/db/src/credits.ts packages/core/src/spend.ts apps/web/lib/gen-actions.ts apps/web/components/canvas/useCanvasGen.ts`

```bash
git add apps/web/components/otto/OttoAccount.tsx apps/web/components/otto/OttoView.tsx apps/web/components/otto/OttoApp.tsx apps/web/app/otto/page.tsx apps/web/app/skin-preview/account/page.tsx
git commit -m "feat(account): config-driven Settings page live (channels + owner settings); replace OttoAccount"
```

---

## Self-Review

**Spec coverage** (channels-foundation + account-settings specs):
- Channel interface + registry + IG/FB connect adapters → Tasks 3–4 ✓. publish/insights stubbed for later plans ✓.
- `ChannelConnection` decision → reuse the shared `MetaConnection` for IG/FB (documented in Task 4); generic table deferred to when a non-Meta platform lands ✓.
- Account Dir-1 + config registry → Tasks 5–8 ✓. Sections (Profile/Billing/Connections/OTTO/Notifications/Schedule defaults/Danger) ✓. Connections iterates the registry ✓. OwnerSettings store ✓. Reuse getMyAccount/BuyPackButton/signOutAction/setAdsAutonomy ✓.
- Money path untouched; spend cap display+signal only ✓.

**Placeholder scan:** one explicit follow-up flagged inline — the Stripe pack price env/prop must be confirmed against the real billing usage in Task 7 (the existing billing page knows the price id(s)). Resolve during implementation, not a silent gap.

**Type consistency:** `OwnerSettings` keys (`autoPublish`, `spendCapCredits`, `notifyEmail`, `notifyInApp`, `timezone`, `defaultPostTimes`) consistent across Tasks 2/7/8. `ChannelState` shape identical in Tasks 7 + 8. `Channel.connectUrl()`/`connectionStatus()`/`listTargets()`/`disconnect()` signatures match Tasks 3 → 4 → 7.

**Open item for the implementer:** confirm `adsAutonomy` is exposed by `getMetaConnection()` (it is — `{ ..., adsAutonomy }`) and thread it; if absent, default `"ASK"`.

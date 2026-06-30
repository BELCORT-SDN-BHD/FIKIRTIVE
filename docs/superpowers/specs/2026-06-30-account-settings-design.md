# Account / Settings redo — design spec

Date: 2026-06-30 · Builds first (smallest, fully decided)

## Goal
Turn the current minimal Account page (balance + receipt) into a **detailed,
easy-to-scale settings page**: looks like one clean page with a sticky left
jump-nav (Direction 1), but is rendered from a **config-driven section registry**
so adding a future setting is one entry in a list — never buried in code
(founder's "file-system" principle). gb skin; coral = OTTO only.

## Non-goals (v1)
- Subscriptions/plan management (credit packs already exist; subscriptions deferred).
- Multi-user / team roles.
- Any change to the spend/charge path. "Buy credits" reuses the existing Stripe
  pack flow (`BuyPackButton` → grantCredits-only money-in path) unchanged.

## Architecture

### Section registry (the engine)
A declarative list the page renders from. One module, e.g.
`apps/web/components/otto/settings/registry.tsx`:

```
type Field =
  | { kind: "text";   id; label; hint?; value; onSave }
  | { kind: "toggle"; id; label; hint?; value; onToggle }
  | { kind: "number"; id; label; hint?; value; unit?; onSave }
  | { kind: "action"; id; label; hint?; button; onClick; tone? }
  | { kind: "custom"; id; render: () => ReactNode }   // escape hatch
type Section = { id; title; subtitle?; danger?; fields: Field[] }
```

- `SettingsPage` renders the left jump-nav from `sections[].title` + the stacked
  section cards from `sections[].fields`, mapping each `Field.kind` to a gb-styled
  row. Adding a setting = push a `Field`; adding a section = push a `Section`.
- `custom` is the escape hatch for anything that doesn't fit (e.g. the credit
  balance hero, the receipt ledger, the Meta connection card) — it renders a
  bespoke component but still lives as a registry entry so the section/nav stays
  consistent.

### Sections (v1)
1. **Profile** — name (text), email (text, read-only or editable per existing auth), sign-in method (info), **Sign out** (action → better-auth signOut).
2. **Billing & Credits** — credit balance hero (custom, from `getMyAccount`), **Buy credits** (custom → existing `BuyPackButton`), receipt ledger (custom, the existing honest ledger incl "Otto thinking" / "Refunded").
3. **Connections** — renders one row per **registered channel** (channels-foundation
   spec): connect / reconnect / disconnect + the connected targets. IG + FB in
   Phase A; a future platform appears here automatically. (custom field; shared with
   Schedule + Analytics.)
4. **OTTO behavior** — Ads autonomy (toggle → existing `setAdsAutonomy` ASK/AUTO), Auto-publish posts (toggle; consumed by Schedule), Spend cap (number; "pause a task over N credits"), default voice/tone (text or link to Brand memory).
5. **Notifications** — email + in-app prefs (toggles).
6. **Schedule defaults** — time zone (text/select), default posting times (text). Consumed by Schedule.
7. **Danger zone** — delete account (action, destructive, confirm) — wire to existing delete if present, else stub with confirm + a clear "contact us" until built.

### Data / persistence
- Reuse existing: `getMyAccount` (balance/ledger), `BuyPackButton`/Stripe, better-auth
  sign-out, `setAdsAutonomy`.
- **New prefs** (auto-publish, spend cap, notifications, schedule defaults, voice)
  need a small owner-scoped store. Add a single JSON `settings` column on the owner
  (or a thin `OwnerSettings` row) with a typed getter/setter
  (`getOwnerSettings` / `setOwnerSetting(key, value)`), owner-scoped + fail-closed.
  This is metadata only — **not** a money file. (The plan decides JSON-column vs row.)
- Spend cap is **display + a soft guard surfaced to OTTO**; it does NOT modify the
  reserve/settle ledger. (If we later enforce it, that's a separate money-reviewed change.)

## Money / safety
- Display + preferences only. Sign-out = auth. Buy-credits = the existing
  grantCredits-only Stripe path (untouched). Danger-zone delete = destructive →
  explicit confirm.
- No do-not-touch files. New `OwnerSettings` store is metadata.

## UI / behavior
- gb tokens; one `/account` page; sticky left jump-nav; smooth-scroll to section.
- Mobile: nav collapses to a top segmented control or accordion (plan decides).

## Testing
- Registry renderer: each `Field.kind` renders + fires its handler.
- `getOwnerSettings`/`setOwnerSetting`: owner-scoped, fail-closed, round-trips.
- Reuse existing tests for balance/Stripe/setAdsAutonomy.

## Open questions for the plan
- Email editable? (depends on better-auth flow) — default read-only with "change" → magic link.
- `OwnerSettings`: JSON column on existing owner row vs new table.

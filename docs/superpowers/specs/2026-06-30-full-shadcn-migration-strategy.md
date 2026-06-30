# Full shadcn migration — strategy spec (umbrella)

Date: 2026-06-30 · Multi-session epic · The MAIN LINE (founder: "迁完全部全部的组件去 shadcn… 严格全部迁完再 Analytics")

This is an **umbrella strategy**, not a single implementable spec. The app is too
large for one plan, so it is decomposed into independent **surface** sub-projects,
each of which gets its own `spec → writing-plans → subagent-driven build` cycle and
reuses the rules here. The parked Analytics task resumes (built natively on shadcn)
**after** every surface is migrated.

## Goal
Kill the dual UI system. Today the app is a **hybrid**: `login` + `billing` are real
shadcn (`.gb` tokens + `components/ui`), while the **otto app + admin console + the
rest** are the **old `fk` design system** (`components/fk` + the `.fk` / `.fk.gb-skin`
token CSS in `app/otto/otto-theme.css` + inline `style={{var(--token)}}`), merely
**re-painted** to the Grok-bright look via a token-override hack. Convert every
fk-based surface to **real shadcn `components/ui` + `.gb` tokens + tailwind v4**, then
delete `fk`, `otto-theme.css`, and the `?skin=fk` flag entirely.

The **design is already locked** (see [[fikirtive-ui-rework]] + [[fikirtive-design-system-shadcn]]):
Grok-bright — near-white `#FCFCFC`, ink `#0A0A0A`, **coral `#EC5828` = OTTO/agent ONLY**,
semantic palette for STATE only, Geist font. The Grok-bright shadcn system already
lives in the repo (`app/globals.css` `.gb` block, the 5 custom `components/ui`, OTTO
assets) and on claude.ai/design project `0abf8563`. This migration is **mechanical
conversion against that locked design**, not a new design effort.

## Target end-state (definition of done for the whole epic)
- One system: shadcn `components/ui` + `.gb` tokens (`globals.css`) + tailwind v4, Geist.
- `.gb` applied at the **root layout** so every page inherits the tokens (today it is
  applied per-surface; the otto shell uses `className="fk"` / `.fk.gb-skin`).
- **Deleted:** `components/fk/*` (16 primitives), `app/otto/otto-theme.css` (the `.fk` /
  `.fk.gb-skin` token CSS + the `cv-*` / `al-*` class system), the `?skin=fk` flag,
  **`components/studio/*` + `app/studio` (the retired creator surface — confirmed not in
  the nav, replaced by canvas home; delete after a load-bearing check)**.
- **Kept:** ReactFlow (`@xyflow/react`) — it is a library, not a component system;
  its custom node/toolbar components are **restyled** with shadcn primitives + `.gb`.
- coral stays OTTO/agent-only across the whole app; sentence case, no em-dashes.

## Decomposition — surfaces, in strict build order
Each surface = its own `spec → plan → subagent-driven build`, strangler-style: migrate
the surface, delete each `fk` primitive as its **last** consumer moves off it, ship the
increment (the app keeps working — shadcn and fk render the same Grok-bright values, so
each surface flips cleanly).

- **S0 — Foundation** (unblocks everything):
  - apply `.gb` at the root `layout.tsx`;
  - `npx shadcn add` the stock components the app needs to match the fk set
    (avatar, checkbox, progress, select, switch, tabs, textarea, tooltip, sonner/toast,
    + any others a surface needs) — they auto-theme from `.gb`;
  - author a **fk → .gb token-mapping reference** (e.g. `--brand`→`--primary`,
    surfaces/text/border/accent) so every later conversion is consistent;
  - **delete `components/studio` + `app/studio`** after confirming nothing load-bearing
    imports them.
- **S1 — Otto app** (the product; the biggest, sub-split into its own plans):
  S1a nav (`OttoNav`) → S1b the simple views (`OttoAccount` [already shadcn-ish via the
  new settings page], `OttoConnections`, `OttoStuff`, `OttoMemory`, `OttoLibrary`,
  `OttoTemplates`, `OttoDiscover`, `OttoFrontDoor`) → S1c chat (`OttoConversation`,
  `OttoChatStream`, `OttoTrace`) → **S1d the canvas** (`FlowCanvas` + node components +
  toolbar + the `.al-*`/`.cv-*` CSS — the hardest). Each sub-surface verified + the fk
  primitives it was the last user of are deleted.
- **S2 — Admin / operator console** (~15 internal pages: `admin`, `admin/audit`,
  `content`, `conversations(+[threadId])`, `cost`, `credits`, `directives`,
  `knowledge`, `models`, `settings`, `system`, `team`, `tenants(+[orgId])`). Internal,
  lower-stakes; its own multi-plan effort.
- **S3 — Remaining routes**: `editor`, `library`, `m`, and any other fk consumers.
- **S4 — Teardown**: once no surface imports `fk` or `otto-theme.css`, delete them +
  the `?skin=fk` flag; grep-verify zero references.
- **(then) Analytics + Schedule** — the parked tasks, built **natively on shadcn**
  (the Analytics Phase-A plan `docs/superpowers/plans/2026-06-30-analytics.md` is
  re-targeted to shadcn `components/ui` + a shadcn/recharts chart instead of the
  hand-built SVG + gb CSS).

## Per-surface discipline (the contract every surface plan inherits)
- **Strangler, not big-bang.** Convert one surface; delete an fk primitive only when its
  last consumer is gone (`grep -rl "@/components/fk/<X>"` returns nothing). The app stays
  shippable at every step.
- **Money path = DISPLAY ONLY, untouched.** The spend logic is never modified — only the
  display components change. Do NOT touch `packages/db/src/credits.ts`,
  `packages/core/src/spend.ts`, `gen.ts`, `gen-actions.ts`, `refgen-actions.ts`,
  `cowork-actions.ts`, `useCanvasGen.ts`, the worker gen/refgen jobs,
  `packages/generation/*`, or any idempotency index. Run the money guard
  (`git status --porcelain` over those paths = empty) on every surface.
- **subagent-driven build** (the established flow): per-task TDD where testable (pure
  helpers, state machines) + a per-task spec+quality review + fixes, then a per-surface
  whole-diff review.
- **Visual verification per surface:** screenshot the real route (or a `skin-preview`
  harness for auth-walled views) via the gstack `/browse` binary → copy the PNG to
  `~/Desktop` for founder review (the founder cannot see inline widgets — see
  [[show-designs-as-png]]). Founder approves each surface before the next.
- **Coexistence is fine mid-epic:** fk and shadcn render the same Grok-bright values, so
  a half-migrated app is visually consistent. No big-bang flag day.

## Token mapping (S0 authors the canonical table; sketch)
| fk (`.fk` / `.fk.gb-skin`) | shadcn (`.gb` in globals.css) |
|---|---|
| `--brand` (ink `#0A0A0A`) | `--primary` |
| `--accent` (coral `#EC5828`) | (coral; OTTO-only — keep as the accent, not a default) |
| `--surface-card` / `--bg-page` | `--card` / `--background` |
| `--text-strong/body/muted/faint` | `--foreground` / `--muted-foreground` (+ scale) |
| `--border-default/subtle/strong` | `--border` (+ a subtle/strong variant) |
| success/warning/error/info | the `.gb` semantic tokens (already defined) |

## Out of scope / non-goals
- No redesign — the look is locked; this is conversion only.
- No new features per surface (Analytics/Schedule are net-new and come last).
- No money-logic changes.
- ReactFlow is not replaced.

## Risks
- **The canvas (S1d)** is the hardest: ReactFlow + heavy custom `.al-*`/`.cv-*` CSS +
  the promptbar/toolbar. Budget it as its own plan; restyle, don't rewrite the flow.
- **Money-display surfaces** (nav credit line, Account balance/ledger, canvas
  generating-state, billing): re-skin display only; money guard is mandatory there.
- **Scale**: ~29 otto + ~15 admin + misc components → genuinely multi-session. Each
  surface ships independently so progress is durable and the app never breaks.

## Verification (epic-level done)
- `npx tsc --noEmit` clean + `pnpm --filter @fikirtive/web build` exit 0 after each surface.
- Money guard clean on every surface.
- Final: `grep -rl "@/components/fk"` and any `otto-theme.css` / `?skin=fk` reference
  return nothing; `components/fk`, `otto-theme.css`, `components/studio`, `app/studio`
  are gone.

## First sub-project
**S0 — Foundation.** Proceed to `writing-plans` for S0 only; later surfaces get their own
plans that cite this strategy.

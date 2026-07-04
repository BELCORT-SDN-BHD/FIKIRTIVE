# FIKIRTIVE Admin Dashboard Local Audit

Date: 2026-07-04
Scope: official `/admin`, local dev preview, source audit of current admin sections
Goal: provide the latest project context and a deletion/merge/rebuild map for redesigning the official admin dashboard without Figma.

## Evidence Captured

| File | What it shows | Health |
|---|---|---|
| `01b-official-admin-access-viewport.png` | Official `/admin` redirects to login without founder session | Expected access block; authenticated production screen could not be inspected locally |
| `02b-skin-preview-cost-viewport.png` | Local skin preview for `Cost & usage` | Page renders, but preview is isolated and not the full dashboard |
| `03b-skin-preview-settings-viewport.png` | Local skin preview for `Settings` | Page renders, but preview nav still highlights Cost even when Settings is shown |

Raw full-page captures `01-official-admin-access.png`, `02-skin-preview-cost.png`, and `03-skin-preview-settings.png` are kept for traceability. Use the `01b/02b/03b` viewport captures as the accepted visual evidence.

## 2026-07-04 Admin V2 QA Pass

Latest local target: `AUTH_ENABLED=false` dev preview at `/skin-preview/admin-v2`. Production `next start` was also checked: `/admin` redirects to `/login` without a founder session, and `/skin-preview/admin-v2` returns 404 as expected outside development.

| File | What it shows | Health |
|---|---|---|
| `06-admin-v2-preview-desktop.png` / `06-admin-v2-preview-desktop-annotated.png` | Overview at 1440px with the 8-section city hall shell | Pass; no console errors |
| `07-admin-v2-money.png` / `07-admin-v2-money-annotated.png` | Money section with risk queue, ledger, approvals, and finance limits | Pass |
| `08-admin-v2-tenants.png` | Tenant watchlist and tenant detail | Pass |
| `08-admin-v2-staff.png` | Staff, permissions, and money hierarchy matrix | Pass |
| `08-admin-v2-cases.png` / `09-admin-v2-case-opened.png` | Metadata-first cases and reason-gated open-case dialog | Pass |
| `08-admin-v2-otto.png` | Otto Ops switches and provider controls | Pass |
| `08-admin-v2-audit.png` | Recent admin activity | Pass |
| `08-admin-v2-system.png` | System health queue/provider rows | Pass |
| `10-admin-v2-preview-mobile.png` / `10-admin-v2-preview-mobile-annotated.png` | Mobile overview at 390px | Pass; no horizontal overflow |
| `11-admin-v2-mobile-money.png` | Mobile section selector on Money | Pass |
| `12-admin-v2-mobile-search-fixed.png` | Search now filters local preview rows and shows empty states | Pass |
| `13-admin-v2-filter-refresh-fixed.png` | Filter summary and refresh status controls | Pass |
| `14-admin-v2-byteplus-pack-desktop.png` | System Health BytePlus resource-pack guard on desktop | Pass |
| `15-admin-v2-byteplus-pack-mobile.png` | System Health BytePlus resource-pack guard at 390px mobile | Pass; no horizontal overflow |

Interactive checks completed:

- All 8 sections were reachable from the desktop nav and mobile section selector.
- The case dialog requires an explicit reason before unlocking sensitive content, then closes back to the list.
- Otto enable/provider switches expose switch semantics and update state.
- Search now narrows approvals, tenants, cases, audit, and system rows in the preview instead of only echoing the query.
- Filter and refresh icon buttons now expose visible state: filter summary with current chips, and a timestamped mock-data refresh notice.
- BytePlus pack guard row is visible in System Health on desktop and mobile preview; no console errors or horizontal overflow.

Verification commands:

- `corepack pnpm --filter @fikirtive/web typecheck`
- `corepack pnpm --filter @fikirtive/web test`
- changed-admin-file `eslint`
- `corepack pnpm --filter @fikirtive/web build`
- `corepack pnpm -r test`
- `corepack pnpm -r typecheck`

## Latest Project Decisions That Matter

1. `市政厅 v2` is the target shape. The current admin should become a real staff management backend with a section x role x read/write/approval matrix, money hierarchy, founder approval queue, invitation/deactivation audit, staff membership, hardened impersonation, and Otto excluded from admin access.
2. Finance grant limits are now explicit: finance can grant up to 1,000 displayed credits per transaction and 3,000 per day; above that goes to founder approval.
3. Impersonation is super-admin only, always write-blocked, reason-required, banner-visible, expires after 30 minutes, and fully audited.
4. Content visibility changed: default view is metadata only. Reading full content requires an explicit audited "open case" action. Finance never sees content.
5. Credit consumption detail is now required on both user Account Credits and official `/admin/cost`, using the same taxonomy: Otto conversation, image, video, search, and future spend points.
6. Old `COWORK_PROVIDER` beta-dollar-safety rule is superseded by full-entry metering. Cowork turn is superseded by Agents SDK Otto. BytePlus is the live media provider; old fal/modal references are legacy or fallback context.

## Current Admin Map

Current nav has 11 live entries:

| Current Entry | Redesign Decision |
|---|---|
| Settings | Remove as default landing. Keep only emergency/system config that is still active. |
| Prompt & knowledge | Merge into Config/Otto controls. It should not be a top-level daily route unless actively used. |
| Knowledge | Merge with Prompt & knowledge to avoid duplicated mental model. |
| Model & provider | Keep, but move into Config/Otto controls with clear kill switches and provider status. |
| Cost & usage | Rebuild into Money/Ledger view with credit taxonomy plus internal provider USD. |
| Credits | Merge into Money/Tenants. Current standalone grant form is outdated. |
| Content review | Rebuild into audited Cases. Default metadata only. |
| Otto conversations | Merge into audited Cases/Otto Ops. Do not expose full transcripts by default. |
| Team & access | Rebuild as Staff & permissions. This is the heart of 市政厅 v2. |
| Tenants | Keep and expand as tenant detail, wallet, status, risk, and admin actions. |
| System & queue | Keep, but make it an Overview/Health widget before a deep route. |

## Findings

### P0: Admin Home Is Pointing At The Wrong Era

`/admin` redirects to `/admin/settings`. That makes the first screen a legacy config surface, while the product target is 市政厅 v2: money safety, tenant health, staff roles, approvals, audit, and operational risk. The redesigned home should be an operator overview, not a settings page.

Recommended first screen:

| Area | Content |
|---|---|
| Money risk | pending credit approvals, large grants, failed/refunded reservations |
| Tenant health | tenants with low credits, blocked tenants, recent high spend |
| Content cases | open cases, reported content, recently opened sensitive content |
| System health | queue failures, active jobs, stuck jobs, provider degradation |
| Staff/audit | recent admin actions, denied access, impersonation sessions |

### P0: Content Screens Expose Too Much By Default

`ContentAdmin` directly renders produced media, prompts, model refs, and guardian payloads. `ConversationsAdmin` renders full messages and Otto generation cards. This conflicts with the 2026-07-03 decision: default metadata only; full content requires an audited "open case" action.

Redesign requirement:

| Default metadata | Open case view |
|---|---|
| tenant, user id, timestamps, status, model/kind, spend/ref id, report reason | prompt/media/transcript/raw payload |
| visible to allowed roles | reason required, audited, role-limited, time-boxed |

Finance must never see content, even through shared tables or raw JSON.

### P0: Money Controls Are Not 市政厅 v2 Yet

`CreditsAdmin` is still a direct grant/adjust form. It does not show the finance single/day limits, founder approval queue, typed confirmation/cooldown for negative adjustments, or tenant detail context. `/admin/cost` currently shows provider USD and paid jobs, but the latest decision requires credit consumption detail using the same categories users see in Account Credits.

Redesign requirement:

| Section | Needed Change |
|---|---|
| Money overview | displayed credits, internal credits, provider USD, margin signal |
| Ledger | category filter: Otto, image, video, search, future spend |
| Grants | role limit, daily remaining, approval handoff, idempotency key |
| Dangerous adjustments | typed confirmation now; two-person approval when team size > 1 |
| Tenant wallet | put balance, packs, grants, refunds, reserves, settles in tenant detail |

### P1: Team & Access Is Only A Role Dropdown

Current `TeamAdmin` is a user table with role select and save. 市政厅 v2 needs staff membership, invitation/deactivation, readable permission matrix, approval axis, and audit. The existing `SECTION_MATRIX` has `read` and `mutate`; it does not yet include approval permissions or money limits.

Redesign requirement:

| Surface | Needed |
|---|---|
| Staff list | active, invited, deactivated, last admin action, role |
| Permission matrix | section x role x read/write/approval |
| Money hierarchy | per role single grant limit and daily grant limit |
| Invitation/deactivation | every action writes `ActionEvent` |
| Impersonation | super-admin only, reason, banner, expiry, write-block |

### P1: Settings Contains Legacy Provider Concepts

`SettingsAdmin` still exposes `cowork_provider` with `mock`, `fal`, and `modal (self-hosted)` and footer copy references `GENERATION_PROVIDER, FAL_KEY`. The latest inventory says `COWORK_PROVIDER` beta logic is superseded and cowork turn is superseded by Agents SDK Otto. BytePlus is the live media provider.

Redesign decision:

| Current Feature | Action |
|---|---|
| Otto provider select: mock/fal/modal | Remove from primary dashboard unless there is still a live operational fallback. |
| `cowork_provider` naming | Rename or retire; do not carry Cowork-era labels into 市政厅 v2. |
| FAL_KEY copy | Replace with current provider/runtime copy or remove. |
| Vision planner copy | Reword under Otto context/reference limits if still active. |

### P1: Audit Taxonomy Has Old Cowork Events

The audit page still lists `cowork.turn`, `cowork.enhance`, and `cowork.draft` as money gate event types. Those should be replaced or archived under an Otto/Agents taxonomy so audit, cost, and ledger speak the same language.

Recommended taxonomy direction:

| Old | New Direction |
|---|---|
| cowork.turn | otto.turn / otto.llm |
| cowork.enhance | otto.plan / otto.edit if still meaningful |
| cowork.draft | otto.draft / generation.reserve-settle chain |
| gen/refgen only | include credit ledger kind/refId categories |

### P2: Preview Harness Is Useful But Stale

`/skin-preview/admin` only previews Cost and Settings. It also hardcodes the active nav to Cost, so Settings preview visually marks the wrong nav item. This is not production-critical, but it weakens redesign QA because the preview cannot compare the full admin shell.

Fix when redesign starts:

| Preview Need | Why |
|---|---|
| one preview route per admin section | visual QA without founder session |
| active nav follows `?c=` | avoid false UI evidence |
| empty/loading/error states | redesign must cover 3 states |
| desktop + mobile screenshots | admin should be mobile usable |

## Proposed New Information Architecture

| New Section | Absorbs | Primary Job |
|---|---|---|
| Overview | System & queue, money risk, audit highlights | Founder/operator command center |
| Money | Cost & usage, Credits, parts of Tenants | Credit ledger, grants, approvals, spend taxonomy |
| Tenants | Tenants, tenant wallet/actions | Tenant state, isolation, packs, balance, risky actions |
| Staff & permissions | Team & access | 市政厅 v2 matrix, invitations, deactivation, impersonation |
| Cases | Content review, Otto conversations | Metadata-first moderation and audited content access |
| Otto Ops | Prompt/knowledge/model runtime pieces | Otto runtime, model routing, kill switches, knowledge health |
| Audit | Audit log, denied access, impersonation | Immutable admin/action timeline |
| System Health | queues, provider health, failures | Deep operational diagnostics |

This gives the redesign 8 meaningful areas instead of 11 mixed-era links.

## Remove / Merge / Keep

### Remove From Primary Dashboard

| Item | Reason |
|---|---|
| Settings as `/admin` default | Wrong landing for 市政厅 v2 |
| Cowork-era provider naming | Superseded by Agents SDK Otto and full-entry metering |
| Direct transcript/media browsing | Violates metadata-first content visibility |
| Standalone founder-only credit adjustment as main money surface | Missing role limits and approval workflow |

### Merge

| Merge | Into |
|---|---|
| Prompt & knowledge + Knowledge + Model & provider + still-valid Settings controls | Otto Ops / Config |
| Cost & usage + Credits + tenant wallet details | Money |
| Content review + Otto conversations | Cases |
| System summary + key audit/money signals | Overview |

### Keep And Rebuild

| Keep | Rebuild As |
|---|---|
| `SECTION_MATRIX` | readable permission + approval matrix |
| System & queue | health widgets plus deep route |
| Tenants | tenant operational console |
| Audit | unified action/event ledger |
| Model/provider controls | constrained emergency ops, not broad settings |

## Visual Direction Notes

1. Use the existing FIKIRTIVE admin seriousness: dense, operational, scannable. Avoid marketing hero layout.
2. Use `.gb` + shadcn patterns where the project standard expects them. Current admin pages lean on inline styles and older local components.
3. Put actions beside the thing they affect: grants inside tenant wallet, case opening beside the content row, impersonation inside tenant/user context.
4. Every risky action needs a visible audit consequence before submit.
5. Cards should be used for repeated records and focused tools only; the main shell should be full-width operational bands and tables.
6. Redesign around states: empty, loading, error, denied, approval-pending, and audited-open.

## Recommended First Build Slice

1. Build the new `/admin` Overview shell using read-only widgets.
2. Replace the nav with the 8-section IA above.
3. Rebuild Money read-only first: credit ledger taxonomy, tenant spend aggregation, pending approvals placeholder.
4. Rebuild Cases metadata-first before exposing any transcript/media.
5. Rebuild Staff & permissions after matrix/approval data contract is decided.

## Source Anchors

- `docs/BLUEPRINT.md`: 市政厅 v2, tenant/accounting transparency, team/approval future.
- `docs/research/GRILL-VERDICTS-2026-07-03.md`: X-02 through X-05 decisions and credit consumption detail.
- `docs/review/DECISION-INVENTORY-2026-07-02.md`: `COWORK_PROVIDER` superseded, BytePlus live, Cowork/Agents transition.
- `packages/core/src/roles.ts`: current roles, sections, and `SECTION_MATRIX`.
- `apps/web/app/admin/layout.tsx`: current 11-entry admin nav and `/admin` shell.
- `apps/web/components/admin/*.tsx`: current implementation details for Settings, Cost, Credits, Content, Conversations, Team, System, Audit.

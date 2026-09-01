# Founder Home

Founder Home is Fikirtive's desktop-only, customizable marketing-health surface for a small-business founder.

## Authority

- This folder owns the Founder Home product pattern, component registry, templates, reference evidence, and review prototype.
- `model.ts` is the machine-readable authority for available components and every business-goal template.
- `FounderHomeReference.tsx` is an interactive review prototype. Its data is fixture-only and must not be read as live merchant truth.
- `home-analysis-spec.md` is the Founder-approved and frozen screen-design authority for the separate `home.analysis` detail surface.
- `home-analysis-selected-direction.png` is the Founder-selected visual target for that detail surface.
- Production `/` and `/analysis` consume the shared marketing-health read model. Review fixtures remain isolated from both production import graphs.
- Current live analytics can only produce honest Meta-only `partial`, setup, insufficient, or unavailable states. It cannot produce the review fixture's full cross-channel `ready` result.
- Workspace-wide Home customization remains approved in this pattern but is not exposed as a fake production save. It requires the owner-scoped persistence and `Manage home` capability defined by the Phase 2 spec.

## Approved product decisions

- Primary user: a small-business founder.
- Primary job: review overall marketing health, understand important changes, and decide what to do next.
- A business goal creates a recommended Home; the founder may show, hide, and reorder governed components.
- The fixed header owns business goal, date range, comparison, freshness, and `Customize home`.
- Customization is workspace-wide and permissioned by `Manage home`.
- Components share one date range. Missing data is a setup state, never a fabricated zero.
- Operations components are optional and do not appear in the recommended marketing-health template.
- Ordinary components navigate to detail. `Recommended next action` opens Otto.
- Dashboard is desktop-only. Small viewports receive a deliberate desktop-required message.

## Selected direction

The selected low-fidelity direction is a narrative founder brief:

1. Marketing-health conclusion and primary trend.
2. Efficiency and source-completeness context.
3. `What changed` beside `Top performers`.
4. One Otto recommendation beside channel contribution.

It deliberately avoids a wall of equal KPI cards.

Visual truth: `selected-direction.png`.

## Review boundary

This pattern approves the Home hierarchy and customization interaction. Production routing now follows it, while analytics aggregation, provider integrations, attribution rules, and workspace layout persistence remain separate backend authorities.

## Interaction completion mini-spec

Founder approval: 2026-08-28.

Founder re-acceptance after interaction completion: 2026-08-28.

Intent: every visible Home control must produce an honest, observable change in the review prototype.

Acceptance criteria:

1. `Business goal` changes the recommended component composition, founder-language conclusion, primary metric, supporting metrics, findings, performers, channels, and Otto recommendation.
2. `Date range` keeps the selected composition but changes the period, primary value, chart, and period-dependent supporting values.
3. `Comparison` keeps the selected composition but changes comparison labels and deltas; `No comparison` removes comparison-only deltas.
4. Each business goal owns an independent customized component order. Switching goals and returning restores that goal's saved order.
5. `Reset` restores the recommended template for the active business goal. Goal, range, and comparison controls are unavailable while an unsaved customization draft is open.
6. The prototype remains fixture-only; it must not imply live analytics, persistence, or production routing.

## Create workspace handoff mini-spec

Founder approval: 2026-08-29 — “是的。”

Intent: Home remains the only product Home and marketing decision surface. `Create` is a separate first-class product area, like Schedule; Home only hands relevant context into it.

Acceptance criteria:

1. `Continue creating` may expose recent-canvas shortcuts, but `Create something new` navigates to the dedicated Create workspace rather than expanding Home.
2. `Recommended next action` opens Create with one visible, removable context; it never auto-submits or charges credits.
3. Home does not render a creation composer, Conversation/history, Otto status or Canvas tools.
4. Existing canvases may open full-screen Canvas directly; new work begins in Create.
5. Canvas Back returns Create workspace.
6. Review-only route ownership lives in `canvas/review-links.ts`; Home does not duplicate route strings.

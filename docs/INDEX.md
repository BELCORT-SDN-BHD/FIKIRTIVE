# docs/ — index & source-of-truth map

One line per folder: what it is, and which file is canonical. When two docs cover the
same thing, the **canonical** one wins; the other is marked superseded.

## Strategy & product (canonical lives in `fikirtive/`)
- **`fikirtive/prd-roadmap.md`** — ✅ **canonical PRD + roadmap (v2)**. The two-clocks doctrine, phased roadmap, gap list, milestone→money mapping.
- `fikirtive/financial-model.md` — financial model (pricing, unit economics, forecast, raise).
- `fikirtive/pitch-deck.md` — investor narrative.
- `fikirtive/_*.md` — working drafts (deck specs, valuation derivation). **gitignored scratch**, kept on disk only.

## Decisions
- **`adr/`** — ✅ Architecture Decision Records (e.g. `0001-brand-vocabulary.md`). Settled calls; don't re-litigate.

## Design
- **`design/`** — ✅ canonical design docs: `2026-06-10-reference-control-layer.md` (PROMOTED), wireframes, `winnin-master-design-*.md`, eng-review test plan.
- Office-hours design docs live OUTSIDE the repo at `~/.gstack/projects/artlio/*-design-*.md` (discoverable by `/plan-*` skills).

## Plans
- **`superpowers/plans/`** — ✅ phase/implementation plans (e.g. `2026-06-19-closed-beta-p3-multitenant-flip.md`). Real specs — should be committed.

## Reference material
- `research/` — background research.
- `sop/` — standard operating procedures (e.g. ComfyUI→Artlio workflow).
- `closed-beta-env-checklist.md` — pre-wedge operational gate.

## Superseded / historical (kept for trace, NOT current)
- `PRD.md` — ⚠️ **superseded** by `fikirtive/prd-roadmap.md` (this is the older pre-Fikirtive Artlio PRD).
- `prd-review/Artlio-PRD-Open-Questions.md` — ⚠️ historical open-questions review.
- `backlog.md`, `ux-audit-2026-06-12.md` — historical.

## Naming note
Product was renamed **Artlio → Fikirtive** and the agent **Cowork → Otto** (see `adr/`). Some
code identifiers still read `cowork-*` / `@artlio/*` — that's tracked drift, not a second product.

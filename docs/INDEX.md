# docs/ — index & source-of-truth map

> ⚠️ **过期(TOMBSTONE 2026-07-04)。** 本文件冻结于 2026-06-24,早于并**不包含**当前宪法栈
> (BLUEPRINT / REVIEWER-PLAYBOOK / harmony 七件 / 判决记录)。它不再是"source of truth map"。
> **权威的 source-of-truth 与阅读顺序在仓库根的 `AGENTS.md`。** 本文件保留仅供旧目录考古。

One line per folder: what it is, and which file is canonical. When two docs cover the
same thing, the **canonical** one wins; the other is marked superseded.

## Strategy / business / fundraising
- Intentionally **NOT in this repo** — `main` is product/engineering only. The pitch deck,
  financial model, PRD/roadmap, and valuation work live outside version control.
- Product/build specs (the engineering source of truth) live in `superpowers/plans/` + `superpowers/specs/`.

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
- `PRD.md` — ⚠️ the older pre-Fikirtive Artlio PRD (historical; current product/build specs are in `superpowers/plans/` + `specs/`).
- `prd-review/Artlio-PRD-Open-Questions.md` — ⚠️ historical open-questions review.
- `backlog.md`, `ux-audit-2026-06-12.md` — historical.

## Naming note
Product was renamed **Artlio → Fikirtive** and the agent **Cowork → Otto** (see `adr/`). The npm
scope was renamed `@artlio/*` → `@fikirtive/*` (2026-06-24); some code identifiers still read
`cowork-*` (the agent's internal symbols) — that's tracked drift, not a second product.

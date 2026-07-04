# FIKIRTIVE — start here (any agent, any tool, any harness)

> If you are a GPT/Codex/goal-mode agent that does NOT read `.claude/`, these rules still
> bind you. The founder runs multiple agent harnesses against this repo — the machine gates
> in CI enforce most of this regardless of what you read, and violating the prose rules gets
> your PR reverted. Read this whole file before touching anything.

## Non-negotiable rules (violating these = reverted / incident)

1. **Never push directly to `main`.** All changes land via a PR. Pushing `main`
   **auto-deploys web + worker to Railway AND auto-runs `prisma migrate deploy` on prod** —
   a bad merge ships instantly, with no human gate. There is no branch protection (private
   repo, free plan); the discipline IS the protection.
2. **Never merge a PR unless ALL CI checks are green** on the current head commit. Never
   self-merge your own PR — the founder is the final merge authority.
3. **Ask the founder before ANY real paid spend** during development/verification
   (BytePlus/fal/Anthropic verification runs, Stripe live actions). "Asking" is the cap —
   there is deliberately no code cap (宪法 2). Do not spend real money to "just test it".
4. **Never edit `docs/BLUEPRINT.md`** (the constitution). It is immutable except via the
   founder's own §7 amendment flow. CI (`check-blueprint-integrity.sh`) fails if it changes
   without an explicit founder amendment. If code and blueprint disagree: **stop and report** —
   do not "helpfully" let the code win.
5. **Money & tenant paths are sacred.** Any diff touching the spend path (genRequest gate,
   startGen, credit ledger reserve/settle/refund, idempotency keys, the fal/BytePlus provider
   call) must keep it exactly-once and fail-closed; any query on an owner-scoped model must
   carry an `ownerId` filter (tenant iron-curtain, 宪法 6). A cross-tenant read is an incident.

## The reading order (before you build anything)

1. `docs/BLUEPRINT.md` — the constitution (what this product IS; 11 non-negotiable articles;
   the 9 expansion seams every new feature must route through). NEVER edit.
2. `.claude/CLAUDE.md` — the law layer (merge discipline, founder rules, bootstrap order).
   Written for the Claude harness but the rules apply to every agent.
3. `docs/review/REVIEWER-PLAYBOOK.md` — review checklists; run them before touching any PR.
   Warning: some invariants LOOK like over-engineering but are load-bearing — the playbook
   says why. Precedence: playbook > code; blueprint > playbook.
4. `docs/research/GRILL-VERDICTS-2026-07-03.md` (+ `docs/review/DECISION-INVENTORY-2026-07-02.md`)
   — the product decisions already made (要/不要/以后). Don't re-litigate them.
5. `docs/review/EXPANSION-SEAMS.md` + `docs/design/2026-07-03-harmony-0*.md` — build recipes:
   the exact way to add a skill, a model, a收钱点, a platform, a data model, a queue, a card.

## Conventions

- **Language (宪法 9)**: spec/skill docs in 华语; generation prompts in English; UI copy in
  English sentence case.
- **Never hardcode pricing** — margins live in config (宪法 5, ≥45% floor).
- **New capability for the agent = a new skill file** (seam 1, `defineOttoSkill`), never a
  second app or a bypass.
- Present product options to the founder; don't decide them yourself.

## Stale-doc warning

Some older docs predate this stack and can mislead: `docs/INDEX.md`, root `TODOS.md`,
`docs/backlog.md` are pre-pivot artifacts (tombstoned at their headers). The blueprint's
ch.3 zoning map is a dated snapshot. When a doc and current code disagree on STATUS (not on
LAW), trust the code + this file's reading order — not the stale snapshot.

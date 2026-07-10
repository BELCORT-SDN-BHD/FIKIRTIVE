# FIKIRTIVE — start here (any agent, any tool, any harness)

> If you are a GPT/Codex/goal-mode agent that does NOT read `.claude/`, these rules still
> bind you. The founder runs multiple agent harnesses against this repo — the machine gates
> in CI enforce most of this regardless of what you read, and violating the prose rules gets
> your PR reverted. Read this whole file before touching anything.

## Non-negotiable rules (violating these = reverted / incident)

1. **Never push directly to `main`.** All changes land via a PR. `main` is production-bound:
   deploys are MANUAL (`railway up -s web|worker -e production`; auto-deploy verified dead
   2026-07-10) and `prisma migrate deploy` runs against prod on deploy — a bad merge ships
   verbatim on the next deploy. `main` now has an active org ruleset (`protect-main`,
   BELCORT-SDN-BHD org) as hard protection, but the discipline stays: PR only, CI green.
2. **Never merge a PR unless ALL CI checks are green** on the current head commit. Never
   self-merge your own PR — the founder is the final merge authority.
   **CI 不可用时(账单封锁/Actions 宕机)不得以"CI 本来就红"为由合并;必须在本地完整
   复现三关(check/test/web-build,配方见 `docs/runbooks/local-ci.md`)并把结果贴进 PR,
   再经 founder 明确批准才可合并。此规则约束所有 agent(claude/codex/任何工具)。**
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

## Orchestration control plane (conditional)

When a session is asked to orchestrate multi-agent work, resume an interrupted program, or make
product/architecture/design/audit decisions, it must also read
`.claude/skills/orchestration/SKILL.md` and `docs/ops/ORCHESTRATOR-STATE.md`. Codex is the recoverable
control plane, Fable 5 is the verified judgment co-orchestrator, and the founder remains the final
authority. This does not relax any rule above; in particular, no agent may self-merge, auto-merge,
deploy, spend, or modify `docs/BLUEPRINT.md`.

## Stale-doc warning

Some older docs predate this stack and can mislead: `docs/INDEX.md`, root `TODOS.md`,
`docs/backlog.md`, and `docs/ops/config-and-architecture.md` are dated artifacts
(tombstoned at their headers). The blueprint's ch.3 zoning map is a dated snapshot.
Root `README.md` and `.env.example` were rebuilt against reality on 2026-07-07 and are
current as of that date. When a doc and current code disagree on STATUS (not on LAW),
trust the code + this file's reading order — not the stale snapshot.

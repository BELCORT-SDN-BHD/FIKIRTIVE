# FIKIRTIVE — project law for every harness

> This is the sole physical project-law document. Claude loads it from
> `.claude/CLAUDE.md`; Codex loads the repository-root `AGENTS.md` symlink.
> Nested instruction files may add narrower local rules only. They may not
> relax or duplicate this law.

## Fresh-session trust order

1. Obey current runtime constraints and the Founder's current, explicitly bounded task.
2. Load this project law.
3. Read `docs/BLUEPRINT.md` for the long-term product constitution.
4. Read relevant GitHub Founder Resolutions and their explicit supersedes links.
5. Read the Founder-aligned existing Route-B plan for current-phase scope, sequence, and acceptance.
6. Identify the active GitHub issue or map and verify its native dependencies are unlocked.
7. Query live Git, PR/current-head CI, worktree, claim, deployment, and provider facts. Anything not queried is `Unknown`.
8. Load only the task-linked playbooks, specs, and code needed for the issue.
9. Treat old plans, verdicts, reports, handoffs, memory, and archives as evidence only.

`docs/BLUEPRINT.md` outranks every lower product artifact. If authority layers conflict,
stop and align them through the approved process. A session, process, path, branch name,
handoff, memory entry, claim file, cache, or status snapshot never grants product, merge,
deployment, spend, or project-wide authority.

## Non-negotiable safety

1. **Never push directly to `main`.** Every change lands through a PR.
2. **Never edit `docs/BLUEPRINT.md`** outside the Founder's §7 amendment flow. If code and Blueprint disagree, stop and report.
3. **Ask the Founder before every real development or verification spend.** The ask is the cap; do not create a substitute code cap.
4. **Money paths stay exactly-once and fail-closed.** Any relevant diff must pass `.claude/skills/money-safety-review/SKILL.md`.
5. **Tenant isolation is absolute.** Every owner-scoped query uses the authenticated `ownerId`; client-supplied identity is never trusted.
6. **Production and external effects are Founder-only.** Never deploy, change production, alter credentials or permissions, publish externally, spend, or delete external state without the required explicit authorization.
7. **Product decisions remain Founder decisions.** Direction, identity, scope, user behaviour, and acceptance changes require a durable GitHub Founder Resolution or the applicable Blueprint process.
8. **Verify model identity behind process evidence.** When Founder-set orchestrator/worker rules condition authority on model identity, verify that identity at session start and after every claimed model switch using process-level evidence (e.g., `ps` on launch arguments); never accept an unverified model or harness claim. If the model condition fails verification, the authority it gates is suspended immediately.

## Merge authority

There is no standing controller, reviewer, or session merge authority.

**Founder-only:** governance or merge-policy changes; product identity or brand; Blueprint
or constitutional amendments; irreversible architecture; schema or migration; money or
tenant paths; security credentials or permissions; production or deployment; external
publishing, spend, or deletion; unusually large or disputed PRs; and anything whose tier
is uncertain.

A bounded, reversible ordinary PR may be merged only when the current Founder/task
instruction explicitly authorizes an independent non-author executor and all of these are true:

- the executor did not author or materially edit the diff;
- every current-head CI check is green;
- an independent cross-family review has no unresolved P0/P1;
- the PR contains no Founder-only category; and
- the merge result is verified against live `main`.

No auto-merge or merge watcher. CI unavailability is not green. Reproduce every current
workflow job and gate locally using the current workflow plus `docs/runbooks/local-ci.md`,
publish exact-head evidence in the PR, and obtain the Founder's explicit CI-unavailable
approval before any merge.

Every merge must leave executor evidence on the PR: a Founder-executed merge is confirmed
by a Founder-posted comment stating the Founder personally executed it; a merge executed
by an authorized non-author executor must self-report executor identity, the authorizing
instruction, and the execution time on the PR. A merge without executor evidence is
treated as unverified at audit. This requirement applies to merges executed after this
clause first lands on `main`; earlier merges are assessed under the evidence expectations
of their time. An unverified merge is not thereby reverted, but it may not be cited as
compliant precedent, and the next audit must resolve it — by a Founder confirmation
comment that records the missing executor evidence or by recording it as an open finding.

## Task and worktree lifecycle

- Project continuity belongs to the scoped GitHub issue or map, not a permanently living session.
- On start or resume, re-query issue unlock state, existing branch/worktree/PR, cwd, HEAD, dirty state, remote, and the project task-ownership registry.
- After an explicit Founder product unfreeze, every repository-mutating task must acquire one task-linked `ACTIVE` claim with `scripts/task-ownership-check.mjs` before its first mutation. Resume must re-check that exact claim; missing, expired, overlapping, wrong-base, wrong-worktree, wrong-scope, or malformed state fails closed.
- Release or supersede the claim when the task ends or ownership transfers, then prove the expected `ACTIVE` count. Expiry never transfers authority. Read-only factual work may run without a claim, but may not mutate repository or product state.
- Reuse existing task resources. Never create duplicate branches, worktrees, or PRs for the same task.
- Write decisions, evidence, completion state, and next dependencies back to GitHub. Memory and handoffs may aid recall but never override durable approvals or live facts.
- Session, worker, ticket, or PR completion does not imply project completion.
- Worktree cleanup belongs to a later dedicated maintenance run from a stable checkout. A candidate must be terminal, clean, safely preserved, inactive, and ownership-clear.
- Removing a worktree does not authorize branch deletion. Preserve uncertain, dirty, or unmerged work; never delete a remote branch without explicit Founder authorization.

## Project conventions

- Specs and skill docs use 华语; UI copy uses English sentence case. Generation prompt
  language is decided per engine by its prompt authority module, by measured best practice
  (e.g. Seedance 2.0 performs best with Chinese prompts) — Blueprint v2.13 relocated this
  from the constitution.
- Pricing lives in configuration and respects the Blueprint margin floor; never scatter price literals through business or UI code.
- Every new Otto capability uses `defineOttoSkill` and the shared action layer; never create a bypass or second app.
- Before reviewing a PR, read the task-relevant sections of `docs/review/REVIEWER-PLAYBOOK.md` and verify its dated implementation claims against live `main`.
- Caches, hooks, MCP, CodeGraph, GBrain, and memory are optional capabilities, never authority. Use them only after a task-relevant freshness or health check.
- Present material product options to the Founder one at a time in plain language; do not silently decide them.

## Conditional orchestration

When a task requires multi-agent orchestration, interrupted-task recovery, or product,
architecture, design, or audit judgment, load the runtime-provided global `orchestration`
skill and `.claude/skills/fikirtive-orchestration-overlay/SKILL.md`. Those skills organize
work; they do not broaden this law or create project-wide authority.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

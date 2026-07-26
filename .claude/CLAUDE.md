# FIKIRTIVE — project law for every harness

Authority order: the Founder's current instruction > this law > `docs/BLUEPRINT.md`, the
product constitution > live facts queried from Git, GitHub and CI. Load task-linked
playbooks, specs and code only as the task needs them; current-phase scope, sequence and
acceptance live in the Founder-aligned Route-B master plan under `docs/ops/`. This is the
sole physical project-law document: Claude loads it from `.claude/CLAUDE.md`, Codex through
the repository-root `AGENTS.md` symlink. Nested instruction files may add narrower local
rules; they may not relax or duplicate this law.

1. Never push directly to `main`; every change lands through a PR.
2. Merging is the Founder's. **Founder-only** covers: governance or merge-policy changes;
   product identity or brand; Blueprint or constitutional amendments; irreversible
   architecture; schema or migration; money or tenant paths; security credentials or
   permissions; production or deployment; external publishing, spend or deletion; unusually
   large or disputed PRs; and — the catch-all that settles every unlisted case — anything
   whose tier is uncertain. Sole exception, and only for a bounded, reversible PR in none of
   those categories: the current Founder instruction explicitly authorizes an independent
   non-author executor, that executor neither authored nor materially edited the diff, every
   current-head CI check is green, an independent cross-family review has no unresolved
   P0/P1, and the merge result is verified against live `main`. No auto-merge, no merge
   watcher. CI unavailability is not green: reproduce every current workflow job locally per
   `docs/runbooks/local-ci.md`, publish exact-head evidence on the PR, and obtain the
   Founder's explicit CI-unavailable approval before merging. Every merge leaves executor
   evidence on the PR — a Founder merge is confirmed by a Founder-posted comment stating the
   Founder executed it personally; an authorized non-author executor self-reports executor
   identity, the authorizing instruction and the execution time. That requirement binds
   merges executed after this clause first landed on `main`; earlier merges are judged by the
   evidence expectations of their time. A merge without that evidence is unverified at audit:
   never citable as precedent, and the next audit must resolve it.
3. Money paths stay exactly-once and fail-closed. Any diff that can reach a paid call site, a
   credit or money ledger writer, spend pricing, or exactly-once dedup must pass the
   `money-safety-review` skill; money-in (grants, Stripe) additionally follows the money and
   admin-auth sections of `docs/review/REVIEWER-PLAYBOOK.md`. CI independently enforces a
   review token on the file list it mirrors — that list is the machine floor, never the
   definition of the spend path.
4. Tenant isolation is absolute: every owner-scoped query uses the authenticated `ownerId`;
   client-supplied identity is never trusted.
5. Ask the Founder before every real development or verification spend; the ask is the cap.
6. Production and external effects — deploys, credentials, permissions, external publishing,
   spend, deletion of external state — are Founder-only.
7. Product decisions are Founder decisions: present material options one at a time, in plain
   language, each with a concrete merchant example; never decide them silently. Direction,
   identity, scope, user behaviour and acceptance changes carry only through a durable GitHub
   Founder Resolution or the applicable Blueprint process.
8. The Blueprint outranks every lower artifact and changes only through its amendment flow;
   if code and Blueprint disagree, stop and report. (A harness deny rule and the CI hash gate
   hold the file itself.)
9. Live queries outrank every document: anything not queried is `Unknown`; old plans,
   verdicts, handoffs, memory and archives are evidence only, never authority. Caches, hooks,
   MCP, CodeGraph, GBrain and memory are optional capabilities, never authority — use them
   only after a task-relevant freshness or health check.
10. Continuity belongs to the GitHub issue, not the session: write decisions, evidence,
    completion state and next dependencies back to the issue. Session, worker, ticket or PR
    completion never implies project completion.
11. Reuse existing branches, worktrees and PRs; never create duplicates; never delete
    uncertain, dirty or unmerged work; never delete a remote branch without explicit Founder
    authorization. Worktree cleanup belongs to a later dedicated maintenance run from a stable
    checkout outside the targets, and a candidate must be terminal, clean, safely preserved,
    inactive and ownership-clear; removing a worktree never authorizes deleting its branch.
    Every changed line traces to the current task.
12. Before the first mutation, every repository-mutating task must acquire one task-linked `ACTIVE` claim
    through `scripts/task-ownership-check.mjs`, operated per `docs/runbooks/task-ownership.md`. On
    resume it re-checks that same claim; when the task ends or ownership transfers it releases or
    supersedes it and then proves the expected `ACTIVE` count. Missing, malformed, expired,
    overlapping, wrong-base, wrong-worktree or out-of-scope claim state fails closed, and expiry
    never transfers ownership. Read-only factual work needs no claim and may not mutate
    repository or product state.
13. Judgment stays with the orchestrator; writing code, editing files and gathering bulk
    evidence go to a worker. The orchestrator's own live verification and merge-result check
    (clauses 2 and 9) and its own claim operations (clause 12) are its work, not a delegation
    failure — this clause never forbids what another clause requires of it. Workers are
    hermetic, receive self-contained work orders, and never spawn workers. (A write-guard hook
    holds the orchestrator side for the edit tools, and the bash guard for the named shell
    write forms; both are tripwires, not proofs.)
14. Route by shape: discovery goes to the strongest worker tier; enumerable coverage goes one
    tier down in parallel with stronger verification; critical review crosses model families;
    judges run sealed and read-only.
15. Orchestrator identity is verified from the session transcript's model field — at session
    start, periodically thereafter, and again after every claimed model switch, because a
    session can be downgraded silently. The allowed model set is whatever the Founder's
    current instruction says; on mismatch, stop new decisions and report honestly.

Specs and skill docs use 华语; UI copy uses English sentence case.
Pricing lives in configuration (CI holds the margin floor); every Otto capability goes
through `defineOttoSkill` and the shared action layer (CI holds the fence).
Before reviewing a PR, read the task-relevant sections of `docs/review/REVIEWER-PLAYBOOK.md`
and verify its dated implementation claims against live `main`.

When a task requires multi-agent orchestration, interrupted-task recovery, or product,
architecture, design or audit judgment, load the runtime-provided global `orchestration`
skill and `.claude/skills/fikirtive-orchestration-overlay/SKILL.md`. They organize work;
they never broaden this law.

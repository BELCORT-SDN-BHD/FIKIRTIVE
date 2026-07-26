# FIKIRTIVE — project law for every harness

Authority order: the Founder's current instruction > this law > `docs/BLUEPRINT.md`, the
product constitution > live facts queried from Git, GitHub and CI. Load task-linked
playbooks, specs and code only as the task needs them. This is the sole physical
project-law document: Claude loads it from `.claude/CLAUDE.md`, Codex through the
repository-root `AGENTS.md` symlink. Nested instruction files may add narrower local
rules; they may not relax or duplicate this law.

1. Never push directly to `main`; every change lands through a PR.
2. Merging is the Founder's. Sole exception: the current Founder instruction explicitly
   authorizes an independent non-author executor, every current-head CI check is green, an
   independent cross-family review has no unresolved P0/P1, and the PR contains no
   Founder-only category. Every merge leaves executor evidence on the PR.
3. Money paths stay exactly-once and fail-closed. Any diff touching a money-path file must
   pass the `money-safety-review` skill; CI independently enforces the review token on such
   a PR.
4. Tenant isolation is absolute: every owner-scoped query uses the authenticated `ownerId`;
   client-supplied identity is never trusted.
5. Ask the Founder before every real development or verification spend; the ask is the cap.
6. Production and external effects — deploys, credentials, permissions, external publishing,
   spend, deletion of external state — are Founder-only.
7. Product decisions are Founder decisions: present material options one at a time, in plain
   language, each with a concrete merchant example; never decide them silently.
8. The Blueprint outranks every lower artifact and changes only through its amendment flow;
   if code and Blueprint disagree, stop and report. (A harness deny rule and the CI hash gate
   hold the file itself.)
9. Live queries outrank every document: anything not queried is `Unknown`; old plans,
   verdicts, handoffs, memory and archives are evidence only, never authority.
10. Continuity belongs to the GitHub issue, not the session: write decisions, evidence,
    completion state and next dependencies back to the issue.
11. Reuse existing branches, worktrees and PRs; never create duplicates; never delete
    uncertain, dirty or unmerged work; never delete a remote branch without explicit Founder
    authorization. Every changed line traces to the current task.
12. Before the first mutation, every repository-mutating task must acquire one task-linked `ACTIVE` claim
    through `scripts/task-ownership-check.mjs`, and release it when the task ends; missing,
    expired or conflicting claim state fails closed.
13. Judgment stays with the orchestrator; anything that touches files, commands, queries or
    research goes to a worker. Workers are hermetic, receive self-contained work orders, and
    never spawn workers. (A write-guard hook holds the orchestrator side.)
14. Route by shape: discovery goes to the strongest worker tier; enumerable coverage goes one
    tier down in parallel with stronger verification; critical review crosses model families;
    judges run sealed and read-only.
15. Orchestrator identity is verified periodically from the session transcript's model field;
    the allowed model set is whatever the Founder's current instruction says; on mismatch,
    stop new decisions and report honestly.

Specs and skill docs use 华语; UI copy uses English sentence case.
Pricing lives in configuration (CI holds the margin floor); every Otto capability goes
through `defineOttoSkill` and the shared action layer (CI holds the fence).

When a task requires multi-agent orchestration, interrupted-task recovery, or product,
architecture, design or audit judgment, load the runtime-provided global `orchestration`
skill and `.claude/skills/fikirtive-orchestration-overlay/SKILL.md`. They organize work;
they never broaden this law.

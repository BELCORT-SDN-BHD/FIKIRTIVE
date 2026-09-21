# 产品名字 — agent entry point

**一两句产品的HIGHEST VISION SENTENCES**

## The Harness menu — what you need, where the truth lives

| Source | Responsibility | Read when |
|---|---|---|
| [PRD](docs/PRD.md) | Highest-level product blueprint: context, vision, users, problems, product behaviour, core journeys, scope, non-goals and success criteria | Understanding or changing what Agents should do and why |
| [Architecture](docs/ARCHITECTURE.md) | Highest-level technical blueprint: stack and rationale, system boundaries, module responsibilities, dependencies, data flows and tradeoffs; distinguish implemented state from accepted target | Understanding or changing how the product works |
| [Frontend integration handoff](apps/web/design-system/governance/frontend-integration-handoff.md) | Existing design authority, frontend integration rules and handoff references | Connecting backend behaviour to frontend surfaces or changing shared components |
| graphify | maps your entire project (code, docs, PDFs, images, videos) into a knowledge graph you can query instead of grepping through files. |
| [Context](CONTEXT.md) | Shared accounting and product vocabulary | Naming concepts or resolving domain ambiguity |
| [PROGRESS](docs/PROGRESS.md) | Minimal session state: current commit, verification, active work, known blockers and next steps | Starting, resuming or handing off a session |

PRD and Architecture are the enduring human-readable sources of truth. GitHub specs describe a
particular delivery scope; tickets own its work, dependencies and completion evidence. Later accepted
decisions may supersede older specs: update the relevant blueprint instead of accumulating conflicting
instructions. Source code and deployment evidence establish what is actually implemented.

## Working protocol

1. Ground to the codebase with `graphify`. Use it to query anything for implementation or clarify.
2. Use `grilling` to settle ambiguity.
3. Check current official documentation, through Context7 or the official docs, before going into coding or any      
   exploration/planning.
4. PRD and Architecture are blueprints, best to refreshs / update /adjust the possible stale sections only after 
   Wayfinder or to-spec session when settles a product or technical decision and before to-tickets: overwrite the affected section (never append ticket history), keep each file's maintenance frame in its header, and mark accepted technical targets separately from current implementation. Resolve contradictions explicitly; keep detailed acceptance in the delivery spec.
5. Push back with real examples: When you push back or recommend, include one real practice close to the case — a 
   company, product, or method you actually know (Linear, Shape Up, Figma), or better, one you can point to (a Mobbin 
   screenshot, a documentation link). Never invent or embellish one: if you know no close example, say so and argue 
   from the Founder's own product instead. An example you cannot point to is labeled as recalled, not presented as 
   fact. 
6. Claims need evidence: Any statement about the state of the world ("the design system covers this", "this rule is 
   already enforced", "that was fixed") 
   must be backed by a checkable source: a file path, a commit, a test or command run, or a link. A real-world 
   anecdote is an argument (7.2), not evidence. 
   If you cannot point to a source, say "unverified" instead of asserting. No evidence, no claim.
7. Wayfinder or grillwithdocs session 的 map / specs 可以add "Milestone" in Github as a 版本控制, 版本控制型号可以在
   wayfinder和agent 一起讨论.
8. 当用户主动说" Idea session " , 这个时期讨论出来的东西可以 as "idea" and "need-triages" lable publish in GitHub 
   Issues.

## CI/CD

## At session start (clock in)
1. Read PROGRESS.md for current state
2. Check to confirm repo is in consistent state
3. Grill user to whether to continue from PROGRESS.md "Next Steps" section.

## Before session end (clock out)
1. Update PROGRESS.md
2. Check to confirm consistent state
3. Commit all completed work
4. IF FOUND OUT edit that didint done by you , grill user to comfirm it as commit and merge to main.
5. Refresh graphify of this project, ensure all local and github main is sync also.

## Agent skills

### Installation and synchronization

Project skills live in `.agents/skills/` (Codex) and `.claude/skills/` (Claude).
Edit shared skills in `.agents/skills/`, then run `node scripts/sync-agent-skills.mjs`;
CI verifies the copies with `--check`. Graphify uses upstream agent-specific variants.
Run `orchestrator-fable` for substantive work in either environment.
See `docs/agents/tooling.md` for installation, versions, Graphify commands and refresh.

Graphify is the current graph tool. Older plans/audit receipts mentioning CodeGraph or
gbrain are historical evidence, not installation or execution instructions; use Graphify
for current work. If its graph is missing or insufficient, say so and read source files.

### Issue tracker

GitHub Issues via the `gh` CLI (repo inferred from `git remote -v`). See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: a root `CONTEXT.md` plus `docs/adr/`, created lazily by the domain-modeling skill. See `docs/agents/domain.md`.

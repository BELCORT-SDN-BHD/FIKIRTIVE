<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tools** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them. `codegraph_node` returns one symbol's source + callers, or reads a whole file with line numbers. If the tools are listed but deferred, load them by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` and `codegraph node <symbol-or-file>` print the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

## GBrain Configuration (configured by /setup-gbrain)
- Mode: local-stdio
- Engine: pglite (`~/.gbrain/brain.pglite`)
- Embedding: openai:text-embedding-3-large (1536d) — key in `~/.zshenv`
- Config file: `~/.gbrain/config.json` (mode 0600)
- Setup date: 2026-06-20
- MCP registered: yes (user scope; restart Claude Code to load `mcp__gbrain__*`)
- Artifacts sync: off (defer; `/setup-gbrain` to enable later)
- Current repo policy: read-write

## GBrain Search Guidance (configured by /sync-gbrain)
<!-- gstack-gbrain-search-guidance:start -->

GBrain is set up and synced on this machine (local PGLite, OpenAI embeddings).
Prefer gbrain over Grep when the question is semantic or you don't yet know the
exact identifier.

**This worktree is pinned to a worktree-scoped code source** via the
`.gbrain-source` file in the repo root (`gstack-code-artlio-4a8eba04`, gitignored).
`gbrain code-def`, `code-refs`, `search`, and `query` from anywhere under this
worktree route to that source by default — no `--source` flag needed.

Indexed corpora (via the `gbrain` CLI):
- This worktree's code (283 pages, auto-pinned via `.gbrain-source`).
- `default` source: this repo's docs/plans/PRDs + `~/.gstack/` memory (local-only).

Prefer gbrain when:
- Semantic intent, no exact string yet:
    `gbrain query "<question>"`  ·  `gbrain search "<terms>"`
- Symbol definition / references:
    `gbrain code-def <symbol>` · `gbrain code-refs <symbol>`
- Past plans / decisions / research:
    `gbrain query "<question>"`

Caveat — call graph not built yet: `gbrain code-callers`/`code-callees` return
`count: 0` until `/sync-gbrain --dream` runs, and dream needs `ANTHROPIC_API_KEY`
(not set). `code-def`/`code-refs` and semantic search work now without it.

Grep stays right for known exact strings, regex, and file globs. Run
`/sync-gbrain` after meaningful code changes; `/sync-gbrain --full` for a full
reindex.

<!-- gstack-gbrain-search-guidance:end -->

## Code intelligence routing: CodeGraph vs GBrain
Both are active and do NOT conflict (separate storage, separate tools):
- **CodeGraph** (`.codegraph/`) — precise *structural* code: exact defs, call
  paths, "who calls X". Reach for it first for structural/symbol questions.
- **GBrain** (`~/.gbrain`) — *semantic* search ("find code about this concept")
  plus non-code knowledge (this repo's plans/PRDs/research). Reach for it for
  fuzzy/conceptual questions and for searching docs/decisions.

## Merge discipline (branch protection substitute)
This is a PRIVATE repo on a free GitHub plan — real branch protection is unavailable
(and the founder chose not to upgrade). These rules ARE the protection; every agent
session must follow them:
- **Never push directly to `main`.** All changes land via a PR.
- **Never merge a PR whose two CI checks ("typecheck + fences + frozen lockfile",
  "unit + integration tests") are not both green** on the current head commit.
- Pushing `main` auto-deploys web + worker to Railway and auto-runs prisma migrations
  on prod — a bad merge ships instantly. When in doubt, don't merge; ask the founder.
- Spend-path diffs (see `.claude/skills/money-safety-review`) additionally require that
  skill's checks to pass before merge.

## The Blueprint (constitution)
`docs/BLUEPRINT.md` is the founder-finalized master plan: what this product IS, its
non-negotiable principles, and the 8 expansion seams every new feature must use.
**Read it before building anything new. NEVER edit it** — if code and blueprint
disagree, stop and report; only the founder changes the blueprint.

## Working with the founder (portable rules — survive any machine/account/session)
These were previously only in one machine's agent memory; they are now repo law:
- **Ask before spending real money.** Every real paid call (BytePlus/fal/Anthropic verification
  runs, Stripe live actions) needs the founder's explicit per-spend confirmation. The ask IS the
  cap — there is deliberately NO code cap. Delegated phrases like "you decide" do NOT cover a
  specific spend.
- **Present options, don't decide.** Product calls belong to the founder: lay out options with
  tradeoffs, neutrally. Recommend only when asked (he often asks — then commit to a clear one).
- **Specs/skill docs in 华语** (founder reviews in Chinese); generation prompts stay English;
  UI copy sentence case.
- **Founder can't see inline chat widgets** — render design mockups to PNG on ~/Desktop.
- **Founder priorities, in order: 安全 > 效率 > 易管理**(file-system style: readable files +
  simple toggles, nothing buried).

## Fresh agent bootstrap (new machine / new session — read in this order)
1. `docs/BLUEPRINT.md` — the constitution (NEVER edit; conflicts → stop and report)
2. `docs/review/REVIEWER-PLAYBOOK.md` — review checklists before touching any PR
3. `docs/research/GRILL-VERDICTS-2026-07-03.md` — every product decision the founder has made
4. `docs/design/2026-07-03-harmony-0*.md` — data model, seams, factory roadmap, costing, ledger
5. `docs/review/EXPANSION-SEAMS.md` — the recipe for whatever you're about to build
Everything an agent needs to build correctly is in the repo; no chat history required.

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

# Agent tooling

## Skills in both coding harnesses

Codex discovers `.agents/skills/`; Claude Code discovers `.claude/skills/`.
The 25 published engineering/productivity skills from
[mattpocock/skills](https://github.com/mattpocock/skills) are installed as editable
project files. Deprecated, in-progress and miscellaneous skills are not enabled.
The existing `apple-design` and `orchestrator-fable` skills are preserved in both.
Versions and provenance live in `.agents/skill-sources.json`; upstream licenses
are stored beside the skills.

No project-specific synchronization script, sync hook or CI mirror gate is required
to use the installed skills. Each harness loads its own installed directory.
Codex automatically detects changes to its skills and offers native import of
Claude skills/configuration/hooks. The desktop app also offers automatic updates
under Settings > Import to keep imported work in sync with the original agent.
Use that native feature when enabled; it is not a repository-managed bidirectional
mirror. Use the clients' supported install/import workflow when updating skills.
See [skill discovery](https://learn.chatgpt.com/docs/build-skills) and
[native import and automatic updates](https://learn.chatgpt.com/docs/import).

Graphify's official Codex and Windows Claude
variants call different agent tools and shells. Upgrade both from the same package
release rather than copying one variant over the other. On macOS/Linux Claude,
install the upstream `claude` variant locally instead of `windows`.

`CLAUDE.md` imports root `AGENTS.md`; the latter is the shared working protocol.
Matt's setup already uses GitHub Issues, the five labels in `triage-labels.md`, and
a single root `CONTEXT.md` plus `docs/adr/`. Preserve the existing repo-specific
spec publishing convention in `issue-tracker.md`. There is no need to rerun its
setup interview unless these choices change.

## Graphify

[Graphify](https://github.com/Graphify-Labs/graphify) replaces CodeGraph/gbrain for
current work. Their MCP registration and permissions have been removed. Old audit
receipts remain historical evidence; their tool instructions are superseded.

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and run commands
from the repository root. The project MCP configurations pin the runtime, so they
do not depend on whichever global `graphify` happens to precede it on PATH:

```sh
uvx --from 'graphifyy[mcp,watch,sql]==0.9.65' graphify --help
uvx --from 'graphifyy[mcp,watch,sql]==0.9.65' graphify extract . --code-only --max-workers 4
uvx --from 'graphifyy[mcp,watch,sql]==0.9.65' graphify query "authentication"
```

The deterministic extraction indexes code without calling an LLM. Documentation,
PDF/image/video semantic extraction is a separate `/graphify` skill workflow;
do not describe a code-only graph as complete multimodal coverage. Refresh the
code graph after code changes. Use direct source reads when the graph is missing
or cannot answer a question.

Claude reads `.mcp.json`; Codex reads `.codex/config.toml` in a trusted project.
Both launch `graphify-mcp` against `graphify-out/graph.json`. Restart the client
after changing MCP configuration. Skills become available in the next refreshed
project session. Open this Desktop checkout as the project; this configuration
does not attach it to an unrelated projectless task.

`.graphifyignore` excludes tool bundles, generated files and credential-shaped
files from extraction. Generated graph data and caches are local and excluded from Git, Docker and
Railway uploads. No hosted graph service or API key is required for the code index.

## Hooks and user-level skills

Keep hooks in the owning harness's native configuration. The existing Claude
`SessionStart` hook in `.claude/settings.json` reports spec status; it is unrelated
to skill installation and is preserved. This project adds no skill-copy hook.
Codex's native importer supports hooks, but importing a hook and trusting it are
client operations, not automatic consequences of a Git pull.

User-level skills retain their platform-specific adaptations. Personal skills are
not copied into this repository, and no project script maintains their copies.

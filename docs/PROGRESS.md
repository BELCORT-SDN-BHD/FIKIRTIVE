PROGRESS.md: The most basic state persistence file

# Project Progress 

## Current State
- 2026-09-21: Graphify always-use integration based on `main@201cfcc3` (merged PR #1500). Root `AGENTS.md` is shared by Codex and Claude through `CLAUDE.md`.

## Completed
- Installed 25 published Matt Pocock skills in both agent environments; preserved apple-design and the user's orchestrator-fable skill.
- Removed the custom skill synchronization script and CI drift gate at the user's request. Both harnesses retain their installed skills; Graphify keeps official agent-specific variants at 0.9.65.
- Replaced the legacy graph MCP configuration with pinned Graphify configuration for both agents.
- Preserved the user's root instructions and PRD/Architecture drafts, including removal of `.claude/CLAUDE.md`.
- Verified shared-skill parity (27 skills), JSON/TOML configuration, and Graphify MCP initialize/list-tools/stats. Initial AST index: 17,771 nodes, 41,331 edges, 719 communities; no LLM calls.
- PR #1499 merged after all required CI checks passed, including the restored frontend integration handoff link.
- Preserved the user's follow-up AGENTS.md edits: removal of synchronization instructions and addition of the Graphify query/update protocol.
- Actually ran `graphify codex install` and `graphify claude install` (0.9.65). Preserved existing instructions, MCP permissions and the spec-status SessionStart hook; committed hooks use portable PATH commands.
- Verified Claude search/read hooks return graph-first reminders. The official Codex hook is intentionally a no-op; AGENTS.md supplies its graph-first instructions. Clock-out now explicitly requires `graphify update .` and reporting failures.

## In Progress
- Publish this follow-up through protected-main checks; use its PR for live CI/merge status.

## Known Issues
- PRD and Architecture are user-authored draft outlines; this tooling task does not establish product implementation status.
- The initial Graphify index is code-only; full semantic document/media extraction is a separate run.
- Graphify emitted parser warnings for `OttoAvatar.tsx` and `canvas-card-status.ts`; those files need direct reads. These warnings do not establish an application syntax error.
- Native MCP activation is not complete: `claude mcp get graphify` reports pending approval; `codex mcp get graphify` reports no server in the current client context. Open/trust the Desktop checkout and approve MCP using each client. CLI/skill availability does not imply MCP approval.

## Next Steps
1. Open `C:\Users\zhant\Desktop\FIKIRTIVE` as the project in Codex/Claude and refresh the session to load skills and MCP.
2. Use each harness's native skill discovery and install/import features; no custom sync command is required.

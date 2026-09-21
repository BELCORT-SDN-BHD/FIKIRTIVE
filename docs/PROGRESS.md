PROGRESS.md: The most basic state persistence file

# Project Progress 

## Current State
- 2026-09-21: agent-tooling setup based on `main@18a36c49`. Root `AGENTS.md` is shared by Codex and Claude through `CLAUDE.md`.

## Completed
- Installed 25 published Matt Pocock skills in both agent environments; preserved apple-design and the user's orchestrator-fable skill.
- Added explicit `.agents/skills` → `.claude/skills` synchronization and a CI drift check; Graphify keeps official agent-specific variants at 0.9.65.
- Replaced the legacy graph MCP configuration with pinned Graphify configuration for both agents.
- Preserved the user's root instructions and PRD/Architecture drafts, including removal of `.claude/CLAUDE.md`.
- Verified shared-skill parity (27 skills), JSON/TOML configuration, and Graphify MCP initialize/list-tools/stats. Initial AST index: 17,771 nodes, 41,331 edges, 719 communities; no LLM calls.
- PR #1499 validation found the rewritten AGENTS menu omitted the existing frontend integration handoff; restored its link while preserving the user's new structure. Initial build/typecheck/lint/checks/E2E passed; full tests are rerun on the corrected revision.

## In Progress
- Merge the setup plus existing user changes through protected-main checks; use the associated PR for live CI/merge status.

## Known Issues
- PRD and Architecture are user-authored draft outlines; this tooling task does not establish product implementation status.
- The initial Graphify index is code-only; full semantic document/media extraction is a separate run.
- Graphify emitted parser warnings for `OttoAvatar.tsx` and `canvas-card-status.ts`; those files need direct reads. These warnings do not establish an application syntax error.

## Next Steps
1. Open `C:\Users\zhant\Desktop\FIKIRTIVE` as the project in Codex/Claude and refresh the session to load skills and MCP.
2. After editing shared skills, run `node scripts/sync-agent-skills.mjs` and commit both copies.

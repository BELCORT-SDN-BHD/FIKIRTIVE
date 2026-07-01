<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Input conventions

Multi-line message / prompt composers (any textarea or rich editor you talk to Otto through) submit on **Shift+Enter**; plain **Enter inserts a newline** (never sends), so users can't fat-finger a send. When a `@`-mention or autocomplete dropdown is open, plain Enter picks the highlighted item. The `MentionInput` canvas editor also accepts Cmd/Ctrl+Enter for back-compat.

Single-line fields (rename, search, inline edits) keep the normal **Enter = submit** — this convention is only for message composers.

# FIKIRTIVE Credential/Secret Inventory (read-only, D5 pre-rotation) — 2026-07-11

Produced by a read-only Sonnet worker (19 tool calls). No values printed, no network calls, no files modified.
Scope: main checkout (orchestration-skill-setup-1312a5 worktree), local Claude/gbrain configs, live ps aux,
prior findings in ORCHESTRATOR-STATE.md §三/3.

| Credential (name/type) | Owner service | Storage location(s) | Exposure status | Rotation blast radius |
|---|---|---|---|---|
| DATABASE_URL / DATABASE_URL_POOLED / PROD_DATABASE_URL | Postgres (app DB) | .env.example; consumed by apps/web, apps/worker, packages/db | file-only | Web + worker lose DB; migrations blocked |
| ANTHROPIC_API_KEY | Anthropic API | .env.example only (no code consumer found) | file-only | Unclear consumer — see gaps |
| FAL_KEY | fal.ai | apps/web, packages/generation | file-only | Generation jobs fail |
| BYTEPLUS_API_KEY (+ budget vars) | BytePlus | packages/generation | file-only | Generation jobs fail; budget-guard vars reset |
| STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET | Stripe | apps/web | file-only | Checkout + webhook verification breaks until resynced |
| META_APP_ID / META_APP_SECRET | Meta/Instagram Graph | apps/web | file-only | IG OAuth + publish flows break (L1 not live anyway) |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | Google OAuth | apps/web | file-only | Google login breaks until resynced |
| BETTER_AUTH_SECRET | Better Auth session signing | apps/web | file-only | Rotation force-logs-out all users |
| TOKEN_ENCRYPTION_KEY | Internal token encryption | apps/web, packages/token-crypto | file-only | Old-key data unreadable without dual-key migration |
| R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT | Cloudflare R2 | packages/storage | file-only in repo; account-level CF cred separately exposed in transcripts | Media/storage breaks; much larger if account-level |
| RESEND_API_KEY | Resend email | apps/web | file-only | Auth/notification emails stop |
| SENTRY_DSN | Sentry | apps/web, apps/worker | file-only | Error reporting pauses (low risk) |
| BRAVE_SEARCH_API_KEY / TAVILY_API_KEY | Search tooling | .env.example (consumer untraced) | file-only | Search features degrade |
| MODAL_LLM_KEY / MODAL_LLM_ENDPOINT | Modal LLM | apps/web | file-only | Modal-backed LLM feature fails |
| MEDIA_PROXY_SECRET | Internal media proxy | .env.example (consumer untraced) | file-only | Media proxy auth fails |
| VERCEL_TOKEN | Vercel | ~/.claude/settings.json env block (name only) | file-only, local machine | Local deploy tooling breaks; privilege scope unverified |
| OPENAI_API_KEY | OpenAI | ~/.zshenv (exported shell-wide) | file-only but inherited by every child process | Ambient local tooling breaks |
| Magic MCP API key (API_KEY) | 21st.dev magic MCP | Inline in --mcp-config JSON on claude CLI argv (LIVE, multiple PIDs, re-confirmed today) | in-argv + in-transcript (ledger §三/3) | Magic MCP tools stop authenticating until config updated |
| Cloudflare high-privilege credential — **located**: Global API Key at `~/.cloudflare/token` (0600), used with X-Auth-Email tools@belcort.com (per SESSION-HANDOFF-2026-07-11; file existence re-verified) | Cloudflare account | `~/.cloudflare/token` + persistent transcripts per ledger §三/3 | in-transcript + on-disk; "exposed, rotation pending founder approval". Global Key = account-root privilege — CONFIRMS worst-case scope | DNS (app.fikirtive.com CNAME/TXT), R2, everything account-level; rotation must re-provision deploy/DNS tooling |
| .env / .env.local (repo) | n/a | None on disk; only .env.example tracked | tracked-in-git: NO (clean) | n/a |

## Highest-risk items
- Cloudflare high-privilege credential exposed in persistent transcripts — treat as account-level until proven otherwise.
- Magic MCP API key live in ps argv right now, multiple running claude processes — current, not historical.
- TOKEN_ENCRYPTION_KEY rotation needs a dual-key migration plan; naive rotation breaks existing encrypted data.
- BETTER_AUTH_SECRET rotation force-logs-out all users; needs a maintenance window.
- ANTHROPIC_API_KEY has no confirmed code consumer — verify before rotating or deprioritizing.

## Evidence gaps
- Consumers of ANTHROPIC_API_KEY / BRAVE_SEARCH_API_KEY / TAVILY_API_KEY / MEDIA_PROXY_SECRET not isolated within budget.
- No RAILWAY/CLOUDFLARE/IG token variable names in repo — those creds are infra-level, outside repo; not verifiable read-only.
- Cloudflare credential privilege scope needs provider-side check (out of scope read-only).
- Other MCP processes (od-mcp, codegraph) showed no embedded credential values in observed argv.

Filing plan: goes into docs/ops as part of the D5 follow-up ordinary PR AFTER #228 lands (not added to the
surgical #228 correction commit). Rotation itself remains gated on founder per-provider approval.

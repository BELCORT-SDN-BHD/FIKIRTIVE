# Session Handoff — 2026-06-28 — G6 Meta connector SHIPPED + G7 Ad-Write (designing)

## TL;DR
- **G6 read-only Meta Ads connector is SHIPPED** (PRs #61, #62 merged → prod). Proven live end-to-end with the founder's real Meta account (4 ad accounts read).
- New **Meta App `999242359480685`** ("fikirtive marketing API app", Marketing API) created. Prod env vars set via Railway CLI.
- **3 founder steps remain to fully light up prod** (§3).
- **G7 "Otto sets up / schedules ads" (WRITE)** is mid-design: scope + safety model LOCKED; one open question (v1 slice). **Resume the brainstorming at §4's open question.**
- **0 open PRs.** main tip `1dbec9f`.

---

## 1. What shipped this session (merged to main)
- **#61 (g6a)** — Connect Meta: OAuth (Facebook Login for Business) + AES-256-GCM encrypted tokens, `requireOwner` + owner-scoped, multi-tenant, **read-only**.
- **#62 (g6b)** — Meta analytics: `getMetaInsights` + `metaInsights` Otto skill (free/read/external) + per-account last-30d summary on the Connections view.
- **#63** — studio video-picker lock: constrains the 3 studio video pickers to `activeVideoModel()` (money-safe display fix, removes a no-spend dead-end). Follow-up to #60.
- Merged via squash; #62 needed a `git rebase --onto origin/main` to clear a stacked-squash conflict.

## 2. Meta App (active)
- **App ID `999242359480685`** — "fikirtive marketing API app", use case **"Create & manage ads with Marketing API"** + auto **Facebook Login for Business**, business portfolio **Belcort SDN BHD**, scope **`ads_read`**, contact xxnicksxx123@gmail.com. App is in **Development** mode, **Unpublished**.
- **DEAD App `1359820566248770`** ("FIKIRTIVE") — wrong type (app-install-ads, "Does not include access to Marketing API"); abandoned.
- App Secret lives in Railway + local `.env.local` (not reproduced here).

## 3. PROD activation — founder's remaining steps (BLOCKING)
1. **⬜ SAVE the redirect URI.** I entered `https://fikirtive.com/api/meta/callback` as a chip in the app's **Facebook Login for Business → Settings → Valid OAuth Redirect URIs** (`/apps/999242359480685/business-login/settings/`), but Meta gates the Save to a real human click — **founder must click "Save changes".** Without it, prod OAuth callback fails.
2. **⬜ APPROVE the Railway prod deploy.** `web` + `worker` services showed **"Awaiting approval"** (deploy from the merge). Approve in the Railway dashboard so the new code + env vars go live.
3. **⬜ For PUBLIC users:** business verification (Belcort is **Unverified**) + `ads_read` **App Review** + flip app **Dev → Live**. The founder/team (app admins) can use it on prod **now** without this; only non-team users need it.
- **Prod env vars ALREADY set via Railway CLI** (FIKIRTIVE project, `web` service, `production` env): `META_APP_ID=999242359480685`, `META_APP_SECRET`, `TOKEN_ENCRYPTION_KEY` (permanent prod key — **never rotate**). `BETTER_AUTH_SECRET` was already there. `BETTER_AUTH_URL=https://fikirtive.com`.

## 4. G7 — Otto Ad-Write (the "B" work) — design state
**Scope: (c) both — CREATE new ads AND MANAGE existing.**

**Safety model (LOCKED): user-configurable autonomy mode, à la Claude Code, default strictest.**
| Mode | Otto may | maps to |
|---|---|---|
| ① **Ask** (default) | every write needs confirm; new ads built **PAUSED** | Ask permissions |
| ② **Draft** | only paused drafts + proposals; **never executes spend** | Plan mode |
| ③ **Auto** | money-safe ops (pause, lower budget, draft, read) auto; spend ops (launch, raise budget, expand) still ask | Auto / Accept edits |
| ④ **Autopilot** (opt-in) | spend ops too, but with **HARD caps** (daily max, per-change max); over cap still asks | Bypass permissions |

- Default is always ① . User raises autonomy in settings with clear risk warnings. **Even ④ has a hard spend cap** — Otto can never burn unlimited budget. The autonomy mode is a **per-user/org setting**.
- **Needs:** `ads_management` scope (current app only has `ads_read`) + its own App Review for write. A new Graph **write** client. 
- **Synergy:** "create" can bind FIKIRTIVE-generated images/videos as the ad creative — the full super-employee loop.

**▶ OPEN QUESTION — resume the brainstorming here:** v1 slice —
- **(a) manage-existing-first** *(RECOMMENDED — fastest, lowest risk; exercises the mode system on real money-ops without campaign-creation complexity)* — pause/resume, budget up/down, schedule; modes ①+③. Create deferred to v2.
- **(b) create-first** — Otto builds a full campaign (using generated assets) as a PAUSED draft; modes ①+②. Manage deferred.
- **(c) both in v1** — bigger/slower.

After v1 slice is picked → finish brainstorming → write spec to `docs/superpowers/specs/` → `writing-plans` → `subagent-driven-development`.

## 5. Local test rig (g6b code)
- Tested via the **`otto-g2-editor` worktree** (`/Users/winnin/Desktop/artlio/.claude/worktrees/otto-g2-editor`, branch `claude/otto-g6b-meta-insights`) at **localhost:3100**. Synced main's `apps/web/.env.local` + `packages/db/.env` in, ran `prisma migrate deploy`, `pnpm --filter @fikirtive/web exec next dev -p 3100`. **Dev server is stopped.**
- Local `.env.local` (main checkout + that worktree) now points to the **new app 999242359480685** (local dev `TOKEN_ENCRYPTION_KEY` is a *separate* key from prod).
- **Local login = magic link** → written to `<worktree>/.data/last-magic-link.txt` AND console-logged `[better-auth] Sign in to Fikirtive for ...: <url>`.
- **Local Otto chat needs `ANTHROPIC_API_KEY`** (NOT in local env → that's why local chat errored with `AI_LoadAPIKeyError`; prod has it). Add it locally to test the chat skill.

## 6. Gotchas / learnings
- **Meta:** `ads_read` requires the **Marketing API** use case; in the create-app flow pick **"Create & manage ads with Marketing API"** (NOT "Meta Ads Manager" app-install-ads). localhost redirect auto-allowed in Dev mode; prod **https must be registered**. Security-gated Saves (redirect URI, app secret reveal, app creation) need a **real human click** — browser automation can't trigger them; hand those to the founder.
- **Browser-drive:** founder's Chrome has named profiles (no Default); the Claude extension reconnects via `switch_browser` broadcast → founder clicks **Connect** in the Meta-logged-in window ("Nicks's mac chrome").
- **Merge:** stacked-squash → `CONFLICTING`; fix via `git rebase --onto origin/main <old-base-sha> <branch>`. Direct push to main is classifier-blocked → use `gh pr merge --squash`.
- **Prod:** Railway dashboard-configured (no in-repo deploy config), **auto-migrates on deploy** (47+ migrations already applied, proven). Deploys may need manual approval.

## 7. Money-safety invariants (unchanged — still hold)
- money-in = `grantCredits` only; spend-path never modified.
- Ask before each real fal/paid spend — the ask IS the cap.
- **G7 write = real Meta ad spend** (the user's own money on Meta, NOT our credit ledger) → gated by the autonomy modes + hard caps; default ① never auto-spends.

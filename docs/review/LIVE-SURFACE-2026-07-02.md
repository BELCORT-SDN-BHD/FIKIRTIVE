> **性质**:给 agent 的深度参考(总蓝图 `docs/BLUEPRINT.md` 的原料层)。大变更后由总审查员更新或重生成 —— 这一层**允许**演进。

# FIKIRTIVE — Census of what is LIVE on origin/main
**Snapshot:** origin/main `019b552` (2026-07-02, PR #106). Harvested read-only from worktree `confident-tu-b5dea3` (worktree ≈ main; the ~20 files that differ were read via `git show origin/main:`).

**Status legend:** ✅ LIVE (works on prod today) · 🌙 DORMANT (code merged, needs reconnect / env / App-Review) · 🔧 BUILT-BUT-UNWIRED (code exists, no user path reaches it) · 🚧 PLACEHOLDER (visible "Coming soon" stub)

---

## 1. User-facing surfaces (apps/web)

**One front door.** Otto IS the product: `apps/web/app/page.tsx` (`/`), `app/m/page.tsx` (retired Simple mode), and `app/library/page.tsx` (retired Workbench) all `redirect("/otto")`.

### `/login` ✅
`app/login/page.tsx` + `LoginForm.tsx`. Email+password (primary), magic link, and Google social login (Better Auth; `lib/better-auth/server.ts` has Google provider + trusted email_verified). Email-allowlist gate (`lib/allowlist.ts`) for closed beta.

### `/otto` — the app shell ✅
`app/otto/page.tsx` → `components/otto/OttoApp.tsx`. Ten views exist (`?view=` param, `OttoViewKey` at OttoApp.tsx:64); **only six are in the left nav** (`OttoNav.tsx:107-112`):

| View | Nav label | Status | What it is |
|---|---|---|---|
| `otto` | **Canvas** | ✅ | Default. Front door (`OttoFrontDoor.tsx`, 4 goal tiles: Sell a product / Announce a sale / Get more followers / Make a video — `packages/core/src/goals.ts`) → streaming chat left + FlowCanvas right (`OttoView.tsx:262-278`). Streaming is fully rolled out — hardcoded `ottoStreamEnabled = true` (`app/otto/page.tsx:70`). Multi-project (campaign = project), all-conversations sidebar. |
| `stuff` | **My Stuff** | ✅ | `OttoStuff.tsx`. Two tabs: **Cast** (entities: CHARACTER / LOCATION / PRODUCT / BRANDMARK with reference images + named variants, rename/delete/download) and **Ads** (launched Meta ads + ad jobs). |
| `memory` | **Brand memory** | ✅ | `OttoMemory.tsx` (554 lines). CRUD on Memory rows + "suggest facts from conversation" flow (`lib/memory-suggest.ts`). |
| `schedule` | **Schedule** | 🚧 | `OttoView.tsx:106` — ComingSoon stub: "Plan your posts on a calendar… auto-publish to Instagram and Facebook." The Buffer-like build (3 views) is specced, not started; blocked on `instagram_content_publish` App Review. |
| `analytics` | **Analytics** | 🚧 | `OttoView.tsx:109` — ComingSoon stub. (The only live analytics today = last-30d Meta account insights inside Connections.) |
| `account` | **Account** | ✅ | `OttoAccount.tsx` → `settings/SettingsPage.tsx` + `settings/sections.tsx`: profile, credits + recent activity, credit-pack purchase (links Stripe checkout), **Connections section** (per-channel connect/reconnect status), **OTTO behavior** toggles (ask-before-ad-spend ASK/AUTO). |

**Views that exist but have NO nav entry (URL-only, e.g. `/otto?view=templates`):**

| View | Status | What it is |
|---|---|---|
| `connections` | ✅ (semi-wired) | `OttoConnections.tsx` — full Meta connect/manage page: connection state (incl. F37 "unreachable ≠ reconnect"), ad accounts, last-30d insights, autonomy toggle, ads-writes kill-switch. Reached via the Account→Connections links and the Meta OAuth callback redirect (`app/api/meta/callback/route.ts` → `/otto?view=connections`), but not in the main nav. |
| `library` | 🔧 | `OttoLibrary.tsx` — asset library grid (full/compact). No link anywhere. |
| `templates` | 🔧 | `OttoTemplates.tsx` + `TemplateModal.tsx` + `lib/templates.ts` — 4 one-click paid templates (Remove background, Remove object, Product in a scene, Festival makeover) that call the real spend path (`startGen`). Fully functional, zero discoverability. |
| `discover` | 🔧 | `OttoDiscover.tsx` + `lib/inspirations.ts` — 10 inspiration prompts in 5 categories (Product shots, Festival/Seasonal incl. CNY/Raya/Deepavali, Social/UGC, Promotions, Lifestyle) with "Use in Otto". No link anywhere. |

### The Canvas (right pane) ✅
`components/canvas/FlowCanvas.tsx` + `useCanvasGen.ts` + `nodes/` (ImageNode, VideoNode, TextNode, GeneratingBody, NodeResize) + `components/asset/DetailPanel.tsx`. Live features: infinite board with persisted nodes (`CanvasNode` model); Generate composer behind a Grok-style button; **image gen = 4 variants per job with cost-confirm** (#88); **Make video (i2v)** with motion presets + cost-confirm (#85/#88); **text-to-video** (#89); delete-confirm on cards (#82); pan/select tools; node-create retry so a paid job is never orphaned (#90).

### Chat cards (in-stream) ✅
`OttoChatStream.tsx` renders live-streaming cards (#106 F23): **GEN_CARD** (`OttoPlanCard` — approve → paid generate), **pack groups** (`PackCard` + `pack-credit-math.ts` — coalesced GEN_CARDs sharing a packId, one cost confirm), **ACTION_CARD** (`OttoActionPlanCard` — Meta manage plan approve), **BUILD_CARD** (`OttoAdBuildCard` — Meta ad build approve), **STORYBOARD** (`StoryboardCard` — 分镜卡, per-shot editable, $0, editing a shot's text clears its first-frame for re-gen; #99). Composer: @-mentions of cast entities (`MentionInput.tsx`), image attach, **video attach with in-browser 抽帧 frame extraction** (`lib/video-frame.ts`, #84); Shift+Enter-to-send convention. First-run: `OttoOnboarding.tsx` + `QuickBrief.tsx`.

### `/billing` ✅
`app/billing/page.tsx` — standalone credit-pack purchase page (live Stripe packs + checkout).

### `/admin` — operator console ✅ (founder/staff only)
`app/admin/layout.tsx`: auth + allowlist wall; role matrix (viewer/ops/finance/moderator/super-admin) re-asserted per page. **All 11 nav sections are live** (the layout's "only Settings live" doc comment is stale — `NAV` marks every item `live: true`):
- `/admin/settings`, `/admin/directives` (prompt & knowledge, per model-family), `/admin/knowledge`, `/admin/models` (enable/disable models via `ModelRegistryOverlay`), `/admin/cost` (LLM/gen cost & usage), `/admin/credits` (**grant/adjust — the ONLY money-in besides Stripe**, idempotent `grantCredits`), `/admin/content` (generation review), `/admin/conversations` (+ `[threadId]` detail w/ `OttoTrace`), `/admin/team` (super-admin only), `/admin/tenants` (+ `[orgId]` detail: grant credits, ban, cut sessions, **impersonate** with `ImpersonationBanner`), `/admin/system` (GenJob/RefGenJob/RenderJob queue health).
- `/admin/audit` ✅ — ActionEvent money-gate audit log; linked from Content, not in admin nav.

### Dev-only surfaces (in the codebase, not for users)
`/kitchensink` 🔧 (shadcn proof, marked throwaway) · `/skin-preview/*` 🔧 (mock-data visual harness, 404s in prod, marked throwaway) · `/files/[...key]` — dev local-disk media serving with Range/206 (prod uses R2 presigned GETs).

### API routes
`/api/better-auth/[...all]` ✅ · `/api/meta/authorize` + `/api/meta/callback` ✅ (OAuth) · `/api/otto/stream` ✅ (SSE streaming turn; reserve→settle metering inside the stream) · `/api/stripe/webhook` ✅ (`checkout.session.completed` → idempotent `grantCredits`).

---

## 2. Otto agent (packages/otto)

- **Model:** `claude-sonnet-4-6` primary with same-tier 529-overload failover to `claude-sonnet-4-5` (`src/model.ts`). OpenAI Agents SDK runtime.
- **Metering:** `withLlmBudget` reserve→settle per turn (`src/meter.ts`); caps 12k context / 1.5k output tokens / 10 steps per turn (`packages/core/src/otto-budget.ts`); margin applied; InsufficientCredits = zero spend, no assistant message.
- **Persona:** plain-language marketing operator for users with no marketing/AI knowledge (`src/instructions.ts`).
- **Skill framework:** `defineOttoSkill()` with a 3-field fail-closed approval gate (cost/effect/reach); how-to in `src/skills/AGENTS.md`; catalog in `src/skills/CATALOG.md`.

### All 16 registered skills (`packages/otto/src/registry.ts`) — ALL ✅ LIVE

| # | Skill | cost / effect / reach | Approval | One-line purpose |
|---|---|---|---|---|
| 1 | `propose` | free / write / internal | no | Build a GEN_CARD image/video proposal the user can approve later. |
| 2 | `proposePack` | free / write / internal | no | Lay out a whole campaign pack of proposals in one turn (e.g. 3 product + 3 model shots). |
| 3 | `generate` | **spend** / write / internal | **YES — the ONE money skill** | Execute a user-approved GEN_CARD; spends credits; literal `needsApproval: true`. |
| 4 | `updateBrief` | free / write / internal | no | Refine the project's durable creative brief (≤60 words). |
| 5 | `describeRefs` | free / write / internal | no | See-once **vision** descriptions of reference images, cached; no spend (#84 reference-vision). |
| 6 | `setTitle` | free / write / internal | no | Set a ≤6-word conversation title. |
| 7 | `rememberBrandFact` | free / write / internal | no | Save ONE durable brand fact to Brand Memory. |
| 8 | `researchWeb` | free / read / **external** | no | Fetch a public web page / search to ground output. |
| 9 | `meta-insights` | free / read / external | no | Read connected Meta ad-account performance (spend, reach, CTR, CPC, ROAS). |
| 10 | `meta-list-objects` | free / read / external | no | List the user's Meta campaigns / ad sets / ads. |
| 11 | `list-meta-pages` | free / read / external | no | List connected Facebook Pages (for ad building). |
| 12 | `propose-meta-action` | free / write / internal | no (card itself; execution gated separately) | Build an ACTION_CARD plan: pause/resume/budget/reschedule Meta objects. |
| 13 | `propose-ad-build` | free / write / internal | no (build = $0 PAUSED draft) | Build a BUILD_CARD: create a new Meta ad from a generated asset. |
| 14 | `seedreamPrompt` | free / read / internal | no | Assemble a model-tuned English IMAGE prompt (prompt-mastery, PR #98) — called before every image propose. |
| 15 | `seedancePrompt` | free / read / internal | no | Assemble a model-tuned English VIDEO prompt (creative only; system appends res/duration/ratio). |
| 16 | `proposeStoryboard` | free / write / internal | no | Ordered storyboard (1–8 shots), each shot's prompts built via skills 14/15; all $0 until per-shot generate (#99). |

Post-gen, the **worker auto-resumes Otto** for a one-shot verdict after a generation finishes (`apps/worker/src/otto-resume.ts`, at-most-once, budget-capped).

---

## 3. Connectors & integrations

### Meta (Facebook/Instagram) — App `999242359480685`
- **OAuth loop** ✅: `lib/meta-oauth.ts` requests `ads_read, ads_management, pages_show_list, business_management`; authorize/callback routes live; token encrypted (Railway `TOKEN_ENCRYPTION_KEY` — do not rotate).
- **Read connector (G6)** ✅ LIVE on prod: insights, object listing, pages (`lib/meta-insights.ts`, `meta-objects.ts`, `meta-pages.ts`, `meta-graph.ts`) — powers skills 9–11 and the Connections view.
- **Ad WRITE v1 (G7, manage existing)** 🌙 DORMANT: `lib/meta-write-actions.ts` — ACTION_CARD → single-use approval → `runApprovedPlan`; SoD; `adsWritesPaused` kill-switch (throws `KILL_SWITCH`); `maybeAutoRun` for AUTO autonomy. Merged (#64) but **gated on `canWrite`** = the stored token actually granting `ads_management` → needs a founder reconnect, and Meta App Review for non-dev users.
- **Ad BUILD v2 (G7, create new)** 🌙 DORMANT: `lib/meta-build-actions.ts` / `meta-build-propose.ts` / `meta-build-spec.ts` — Otto builds full campaign→ad set→creative→ad as a **PAUSED $0 draft**; launching goes through v1's approval gate. Merged (#65); needs `pages_show_list` reconnect.
- **Channel foundation** 🔧 partially: `lib/channels/` (facebook.ts, instagram.ts, registry.ts) — connect status / targets / capabilities are live (feeds Account→Connections); `publish`, per-post insights, published-post listing are `notImpl` stubs awaiting the Schedule build + `instagram_content_publish` App Review.

### Stripe ✅ LIVE (money-in since 2026-06-29)
- `lib/billing-actions.ts`: packs = live Stripe Prices carrying `metadata.credits` (3 MYR packs: RM25/100/250 → 50/220/600 credits; priceIds live only in Stripe dashboard); `createTopupCheckout` → Checkout Session; webhook (`app/api/stripe/webhook/route.ts`) verifies signature and calls idempotent `grantCredits`. Live keys + webhook on Railway.
- Subscriptions: **not built** (deferred, Phase 3b).

### Generation providers (packages/generation) — env-selected `GENERATION_PROVIDER`
- **BytePlus Ark (direct, SEA endpoint)** ✅ LIVE on prod (worker cutover #67): `src/byteplus.ts` — Seedream 4.5 image (**multi-reference conditioning up to 10 refs**, #92; watermark explicitly off, F40) and Seedance 2.0 Fast video (i2v start-frame, t2v, **whole-clip `reference_video` role**, #97; async poll absorbed inside provider).
- **fal.ai provider** 🌙 DORMANT on prod: `src/index.ts` `FalProvider` — Seedream + a verified **12-model video table** (Kling 2.5/2.6/3.0 Pro, Veo 3.1 lite/fast/full, LTX-2, Wan 2.5, PixVerse V6, Grok Imagine, Hailuo 02, Seedance 2 full/fast). Fully wired behind the same seam; inert while `GENERATION_PROVIDER=byteplus`.
- **Model policy** (`packages/core/src/gen.ts`, `model-config.ts`): image = `seedream` only; active video model = `OTTO_DEFAULT_VIDEO_MODEL` env (code default `veo3.1-lite`; prod must pin `seedance-2-fast` for BytePlus). `assertSpendableModel` blocks anything else pre-spend; admin can disable models via overlay (`/admin/models`).
- **Mock provider** — $0 default for dev/tests.

### Anthropic ✅ — Otto's LLM (sonnet 4.6/4.5 failover), credit-metered per turn.

### Better Auth ✅ — NextAuth fully retired. Admin plugin with `super-admin` access control (`lib/better-auth/access.ts`), founder self-heal promote (`converge.ts`), impersonation, bans.

---

## 4. Infra the user doesn't see (but pays for)

### Worker (apps/worker, Railway, pg-boss on Postgres)
Queues (each + DLQ; `src/queues.ts`, `src/index.ts`):
- **gen** ✅ — paid image/video jobs (`jobs/gen.ts`): exactly-once spend (atomic QUEUED→GENERATING claim, `chargedError` post-bill taxonomy, redelivery-discard), refund-on-fail, conditioning-reachability checks, Otto auto-resume on finish.
- **refgen** ✅ — paid reference-image / cast-variant generation (`jobs/refgen.ts`), same money invariants.
- **ingest** ✅ — direct-upload hash re-verification + ffprobe metadata + thumbs (`jobs/ingest.ts`); deletes hash-mismatched uploads (client hash is a hint, worker hash is truth). #106 added redispatch hardening.
- **caption** ✅ — $0 whisper.cpp transcription → content-hash-keyed Transcript cache (`jobs/caption.ts`). Queue live; its consumer UI is the retired editor (below).
- **render** ✅(queue)/🔧(UI) — ffmpeg timeline render of an edit contract (`jobs/render.ts`).
- **sweep** ✅ — D21 refcount purge of soft-deleted assets past 30 days.
- **Interval reapers** ✅: stale GenJob, stale RefGenJob (`gen.ts`/`refgen.ts` reap fns), stale LLM reservations (`jobs/llm-reservation-reaper.ts`) — fail-closed + refund so credit holds never leak.

### Credit system ✅ (the money spine)
`packages/db/src/credits.ts` + `packages/core/src/spend.ts`, `otto-budget.ts`:
- `CreditAccount` + append-only `CreditLedger`; invariants `balance == Σ balanceDelta`, `reserved == Σ reservedDelta`; RESERVE/SETTLE/REFUND exactly-once via partial-unique `(orgId, refId, kind)` indexes.
- 1 internal credit = $0.01; 1 displayed credit = $0.10; USD-pegged pricing with margin (image ~2.5×, video ≈ cost, Otto LLM turns margined). New org seed = **100 displayed free credits**.
- Money-in paths: Stripe webhook + admin grant. Nothing else writes balance.

### Storage ✅
`packages/storage/src/index.ts` — one content-addressed key scheme, two drivers by `STORAGE_DRIVER`: local disk (dev) / **Cloudflare R2 via S3 API (prod)**; browser→R2 **presigned direct uploads** with worker hash re-verify; presigned GETs in prod (dev falls back to `/files` route). #106 added an upload fallback path (`lib/direct-upload.ts` / `upload-actions.ts`).

### Database ✅
Postgres via Prisma — 41 models (`packages/db/prisma/schema.prisma`): content (Project, Entity/EntityVariant/ReferenceImage, Asset, Generation, GenerationBatch, CanvasNode, TemplateBundle), jobs (GenJob, RefGenJob, RenderJob, CaptionJob, Transcript), chat (ChatThread, ChatMessage), brand (Memory, BrandKit, BrandRule), org/auth (Organization, Membership, User, AllowedEmail, BetterAuth×4, legacy NextAuth tables), money (CreditAccount, CreditLedger), ops (ActionEvent audit, ModelDirective + Revisions, ModelRegistryOverlay, RuntimeConfig), Meta (MetaConnection, MetaActionExecution), editor (Shot, ShotEntityRef).

### Pre-spend guardian ✅
`packages/core/src/cowork-guardian.ts` — cast-consistency findings block a paid generation before spend (fail-open around pure logic). Plus the typed genRequest gate + `assertSpendableModel` + count cap (`MAX_GEN_COUNT=4`).

### Editor slice 🔧 BUILT-BUT-UNWIRED (paid-for dead weight to decide on)
Timeline/NLE stack: `packages/core/src/timeline*.ts`, `nle-export.ts`, `edit.ts` server actions (`lib/actions.ts` exportCut/startRender ~line 793, startCaption ~line 879) + the render/caption worker jobs. Since the Workbench (`/library`) was retired to a redirect, **no UI component calls these actions** — worker queues stay registered and idle.

### CI / deploy ✅
`.github/workflows/ci.yml` — typecheck + import fences + frozen lockfile + unit/integration tests + `prisma migrate deploy` check; **push to main auto-deploys web + worker to Railway** (F36; merge discipline doc #104). Dockerfiles: `apps/web/Dockerfile`, `apps/worker/Dockerfile`. Dev secrets live only in the main checkout's `.env.local`; prod = Railway variables.

---

## 5. One-screen founder summary

**LIVE today:** Otto chat (streaming, 16 skills, sonnet-4.6) · Canvas (4-variant images, i2v/t2v video, storyboards, cost-confirms) · My Stuff (cast + ads) · Brand memory · Account/Settings · Meta READ (insights/objects/pages) · Stripe MYR credit packs · full credit ledger with exactly-once spend · BytePlus Seedream/Seedance · R2 storage + direct upload · 11-section admin console with impersonation + credit grants · CI auto-deploy.

**DORMANT (flip-a-switch distance):** Meta ad-write v1 + ad-build v2 (founder reconnect with `ads_management`/`pages_show_list` + App Review) · fal 12-model video menu (env switch) · Meta App Review for public users.

**Built-but-invisible (decide: wire or delete):** Templates (4, fully functional paid flow) · Discover (10 inspirations) · Library view · the whole timeline/render/caption editor stack · kitchensink + skin-preview throwaways.

**Placeholders promised in nav:** Schedule, Analytics — both "Coming soon" screens; Schedule additionally blocked on `instagram_content_publish` App Review; channel `publish` is a stub.

**Not built at all (decided but absent):** subscriptions (Phase 3b), currency display localization ($ hardcoded per credit-economics memory), first real paid prod-gen E2E verification still open.

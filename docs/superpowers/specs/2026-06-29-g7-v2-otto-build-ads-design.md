# G7 v2 Design — Otto Builds Ads (the strategist)

**Date:** 2026-06-29
**Status:** ✅ SHIPPED — merged as PR #65 (`5ad6214`); prod dormant until a reconnect grants pages_show_list. Build=$0, launch=v1 gate.
**Scope:** v2 = slice (c) **create from scratch AND drop an asset into an existing ad set**, driven by Brand Brain like a real media strategist.
**Builds on:** G7 v1 (manage-existing, shipped/merged `f141037`) + Brand Brain (G3b: BrandKit/BrandRule + `getBrandContextText`) + the FIKIRTIVE asset/generation engine.

---

## 创始人摘要 (Founder TL;DR — read this first)

G7 v2 让 **Otto 当你的媒体策划官**:你给个目标(「帮 KAIA 推 Raya 蛋糕,多拿订单」),Otto 读你的 **Brand Brain(品牌/受众/产品)+ 你生成的素材 + 你的 Meta 历史表现**,出一份**有理有据的投放计划**(目标 + 定向 + 选哪条素材 + 品牌口吻文案 + CTA + 预算 + 排期,**附理由**)。你批准 → Otto 在你 Meta 账户里**全部建成暂停草稿**(campaign→广告组→创意→广告)—— **一分钱不花**。你再看草稿、改、然后**启动** → 走 v1 那道已上线的花钱门。

- **钱安全:建草稿 = 暂停 = $0。** 唯一花钱的瞬间是「启动」,完全复用 v1 已验证的钱机器(门/急停/幂等/偏移闸)。**没有新花钱路径。**
- **同一套 harness/SoD:** Otto 的新能力是 skill(只提议,进 CATALOG);真正去 Meta 建对象的是**服务器动作,不是 skill**,CI 围栏挡死 —— Otto 工具箱里依旧没有任何「写/建 Meta」的工具。
- **自主:** 默认①(出计划→你批→建暂停);模式②=Otto 自动建草稿。**启动永远走 v1 门。**

这是 super-employee 北极星的高光:Otto 像最强的 marketer 一样,从品牌出发,把一整条广告替你搭好。

---

## 1. Scope

### In v2
- A **strategist** flow: Otto reads Brand Brain + the user's generated assets + (optional) Meta insights → proposes a reasoned ad plan.
- **Create from scratch:** campaign(objective) → ad set(targeting + budget + optimization + schedule) → creative(uploaded asset + Page + copy + CTA + link) → ad — **all PAUSED**.
- **Into an existing ad set:** skip campaign/adset creation; build only creative + ad (PAUSED) inside an ad set the user already has.
- Read the user's **FB Pages** (creative requires a `page_id`).
- The **build is a new money-SAFE op** (paused spends nothing); autonomy modes ①+②.
- **Launch handoff:** the built paused draft is launched via **v1's existing resume/spend gate** — no new spend path.

### Deferred (NOT in v2)
- Multi-adset / A·B-test campaigns (v2 builds a single ad set + single ad first).
- Generating NEW creative inside the build (Otto picks from EXISTING generated assets; making a new image/video stays the existing FIKIRTIVE gen flow + its own spend gate).
- Mode ④ Autopilot for builds (mode ② already covers auto-building safe drafts).
- Advanced objectives/placements beyond the supported set (§7).

---

## 2. The experience

1. **Goal in.** User: "Promote my Raya cake set for KAIA — get orders." (Or Otto offers, after analysing insights.)
2. **Strategy out.** Otto (skill `proposeAdBuild`) reads `getBrandContextText` (brand voice / audience / products), lists the user's generated assets, optionally reads `getMetaInsights`, and produces a **BUILD card**: objective + targeting + chosen creative(asset) + brand-voice copy + headline + CTA + link + suggested daily budget + schedule + Page — **with its reasoning** ("traffic objective because the goal is orders to your site; audience = your brand's MY food-lovers 25-44; this Raya hero image because it's your top-performing style").
3. **Review + approve.** User reads the plan (one rich card), edits copy/budget/targeting if desired, approves.
4. **Build (paused).** A trusted server action (`buildAdDraft`) creates the objects in the user's Meta account, **all PAUSED** — uploads the asset → creative → campaign → ad set → ad. **$0 spent.**
5. **Launch.** User reviews the paused draft (in Otto or Meta) and clicks **Launch** → routed through **v1's `approveMetaActionPlan` resume/activate gate** (the spend moment, already shipped). Default mode ① also gates the build approval; mode ② auto-builds drafts; **launch is always v1-gated.**

---

## 3. Money safety

- **Build = paused = $0.** Creating paused campaign/adset/ad/creative spends nothing (budget is *set* on the paused ad set but never charged until active). So the strategist + the build are **money-SAFE by construction** — the locked **mode ② Draft** ("only paused drafts + proposals, never executes spend").
- **The only spend moment is Launch = un-pause = v1's `resume` op**, which already runs through `approveMetaActionPlan` → `runApprovedPlan` (requireOwner + impersonation-block + bound approval + kill-switch + per-step idempotency + divergence gate). **No new spend path; v2 reuses v1's money machinery for the launch.**
- **SoD unchanged:** Otto only PROPOSES the plan (a free/write/internal skill writing a BUILD card). The Meta creates happen in a trusted server action the LLM cannot call. The CI fence forbids any skill importing the Meta Graph client.
- **"Build a paused draft" is a NEW money-class-`safe` op** in the existing taxonomy (`meta-action-policy.ts`): mode ① asks (approve the plan); mode ② auto-builds. The existing policy/card/executor machinery extends — no new money model.

---

## 4. Autonomy mapping (v2 = ①+②)

| Mode | For a BUILD (paused draft) | For LAUNCH (un-pause) |
|---|---|---|
| **① Ask** (default) | Otto proposes the plan; user approves → build | v1 gate (always asks) |
| **② Draft** | Otto **auto-builds** the paused draft (it spends nothing) | v1 gate (still asks — launch spends) |
| ③ Auto / ④ Autopilot | (③ already auto-does safe manage ops; build-auto = ②. ④ deferred) | — |

Default is ①. The launch step is **always** v1's spend gate regardless of build autonomy. `MetaConnection.adsAutonomy` (existing) carries the mode; the kill-switch (`adsWritesPaused`) blocks builds too.

---

## 5. Architecture

### New Otto skills (ungated, propose-only — `defineOttoSkill`, in CATALOG)
- **`proposeAdBuild`** — `cost:free, effect:write, reach:internal` → ungated. Reads Brand Brain (`getBrandContextText` via a ctx port) + the user's generated assets + optional insights via ports; calls a web port `proposeAdBuildForOwner` that owner-validates the chosen asset + (if into-existing) the ad set, builds the **BUILD card** payload (objective, targeting, creative, copy, budget, schedule, reasoning, page), and persists it. Otto never touches Meta; copy/strategy are Otto's text, but the asset id, ad-set id, and page id are **server-validated** against the owner's account.
- **`listMetaPages`** — `cost:free, effect:read, reach:external` → ungated. Reads the owner's FB Pages (`GET /me/accounts`) via a port so the plan can bind a `page_id`. Mirrors `metaListObjects`.
- **Reused:** `metaListObjects` (v1) for the into-existing-ad-set path; `metaInsights` (G6b) for the optional performance read.

### The only Meta-CREATE writer — a trusted server action (NOT a skill)
`apps/web/lib/meta-build-actions.ts` `buildAdDraft(cardId)` mirrors v1's `runApprovedPlan` discipline:
1. `requireOwner` + impersonation-block + **kill-switch** (`adsWritesPaused`) + `canWrite`.
2. Verify the BUILD card's bound approval (reuse `meta-approval.ts`); consume single-use (gate before consume, per the v1 ultra-fix).
3. **Ordered, idempotent multi-object create — ALL PAUSED**, each step a `MetaActionExecution` row keyed `meta-build:<cardId>:<step>` (exactly-once via the raw-SQL unique index; a re-run reads created ids from the rows, never re-creates):
   - **upload asset** → `POST /act_<id>/adimages` (image bytes → `image_hash`) OR `/advideos` (video → `video_id`).
   - **creative** → `POST /act_<id>/adcreatives` with `object_story_spec` (`page_id`, link_data/video_data: message, link, image_hash/video_id, call_to_action) → `creative_id`.
   - **campaign** (create path) → `POST /act_<id>/campaigns` `{name, objective, status:PAUSED, special_ad_categories:[]}` → `campaign_id`.
   - **ad set** (create path) → `POST /act_<id>/adsets` `{name, campaign_id, daily_budget, billing_event, optimization_goal, targeting, status:PAUSED, start_time}` → `adset_id`. (into-existing: use the chosen `adset_id`, skip campaign+adset.)
   - **ad** → `POST /act_<id>/ads` `{name, adset_id, creative:{creative_id}, status:PAUSED}` → `ad_id`.
4. On partial failure: **stop, report what was created** (the created ids persist in the execution rows); never leave half-state un-recorded; offer a clean retry (idempotent). No auto-rollback of created objects (deleting a created campaign is its own Meta call; report instead).
5. Result: the created object ids + a "draft built — review & launch" state on the card. Injected as the `metaBuild` port in `buildOttoContext`; **withheld from the worker** (like `startGen`/the v1 writer).
- New Graph helpers in `meta-graph.ts`: `metaGraphUpload` (multipart for adimages/advideos) + the create POSTs reuse `metaGraphPost`.

### The BUILD card
A new `BUILD_CARD` ChatMessage kind (sibling of `ACTION_CARD`), rendered by `OttoAdBuildCard.tsx` (modeled on `OttoActionPlanCard`): the strategy (objective + reasoning), the targeting summary, the creative preview (the chosen asset + copy + headline + CTA + link), the suggested budget + schedule, the Page — then Approve/Deny (or, in ②, an auto-built status). Threaded through DTO / ui-messages / both MessageRow surfaces (same as v1's ACTION_CARD). **Client DTO strips approval internals** (per the v1 ultra-fix).

### The strategist intelligence
`proposeAdBuild` grounds the plan in **Brand Brain**: `getBrandContextText` (BrandKit voice/tone/audience/colors + active BrandRules) drives the copy voice, the audience/targeting suggestion, and the objective rationale. Optional `getMetaInsights` informs "what's worked." Otto writes the copy + reasoning; the server validates the concrete ids (asset, ad set, page) and computes nothing money-relevant the LLM could spoof.

### The launch handoff
Launching the built draft = un-pausing campaign/adset/ad = v1's `resume` op. The BUILD card, once built, surfaces a **Launch** affordance that creates a v1 ACTION_CARD (resume the new objects) → v1's `approveMetaActionPlan` spend gate. (Or the user launches in Meta directly.) **No new launch/spend code.**

---

## 6. Data model

- **`BUILD_CARD`** added to `ChatMessageKind`. Payload `MetaAdBuildCardPayload`:
  ```ts
  type MetaAdBuildCardPayload = {
    goal: string; reasoning: string;
    mode: "create" | "into_existing";
    objective: string;                 // from the supported set (§7)
    accountId: string; pageId: string; igAccountId?: string;
    targeting: Record<string, unknown>; // server-shaped from Brand-Brain suggestion (or Advantage+ default)
    dailyBudgetMinor: number; startTime?: string;
    creative: { assetId: string; kind: "image"|"video"; message: string; headline?: string; cta: string; link: string };
    intoExisting?: { adsetId: string };
    approval: Approval;                 // reuse meta-approval.ts (bound/expiring/single-use)
    buildOutcome?: { built: boolean; createdIds?: Record<string,string>; state?: "done"|"partial"|"failed"; reason?: string };
  };
  ```
- **`MetaActionExecution`** (v1) reused for the build steps + to store created ids (`appliedValue` = the created object id) → exactly-once create.
- **Scope:** `ads_management` (v1) already permits create. **Open:** reading the user's Pages for the creative may additionally require `pages_show_list` / `business_management` — confirm and, if so, add to the authorize scope (another reconnect/App-Review line). Default Page can be stored on `MetaConnection` (`defaultPageId String?`) to avoid re-picking.

---

## 7. Scope boundaries (v2-v1)

- **Objectives (supported set):** a small, common set — e.g. `OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`, `OUTCOME_LEADS`, `OUTCOME_SALES`. Otto picks from these with a stated rationale; the typed build schema rejects anything else.
- **Structure:** single ad set + single ad per build (no multi-adset/A·B in v2).
- **Creative:** image AND video, from the user's EXISTING generated assets (no new generation inside build).
- **Targeting:** Brand-Brain-suggested, server-shaped into a valid Meta targeting spec; if unmappable, fall back to an Advantage+/broad default. Always editable in Meta before launch.
- **Page:** required (creative needs it). IG account optional.
- **Into-existing path:** reuse the chosen ad set's targeting/budget/objective (Otto only adds creative + ad).

---

## 8. Reuse table (v1 + Brand Brain infra)

| Concern | Reused symbol | v2 action |
|---|---|---|
| Meta POST/create | `metaGraphPost` (`meta-graph.ts`) | reuse; add `metaGraphUpload` (multipart) for adimages/advideos |
| Read existing objects | `fetchOwnerAdObjects` / `metaListObjects` | reuse for into-existing |
| Propose→card→trusted-execute SoD | `proposeMetaAction` + `metaPropose` port + `runApprovedPlan` | MIRROR for `proposeAdBuild` + `metaBuild` port + `buildAdDraft` |
| Approval binding | `meta-approval.ts` | reuse (bind/expire/single-use; gate-before-consume) |
| Money-class / autonomy | `meta-action-policy.ts` | extend: "build" = money-class `safe`; mode ② auto-builds |
| Exactly-once | `MetaActionExecution` + raw unique index | reuse (one row per created object) |
| Kill-switch / owner-scope / impersonation | `adsWritesPaused`, `requireOwner`, `isImpersonating` | reuse on the build writer |
| Brand Brain | `getBrandContextText`, BrandKit/BrandRule (G3b) | inject as a port for the strategist |
| Assets | `Generation`→`Asset`, storage | read asset bytes to upload to Meta |
| Card UI | `OttoActionPlanCard` + DTO threading | MIRROR as `OttoAdBuildCard` + `BUILD_CARD` threading |
| Launch/spend | `approveMetaActionPlan` (v1 resume gate) | reuse verbatim (launch = resume) |
| CI fence | `scripts/check-skill-imports.sh` | already blocks meta-graph in skills — covers v2 |

---

## 9. Security · idempotency · errors

- Every server action `requireOwner`-first; `ownerId`/ids never from the LLM; the asset/adset/page ids in the card are server-validated against the owner's account before any create.
- Build writer blocked under kill-switch; impersonation blocked; owner-scoped.
- Per-object idempotency (create exactly once; re-run reads created ids). Partial-create → stop + report created ids (no auto-delete).
- Asset upload: stream the owner's asset bytes from storage to Meta; never expose a token to the client.
- Fail-closed: unmappable objective/targeting → reject the build (friendly message), don't guess into a spend-bearing config.

## 10. Testing
- Pure: targeting/objective mapping (Brand-Brain suggestion → valid Meta spec, fallbacks); BUILD payload builder; the supported-objective guard.
- Skill gates: `proposeAdBuild` free/write/internal/ungated; `listMetaPages` free/read/external/ungated.
- `buildAdDraft`: requireOwner/impersonation/kill-switch enforced; ordered creates ALL PAUSED; exactly-once (no double-create on retry); partial-create reports created ids; asset upload mocked (no real Meta). Graph client mocked throughout.
- Launch handoff: building then launching routes through v1's `approveMetaActionPlan` (resume) — no new spend path.

## 11. Key files
New: `apps/web/lib/meta-build-actions.ts`, `apps/web/lib/meta-ad-build-card.ts` (payload builder + targeting/objective mapping), `apps/web/lib/meta-build-propose.ts` (the `proposeAdBuildForOwner` port impl), `packages/otto/src/skills/{propose-ad-build,list-meta-pages}.ts`, `apps/web/components/otto/OttoAdBuildCard.tsx`.
Modify: `meta-graph.ts` (+`metaGraphUpload`, pages read), `meta-actions.ts`/`meta-oauth.ts` (Page scope + `defaultPageId`), `packages/otto/src/context.ts` (`metaBuild`/`metaPages`/`brandBrain` ports), `registry.ts`, `otto-actions.ts` (inject ports), `dto.ts`/`otto-ui-messages.ts`/`types.ts` (BUILD_CARD), both MessageRow surfaces, `schema.prisma` (BUILD_CARD enum, `defaultPageId`), `instructions.ts` (the strategist guidance), `apps/worker/src/otto-resume.ts` (withhold the build port — verify).

## 12. Open questions (resolve in planning)
1. Does reading the user's Pages need `pages_show_list`/`business_management` beyond `ads_management`? If yes → scope add + reconnect/App-Review note.
2. Targeting spec shape — how rich a Brand-Brain→Meta targeting mapping for v1 (geo + age + interests vs. Advantage+ broad)? Keep minimal, fall back to broad.
3. Link/destination — Otto asks for the URL, or pull a brand site URL from BrandKit?
4. Default Page persistence vs. pick-per-build.

## References
- G7 v1 design + the shipped v1 code (`meta-write-actions.ts`, `meta-propose.ts`, `meta-plan-card.ts`, `meta-approval.ts`, `meta-action-policy.ts`).
- [Agent-authz research](2026-06-28-g7-agent-authz-research.md) (SoD principles).
- Brand Brain (G3b): BrandKit/BrandRule + `getBrandContextText`.
- Memory: `otto-build-priorities`, `fikirtive-otto-super-employee-direction`, `ask-before-spending-real-money`, `grok-imagine-agent-north-star`.

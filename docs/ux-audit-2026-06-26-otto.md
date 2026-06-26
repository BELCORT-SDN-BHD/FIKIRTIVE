# Otto UX / feature audit — 2026-06-26

Source: founder screen recording (`Screen Recording 2026-06-26 at 10.48.40 AM.mov`, 7m51s, account `tools@belcort.com`) + full read of the Otto codebase. Verifies and refines the 34-item codex review, adds new findings. Severities are from the **merchant's** point of view (a non-coder making a real ad and trusting the money/trust copy).

Method: 8-agent code audit (billing, generation, approval, My Stuff, brand memory, IA/nav, tone/honesty, cross-cutting critic) + first-hand reading of the money path and the recording frame-by-frame. 65 raw findings deduped to ~40 distinct problems below. `🎥` = directly visible in the recording.

---

## The core broken promise (one sentence)

> **"Otto plans and makes it — you approve before anything costs money"** ([OttoFrontDoor.tsx:358](apps/web/components/otto/OttoFrontDoor.tsx)) is the product's central promise, and it is false on every clause the founder could test: talking to Otto already spends real credits *before* any approval; the one number on the approval gate (`$0.04`) is not what gets charged (the media charge alone is **2.5×** that, plus undisclosed per-turn LLM cost); the balance the user watches is stale and never reconciled to a quote; and after **~$0.61 left the wallet the job produced ZERO output** while Otto insisted it was *"Not stuck at all."*

### The 7m51s lived experience (balance + state)
- Start balance **$999,991.89**. User: *"create a ad for my product @sunglass"* → `@sunglass` renders as **plain text** (no chip).
- User picks *"Nike, sporty / video, realistic video / sunglass on their own"*. Otto proposes a card: **"An image … About $0.04"**, `[Make it · $0.04]`, *"Nothing is charged until you approve — and you can always undo."*
- User: *"ok! lets go ahead"* → card flips to **"✓ On it — making this now."** Balance drops to **$999,991.54 (−$0.35)** — 9× the quoted $0.04, with the trust line still showing.
- Card sits on "On it" for minutes, no progress/ETA. Otto (text): *"Hmm, something went wrong… try clicking 'Generate' on the card directly"* — **but the card shows "On it" with no Generate button.** User: *"hi are you stuck?"* → Otto: *"Not stuck at all, sorry about that little hiccup! Let me try again right now!"*
- User navigates to My Stuff (wall of test-junk entities), Brand memory (empty static form), back to Otto → card has **reverted to `[Make it · $0.04]`** (no `genJobId` was ever attached → generation never actually started).
- End: balance **$999,991.28** (total **−$0.61**), still **zero output**, Otto: *"Otto is making this — this can take a moment…"*

---

## ⚠️ Critical scoping caveat (read before fixing)

**The entire recording — and most video-grounded findings — are on the founder-only streaming path.** `ottoStreamEnabled = isFounderAdmin(email)` ([otto/page.tsx:48](apps/web/app/otto/page.tsx)) routes the founder to `OttoChatStream`; **every real merchant gets `OttoConversation`** (the non-stream `ottoTurn` path), which has a *worse* out-of-credits error and divergent mention/attachment behavior ([OttoView.tsx:111-141](apps/web/components/otto/OttoView.tsx)). Any fix must be verified on **both** components, and the streaming gate should be removed or brought to parity before merchants rely on it. *(XC-2)*

---

## P0 — Money, trust & blocking (must fix before any merchant sees Otto)

**P0-1 · Talking to Otto spends real money before any approval** `🎥`
Every chat turn runs `withLlmBudget({ paid: true })` — [stream/route.ts:207](apps/web/app/api/otto/stream/route.ts), [otto-actions.ts:410](apps/web/lib/otto-actions.ts) (turn), [:562](apps/web/lib/otto-actions.ts) (approve), [otto-resume.ts:75](apps/worker/src/otto-resume.ts) (verdict) — so the front-door and card promises ("before anything costs money" / "nothing is charged until you approve") are literally false. Worst-case reserve is **$1.80/turn** (`turnBudgetInternal × OTTO_MAX_STEPS=10`, [otto-budget.ts](packages/core/src/otto-budget.ts)), settled to actual tokens. This is the single biggest trust-killer. *Fix:* make Otto conversation free to the merchant (drop `paid:true` on chat turns, absorb as platform cost) **or** disclose a running "thinking" cost so the balance movement is explained. *(BILL-1 / TRUST-1 / GEN-1 / codex#1)*

**P0-2 · The quoted price is wrong even for media — $0.04 shown, $0.10 charged (2.5×)** `🎥`
The card shows `GEN_PRICE_USD_PER_IMAGE = 0.04` (the *record-only fal cost*, [propose.helpers.ts:136](packages/otto/src/tools/propose.ts), [gen.ts:81](packages/core/src/gen.ts)), but `startGen` reserves `pricedGenCredits` = **$0.10/image** (2.5× margin, [spend.ts:76-79](packages/core/src/spend.ts), [gen-actions.ts:93](apps/web/lib/gen-actions.ts)). The media charge alone is 2.5× the quote **before** any LLM cost. *Fix:* drive the card's `estimatedPriceUsd` from the same `pricedGenCredits` value that's actually reserved. *(XC-8 / GEN-1 — corrects BILL-1 framing)*

**P0-3 · A "video" request is quoted & approved as a cheap image; the real video step is never priced** `🎥`
User asked for "realistic video"; the card said "An image … $0.04". The image-keyframe-first rule ([instructions.ts:38](packages/otto/src/instructions.ts), [cowork-planner.ts](packages/core/src/cowork-planner.ts)) is real but over-applied (the user wanted a *product*, not a character variant), and the card data model has **no notion of a 2-step plan or aggregate cost** — a realistic video is ~$2.00, not $0.04 ([videoPriceUsd](packages/core/src/gen.ts)). *Fix:* show the full plan on the card ("Step 1 of 2: a still to animate — ~$X now, ~$Y for the video"). *(IMG-VID-1 / GEN-8 / codex#5)*

**P0-4 · "Nothing is charged until you approve — and you can always undo" is false on both clauses** `🎥`
Charging happens during the conversation (P0-1), and **there is no undo/cancel anywhere** — grep of the money path finds zero cancel/abort/refund-on-demand handlers ([OttoPlanCard.tsx:133](apps/web/components/otto/OttoPlanCard.tsx)). The only money-return is an automatic refund on terminal job *failure*. *Fix:* delete the "you can always undo" clause; rewrite to be literally true. *(BILL-2 / TRUST-2 / codex#2+#3)*

**P0-5 · "Your credits are safe — nothing is charged until a result comes back" is false** `🎥`
Shown at the 2-min stall (the most anxious moment). Credits are **reserved at approval** in the same tx as the job insert ([gen-actions.ts:124](apps/web/lib/gen-actions.ts)), decrementing the visible balance immediately; the hold sits up to **25 min** ([gen.ts:50](apps/worker/src/jobs/gen.ts)). Filed in 4 places ([OttoChatStream.tsx:508](apps/web/components/otto/OttoChatStream.tsx), [OttoConversation.tsx:258](apps/web/components/otto/OttoConversation.tsx)) — one copy fix resolves all. *Fix:* "We've set aside ~$X; if it fails you're refunded automatically." *(BILL-3 / GEN-2 / HON-5 / codex#9)*

**P0-6 · The plan card is an optimistic dead-end — "On it" with no failed/stuck/retry state, and it reverts to a pay button** `🎥`
`settled = done || hasDurableResult` ([OttoPlanCard.tsx:50](apps/web/components/otto/OttoPlanCard.tsx)): approve sets `done=true` optimistically; a degraded/stale `ottoApprove` result has no `error` key so it's treated as success ([otto-actions.ts:608/655](apps/web/lib/otto-actions.ts)) even though **no GenJob was created**. On remount the card resets to `alreadyGenerated = !!genJobId` (= false) → shows `[Make it · $0.04]` again. The known `ottoApprove`-on-a-proposed-card failure is documented in the code ([OttoPlanCard.tsx:58-60](apps/web/components/otto/OttoPlanCard.tsx)). *Fix:* drive the card from authoritative `GenJob.status` (query `cowork:<cardId>`); add explicit queued/generating/failed states so it never reverts to a chargeable button after approval. *(APPR-1 / GEN-4 / BILL-6 / IA-7 / APPR-3 — one defect, de-dupe into one fix)*

**P0-7 · Otto speaks blind about job state — "Not stuck at all" while the job is dead; impossible recovery instruction** `🎥`
`OttoContext` has **no GenJob status field** and `buildOttoContext` never queries `genJob` ([context.ts:6-31](packages/otto/src/context.ts), [otto-actions.ts:99-129](apps/web/lib/otto-actions.ts)) — the only signal the model ever sees is the literal string `"queued"` ([generate.ts:137](packages/otto/src/tools/generate.ts)). `instructions.ts` has **zero** honesty / status-grounding / capability-boundary rules, so it fills dead air with reassurance and tells the user to click a "Generate" button that doesn't exist in the "On it" state. *Fix:* inject live `GenJob.status/progress/error` (or a read-only `checkJob` tool) + a prompt rule forbidding job-state claims that aren't grounded; never reference UI affordances Otto can't see. *(HON-1 / HON-2 / HON-4 / GEN-3 / codex#6+#7+#11)*

**P0-8 · No quote-vs-actual reconciliation anywhere — the result ignores the `costUsd` it already has** `🎥`
Quote (card), media charge (`pricedGenCredits`), LLM charge (`withLlmBudget`), and the result's own `costUsd` are 4 numbers computed in 4 places and never joined; `OttoResult` receives `costUsd?` and **never renders it** ([OttoResult.tsx:7](apps/web/components/otto/OttoResult.tsx)). The user can never answer "where did my money go and was it what I agreed to." *Fix:* one per-card/per-session cost object (quoted / media / thinking / refunded / net) rendered on the result and settled card, not only in Account. *(XC-3 / IA-8 / codex#12)*

**P0-9 · The new Otto app is an unlinked island — default routes land on legacy `/studio`** 
`/` and post-login redirect to `/studio` ([page.tsx:8](apps/web/app/page.tsx), [login/page.tsx:22](apps/web/app/login/page.tsx)); grep finds **zero** inbound links to `/otto`, and the legacy `StudioShell` re-exposes its own "Otto" tab ([StudioShell.tsx:28](apps/web/components/studio/StudioShell.tsx)) plus a third Otto at `/m`. The polished Otto surface is reachable only by hand-typing the URL. *Fix:* repoint `/` and post-login to `/otto`; retire/redirect `/studio`, `/m`, `/library`. (Memory: product direction is ONE Otto app, no two doors.) *(IA-1 / codex#26)*

**P0-10 · No self-serve top-up — a real merchant bricks at $0 behind a generic error** 
The only credit a merchant gets is a one-time **$100** grant ([spend.ts:93](packages/core/src/spend.ts)); all other credit-add paths are admin-only ([credit-actions.ts](apps/web/lib/credit-actions.ts), [tenant-actions.ts:63](apps/web/lib/tenant-actions.ts)). The Account screen's only button is "Sign out" ([OttoAccount.tsx:88-94](apps/web/components/otto/OttoAccount.tsx)). At $0, every Otto message fails with the generic *"Couldn't reach Otto — please try again"* (InsufficientCredits is swallowed into a transport error, [otto-actions.ts:444-465](apps/web/lib/otto-actions.ts)). No revenue path, no graceful empty-wallet state. *Fix:* add a top-up/checkout (or beta "request more credits") reachable from the balance card and the out-of-credits error; special-case InsufficientCredits with a top-up prompt. *(XC-1 / BILL-8)*

**P0-11 · A stuck QUEUED job never terminates — credit hold leaks, chat spins forever** `🎥`
Both worker safety nets key on `status: GENERATING` ([gen.ts:172](apps/worker/src/jobs/gen.ts) reaper; the stale-claim path only runs inside `handleGen`). A job that's never claimed (worker down / lost message) stays `QUEUED`, never hits either net, the hold stays open, and the client just stops polling after 2 min ([OttoChatStream.tsx:216-229](apps/web/components/otto/OttoChatStream.tsx)) and spins "Otto is making this…" forever. Consistent with the recording's 7-min no-terminal-state hang. *Fix:* extend the reaper to fail-close + refund + post TURN_ERROR for long-`QUEUED` jobs; add a worker-liveness signal. *(GEN-6)*

---

## P1 — Serious confusion or missing core capability

**Approval & plan card**
- **P1-1 · Two approval surfaces (button vs. chat reply) with no copy explaining a typed "ok go ahead" can spend.** `🎥` A typed go-ahead approves via the SDK interruption ([instructions.ts:57-63](packages/otto/src/instructions.ts)) while the card implies the button is the only way; no visual link between the "go ahead" message and the card it approved. *(APPR-2 / codex#4)*
- **P1-2 · Plan-card prompt is single-line truncated; can't expand, copy, or edit before paying.** `🎥` `whiteSpace:nowrap + ellipsis` ([OttoPlanCard.tsx:100-102](apps/web/components/otto/OttoPlanCard.tsx)); "Change something" just refocuses the composer. *(CARD-1 / codex#29)*
- **P1-3 · No @mention chip/picker, and the streaming path never sends `entityIds`** `🎥` — composer is a bare textarea; `prepareSendMessagesRequest` omits `entityIds` ([OttoChatStream.tsx:105-118](apps/web/components/otto/OttoChatStream.tsx)), so a typed `@sunglass` can never bind to a real entity. *(MENTION-1 / codex#30)*
- **P1-4 · No image upload / attach in the Otto composer** `🎥` — founder explicitly wanted to drop a reference photo; text-only composer ([OttoChatStream.tsx:613-633](apps/web/components/otto/OttoChatStream.tsx)). *(ATTACH-1 / IA-9 — NEW)*
- **P1-5 · In-progress and failed turns have no actions.** `🎥` TURN_ERROR is a dead red bubble (no retry); "making" has no cancel; only the success result has download/copy/edit. *(GEN-7 / codex#31)*

**My Stuff / assets**
- **P1-6 · Production stress-test scripts polluted the founder's real Cast with garbage entities that never clean up.** `🎥` `BruteA*` ([prod-pass3-brute.mjs:24](scripts/prod-pass3-brute.mjs)), `PassOne*` ([prod-pass1-careful.mjs:22](scripts/prod-pass1-careful.mjs)), `SloppyNoRef*` ([prod-pass2-sloppy.mjs:23](scripts/prod-pass2-sloppy.mjs)), `Mira*` ([prod-quality-sampler.mjs:25](scripts/prod-quality-sampler.mjs)) run against the **live site under the founder's session** with "no prod-DB deletes." *Fix:* point QA at an isolated test org; purge the leaked rows. *(STUFF-1 / codex#14)*
- **P1-7 · Cast mixes all entity types with no grouping/search/filter/sort — the real product is unfindable.** `🎥` One flat `entities.map` ([OttoStuff.tsx:104](apps/web/components/otto/OttoStuff.tsx)); the *old* Library already had search + type grouping ([Library.tsx:134-145](apps/web/components/Library.tsx)) — dropped in the Otto redesign. *(STUFF-3 / IA-6 / codex#13+#16)*
- **P1-8 · No rename / delete / edit / hide in My Stuff — though the server actions exist.** `🎥` `EntityTile` is pure display; `softDeleteEntity`/`updateEntity` exist ([actions.ts:283/172](apps/web/lib/actions.ts)) but are wired only into legacy Library. *(STUFF-4 / codex#18)*
- **P1-9 · Ads tab only shows DONE generations — in-progress and failed jobs are invisible.** `🎥` `getMyAds` queries `Generation` rows, which only exist after success ([data.ts:190](apps/web/lib/data.ts)); a failed/slow gen leaves the tab blank. *(STUFF-6 / codex#19)*

**Brand memory**
- **P1-10 · Otto can't read-into-chat, write, edit, or research Brand memory — it has no memory tool.** `🎥` Tools = `[propose, generate, updateBrief, describeRefs, setTitle]` ([otto.ts:24](packages/otto/src/otto.ts)); `updateBrief` writes the *Project Brief*, not the owner-scoped Memory the screen shows. Founder wants Otto to *live* here (chat to research/edit). **Note:** memory **is** read into context every turn ([context.ts:23](packages/otto/src/context.ts), [otto-actions.ts:85](apps/web/lib/otto-actions.ts)) — so codex's "decorative/never-read" framing is wrong; the gap is *conversational authoring + research*, not reading. *(BMEM-1 / codex#20-22, refined)*
- **P1-11 · Compiled brand memory is silently truncated to 3000 chars.** Hard `.slice(0,3000)` after concat ([memory-actions.ts:117-120](apps/web/lib/memory-actions.ts)), ordered by category — so "Voice"/"Rules" drop first, with no warning. "Otto uses it on every campaign" becomes quietly false at scale. *(BMEM-3 — NEW)*
- **P1-12 · "Otto learned this" is unreachable dead code.** UI label exists ([OttoMemory.tsx:128](apps/web/components/otto/OttoMemory.tsx)) but `addMemory`/`updateMemory` hardcode `source:"user"` ([memory-actions.ts:56/75](apps/web/lib/memory-actions.ts)) — nothing ever writes `source:"otto"`. A false capability cue. *(BMEM-2 — NEW)*

**IA / navigation / money display**
- **P1-13 · `/studio` and `/m` remain fully reachable, duplicating Otto/My-stuff/Brand-memory under different names.** Three IA generations run side by side ([studio/page.tsx](apps/web/app/studio/page.tsx), [m/page.tsx](apps/web/app/m/page.tsx)). *(IA-2 / codex#26)*
- **P1-14 · Recent list shows only truncated titles — no processing/needs-approval/failed badge.** `🎥` `ChatThreadDTO`/`getCoworkThreads` carry no status field ([types.ts:76](apps/web/lib/types.ts), [data.ts:218](apps/web/lib/data.ts)). *(IA-3 / codex#27)*
- **P1-15 · Balance is USD in the headline but "credits" in Account — two units, no conversion.** `🎥` `$` headline ([OttoNav.tsx:90](apps/web/components/otto/OttoNav.tsx)) vs "Your credit balance"/"N credits held"/"-N credits" ([OttoAccount.tsx:34/42/80](apps/web/components/otto/OttoAccount.tsx)); 1 displayed credit = $0.10. *(IA-4 / BILL-5 / codex#28)*
- **P1-16 · Displayed balance is a static snapshot the streaming path never revalidates — it silently lies mid-session.** `🎥` Streaming chat doesn't `revalidatePath`; only non-stream `ottoTurn` does ([otto-actions.ts:455](apps/web/lib/otto-actions.ts)); the `onRefresh` prop is "unused here" ([OttoChatStream.tsx:33](apps/web/components/otto/OttoChatStream.tsx)). *(XC-4 — NEW)*
- **P1-17 · "Edit by hand" opens a "coming soon" stub, not the real editor.** [OttoResult.tsx:145](apps/web/components/otto/OttoResult.tsx) → [OttoWorkshop.tsx:46](apps/web/components/otto/OttoWorkshop.tsx) stub; the real `VideoEditor` is reachable only from the orphaned `/studio`. *(IA-5 — NEW)*

**Honesty / deliverable**
- **P1-18 · The "Verdict after a generation finishes" instruction is unreachable — Otto is never re-invoked on completion.** `🎥` The worker writes the GEN_RESULT/TURN_ERROR bubble directly ([gen.ts:117-138](apps/worker/src/jobs/gen.ts)); no path feeds completion back into an agent run, so the verdict prompt ([instructions.ts:65-67](packages/otto/src/instructions.ts)) can never fire. *(HON-3 — NEW)*
- **P1-19 · The "ad-pack" wedge is essentially unbuilt.** CONTEXT.md specs a named, persisted, brand-kit-applied, captioned, multi-aspect-ratio deliverable; what ships is loose DONE generations + a transient variant chooser, and "Copy to post" copies a **raw URL, not caption text** ([OttoResult.tsx:132](apps/web/components/otto/OttoResult.tsx)). *(XC-6 — NEW)*
- **P1-20 · Account ledger mislabels every Otto LLM turn as "Generation."** `reserveCredits` writes no `reason`, so the UI falls back to `KIND_LABEL.RESERVE = "Generation"` ([credits.ts:34](packages/db/src/credits.ts), [account-actions.ts:34/63](apps/web/lib/account-actions.ts)); LLM settles have nonzero `balanceDelta` and leak paired rows the feed assumed wouldn't appear. *(BILL-4 / XC-9 — NEW)*

---

## P2 — Friction / polish that materially hurts

- **P2-1 · "used N times" only counts legacy Studio shot-refs — always "used 0 times" for Otto.** `🎥` `usageCount = _count.shotRefs` ([dto.ts:39](apps/web/lib/dto.ts)); Otto never writes ShotEntityRef. *(STUFF-2 / codex#17)*
- **P2-2 · Empty placeholder cards read as broken assets — no explanation/fix/hide.** `🎥` Silent icon fallback when an entity has no ref ([OttoStuff.tsx:25-30](apps/web/components/otto/OttoStuff.tsx)). *(STUFF-5 / codex#15)*
- **P2-3 · Garbage test entities also leak into Otto's LLM context as suggested @-refs.** `loadAvailableRefsForAgent` loads ALL entities, injected verbatim ([otto-actions.ts:66/86](apps/web/lib/otto-actions.ts)). *(STUFF-7 — NEW)*
- **P2-4 · No mobile/responsive layout — a fixed 240px sidebar eats a phone screen.** [OttoApp.tsx:46](apps/web/components/otto/OttoApp.tsx), [OttoNav.tsx:93](apps/web/components/otto/OttoNav.tsx). Serious for a "social video" SMB product. *(XC-7 — NEW)*
- **P2-5 · Failed/empty campaigns leak permanently into Recent; no delete affordance.** `🎥` Front door persists the thread before the first turn ([OttoFrontDoor.tsx:127](apps/web/components/otto/OttoFrontDoor.tsx)); `coworkDeleteThread` exists ([cowork-actions.ts:624](apps/web/lib/cowork-actions.ts)) but isn't wired into the nav. *(XC-5 — NEW)*
- **P2-6 · No first-run/onboarding — a confident front door over an empty Cast + empty memory.** Empty states describe the feature instead of guiding the first action ([OttoFrontDoor.tsx:204](apps/web/components/otto/OttoFrontDoor.tsx)). *(XC-10 — NEW)*
- **P2-7 · Small-screen editor is read-only via `pointer-events-none` and looks broken.** [VideoEditor.tsx:30-33](apps/web/components/studio/VideoEditor.tsx) — but only reachable from the orphaned `/studio` (see P1-17). *(IA-10 / codex#32)*
- **P2-8 · Brand-memory category chips are manual labels with no guidance/auto-classify/dedupe; "every campaign" overstates an unscoped box.** [OttoMemory.tsx:7/66](apps/web/components/otto/OttoMemory.tsx); `pinned` column is force-set but never used. *(BMEM-5 / codex#23+#24)*
- **P2-9 · No visible link between Brand memory and a chat turn — user can't see which memories Otto used.** Injected as opaque prose with no ids ([otto-actions.ts:85](apps/web/lib/otto-actions.ts)). *(BMEM-4 / codex#25)*
- **P2-10 · No capability-boundary guidance — Otto can't cleanly answer "can you see the logs?" and conflates it with job state.** `🎥` No boundary section in `instructions.ts`. *(HON-6 / codex#10)*

---

## P3 — Minor

- **P3-1 · All asset/ad media render with `alt=""`** ([OttoStuff.tsx:27/53](apps/web/components/otto/OttoStuff.tsx)) — a11y + non-visual review gap. *(STUFF-8 / codex#33)*

---

## Codex cross-check

All 34 codex items verified against current (post-auth-refactor) code. **None stale.** Refinements:
- **codex#1** quantified and split: media quote is *also* 2.5× low (P0-2), separate from LLM metering (P0-1) — both compound.
- **codex#20-22 (brand memory "decorative")**: *refuted in part* — memory **is** read into context every turn ([context.ts:23](packages/otto/src/context.ts)). The real gap is conversational authoring/research (P1-10) + silent truncation (P1-11), not "never read."
- **codex#32 (small-screen editor)**: *mis-scoped for Otto* — it's on `/studio`, which Otto never links to; the Otto-side gap is the stub editor (P1-17).
- **codex#3 "always undo"** is not "inaccurate" — it references a feature that **does not exist** anywhere (P0-4).

New (not in codex): P0-10 (no top-up), P0-11 (QUEUED never reaped), P1-4 (no upload), P1-11/12 (memory truncation / dead "Otto learned this"), P1-16 (stale balance), P1-17 (stub editor), P1-18 (dead verdict), P1-19 (ad-pack unbuilt), P1-20 (ledger mislabel), P2-3/4/5/6 (context leak / mobile / Recent leak / onboarding), and the **founder-only streaming gate** caveat (XC-2).

---

## Suggested fix sequencing (for PR slicing)

1. **Trust copy + price truth (fast, high-impact):** P0-2, P0-3, P0-4, P0-5, P1-15 — make every displayed number equal what's charged; rewrite/remove false guarantees. *(mostly copy + one price-source change)*
2. **The money model decision (needs a call):** P0-1 — free Otto conversation vs. disclose it. Then P0-8 / P1-20 reconciliation.
3. **Generation lifecycle correctness:** P0-6, P0-7, P0-11, P1-5, P1-18 — authoritative card state, job-status in Otto context, QUEUED reaper, retry/cancel.
4. **Make Otto reachable & sellable:** P0-9 (route to /otto), P0-10 (top-up), P1-13 (retire /studio), XC-2 (one chat path).
5. **My Stuff cleanup + management:** P1-6 (purge + isolate QA), P1-7/8/9, P2-1/2/3.
6. **Brand memory as a living surface:** P1-10/11/12, P2-8/9.
7. **Capabilities & polish:** P1-3 (mentions), P1-4 (upload), P1-19 (ad-pack), P2-4 (mobile), P2-5/6, P3-1.

---

## PR roadmap (founder decision: money = display/copy only, never charge logic)

**Hard constraint (founder, 2026-06-26):** PRs may change what money numbers/copy are *shown* and may *add* credit, but must **not** change reserve/settle/charge-amount logic. Items that require a money-logic or pricing/product decision are split out and **gated**, not silently shipped.

### PRs I can ship now (within the constraint)

**PR 1 — Honest money copy + price-truth display** · risk: low · _no charge logic touched_
Covers P0-2, P0-3, P0-4, P0-5, P0-8, P1-15, P1-20, and the *copy* half of P0-1.
**Founder decisions baked in (2026-06-26):** unit = **credits everywhere, no dollar sign** (G2 resolved); Otto conversation **stays normally charged** (G1 resolved) — so copy must be honest that chatting uses a little credit, NOT claim it's free. (1 displayed credit = the `pricedGenCredits` unit; an image = **1 credit**, a realistic video ≈ tens of credits.)
- Card shows the **real** charge **in credits** (drive the displayed quote from the same `pricedGenCredits` value `startGen` reserves — an image shows "1 credit", not "$0.04"; display source swap, amount unchanged).
- Card shows the **two-step** plan + a combined/staged credit price when a video decomposes to keyframe+animate.
- Delete "you can always undo"; rewrite the approve line and front-door footer to be literally true and credit-denominated ("Chatting with Otto uses a little credit · making this costs ~N credits on approval"). Note the front-door footer can no longer say "before anything costs money".
- Rewrite the stall copy ("we've set aside ~N credits; refunded automatically if it fails").
- Render the result/settled-card **actual cost in credits** (the `costUsd` already passed to `OttoResult`, converted to credits), and a small running "thinking" credit indicator so balance movement reconciles (since conversation stays charged).
- **Unify on credits** across nav balance / card / Account (today nav + card show $, Account shows credits → flip nav + card to credits); relabel LLM-turn ledger rows ("Otto thinking") in the **display layer** (`account-actions.ts`), no DB/credits.ts change.
- Files: `OttoNav.tsx`, `OttoPlanCard.tsx`, `OttoResult.tsx`, `OttoFrontDoor.tsx`, `OttoChatStream.tsx`, `OttoConversation.tsx`, `OttoAccount.tsx`, `account-actions.ts`, `propose.helpers.ts` (price *unit/source* only).

**PR 2 — Plan-card state machine + Otto status honesty** · risk: medium · _no charge amounts_
Covers P0-6, P0-7, P1-5, P1-18, P2-10.
- Drive the card from authoritative `GenJob.status` (queued/generating/failed/done) keyed by `cowork:<cardId>`; never revert to a pay button after approval; add a stable failed/stuck state with safe retry/cancel affordances.
- Inject live `GenJob.status/progress/error` into `OttoContext` (or a read-only `checkJob` tool); add honesty + capability-boundary rules to `instructions.ts`; forbid referencing UI Otto can't see.
- Wire (or remove) the dead "verdict on finish" instruction.
- Files: `OttoPlanCard.tsx`, `OttoChatStream.tsx`/`OttoConversation.tsx`, `packages/otto/src/context.ts` + `instructions.ts` + a status tool, `otto-actions.ts` (context build).

**PR 3 — Make Otto the front door + retire the two-door** · risk: medium · _IA/routing_
Covers P0-9, P1-13, P1-17 (point "Edit by hand" at the real editor or hide), and the streaming-gate caveat XC-2 (collapse to one chat path).
- Repoint `/` and post-login to `/otto`; redirect `/studio`, `/m`, `/library`; remove the Studio "Otto" tab; remove the `isFounderAdmin` streaming gate (or bring `OttoConversation` to parity).

**PR 4 — My Stuff cleanup + management** · risk: low-medium · _no money_
Covers P1-7, P1-8, P1-9, P2-1, P2-2, P2-3, P3-1.
- Type grouping + search/sort; per-tile rename/delete/edit wired to existing `updateEntity`/`softDeleteEntity`; surface in-progress/failed in Ads; fix/remove `usageCount`; explicit empty-card state; filter junk from Otto context; alt text.
- (P1-6 *prod-data purge* + isolating QA scripts is a **data op on your real account** → gated, see below.)

**PR 5 — Brand memory as a living surface** · risk: medium · _no money_
Covers P1-10, P1-11, P1-12, P2-8, P2-9.
- Owner-scoped memory tool (add/update/dedupe) + instructions; truncation budget + user-visible warning; remove or implement "Otto learned this"; category guidance; memory↔chat "used these" link. (Research/import-from-URL can be a fast-follow.)

**PR 6 — Composer capabilities** · risk: medium · _no money_
Covers P1-3, P1-4.
- @mention autocomplete → chips → pass resolved `entityIds` through the stream body; image upload/attach (file + paste + drag) threaded into the turn.

**PR 7 — Recent / nav / mobile / first-run polish** · risk: low-medium · _no money_
Covers P1-14, P1-16, P2-4, P2-5, P2-6, P2-7.
- Per-thread status badge (needs a status field in the thread DTO); live balance refresh on the streaming path; responsive shell (drawer nav, mobile composer); Recent delete + don't persist empty threads; first-run onboarding; small-screen editor read-only made legible.

**PR 8 — Ad-pack deliverable** · risk: high (build-forward) · _uses existing media spend path_
Covers P1-19.
- Named, persisted ad-pack (group generations, apply Brand Kit, generate captions, 9:16/1:1/16:9); real "Copy to post" (caption, not URL); share/export.

### Gated — need a decision before code (NOT in the PRs above)

- ~~**G1 · P0-1 charging policy**~~ → **RESOLVED 2026-06-26: conversation stays normally charged.** PR 1 makes the copy honest ("chatting uses a little credit"); no charge-logic change. Front-door footer "before anything costs money" is dropped.
- ~~**G2 · P0-2 pricing intent**~~ → **RESOLVED 2026-06-26: keep the charge, fix the display — show CREDITS everywhere, no dollars.** Card shows the real charge in credits (image = 1 credit); also resolves P1-15/IA-4 (unit = credits, not USD). Display-only.
- **G3 · P0-11 stuck-QUEUED reaper:** the fix refunds a leaked hold + posts a failure — it touches the **refund path** (money-safety). Correct, but gated under your "don't touch charge logic" rule.
- **G4 · P0-10 self-serve top-up:** the *friendly out-of-credits error + "request more credits"* affordance is display-only (can ride in PR 1/3); a real **Stripe/checkout** is a payments+product build → separate decision.
- **G5 · P1-6 prod-data purge:** deleting the `Brute*/Pass*/Sloppy*/Mira*` entities from your live account is a data operation on real data — needs your explicit OK; isolating QA scripts (stop pointing personas at prod under your session) is a code change I can include in PR 4.

**Total: 8 ship-now PRs + 5 gated decisions.**

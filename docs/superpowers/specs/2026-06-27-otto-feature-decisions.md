# Otto feature decisions — founder pass (2026-06-27)

Going through every candidate work item one by one. This pass decides **WHAT goes in the
product** (要 / 不要 / 以后). It does **NOT** decide HOW — "要" means the capability must
exist; whether it is reused-from-existing, optimized, or rebuilt is a SEPARATE later pass,
decided item by item. (Founder principle, item 12.)

Status legend: 要 = include · 不要 = skip · 以后 = later · 已有 = already exists (in product)

## A — Agent & canvas
1. Agent mode (autonomous multi-step agent) — 已有
2. Infinite canvas workspace (node-based) — 要
3. Canvas image generation (image nodes) — 要
4. Image→video "animate" (video nodes) — 要
5. Text / design nodes — 要
6. Multiple agents in one project (parallel) — 要
7. Structured intake / clarifying questions (brand brief) — 要
8. Quick-start fill-in brief template — 要
9. Visible agent status (thinking/searching/generating) — 要
10. Agent starter prompt chips — 要
11. Project auto-create + project-scoped conversations — 要
12. Reference consistency (same model/face across outputs) — 要 (via @reference)

## B — Web research
13. UGC multi-stage pipeline (products×models→stories→social packs) — 要
14. Web research / brand grounding — 要

## C — Per-asset editor
15. Per-asset detail/edit page — 要
16. Crop — 要
17. Aspect-ratio presets — 要
18. Regenerate — 要
19. Animate (from detail page; same capability as #4) — 要
20. Video Extend (+6s/+10s, extend-from-frame) — 要
21. Make Video — 要
22. Upscale — 要
23. Video sound / audio — 要
24. Edit composer with @reference — 要
25. Variant stack per asset — 要
26. Favorite + feedback (thumbs / note) — 要
27. Delete asset — 要
28. Share / copy link — 要

## D — Browse / library
29. Template gallery + template modal (Upload→Generate→Done) — 要
30. Templates with a question step (e.g. object remover) — 要
31. History / library page (search, Full/Compact) — 要
32. Discover feed — 要

## E — Other Grok modules
33. Build module (terminal coding agent) — 不要
34. Chat (separate generic chat) — 不要 (agent + project manage conversations instead)
35. Spicy / 18+ (NSFW toggle) — 不要
36. Post-to-X / one-click publish — 要 (want the publish button/slot, but platform flexible — e.g. Meta/IG, not necessarily X)
37. Settings (response styles, Agent Library, etc.) — 要 (but our own design, not a copy)
38. Tasks / scheduled automations — 要
39. Subscription / billing / usage gating — 要 (money-path stays sacrosanct: in = grantCredits, Stripe is Phase 4)

> ⚠️ FOUNDER NOTE (item 39): several new PRs were merged since my last audit. Before the
> HOW pass (reuse vs optimize vs rebuild) and before any implementation, **re-audit the
> entire current codebase.** (See [[otto-34pr-integration-state]] — PR #47 integration.)
## F — The 4 vectors
40. Ads connector — 要, **multi-platform: Meta + TikTok + Lazada + Shopee**, localized (SEA/Malaysia)
41. Ads data analysis (creative/spend/ROAS/conversion/anomaly/budget recs) — 要 (multi-platform)
42. Brand Brain — 要加强 (strengthen/extend the existing one)
43. Auto-video (agent batch-generates many videos for a campaign at once) — 要

## G — Cross-cutting
44. Model selection — start fixed 1 image + 1 video model (no user picker); architecture
    allows adding 1–2 more later (small curated set, not a big list)
45. Canvas placement — **canvas becomes the home (one door)**, existing tools fold in over time

---

## Summary

**不要 (skip): 3 items** — #33 Build (terminal coding agent), #34 generic Chat (use
agent + project to manage conversations), #35 Spicy/18+ (NSFW).

**已有 (exists): #1** Agent mode.

**要 (include): everything else (41 items)** — with notes:
- #36 publish button: want the slot, platform flexible (Meta/IG, not necessarily X)
- #37 settings: yes, but our own design (not a Grok copy)
- #40 connector: multi-platform — Meta + TikTok + Lazada + Shopee, localized (SEA/Malaysia)
- #41 analytics: multi-platform
- #42 Brand Brain: strengthen the existing one
- #43 auto-video: agent batch-generates campaign videos
- #44 models: 1+1 now, room for 1–2 more later
- #45: canvas = home

**This pass decided WHAT only.** Still open (next rounds, founder-decided, item by item):
1. **Re-audit the current codebase first** — several new PRs merged since the last audit
   (per founder, item 39). [[otto-34pr-integration-state]].
2. **HOW pass** — for each 要 item: reuse existing / optimize existing / rebuild.
3. **Sequencing** — which items group into which PR, and in what order.

---

## Current-state map — re-audit of main @ fba7882 (post 34-PR integration, 2026-06-27)

Audit of the LIVE code (primary repo `/Users/winnin/Desktop/artlio`, not the stale worktree).
This grounds the HOW decision per item. Suggested HOW is the audit's reading of code reality.

### 可直接复用 / reuse-as-is (16)
1 Agent core · 3 image-gen engine · 4 image→video (i2v) · 8 quick-start goal tiles ·
9 agent status stream · 10 starter chips · 11 project/conversation scoping · 18 regenerate ·
19 animate-from-detail (Storyboard) · 21 make-video · 23 video sound · 24 @reference composer ·
25 variant stack · 27 delete · 28 share/copy (public share-link TBD) · 39 money path & billing

### 要优化现有 / needs-optimize (7)
7 intake (brief+goals exist, no structured form) · 12 reference-consistency (@reference, needs
structured descriptions + audit) · 15 per-asset detail page (Assets/Lightbox extendable) ·
17 aspect-ratio presets (buried in model logic) · 31 history/library (Library.tsx adaptable) ·
44 model selection (hardcoded → env-config) · 45 canvas-as-home (FrontDoor is home today)

### 要新建 / needs-rebuild (19) — some have reusable foundations
2 infinite-canvas engine (mock only) · 5 text/design nodes · 6 multi-agent parallel ·
13 UGC pipeline · 14 web-research skill (foundation: brand-research fetcher reusable) ·
16 crop · 20 video extend · 22 upscale · 26 favorite/feedback · 29 templates · 30 template
question-step · 32 discover feed · 36 social-publish connector · 37 settings (partial) ·
38 scheduled tasks · 40 ads connectors (Meta/TikTok/Lazada/Shopee) · 41 ads analytics ·
42 Brand Brain v2 (foundation: Memory/rememberBrandFact reusable) · 43 batch auto-video

> Pleasant surprises: the generation engine, money path, @reference, variants, and most
> single-asset ops are already production-grade and reusable. The big net-new is: the canvas
> engine itself, all connectors/analytics, tasks, templates, discover, and Brand Brain v2.

---

## HOW decisions — founder pass (reuse / optimize / rebuild)

Founder is non-technical → for each item I give a recommendation + plain-language why, founder confirms.

1. Agent core — **优化** (audit said reuse; founder wants to optimize)
2. Infinite canvas engine — **重建** (React Flow; mock is an empty shell)
3. Image-gen engine — **复用**
4. Image→video (i2v) — **复用**
5. Text/design nodes — **重建** (as canvas node type)
6. Multi-agent parallel — **重建** (heavier; sequence after canvas)
7. Structured intake — **优化** (form is UI+brief storage; the "agent asks/uses brief" half can be a skill)
8. Quick-start brief template — **优化**
9. Agent status stream — **复用**
10. Starter chips — **优化**
11. Project auto-create — **复用**
12. Reference consistency / @reference — **优化** (structured descriptions + consistency check + expose to canvas)
13. UGC pipeline — **重建** (new orchestration layer + reuse engine)
14. Web research — **重建** (new `searchWeb` skill + reuse the brand-research fetcher foundation)
15. Per-asset detail page — **优化** (extract cards/lightbox/variant-picker into a detail page)
16. Crop — **重建** (use a ready crop library + small save endpoint)
17. Aspect-ratio presets — **优化** (surface existing video plumbing as a first-class picker + image parity)
18. Regenerate — **复用**
19. Animate from detail (Storyboard) — **复用**
20. Video Extend — **重建** (new fal extend endpoint + UI + worker)
21. Make Video — **复用**
22. Upscale — **重建** (new fal upscale endpoint + UI + worker + cost)
23. Video sound — **复用**
24. Edit composer (@reference) — **优化**
25. Variant stack — **复用**
26. Favorite + feedback — **重建** (small but end-to-end new: schema+API+UI)
27. Delete — **复用**
28. Share / copy link — **优化** (reuse copy + add public share-link)
29. Template gallery + modal — **重建** (borrow core template schema; build UI layer)
30. Template question-step — **重建** (extends #29)
31. History / library page — **优化** (borrow Library UI pattern + new history query/filters)
32. Discover feed — **重建** (low priority; borrow ContentAdmin grid)
(33–35 不要: Build, generic Chat, Spicy/18+ — excluded from HOW pass)
36. Publish button — **重建** (pairs with #40 connectors: OAuth + postToSocial skill)
37. Settings — **重建** (our own design; borrow admin config pattern)
38. Scheduled Tasks — **重建** (borrow pg-boss job foundation; add scheduling + UI)
39. Subscription / billing / money path — **复用** (production-grade, audited — do NOT touch)
40. Ads connectors (Meta/TikTok/Lazada/Shopee) — **重建** (per-platform OAuth+SDK+skill; separate PRs + heavy security testing; money/platform-risk → sequence last)
41. Ads data analysis — **重建** (depends on #40; readAdMetrics skill + metrics cache + recommendation layer)
42. Brand Brain v2 — **重建 v2** (new BrandKit/rules/structured entities; reuse Memory foundation)
43. Batch auto-video — **重建** (new batch orchestration + reuse video engine)
44. Model selection — **优化** (move hardcoded lists to env/runtime-config; validate at spend-time)
45. Canvas-as-home — **优化** (reuse FrontDoor routing/shell; point home at the new canvas)

### HOW summary
- **复用 / reuse (11):** 3, 4, 9, 11, 18, 19, 21, 23, 25, 27, 39
- **优化 / optimize (12):** 1, 7, 8, 10, 12, 15, 17, 24, 28, 31, 44, 45
- **重建 / rebuild (19):** 2, 5, 6, 13, 14, 16, 20, 22, 26, 29, 30, 32, 36, 37, 38, 40, 41, 42, 43

## ⓒ Sequencing — founder-decided order: G1 → G2 → G3 → G4 → G5 → G6

- **G1 · Canvas spine** — 2 canvas engine (rebuild/React Flow) · 5 text nodes (rebuild) ·
  44 model selection (optimize/env) · 45 canvas-as-home (optimize) · wire in reuse 3,4 engine.
- **G2 · Per-asset editor** — 15 detail page · 16 crop · 17 aspect · 20 extend · 22 upscale ·
  24 @composer · 26 favorite · 28 share + reuse 18,19,21,23,25,27.
- **G3 · Smarter agent** — 14 web research · 1 agent core (optimize) · 7,8,9,10 intake/chips/status ·
  12 reference consistency · 42 Brand Brain v2.
- **G4 · Campaign automation** — 13 UGC pipeline · 43 batch auto-video · 6 multi-agent · 11 project (reuse).
- **G5 · Library / templates / settings** — 29,30 templates · 31 history · 32 discover · 37 settings · 38 tasks.
- **G6 · Connectors / publish / analytics (LAST)** — 40 ads connectors (per-platform sub-PRs) ·
  41 analytics · 36 publish. Money/platform-risk → separate PRs + heavy security testing.

Forced by dependencies: G1 first (spine), G6 last (risk). Middle order G2→G3→G4→G5 = founder priority.
Standing constraint: **#39 money path is untouched** across all groups (in = grantCredits, spend gate unchanged).



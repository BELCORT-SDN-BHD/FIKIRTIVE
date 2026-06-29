# Phase 2 — BytePlus (Seedream/Seedance) Generation Migration — Design

**Date:** 2026-06-29
**Status:** design (grounded in real API tests), pending founder review → `writing-plans`
**Decides:** move image+video generation fal → official BytePlus ModelArk, collapse the model lineup, add a 720p/1080p quality picker, and re-cost the per-generation credit charge.

---

## 创始人摘要 (Founder TL;DR)

图/视频生成从 fal 搬到**官方 BytePlus ModelArk**:图 = **Seedream 5.0**(同步出图),视频 = **Seedance 2.0 fast**(提交→轮询,主路径是「先出首帧图 → i2v 动起来」)。**整条链路已用真实 API 实测打通**(出图 16,384 tokens;i2v 5s 720p = 108,900 tokens / 92s / $0.36)。

seam 很干净:新建一个 `BytePlusProvider` 套现有 `GenerationProvider` 接口,`GENERATION_PROVIDER=byteplus` 一个 env 切换,**worker 和钱的路径完全不动**(轮询藏在 provider 里)。用户加个 **720p/1080p** 选择器。每次扣费重算成:**图 1cr · 视频 720p 7cr · 1080p 16cr**(你已确认)。

**这阶段 = 基础设施(provider + 重算 + 选择器 + 切换)。** Otto 的「出帧→动图」视频 skill 是这之上的自然下一步(单独的小 brainstorm)。

---

## 1. What was verified (real API tests, account 3003327224)

All against `https://ark.ap-southeast.bytepluses.com/api/v3`, `Authorization: Bearer <ARK key>` (the stored `BYTEPLUS_API_KEY`, prefix `ark-`, len 46). **Each model must be activated in the Ark Console** (a one-time per-model "开通", separate from buying a token pack — both done by the founder).

**Image — Seedream 5.0 (`seedream-5-0-260128`) — SYNCHRONOUS:**
```
POST /images/generations
{ "model":"seedream-5-0-260128", "prompt":"...", "size":"2048x2048", "response_format":"url" }
→ 200 { "model","created", "data":[{"url","size"}], "usage":{"output_tokens":16384,"total_tokens":16384,"generated_images":1} }
```
- Returns the image URL immediately (no poll). Min size ≈ **1920×1920 (3.69M px)** — smaller → `InvalidParameter`. 2048² = 16,384 tokens.

**Video — Seedance 2.0 fast (`dreamina-seedance-2-0-fast-260128`) — ASYNCHRONOUS (submit → poll):**
```
POST /contents/generations/tasks
  t2v: { "model":..., "content":[{"type":"text","text":"<prompt> --resolution 720p --duration 5 --ratio 16:9"}] }
  i2v: { "model":..., "content":[{"type":"image_url","image_url":{"url":"<first-frame>"}},
                                  {"type":"text","text":"<motion> --resolution 720p --duration 5 --ratio 16:9"}] }
→ 200 { "id":"cgt-…" }
GET /contents/generations/tasks/{id}
→ { "status":"running"→"succeeded", "content":{"video_url":"…mp4 (signed TOS, 24h)"},
    "usage":{"total_tokens":108900}, "resolution","ratio","duration","framespersecond","seed","generate_audio":true }
```
- 5s 720p 24fps = **108,900 tokens** (same for t2v and i2v — token count is resolution×fps×duration, NOT input-dependent). Wall time ≈ **87–92s**. Output is a downloadable mp4 (verified: 1.9–2.6 MB).
- `GET /contents/generations/tasks?page_size=N` lists recent tasks (useful for reconcile).

**Cost basis (fast pack: $33 / 10M tokens = $3.30/M; 90-day expiry, non-refundable, PAYG after exhaustion):**
| Gen | tokens | deduction | USD cost |
|---|---|---|---|
| Image 2048² | 16,384 | 1× | ~$0.05 |
| Video 720p i2v | 108,900 | ×1.0 | **$0.36** |
| Video 720p t2v | 108,900 | ×1.6 | $0.58 |
| Video 1080p i2v *(est 2.25×)* | ~245,000 | ×1.0 | ~$0.81 |
| Video 1080p t2v *(est)* | ~245,000 | ×1.6 | ~$1.29 |

*(Deduction rule: "Without Video Input" t2v ≈ 1.6 units/token; "With Video Input" i2v = 1:1. The primary Otto path is i2v, so real-world cost trends to the cheaper column.)*

---

## 2. Decided

- **Models:** image **Seedream 5.0** (`seedream-5-0-260128`); video **Seedance 2.0 fast** (`dreamina-seedance-2-0-fast-260128`). (Founder activated 4.0/4.5/5.0 + 2.0 full/fast/mini; we *use* 5.0 + 2.0-fast; the others stay available behind the registry for a later tier.)
- **Quality:** user picks **720p (default) / 1080p** — a `resolution` parameter on the same Seedance model (not separate models).
- **Per-generation charge (founder-confirmed):** image **1 cr** · video 720p **7 cr** · 1080p **16 cr**. Flat per (kind, resolution) — predictable to the user, covers the t2v worst case, healthy margin on the i2v primary path (720p 7cr=RM3.50 vs $0.36 cost ≈ 1.9×).
- **Primary video path = i2v** (Seedream first frame → Seedance animate). t2v still supported.
- **Cutover by env** (`GENERATION_PROVIDER=byteplus`); fal stays in the codebase as a selectable fallback (delete later, not this phase).

---

## 3. Architecture

The seam already exists (`packages/generation/src/index.ts`: `GenerationProvider` interface + `MockProvider` + `FalProvider`, chosen by `createGenerationProvider()` on `GENERATION_PROVIDER`; the **worker is the only caller** — `apps/worker/src/jobs/gen.ts`). Generation is already async at the **job** level (`startGen` reserves credits + creates a `QUEUED` GenJob; the worker processes it). So:

**New unit — `BytePlusProvider`** (`packages/generation/src/byteplus.ts`), implements `GenerationProvider`:
- `generate(req): GeneratedImage[]` → Seedream `POST /images/generations` (sync) → download `data[].url` → return bytes. Maps `req.count`/size to the Ark params; enforces the ≥1920² minimum.
- `generateVideo(req): GeneratedVideo` → Seedance: build `content` (i2v if `req.inputImageUrls`/source present, else t2v) with the `--resolution/--duration/--ratio` flags → `POST …/tasks` → **poll `GET …/tasks/{id}` until `succeeded`/`failed`** (bounded, e.g. ≤5 min, 5s interval) → download `content.video_url` → return bytes. **The poll lives entirely inside the provider** — the worker just `await`s `generateVideo`, exactly as with FalProvider.
- **Ark client** (small, in the same file or `byteplus-client.ts`): base URL + `Bearer ARK_API_KEY` (`process.env.BYTEPLUS_API_KEY`); `submitImage`, `submitVideoTask`, `pollVideoTask`, `download(url)`. No SDK — plain fetch.

**Wire-in:** `createGenerationProvider()` gains a `byteplus` branch; `GENERATION_PROVIDER=byteplus` selects it. `MockProvider` unchanged (dev/tests). `FalProvider` unchanged (fallback).

**Money path untouched:** `startGen` (reserve) and the worker's settle/refund are unchanged; only the provider *behind* the existing gate swaps. Reserve == settle still holds (the charge is the deterministic `pricedGenCredits`, see §5).

## 4. Model registry + quality picker

- **Registry** (`apps/web/lib/model-registry.ts` + the typed menu in `packages/core/src/gen.ts`): the user-facing menu collapses to **one image model (Seedream 5.0)** + **one video model (Seedance 2.0 fast)**. Internal id → Ark id mapping lives in the provider. The legacy fal video models stay defined (for the fal fallback) but are not offered in the BytePlus menu.
- **Quality picker:** the composer's video controls expose **720p / 1080p** (default 720p), feeding the existing `resolution` field on the gen request (`startGen` already carries `resolution`). 1080p maps to the higher-token Seedance call. No new request plumbing — `resolution` already flows end-to-end.
- **Audio:** Seedance returns `generate_audio:true` by default. Decide per the open question (§8); default keep-on unless it complicates the editor.

## 5. Re-cost (the credit charge)

Today (`packages/core/src/spend.ts`): image = `count × INTERNAL_PER_DISPLAY` (1 displayed cr/image, flat); video = `displayedFromUsd(genSpentUsd(job)) × INTERNAL_PER_DISPLAY` (USD cost rounded up to $0.10 — at-cost, fal per-second prices in `gen.ts`).

**Change:** video charge becomes a **flat per-resolution map** (matches the founder-confirmed figure, predictable, t2v-safe):
- image: **1 cr** (unchanged: `count × INTERNAL_PER_DISPLAY`)
- video **720p: 7 cr**, **1080p: 16 cr** (= 70 / 160 internal) — driven by `videoOptions.resolution`, not by USD.

`genSpentUsd` (record-only, the true COST for accounting/margin reporting) updates to the **BytePlus token basis** (tokens(resolution) × deduction(t2v|i2v) × $/M) so the ledger's recorded cost reflects reality. The reserve==settle invariant holds because `pricedGenCredits` (the flat map) is deterministic from the frozen job row.

## 6. Cutover + verification
1. Build `BytePlusProvider` (mock-tested for the request shaping + poll loop; real-call-tested in dev with the verified formats).
2. Flip dev `GENERATION_PROVIDER=byteplus` → run a real image + a real i2v video through `startGen` → confirm bytes stored content-addressed + the right credits reserved/settled + the job completes.
3. Prod: set Railway `GENERATION_PROVIDER=byteplus` + `BYTEPLUS_API_KEY` (the `ark-` key) + flip. fal env stays as the rollback.

## 7. Money-safety (unchanged invariants)
- The spend gate (`startGen` reserve), settle/refund, idempotency, and the credit ledger are **not modified** — only the provider behind them + the `pricedGenCredits` numbers.
- A failed/timed-out video task → the worker's existing terminal-failure path refunds the reservation (user not charged). The provider must surface failure as a thrown error (not silent empty bytes).
- Building/generating is metered exactly once (the GenJob is the unit); the poll is internal and idempotent on the task id.

## 8. Open questions / risks
- **Seedream $/M** not yet read from console (image runs PAYG; ~16,384 tokens ≈ $0.05 at the Seedance rate → 1 cr is safe at ≥1.5×). Confirm the console price; if image is unexpectedly >$0.10/img, bump to 2 cr.
- **1080p token count** is an estimate (2.25× of measured 720p). Confirm with one real 1080p gen before locking 16 cr (or accept the estimate — margin headroom covers small error).
- **Worker timeout:** video polls run ~90s (up to a few min). Confirm the worker's per-job timeout tolerates this (it processes one job and awaits; likely fine — verify).
- **Prepaid pack economics:** fast pack = 10M tokens, **90-day expiry, non-refundable**, PAYG after. ~10M / 108,900 ≈ ~90 × 720p i2v clips before PAYG. Watch burn; the spend ledger's recorded USD cost tracks it.
- **t2v ×1.6:** we charge flat per-resolution covering the t2v worst case, so i2v just earns more — no per-request t2v/i2v branching in the charge.
- **Audio default-on:** keep or pass `--audio off`? (editor/export implications.)
- **Otto "frame→i2v" video skill** = the natural follow-on this enables (orchestrate generateImage → animate); **its own brainstorm/spec**, not this phase.

## References
- Seam: `packages/generation/src/index.ts` (GenerationProvider, FalProvider, createGenerationProvider); worker `apps/worker/src/jobs/gen.ts`; entry `apps/web/lib/gen-actions.ts` (startGen).
- Pricing: `packages/core/src/spend.ts` (pricedGenCredits, genSpentUsd), `packages/core/src/gen.ts` (videoPriceUsd, model menu), `apps/web/lib/model-registry.ts`.
- Verified test scripts (this session): `scratchpad/seedance_test.py` (t2v), `seedance_i2v_test.py` (frame→i2v).
- Memory: [[fikirtive-video-provider-migration]], [[fikirtive-credit-economics]], [[fikirtive-pricing-market-benchmark]], [[ask-before-spending-real-money]].

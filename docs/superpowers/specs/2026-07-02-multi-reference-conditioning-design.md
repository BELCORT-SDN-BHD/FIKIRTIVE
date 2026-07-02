# Multi-reference image conditioning (Seedream) — verify-first design

**Date:** 2026-07-02
**Status:** verified → implementing (founder chose "code now, verify at dev-flip")
**Decides:** let a Seedream generation condition on ALL of a job's reference images (product + logo + character together), not just the first.

---

## 创始人摘要 (Founder TL;DR)

现状:worker 已经把每个 @元素的参考图收集成一个 `inputImageUrls[]` 数组(轮询、封顶 10 张、预签名、够不到就拒绝出钱)。**但 provider 只发第 1 张** —— `byteplus.ts` 里 `image: req.inputImageUrls[0]`,注释还写着「多图不支持」。所以多图收集了却只有 1 张真正到模型。

**已核实(verify-first,针对我们用的同一个 endpoint):** Ark Seedream 的 `image` 字段**既能收单个字符串、也能收字符串数组**,支持多参考图。所以修法极小:`image: req.inputImageUrls[0]` → 发整个数组。**只改图片这条路;视频那条路不动**(见下,视频本来就只有一张起始帧,没有多图数组可发)。

**钱是安全的:** 收费是 `count × 每张固定 1cr`,跟输入图片数量无关 → reserve==settle 不变。就算 schema 猜错,Ark 会在扣费前返回 400 → 任务 fail-closed → 退款(pre-charge safe)。

---

## 1. What was verified (verify-first)

The task required confirming — against the **real** BytePlus/Ark ModelArk API, not JS-rendered docs — whether Seedream accepts multiple reference images. Confirmed from sources showing raw request bodies against **our exact endpoint** `https://ark.ap-southeast.bytepluses.com/api/v3` (not fal's schema):

- **Field name = `image`** (the SAME field our code already uses). It accepts **either a single string OR an array of strings** (URLs or base64).
  - Direct JSON example against our endpoint: `"image": ["…seedream4_imagesToimage_1.png", "…_2.png"]`.
  - Official Ark Python SDK: `client.images.generate(model="seedream-4-5-251128", image=[image1, image2], …)`.
- **Max references:** Seedream 5.0 ≈ up to 14. Hard constraint: **inputs + outputs ≤ 15**.
  - Our worker caps at `MAX_CONDITIONING_IMAGES = 10`, and each Ark call emits 1 image → **10 + 1 = 11 ≤ 15, always safe.** No extra capping needed in the provider.
- **NOT `image_urls`.** That is fal's schema (`FalProvider` in `index.ts:236` uses `image_urls`). Ark's field is `image`. One third-party proxy (laozhang) claims `image` is string-only, but that is outvoted by the direct-endpoint JSON example and the official SDK.

Verification method: web search + fetch (the JS-rendered official docs only return a nav shell, as warned). Founder elected **not** to spend on a live paid probe now; the real 2-image call is exercised at the normal dev-flip verify (`GENERATION_PROVIDER=byteplus` → run a real gen), which is money-safe because a wrong schema guess returns a pre-charge 400.

## 2. Scope correction — image path only

The task brief said "map the full array into image **+ video** paths." That framing is off:

- The multi-reference array `inputImageUrls[]` is built by the worker **only for the image path** (`apps/worker/src/jobs/gen.ts:505` → `provider.generate({ inputImageUrls, … })`).
- The **video path** (`gen.ts:497` → `provider.generateVideo`) hands a single `imageUrl: string` (one source frame) plus an optional `tailImageUrl` end frame. `VideoRequest` has **no array**. So `byteplus.ts:62-64` pushing one `image_url` block is **not** a truncation — it is correctly sending the single frame it was given. There is no multi-reference array reaching video to un-truncate, and no upstream source of one.
- Multi-reference *for video* is a real but separate feature, and NOT provider-blocked: our prod video model **Seedance 2.0** (`dreamina-seedance-2-0-fast-260128`) documents **reference-to-video** — up to **9 reference images** (`role: reference_image`) + up to **3 reference clips** (`role: reference_video`), per the same BytePlus ModelArk / fal docs the `2026-07-01-otto-reference-vision-design.md` correction cites. So "product + logo + character together" for video is a **wiring gap** (widen `VideoRequest` to carry an array, emit role-based content blocks, money-safety review), **not** a model gap, and not mere first→last interpolation. It is deliberately deferred here because no multi-ref array reaches the video path upstream yet — it belongs to the creation-experience block F/G scope, on its own verify.

**Decision: change the Seedream image path only. Video path unchanged** — because `VideoRequest` carries no reference array today, not because Seedance can't take one (it can; see above).

## 3. The change

`packages/generation/src/byteplus.ts`, `generate()`:

```diff
- // v1 limitation: only req.inputImageUrls[0] is sent. Ark Seedream i2i accepts a
- // single source image; multi-reference conditioning is not supported in this version.
- ...(conditioned ? { image: req.inputImageUrls[0] } : {}),
+ // Multi-reference conditioning: Ark Seedream's `image` field accepts an array of
+ // source images (verified against ark.ap-southeast; ≤14 refs, inputs+outputs ≤15,
+ // and the worker caps at MAX_CONDITIONING_IMAGES=10 → 10+1 ≤ 15). Send the whole
+ // presigned set. Keep the proven single-string form for exactly one ref (the
+ // live-verified prod shape) — array only when there are 2+.
+ ...(conditioned ? { image: req.inputImageUrls.length === 1 ? req.inputImageUrls[0] : req.inputImageUrls } : {}),
```

**Why keep the 1-ref string form:** the single-image i2i path is live-verified on prod with `image: "<url>"`. `image: ["<url>"]` is the one shape the docs did not explicitly show; the ternary avoids regressing the common single-ref path to fix the rarer multi-ref path. Negligible complexity, strictly safer on a paid call.

No other file changes. The worker already collects, caps, presigns, and refuses-to-spend-on-unreachable (`gen.ts:406-426`).

## 4. Money-safety

- Charge is `count × INTERNAL_PER_DISPLAY` (flat 1 cr/image), **independent of input-image count** → `pricedGenCredits` unchanged → **reserve == settle holds**.
- No change to the spend gate, settle/refund, idempotency, or the ledger. Only the request body shape behind the existing gate changes.
- Fail-safe: a wrong field shape → Ark 400 → `byteplus.ts:33` throws **pre-charge** → worker fail-closed → refund. The user is never charged for a rejected request.
- `genSpentUsd` (record-only COGS) is unaffected by our flat charge; Ark bills per generated image by size, so more *input* refs does not move our per-image charge.
- **Also affects the canvas 4-variant path (#88):** those gens flow through the same worker `provider.generate(inputImageUrls, count=4)`, so post-change each variant conditions on all refs too. Safe: `byteplus.ts` fires **one Ark request per `count`** (`Promise.allSettled` over `req.count`), so count=4 is 4 independent requests of ≤10 refs + 1 output ≤ 15 each — the `10+1 ≤ 15` bound holds per-request; charge stays `count × INTERNAL_PER_DISPLAY`, ref-count-independent.
- Run the **money-safety-review** skill on the final diff.

## 5. Tests

`packages/generation/src/byteplus.test.ts`:
- Existing "passes the input image" test asserts `body.image === "https://r2/src.png"` (1 ref) — **keep** (proves the single-string form is preserved).
- **Add** a multi-ref test: `inputImageUrls: [a, b, c]` → `body.image` deep-equals `[a, b, c]` (array).
- (Optional) assert t2i still omits `image` when `inputImageUrls: []`.

## References
- `packages/generation/src/byteplus.ts` (the change), `packages/generation/src/index.ts:236` (fal's `image_urls`, different provider).
- `apps/worker/src/jobs/gen.ts:406-426` (round-robin cap + presign + refuse-to-spend), `:505` (image dispatch), `:497` (video dispatch — untouched).
- `packages/core/src/refgen.ts:88-120` (`GenerationRequest.inputImageUrls[]`, `VideoRequest.imageUrl`), `:30` (`MAX_CONDITIONING_IMAGES = 10`).
- Prior: `docs/superpowers/specs/2026-06-29-phase2-byteplus-migration-design.md §1` (verified Ark shapes).
- Memory: [[ask-before-spending-real-money]], [[fikirtive-video-provider-migration]], [[fikirtive-credit-economics]].

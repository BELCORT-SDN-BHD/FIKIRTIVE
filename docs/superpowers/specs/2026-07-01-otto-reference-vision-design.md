# Otto reference attachment → vision + i2v decouple (design)

**Date:** 2026-07-01
**Status:** approved-for-planning
**Author:** Claude (brainstorming session)

---

## 一句话 (TL;DR, 给创始人)

让 Otto **真正看懂**你拖进聊天的参考图,并且拖图**不再强制变视频**(要图给图、要视频给视频),
一次性**全量上 prod 给所有用户**。视频当参考(video-to-video)先搁置。

**创始人已拍板的决定:**
1. 参考图方向 = **A**:Otto 看懂图 + 不强制变视频。
2. 节奏 = **不分步,尽快全量**(接受"新版 streaming 聊天只有创始人测过"的风险)。
3. 视频当参考 = **先不做**(等看到用户真实需求;抽帧 vs 整段视频再定)。

**两件上线前不跳过的事**(护"安全"第一优先级,不拖进度):
- 上线前跑 **money-safety-review**(因为改动会影响"扣图片的钱还是视频的钱")。
- 上线前**真机跑一遍 happy path**(别把没跑过的东西推给所有人)。

---

## Problem (verified against code, 2026-07-01)

Today an attached reference is **not** something Otto perceives — it is a **video i2v start-frame and nothing else**:

- The attach UI sends the image as `sourceGenerationId` (only exists in the streaming composer
  `apps/web/components/otto/OttoChatStream.tsx`, ~line 349).
- The **image bytes never reach the planner model**: `runInput` is text-only in both entry paths —
  `apps/web/lib/otto-actions.ts:436` and `apps/web/app/api/otto/stream/route.ts:180` both build
  `{ role: "user", content: text }`.
- The mere **presence** of `sourceGenerationId` **force-flips the plan to `kind = "video"`** and clears
  entity refs — `packages/otto/src/skills/propose.helpers.ts:99-104`. It is a switch, not a perception input.
- A working multimodal pattern already exists but is **dead**: the legacy `coworkTurn`
  (`apps/web/lib/cowork-actions.ts` + `packages/core/src/cowork-planner.ts`) gathers image bytes and
  appends them to the user turn. It is unused in the live Otto path.

Net effect: attaching a reference silently coerces a video i2v the user may not have asked for, and Otto
never sees the pixels — so "make an image in this style" is impossible today.

## Goals

1. **看懂图 (vision):** feed the attached image (and @-mentioned entity base images) to the Otto planner
   as image content parts, so Otto reasons about the actual pixels.
2. **不强制变视频 (decouple):** attaching a reference no longer forces `kind = "video"`. The planner
   decides image vs video from user intent; the reference is used correctly for each.
3. **一个门 (rollout):** remove the founder-only gate so all users get the streaming surface (which carries
   the attach UI) — one chat, everyone.

## Non-goals (explicitly out of scope)

- **Video-as-reference** (dropping a video clip; video-to-video conditioning). Deferred — provider gap
  (neither BytePlus nor FAL supports it) and pending product signal.
- **Image-to-image conditioning for `kind = "image"`.** In this change, an attached image informs Otto's
  *plan/prompt* via vision; it is **not** passed to the image generator as an i2i conditioner. (Follow-up,
  own money-review.)
- **Deleting `OttoConversation`** (the old non-streaming composer). The gate flip makes it unused;
  removing the code is a later cleanup, not this change.
- Per-image `detail` tuning, multi-image beyond a small cap.

---

## Design

### Part 1 — 看懂图: multimodal user turn

**Gather (in `buildOttoContext`, `apps/web/lib/otto-actions.ts` ~119-165):** after the existing
`sourceGenerationId` + @-mention ref resolution, fetch image bytes → base64 data URL, best-effort,
producing `images: { label: string; dataUrl: string }[]` on the context (current turn only).

- Reuse the fetch/encode logic from `refImageDataUrl` (`apps/web/lib/cowork-actions.ts:39-52`).
  **Extract it to a shared util** (it is not currently exported) rather than duplicating.
- **Cap** the number of images (mirror cowork's `vision.maxImages`: source frame + N entity refs).
- **Graceful degrade:** any fetch/encode failure → drop that image, fall back to text-only. Never error the turn.

**Format adapter (the real work — NOT copy-paste):** the legacy cowork format
`{ type: "image_url", image_url: { url } }` (OpenAI chat shape) is **incompatible** with the live
`@openai/agents-core` (v0.11.8) `UserMessageItem` content, which expects `{ type: "input_image", image: string }`
(`protocol.d.ts:42-50`). Write a small adapter mapping data URL → `input_image`.
> Implementation note: confirm the exact text-part discriminator (`input_text` vs `text`) against
> `@openai/agents-core` `protocol.d.ts` before wiring — image part is confirmed `input_image`.

**Insertion (both paths):** replace the text-only user turn at `otto-actions.ts:436/438` and
`stream/route.ts:180/182` with:
```
content = images.length
  ? [{ type: "input_text", text }, ...images.map(i => ({ type: "input_image", image: i.dataUrl }))]
  : text
```
Attach images to the **current turn only**, never to `priorState.history` (avoid ballooning serialized
`ottoState` across turns via `RunState` rehydration).

### Part 2 — 不强制变视频: the decouple + explicit decision rule

Replace the force block (`propose.helpers.ts:93-104`). New rule:

- `kind = input.kind` — **the planner decides** (no forcing by `sourceGenerationId` presence).
  Default to image unless the user's intent asks for video; Otto now *sees* the reference + reads the
  user's text, so it can choose. (Add a short guidance line to the propose skill / system prompt so Otto
  knows an attached reference can be **animated → video** or **taken as inspiration → image**.)
- `const isI2V = kind === "video" && !!ctx.sourceGenerationId;`
- `hasSourceImage = isI2V;` (drives i2v model routing in `suggestModel`, Step 3 — unchanged for the video case)
- **When `isI2V`:** clear `entityIds`/`variantSel` and thread `sourceGenerationId` as the start frame —
  **exactly today's video behavior, preserved.**
- **When `kind === "image"`:** keep entity refs (run the existing Step-2 owned-entity scoping), and do
  **NOT** thread `sourceGenerationId` into the card payload (line 210 becomes conditional on `isI2V`), so
  the image generator never silently receives it. The reference influences the output only through Otto's
  vision-informed prompt.

Result: "要图给图、要视频给视频." No new wire field needed for MVP — `kind` (planner intent) + presence of
`sourceGenerationId` fully disambiguate vision-reference vs i2v-start-frame.

### Part 3 — 一个门: rollout to all users

- Flip the gate at `apps/web/app/otto/page.tsx:71`
  (`const ottoStreamEnabled = isFounderAdmin(email)` → enabled for all users). Everyone renders
  `OttoChatStream` (attach UI + 看懂图). `OttoConversation` becomes unused (left in place; cleanup later).

---

## Money-safety surface (must pass money-safety-review before ship)

- **Pricing functions unchanged.** Cost = `pricedGenCredits({ kind, model, count, videoOptions })`
  (`gen-actions.ts:100-105`); reserve/settle operate on that precomputed value; `sourceGenerationId`
  never enters pricing (only the worker uses it downstream to fetch the source image).
- **reservation == settlement holds by construction:** the card's displayed credits come from the *same*
  `pricedGenCredits(...)` call startGen reserves (`propose.helpers.ts:151-161`), keyed off the resolved
  `kind`. As long as price stays keyed off the resolved `kind`, the invariant is preserved.
- **What changes (the reason a money review is required):** decoupling changes **which tier is selected**
  for an attached-reference request — it can now resolve to `kind = "image"` (`GEN_PRICE_USD_PER_IMAGE ×
  count`) instead of always `kind = "video"` (`videoPriceUsd`). No pricing code is edited, but the charged
  amount for the same user action can change. Re-verify the `count` clamp ordering
  (`propose.helpers.ts:133`) still holds once the entity/variant-clearing block is gone.
- **No `skills/*` fence violation:** all changes are in `propose.helpers.ts` / context / actions, not in a
  spend skill; no new `@fikirtive/generation` or `reserveCredits` import.

---

## Testing / verification

- **Unit (propose.helpers):**
  - planner `kind = "image"` + `sourceGenerationId` present → card stays image, entity refs kept,
    `sourceGenerationId` NOT in payload, price = image tier.
  - planner `kind = "video"` + `sourceGenerationId` present → i2v: entities cleared,
    `hasSourceImage = true`, `sourceGenerationId` in payload, i2v model, price = video tier.
  - reservation == settlement (displayed credits == `pricedGenCredits`) for both.
- **Multimodal:** `runInput` user turn contains an `input_image` part when an image is attached; fetch
  failure degrades to text-only without throwing; image cap enforced; images not persisted to history.
- **money-safety-review** skill run on the diff.
- **Manual smoke (real app, pre-rollout):** attach image + "make an image in this style" → Otto references
  it, outputs an **image**; attach image + "animate this" → **video i2v**. Founder-verified happy path.

## Risks

- **Streaming-to-all is unverified for the general population** (gate labeled "Temporary flag (deleted in
  Task 8 once verified)"). **Founder has explicitly accepted this risk** to ship in one pass. Mitigation:
  real-app smoke test before flipping; the streaming durability surface (createUIMessageStream, RunState
  rehydration) is exercised in the smoke test.
- **i2i deferred:** for image output the reference shapes Otto's prompt, not the generator's pixels. Set
  expectation: "matches the style Otto describes," not "pixel-conditioned." Follow-up if needed.

## Rollback

- Revert the `page.tsx:71` gate flip to re-restrict streaming to founders (instant rollout kill-switch,
  independent of the vision/decouple code).

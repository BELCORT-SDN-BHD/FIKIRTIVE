# Otto video-frame-as-reference (抽帧) — design

**Date:** 2026-07-01
**Status:** approved-for-planning
**Ships on:** the reference-vision branch `claude/unruffled-sammet-316a90` (PR #84) — the completion of "reference attachment"

---

## 一句话 (TL;DR)

让 streaming 聊天框的上传按钮**也能选视频**:选了视频 → 弹一个小"选帧"面板(预览 + 滑块)→ 你拖滑块挑一帧 → 那一帧**在浏览器里**导成一张图,喂进**现有的**图片上传流程,当参考图用。后端/供应商/钱**一律不碰**,只改前端 composer。

**这是"便宜版"video-as-reference**;真·整段 `reference_video`(Seedance 2.0)仍然缓做(碰供应商 + 真人脸限制,见 [reference-vision spec](2026-07-01-otto-reference-vision-design.md) Non-goals)。

---

## Problem

Today the composer attach accepts images only (`accept="image/png,image/jpeg,image/webp"`, `OttoChatStream.tsx:868`). Whole-clip video-as-reference is deferred (provider wiring + the Seedance 2.0 real-human-face restriction). But a **cheap** slice delivers real value now: let a user drop a video, pick a frame, and use that frame as the existing image reference — the frame flows through the exact `sourceGenerationId` path PR #84 already made Otto see and use as an i2v start-frame. No backend, no provider, no new spend surface.

## Goal

Attach a **video** in the streaming composer → pick a frame with a scrubber → that frame becomes the attached image reference (`sourceGenerationId`), identical downstream to attaching an image.

## Non-goals

- **Whole-clip `reference_video`** (Seedance 2.0 motion/camera transfer) — deferred (provider + face-restriction).
- **Server-side frame extraction (ffmpeg).** Extraction is browser-native (`<video>`+`<canvas>`).
- **Widening the image-ext gates.** The uploaded artifact is an IMAGE (the extracted frame); the 4 image-ext validators stay closed to video — correct and unchanged.
- Old `OttoConversation` composer; image-to-image conditioning.

## Design

All changes are in `apps/web/components/otto/OttoChatStream.tsx` (+ small pure helpers extracted for testability).

**1. Widen the file input.** `accept` gains video types: `video/mp4,video/quicktime,video/webm` alongside the existing image types.

**2. Branch on file kind in `handleFilePick`.**
- **Image** (current behavior): unchanged — `uploadFilesDirect` → `finalizeCandidateUploads` → `sourceGenerationId` → `setAttached`.
- **Video:** do NOT upload the video. Open an inline **frame-picker** panel and stop.

**3. Frame-picker panel** (inline, above the composer; replaces the attach chip area while active):
- A hidden/off-DOM `<video>` element with the picked file as an object URL; a visible `<canvas>` preview; an `<input type="range">` scrubber over `[0, duration]`; **Use this frame** / **Cancel** buttons.
- **Default position:** 10% into the clip (`clamp(duration * 0.1, 0, duration)`) — avoids common black first frames.
- On scrub: seek the video to the slider time; on `seeked`, draw the current frame to the canvas (natural resolution, longest side capped at 1600px to bound file size).
- **Use this frame:** `canvas.toBlob('image/jpeg', 0.92)` → a `File` (`frame-<seconds>.jpg`) → the SAME `uploadFilesDirect` + `finalizeCandidateUploads(projectId, "", [], …)` → `sourceGenerationId` → `setAttached({ generationId, src: <canvas dataURL> })`. Panel collapses to the normal attached-thumbnail chip.
- **Cancel:** discard (revoke object URL); back to no attachment.

**4. Downstream: nothing changes.** From `setAttached` onward it is byte-identical to an attached image — the frame is a normal image `Generation`; PR #84's `gatherReferenceImages` feeds it to Otto's vision, and the i2v/decouple logic treats it as any image reference.

### Pure helpers (extracted for unit tests)
- `defaultFrameTime(duration: number): number` — the 10%-clamp rule.
- `frameFileName(seconds: number): string` — `frame-<seconds>.jpg`.
- `isVideoFile(file: {type: string}): boolean` — MIME check driving the branch.
- `ACCEPT_ATTACH` — the accept string constant (asserted to include both image + video types).

## Error handling

- Video fails to load/decode (unsupported codec): `attachError = "读不了这个视频,换 MP4 试试"` (or its English equivalent per existing copy language) and abort — never crash the composer.
- `seek`/draw/`toBlob` failure → `attachError` (existing surface); panel stays open to retry or cancel.
- The extracted frame is just an image, so all existing upload/validation/vision error paths apply unchanged.

## Money safety

**Untouched.** No spend-path symbol is involved — the frame is an image reference (`sourceGenerationId`), and any eventual generation runs through the existing gate. No provider change, no new charge shape. (No money-safety-review needed; this is a client upload-UX change.)

## Testing

- **Unit (pure helpers):** `defaultFrameTime` (10% clamp incl. tiny/zero durations), `frameFileName`, `isVideoFile` (video vs image MIME), `ACCEPT_ATTACH` includes image AND video types.
- **Manual smoke (REQUIRED — extraction is browser-native, not jsdom-testable):** attach an MP4 → picker opens → scrub → Use → frame attaches as thumbnail → send → Otto references it (image path) / can animate it. Try an unsupported file → graceful error. This is the load-bearing verification for this feature.

## Rollback

Client-only; revert the `OttoChatStream.tsx` change. No data/migration/provider impact.

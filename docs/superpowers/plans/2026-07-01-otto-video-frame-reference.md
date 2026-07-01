# Otto video-frame-as-reference (抽帧) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user attach a **video** in the streaming Otto composer, pick a frame with a scrubber, and use that frame as the existing image reference — extraction happens entirely in the browser.

**Architecture:** On video pick, `handleFilePick` opens an inline frame-picker (a hidden `<video>` + a `<canvas>` preview + a range scrubber). The chosen frame is drawn to the canvas, exported via `canvas.toBlob('image/jpeg')` to a `File`, and fed through the SAME `uploadFilesDirect` → `finalizeCandidateUploads` → `sourceGenerationId` path an attached image uses. Nothing downstream changes — the frame is a normal image `Generation`.

**Tech Stack:** React (custom Next.js fork), TypeScript, vitest, the existing `@fikirtive/core` `uploadFilesDirect` / `finalizeCandidateUploads`, `.gb`+shadcn UI (`Button`).

## Global Constraints

- **Client-only. Zero backend / provider / money change.** Do NOT touch `sourceGenerationId` validation gates, the gen provider, `startGen`, or any spend symbol. The extracted frame is an IMAGE and flows through the existing image path unchanged. No `money-safety-review` needed.
- **Do NOT widen the 4 image-ext validators** (`otto-actions.ts`, `stream/route.ts`, `cowork-actions.ts`, worker) — they stay closed to video; only the composer's `accept` attribute and `handleFilePick` change.
- **Extraction is browser-native** (`<video>`+`<canvas>`); it is NOT jsdom-testable. Only the pure helpers get unit tests; the extraction + picker is verified by manual smoke (stated per task).
- **Default frame time = 10% into the clip**, clamped to `[0, duration]`. **Export format = JPEG quality 0.92.** **Cap the frame's longest side at 1600px** (no upscale).
- **Custom Next.js:** `apps/web` is a modified fork — but this task touches only a client component + a pure lib module, no Next APIs.
- **Surface = streaming composer only** (`OttoChatStream.tsx`), matching the reference-vision feature. Not `OttoConversation`.
- **Ships on branch `claude/unruffled-sammet-316a90` (PR #84).**

---

### Task 1: Pure frame helpers + tests

Extract the pure, decision-driving bits into a tested module so the component wiring (Task 2) stays thin and the logic is verified.

**Files:**
- Create: `apps/web/lib/video-frame.ts`
- Test: `apps/web/lib/__tests__/video-frame.test.ts`

**Interfaces:**
- Produces:
  - `ACCEPT_ATTACH: string` — the composer file-input `accept` value (image + video types).
  - `isVideoFile(file: { type: string }): boolean`
  - `defaultFrameTime(duration: number): number` — 10%-into-clip, clamped.
  - `frameFileName(seconds: number): string` — `frame-<seconds>.jpg`.
  - `FRAME_MAX_SIDE: number` (= 1600) and `FRAME_JPEG_QUALITY: number` (= 0.92) — consumed by Task 2's extraction.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/__tests__/video-frame.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ACCEPT_ATTACH,
  isVideoFile,
  defaultFrameTime,
  frameFileName,
  FRAME_MAX_SIDE,
  FRAME_JPEG_QUALITY,
} from "../video-frame.js";

describe("ACCEPT_ATTACH", () => {
  it("allows both image and video types", () => {
    expect(ACCEPT_ATTACH).toContain("image/png");
    expect(ACCEPT_ATTACH).toContain("image/jpeg");
    expect(ACCEPT_ATTACH).toContain("image/webp");
    expect(ACCEPT_ATTACH).toContain("video/mp4");
    expect(ACCEPT_ATTACH).toContain("video/quicktime");
    expect(ACCEPT_ATTACH).toContain("video/webm");
  });
});

describe("isVideoFile", () => {
  it("true for video MIME types", () => {
    expect(isVideoFile({ type: "video/mp4" })).toBe(true);
    expect(isVideoFile({ type: "video/quicktime" })).toBe(true);
  });
  it("false for image MIME types and empty", () => {
    expect(isVideoFile({ type: "image/png" })).toBe(false);
    expect(isVideoFile({ type: "" })).toBe(false);
  });
});

describe("defaultFrameTime", () => {
  it("returns 10% of duration", () => {
    expect(defaultFrameTime(10)).toBeCloseTo(1);
    expect(defaultFrameTime(30)).toBeCloseTo(3);
  });
  it("clamps to [0, duration] and handles tiny/invalid durations", () => {
    expect(defaultFrameTime(0)).toBe(0);
    expect(defaultFrameTime(-5)).toBe(0);
    expect(defaultFrameTime(Number.NaN)).toBe(0);
  });
});

describe("frameFileName", () => {
  it("builds frame-<seconds>.jpg with 2 decimals", () => {
    expect(frameFileName(1.5)).toBe("frame-1.50.jpg");
    expect(frameFileName(0)).toBe("frame-0.00.jpg");
  });
});

describe("frame export constants", () => {
  it("cap 1600 and jpeg quality 0.92", () => {
    expect(FRAME_MAX_SIDE).toBe(1600);
    expect(FRAME_JPEG_QUALITY).toBe(0.92);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web exec vitest run lib/__tests__/video-frame.test.ts`
Expected: FAIL — `Cannot find module '../video-frame.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/video-frame.ts`:

```ts
/** Composer attach: allowed file types. Images (existing) + videos (抽帧, browser-extracted). */
export const ACCEPT_ATTACH =
  "image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm";

/** Longest-side cap (px) for an extracted frame — bounds the exported JPEG size. No upscale. */
export const FRAME_MAX_SIDE = 1600;

/** JPEG quality for the exported frame. */
export const FRAME_JPEG_QUALITY = 0.92;

export function isVideoFile(file: { type: string }): boolean {
  return file.type.startsWith("video/");
}

/** Default scrubber position: 10% into the clip (avoids common black first frames),
 *  clamped to [0, duration]. Invalid/tiny durations → 0. */
export function defaultFrameTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.max(duration * 0.1, 0), duration);
}

/** File name for an extracted frame, e.g. frame-1.50.jpg. */
export function frameFileName(seconds: number): string {
  const s = Number.isFinite(seconds) ? seconds : 0;
  return `frame-${s.toFixed(2)}.jpg`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web exec vitest run lib/__tests__/video-frame.test.ts`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/video-frame.ts apps/web/lib/__tests__/video-frame.test.ts
git commit -m "feat(otto): pure video-frame helpers (accept string, default frame time, filename)"
```

---

### Task 2: Frame-picker UI + wiring in the composer

Widen `accept`, branch `handleFilePick` on video, and add the inline frame-picker (video + canvas + scrubber + Use/Cancel) that extracts the chosen frame into the existing upload path.

**Files:**
- Modify: `apps/web/components/otto/OttoChatStream.tsx` (imports; `accept`; `handleFilePick` ~355-379; new state/refs; new picker JSX in the composer footer area ~864-903)

**Interfaces:**
- Consumes: `ACCEPT_ATTACH`, `isVideoFile`, `defaultFrameTime`, `frameFileName`, `FRAME_MAX_SIDE`, `FRAME_JPEG_QUALITY` from `@/lib/video-frame` (Task 1); the existing `uploadFilesDirect`, `finalizeCandidateUploads`, `projectId`, `setAttached`, `setAttachError`, `setUploading`, `fileInputRef`.

- [ ] **Step 1: Import the helpers**

At the top of `apps/web/components/otto/OttoChatStream.tsx`, add:

```ts
import { ACCEPT_ATTACH, isVideoFile, defaultFrameTime, frameFileName, FRAME_MAX_SIDE, FRAME_JPEG_QUALITY } from "@/lib/video-frame";
```

- [ ] **Step 2: Add picker state + refs**

Near the existing composer state (where `attached` / `uploading` / `attachError` are declared with `useState`), add:

```ts
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [videoPick, setVideoPick] = useState<{ url: string; duration: number } | null>(null);
  const [frameTime, setFrameTime] = useState(0);
```

(`useRef`/`useState` are already imported in this file.)

- [ ] **Step 3: Widen the file input `accept`**

Change the hidden file input (~line 868) from `accept="image/png,image/jpeg,image/webp"` to:

```tsx
            accept={ACCEPT_ATTACH}
```

- [ ] **Step 4: Branch `handleFilePick` on video vs image**

Replace `handleFilePick` (~355-379) with:

```ts
  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so the same file can be picked again if the user re-attaches.
    e.target.value = "";
    if (!file) return;
    setAttachError(null);

    // Video → open the frame picker instead of uploading the clip. A frame is
    // extracted in the browser and uploaded as an image through the same path.
    if (isVideoFile(file)) {
      const url = URL.createObjectURL(file);
      setVideoPick({ url, duration: 0 });
      return;
    }

    // Image → existing behavior.
    setUploading(true);
    try {
      const outcome = await uploadFilesDirect([file], () => {});
      if (outcome.files.length === 0) {
        setAttachError(outcome.failures[0]?.reason ?? "Upload failed.");
        return;
      }
      const res = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if ("error" in res || !res.generationIds?.[0]) {
        setAttachError("error" in res ? res.error : "Could not attach image.");
        return;
      }
      setAttached({ generationId: res.generationIds[0], src: URL.createObjectURL(file) });
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }
```

- [ ] **Step 5: Add the picker handlers**

Add these functions next to `handleFilePick`:

```ts
  // Called once the hidden <video> has its metadata: set duration + seek to the default frame.
  function handleVideoMeta() {
    const v = videoElRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    const t = defaultFrameTime(v.duration);
    setVideoPick((p) => (p ? { ...p, duration: v.duration } : p));
    setFrameTime(t);
    v.currentTime = t;
  }

  // Draw the current video frame into the preview canvas (longest side capped).
  function drawCurrentFrame() {
    const v = videoElRef.current;
    const c = canvasRef.current;
    if (!v || !c || !v.videoWidth) return;
    const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
  }

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const t = Number(e.target.value);
    setFrameTime(t);
    if (videoElRef.current) videoElRef.current.currentTime = t;
  }

  function closeVideoPick() {
    if (videoPick) URL.revokeObjectURL(videoPick.url);
    setVideoPick(null);
    setFrameTime(0);
  }

  async function useSelectedFrame() {
    const c = canvasRef.current;
    if (!c) return;
    setUploading(true);
    try {
      const blob: Blob | null = await new Promise((res) => c.toBlob(res, "image/jpeg", FRAME_JPEG_QUALITY));
      if (!blob) { setAttachError("Couldn't capture that frame — try another moment."); return; }
      const file = new File([blob], frameFileName(frameTime), { type: "image/jpeg" });
      const preview = c.toDataURL("image/jpeg", FRAME_JPEG_QUALITY);
      const outcome = await uploadFilesDirect([file], () => {});
      if (outcome.files.length === 0) {
        setAttachError(outcome.failures[0]?.reason ?? "Upload failed.");
        return;
      }
      const r = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if ("error" in r || !r.generationIds?.[0]) {
        setAttachError("error" in r ? r.error : "Could not attach frame.");
        return;
      }
      setAttached({ generationId: r.generationIds[0], src: preview });
      closeVideoPick();
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }
```

- [ ] **Step 6: Add the picker JSX**

Immediately AFTER the hidden file `<input>` (the block ending ~line 871), add the picker panel. It renders only while `videoPick` is set:

```tsx
          {/* Video frame picker: pick a frame to use as the image reference */}
          {videoPick && (
            <div className="mb-2 rounded-[14px] border border-border bg-muted p-2">
              <video
                ref={videoElRef}
                src={videoPick.url}
                muted
                playsInline
                preload="metadata"
                className="hidden"
                onLoadedMetadata={handleVideoMeta}
                onSeeked={drawCurrentFrame}
                onError={() => { setAttachError("读不了这个视频,换 MP4 试试。"); closeVideoPick(); }}
              />
              <canvas ref={canvasRef} className="mb-2 max-h-40 w-full rounded-[10px] object-contain" />
              {videoPick.duration > 0 && (
                <input
                  type="range"
                  min={0}
                  max={videoPick.duration}
                  step={0.05}
                  value={frameTime}
                  onChange={handleScrub}
                  aria-label="Pick a video frame"
                  className="w-full"
                />
              )}
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={closeVideoPick} disabled={uploading}>Cancel</Button>
                <Button variant="default" size="sm" onClick={useSelectedFrame} disabled={uploading || videoPick.duration === 0}>
                  {uploading ? "Attaching…" : "Use this frame"}
                </Button>
              </div>
            </div>
          )}
```

> `Button` is already imported in this file (used by the Send button). If `variant="ghost"` is not a valid variant in this project's `Button`, use `variant="secondary"` — check the existing `Button` usage/import in the file.

- [ ] **Step 7: Typecheck the changed file**

Run: `pnpm --filter web exec tsc --noEmit 2>&1 | grep -E "OttoChatStream\.tsx|video-frame\.ts"`
Expected: prints nothing (no errors in the changed files; the ~28 pre-existing web errors in other files are unrelated).

- [ ] **Step 8: Manual smoke test (REQUIRED — extraction is browser-native, not jsdom-testable)**

Run the app (`/run` skill or `pnpm --filter web dev`), open the streaming Otto composer, and verify:
1. Click attach → the file picker now offers video files.
2. Pick an MP4 → the frame-picker panel appears; the preview shows a frame ~10% in.
3. Drag the scrubber → the preview updates to that moment.
4. Click **Use this frame** → the panel collapses to the normal attached-thumbnail chip showing that frame.
5. Send a message → Otto references the frame (image path); asking to "animate this" proposes a video (i2v) from the frame.
6. Cancel works; picking an unsupported/corrupt file shows the graceful error, no crash.

Record the outcome (screenshot to `~/Desktop/`). Do not mark done until observed.

- [ ] **Step 9: Commit**

```bash
git add apps/web/components/otto/OttoChatStream.tsx
git commit -m "feat(otto): attach a video → pick a frame (scrubber) → use as image reference (抽帧)"
```

---

## Self-Review (against the spec)

- **Spec coverage:** widen accept → T2 S3; branch handleFilePick → T2 S4; frame-picker (video+canvas+scrubber, default 10%, 1600px cap, JPEG 0.92) → T1 constants + T2 S5/S6; Use→existing upload path → T2 S5; error copy → T2 S6 `onError`; pure helpers tested → T1; manual smoke → T2 S8; money/gates untouched → Global Constraints. All covered.
- **Placeholder scan:** every step has literal code; the one conditional note (Button `ghost`→`secondary` fallback) names the exact check. No TBD/vague items.
- **Type consistency:** helper names/types match between T1 (definitions) and T2 (consumption); `videoPick`/`frameTime`/refs consistent across T2 steps; reuses the existing `attached`/`setAttached` shape (`{ generationId, src }`).

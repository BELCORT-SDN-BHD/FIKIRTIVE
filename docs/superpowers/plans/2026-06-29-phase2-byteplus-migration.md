# Phase 2 — BytePlus Generation Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move image+video generation from fal to official BytePlus ModelArk (Seedream 5.0 sync image + Seedance 2.0 fast async video), add a 720p/1080p picker, and re-cost the credit charge — behind the existing provider seam, money-path untouched.

**Architecture:** A new `BytePlusProvider` implements the existing `GenerationProvider` interface (`packages/generation/src/index.ts`). Image = Seedream sync `POST /images/generations`. Video = Seedance async `POST /contents/generations/tasks` → poll `GET …/tasks/{id}` → download (the poll lives inside the provider; the worker still just `await`s). Selected by `GENERATION_PROVIDER=byteplus`; fal stays as a fallback. The spend gate (`startGen` reserve / worker settle) and ledger are not modified — only the provider behind them + the `pricedGenCredits` numbers.

**Tech Stack:** TypeScript, vitest, plain `fetch` (no SDK), Prisma worker (`apps/worker`), Next.js composer.

**Spec:** `docs/superpowers/specs/2026-06-29-phase2-byteplus-migration-design.md`.

## Global Constraints

- **Verified Ark base URL:** `https://ark.ap-southeast.bytepluses.com/api/v3`. Auth: `Authorization: Bearer ${process.env.BYTEPLUS_API_KEY}` (the `ark-…` key).
- **Model id map (internal → Ark):** image `"seedream"` → `seedream-5-0-260128`; video `"seedance-2-fast"` → `dreamina-seedance-2-0-fast-260128`. Unknown model → throw BEFORE any paid call.
- **Verified image format:** `POST /images/generations` `{model, prompt, size, response_format:"url"}` → `{data:[{url,size}], usage}`. Min size **≥1920×1920**; use `"2048x2048"`. Sync (no poll).
- **Verified video format:** `POST /contents/generations/tasks` `{model, content:[…]}` → `{id}`; poll `GET /contents/generations/tasks/{id}` → `{status:"running"|"succeeded"|"failed", content:{video_url}, usage:{total_tokens}}`. t2v content = `[{type:"text", text:"<prompt> --resolution <r> --duration <s> --ratio <a>"}]`; i2v content = `[{type:"image_url", image_url:{url}}, {type:"text", text:"<prompt> --resolution <r> --duration <s> --ratio <a>"}]`. 5s 720p ≈ 108,900 tokens, ~90s wall.
- **Charge (founder-confirmed):** image **1 cr** (10 internal); video **720p = 7 cr** (70 internal), **1080p = 16 cr** (160 internal). Flat per (kind, resolution). 1 displayed credit = 10 internal (`INTERNAL_PER_DISPLAY`).
- **Money-safety:** a provider failure AFTER the paid call must `throw chargedError(...)` (terminal-fail, never retry-and-re-charge); a failure BEFORE the paid call throws a plain Error (worker may retry). Do NOT touch `startGen`, `reserveCredits`, `settleCredits`, the ledger, or `assertSpendableModel`.
- **Active models:** `activeImageModel()` is already `"seedream"`. The cutover sets `OTTO_DEFAULT_VIDEO_MODEL=seedance-2-fast` so `activeVideoModel()`/`assertSpendableModel` allow it. Don't change the gate logic.
- **Worktree:** `/Users/winnin/Desktop/fikirtive/.claude/worktrees/distracted-maxwell-7d1884` on branch `claude/phase2-byteplus`; verify `git rev-parse --show-toplevel` + branch before committing; NEVER touch `/Users/winnin/Desktop/fikirtive`. Build a changed package before tsc sees it: `pnpm --filter @fikirtive/<pkg> run build`. Tests: `pnpm --filter @fikirtive/generation test`, `pnpm --filter @fikirtive/core test`.

---

## Task 1: Export shared helpers + scaffold the BytePlus provider file

**Files:**
- Modify: `packages/generation/src/index.ts` (export `chargedError`, `extFromUrl`)
- Create: `packages/generation/src/byteplus.ts`
- Test: `packages/generation/src/byteplus.test.ts`

**Interfaces — Produces:** `class BytePlusProvider implements GenerationProvider` (`name`, `generate`, `generateVideo`); `ARK_BASE`, `IMAGE_MODEL_MAP`, `VIDEO_MODEL_MAP` constants.

- [ ] **Step 1: Export the two shared helpers from `index.ts`.** Find `function chargedError(` and `function extFromUrl(` in `packages/generation/src/index.ts` and prefix each with `export ` (they are currently module-private). No other change.
- [ ] **Step 2: Write the failing test** `packages/generation/src/byteplus.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { BytePlusProvider, IMAGE_MODEL_MAP, VIDEO_MODEL_MAP } from "./byteplus.js";

describe("BytePlusProvider — wiring", () => {
  it("maps internal model ids to Ark ids", () => {
    expect(IMAGE_MODEL_MAP["seedream"]).toBe("seedream-5-0-260128");
    expect(VIDEO_MODEL_MAP["seedance-2-fast"]).toBe("dreamina-seedance-2-0-fast-260128");
  });
  it("has a stable provider name", () => {
    expect(new BytePlusProvider("ark-test").name).toBe("byteplus");
  });
});
```

- [ ] **Step 3: Run it — expect FAIL.** `pnpm --filter @fikirtive/generation test byteplus` → FAIL ("Cannot find module ./byteplus.js").
- [ ] **Step 4: Create `packages/generation/src/byteplus.ts`** with the scaffold:

```typescript
import type { GenerationProvider, GenerationRequest, GeneratedImage, VideoRequest, GeneratedVideo } from "@fikirtive/core";
import { chargedError, extFromUrl } from "./index.js";

export const ARK_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
/** internal model id → Ark foundation-model id (verified active on the account). */
export const IMAGE_MODEL_MAP: Record<string, string> = { seedream: "seedream-5-0-260128" };
export const VIDEO_MODEL_MAP: Record<string, string> = { "seedance-2-fast": "dreamina-seedance-2-0-fast-260128" };

export class BytePlusProvider implements GenerationProvider {
  readonly name = "byteplus";
  constructor(private apiKey: string) {}

  private headers() {
    return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" };
  }

  async generate(_req: GenerationRequest): Promise<GeneratedImage[]> {
    throw new Error("not implemented"); // Task 2
  }
  async generateVideo(_req: VideoRequest): Promise<GeneratedVideo> {
    throw new Error("not implemented"); // Task 3
  }
}
```

- [ ] **Step 5: Run it — expect PASS.** `pnpm --filter @fikirtive/generation test byteplus` → PASS.
- [ ] **Step 6: Commit.** `git add packages/generation/src/index.ts packages/generation/src/byteplus.ts packages/generation/src/byteplus.test.ts && git commit -m "feat(gen): scaffold BytePlusProvider + export shared helpers"`

## Task 2: `BytePlusProvider.generate` — Seedream image (sync)

**Files:** Modify `packages/generation/src/byteplus.ts`; `packages/generation/src/byteplus.test.ts`.
**Interfaces — Consumes:** `GenerationRequest { prompt; inputImageUrls: string[]; count; model }`, returns `GeneratedImage[] { bytes; ext }`. **Produces:** the implemented `generate`.

- [ ] **Step 1: Write the failing test** (append to `byteplus.test.ts`) — mock global `fetch`: the Ark POST returns `count` urls; each url download returns bytes.

```typescript
import { vi, afterEach } from "vitest";
afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string, init?: any) => any) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => handler(String(url), init)));
}
const jsonRes = (body: any) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const bytesRes = () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

describe("generate (Seedream image, sync)", () => {
  it("posts the Ark images request and downloads each result", async () => {
    const calls: any[] = [];
    stubFetch((url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/images/generations")) return jsonRes({ data: [{ url: "https://tos/img1.png", size: "2048x2048" }], usage: { total_tokens: 16384 } });
      return bytesRes(); // the result download
    });
    const out = await new BytePlusProvider("ark-test").generate({ prompt: "an apple", inputImageUrls: [], count: 1, model: "seedream" });
    expect(out).toHaveLength(1);
    expect(out[0].ext).toBe("png");
    expect(Array.from(out[0].bytes)).toEqual([1, 2, 3]);
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe("seedream-5-0-260128");
    expect(body.size).toBe("2048x2048");
    expect(body.response_format).toBe("url");
  });
  it("uses ImageToImage (passes the input image) when a source frame is present", async () => {
    let body: any;
    stubFetch((url, init) => {
      if (url.endsWith("/images/generations")) { body = JSON.parse(init.body); return jsonRes({ data: [{ url: "https://tos/x.png" }] }); }
      return bytesRes();
    });
    await new BytePlusProvider("ark-test").generate({ prompt: "edit", inputImageUrls: ["https://r2/src.png"], count: 1, model: "seedream" });
    expect(body.image).toBe("https://r2/src.png");
  });
  it("throws (no spend) for an unknown model", async () => {
    await expect(new BytePlusProvider("ark-test").generate({ prompt: "x", inputImageUrls: [], count: 1, model: "nope" as any }))
      .rejects.toThrow(/no image model/);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL.** `pnpm --filter @fikirtive/generation test byteplus` → FAIL ("not implemented").
- [ ] **Step 3: Implement `generate`** in `byteplus.ts` (replace the stub):

```typescript
async generate(req: GenerationRequest): Promise<GeneratedImage[]> {
  const model = IMAGE_MODEL_MAP[req.model];
  if (!model) throw new Error(`byteplus: no image model mapping for ${req.model}`); // pre-spend
  const conditioned = req.inputImageUrls.length > 0;
  // one request per image (count <= MAX_GEN_COUNT); each is all-or-nothing.
  const results = await Promise.allSettled(
    Array.from({ length: req.count }, async () => {
      const res = await fetch(`${ARK_BASE}/images/generations`, {
        method: "POST", headers: this.headers(),
        body: JSON.stringify({
          model, prompt: req.prompt, size: "2048x2048", response_format: "url",
          ...(conditioned ? { image: req.inputImageUrls[0] } : {}),
        }),
      });
      if (!res.ok) throw new Error(`byteplus image → ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`); // pre-charge
      // res.ok ⇒ billed; a failure past here is a charged failure
      const data = (await res.json()) as { data?: { url: string }[] };
      const url = data.data?.[0]?.url;
      if (!url) throw new Error("byteplus image: no url in response");
      const r = await fetch(url);
      if (!r.ok) throw new Error(`image download → ${r.status}`);
      return { bytes: new Uint8Array(await r.arrayBuffer()), ext: extFromUrl(url) ?? "png" } as GeneratedImage;
    }),
  );
  const ok = results.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (ok.length !== req.count) throw chargedError(`byteplus image: only ${ok.length}/${req.count} usable`);
  return ok;
}
```

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @fikirtive/generation test byteplus` → PASS.
- [ ] **Step 5: Commit.** `git add -A packages/generation/src && git commit -m "feat(gen): BytePlusProvider.generate — Seedream sync image (t2i + i2i)"`

> **Build-time verification (note for the implementer):** the i2i `image` param name is the one unverified bit (t2i + the rest are verified). During Task 6 confirm a real i2i call (`inputImageUrls` set) returns an image; if Ark rejects `image`, check the Seedream ImageToImage param name and adjust this one line.

## Task 3: `BytePlusProvider.generateVideo` — Seedance (async submit→poll→download)

**Files:** Modify `packages/generation/src/byteplus.ts`; `packages/generation/src/byteplus.test.ts`.
**Interfaces — Consumes:** `VideoRequest { prompt; imageUrl; tailImageUrl?; durationSeconds; model; resolution?; aspectRatio?; fps?; audio? }`, returns `GeneratedVideo { bytes; ext }`.

- [ ] **Step 1: Write the failing test** (append):

```typescript
describe("generateVideo (Seedance, async)", () => {
  it("i2v: submits image_url+text content, polls to succeeded, downloads", async () => {
    let submitBody: any; let polls = 0;
    stubFetch((url, init) => {
      if (url.endsWith("/contents/generations/tasks") && init?.method === "POST") {
        submitBody = JSON.parse(init.body); return jsonRes({ id: "cgt-1" });
      }
      if (url.includes("/contents/generations/tasks/cgt-1")) {
        polls++; return jsonRes(polls < 2 ? { status: "running" } : { status: "succeeded", content: { video_url: "https://tos/v.mp4" }, usage: { total_tokens: 108900 } });
      }
      return bytesRes(); // mp4 download
    });
    const out = await new BytePlusProvider("ark-test").generateVideo({ prompt: "roll", imageUrl: "https://r2/frame.png", durationSeconds: 5, model: "seedance-2-fast", resolution: "720p", aspectRatio: "16:9" });
    expect(out.ext).toBe("mp4");
    expect(submitBody.model).toBe("dreamina-seedance-2-0-fast-260128");
    expect(submitBody.content[0]).toEqual({ type: "image_url", image_url: { url: "https://r2/frame.png" } });
    expect(submitBody.content[1].text).toContain("--resolution 720p");
    expect(submitBody.content[1].text).toContain("--duration 5");
    expect(submitBody.content[1].text).toContain("--ratio 16:9");
  });
  it("t2v: text-only content when no source frame", async () => {
    let submitBody: any;
    stubFetch((url, init) => {
      if (url.endsWith("/contents/generations/tasks")) { submitBody = JSON.parse(init.body); return jsonRes({ id: "cgt-2" }); }
      if (url.includes("/tasks/cgt-2")) return jsonRes({ status: "succeeded", content: { video_url: "https://tos/v.mp4" } });
      return bytesRes();
    });
    await new BytePlusProvider("ark-test").generateVideo({ prompt: "a city", imageUrl: "", durationSeconds: 5, model: "seedance-2-fast", resolution: "1080p" });
    expect(submitBody.content).toHaveLength(1);
    expect(submitBody.content[0].type).toBe("text");
  });
  it("a failed task throws chargedError", async () => {
    stubFetch((url) => url.includes("/tasks/") && !url.endsWith("tasks")
      ? jsonRes({ status: "failed", error: { message: "nsfw" } })
      : jsonRes({ id: "cgt-3" }));
    await expect(new BytePlusProvider("ark-test").generateVideo({ prompt: "x", imageUrl: "", durationSeconds: 5, model: "seedance-2-fast" }))
      .rejects.toThrow(/byteplus video.*failed/);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL.**
- [ ] **Step 3: Implement `generateVideo`** (replace the stub):

```typescript
async generateVideo(req: VideoRequest): Promise<GeneratedVideo> {
  const model = VIDEO_MODEL_MAP[req.model];
  if (!model) throw new Error(`byteplus: no video model mapping for ${req.model}`); // pre-spend
  const i2v = req.imageUrl.length > 0;
  // Seedance encodes controls as text flags appended to the prompt.
  const flags = [`--resolution ${req.resolution ?? "720p"}`, `--duration ${req.durationSeconds}`]
    .concat(req.aspectRatio ? [`--ratio ${req.aspectRatio}`] : []).join(" ");
  const content: unknown[] = [];
  if (i2v) content.push({ type: "image_url", image_url: { url: req.imageUrl } });
  content.push({ type: "text", text: `${req.prompt} ${flags}`.trim() });

  const sub = await fetch(`${ARK_BASE}/contents/generations/tasks`, {
    method: "POST", headers: this.headers(), body: JSON.stringify({ model, content }),
  });
  if (!sub.ok) throw new Error(`byteplus video submit → ${sub.status}: ${(await sub.text().catch(() => "")).slice(0, 300)}`); // pre-charge
  const taskId = ((await sub.json()) as { id?: string }).id;
  if (!taskId) throw new Error("byteplus video: submit returned no task id");
  // task created ⇒ billed on success. Poll inside the provider (the worker just awaits).
  const startedAt = Date.now();
  const TIMEOUT_MS = 5 * 60_000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, 5_000));
    const st = await fetch(`${ARK_BASE}/contents/generations/tasks/${taskId}`, { headers: this.headers() });
    if (!st.ok) { if (Date.now() - startedAt > TIMEOUT_MS) throw chargedError(`byteplus video: poll ${st.status} after timeout`); continue; }
    const t = (await st.json()) as { status?: string; content?: { video_url?: string } };
    if (t.status === "succeeded") {
      const url = t.content?.video_url;
      if (!url) throw chargedError("byteplus video: succeeded but no video_url");
      const r = await fetch(url);
      if (!r.ok) throw chargedError(`byteplus video download → ${r.status}`);
      return { bytes: new Uint8Array(await r.arrayBuffer()), ext: extFromUrl(url) ?? "mp4" };
    }
    if (t.status === "failed" || t.status === "cancelled" || t.status === "canceled")
      throw chargedError(`byteplus video task ${t.status}`);
    if (Date.now() - startedAt > TIMEOUT_MS) throw chargedError("byteplus video: timed out");
  }
}
```

- [ ] **Step 4: Run it — expect PASS.** (Tests stub `fetch`; the 5s poll sleep runs against the mock so it resolves immediately on the second poll — keep the test's mock returning `succeeded` on poll #2 so the loop exits fast. If the real `setTimeout` makes the test slow, wrap the delay in a small `private sleep()` and the test can leave it; 5s × 1 is acceptable, or use `vi.useFakeTimers()`.)
- [ ] **Step 5: Commit.** `git add -A packages/generation/src && git commit -m "feat(gen): BytePlusProvider.generateVideo — Seedance submit/poll/download (i2v+t2v)"`

## Task 4: Wire BytePlus into the provider factory

**Files:** Modify `packages/generation/src/index.ts` (`createGenerationProvider`); `packages/generation/src/index.test.ts` (or a new `factory.test.ts`).
**Interfaces — Consumes:** `BytePlusProvider` from `./byteplus.js`.

- [ ] **Step 1: Write the failing test** — `GENERATION_PROVIDER=byteplus` + `BYTEPLUS_API_KEY` → a `BytePlusProvider`; missing key → throws; unset → MockProvider.

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { createGenerationProvider } from "./index.js";
afterEach(() => { delete process.env.GENERATION_PROVIDER; delete process.env.BYTEPLUS_API_KEY; });

it("GENERATION_PROVIDER=byteplus → BytePlusProvider", () => {
  process.env.GENERATION_PROVIDER = "byteplus"; process.env.BYTEPLUS_API_KEY = "ark-x";
  expect(createGenerationProvider().name).toBe("byteplus");
});
it("byteplus without a key throws", () => {
  process.env.GENERATION_PROVIDER = "byteplus"; delete process.env.BYTEPLUS_API_KEY;
  expect(() => createGenerationProvider()).toThrow(/BYTEPLUS_API_KEY/);
});
it("unset → mock", () => { expect(createGenerationProvider().name).toBe("mock"); });
```

- [ ] **Step 2: Run it — expect FAIL.**
- [ ] **Step 3: Implement** — in `createGenerationProvider()` add the branch BEFORE the mock fallback, and `import { BytePlusProvider } from "./byteplus.js";` at the top of `index.ts`:

```typescript
if (process.env.GENERATION_PROVIDER === "byteplus") {
  const key = process.env.BYTEPLUS_API_KEY;
  if (!key) throw new Error("GENERATION_PROVIDER=byteplus but BYTEPLUS_API_KEY is not set");
  return new BytePlusProvider(key);
}
```

- [ ] **Step 4: Run it — expect PASS.** Then `pnpm --filter @fikirtive/generation run build` (so dist is current for the worker).
- [ ] **Step 5: Commit.** `git add -A packages/generation/src && git commit -m "feat(gen): select BytePlusProvider via GENERATION_PROVIDER=byteplus"`

## Task 5: Re-cost — flat per-resolution video charge

**Files:** Modify `packages/core/src/spend.ts:76-79` (`pricedGenCredits`); `packages/core/src/spend.test.ts`.
**Interfaces — Produces:** `pricedGenCredits` charges video by resolution (720p→70, 1080p→160 internal), image unchanged (1 displayed cr/image).

- [ ] **Step 1: Write the failing test** (add to `spend.test.ts`):

```typescript
it("video charge is flat per resolution: 720p=7cr, 1080p=16cr (internal ×10)", () => {
  const v = (resolution: string) => pricedGenCredits({ kind: "VIDEO", model: "seedance-2-fast", count: 1, videoOptions: { seconds: 5, resolution, audio: true } });
  expect(v("720p")).toBe(70);   // 7 displayed credits
  expect(v("1080p")).toBe(160); // 16 displayed credits
});
it("image charge stays 1 displayed credit per image", () => {
  expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null })).toBe(10);
  expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 3, videoOptions: null })).toBe(30);
});
```

- [ ] **Step 2: Run it — expect FAIL** (current video = displayedFromUsd(genSpentUsd)).
- [ ] **Step 3: Implement** — replace `pricedGenCredits` in `spend.ts`:

```typescript
/** Flat per-resolution video charge (BytePlus Seedance 2.0 fast; covers the t2v
 *  worst case, healthy margin on the i2v primary path). 1080p (and anything not
 *  720p) → 16 cr; 720p → 7 cr. Image = 1 displayed credit per image. */
const VIDEO_CREDITS_BY_RESOLUTION: Record<string, number> = { "720p": 7, "1080p": 16 };
export function pricedGenCredits(job: GenSpendInput): number {
  if (job.kind === "VIDEO") {
    const r = job.videoOptions?.resolution ?? "720p";
    const displayed = VIDEO_CREDITS_BY_RESOLUTION[r] ?? 16; // unknown/higher res → the 1080p price (never under-charge)
    return displayed * INTERNAL_PER_DISPLAY;
  }
  return job.count * INTERNAL_PER_DISPLAY; // 1 displayed credit per image
}
```

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @fikirtive/core test spend` → PASS. (Note: `genSpentUsd` — the record-only USD cost — is left as-is this task; it still reports the fal-based number. Updating it to the BytePlus token basis is recorded as a follow-up in the final review, not money-critical since it never gates spend.)
- [ ] **Step 5: Commit.** `git add packages/core/src/spend.ts packages/core/src/spend.test.ts && git commit -m "feat(money): flat per-resolution video charge (720p 7cr / 1080p 16cr)"`

## Task 6: Quality picker (720p/1080p) in the composer

**Files:** Modify the video composer control component (find via `grep -rln "resolution" apps/web/components | grep -i gen`); the value flows through the existing `startGen` `resolution` field.
**Interfaces — Consumes:** the existing `resolution` request field (already plumbed end-to-end).

- [ ] **Step 1: Locate the control.** `grep -rn "resolution" apps/web/components/studio apps/web/components/canvas apps/web/components/otto 2>/dev/null | head`. Identify where video options are chosen (the GenSpace/composer video controls).
- [ ] **Step 2: Add a 720p/1080p selector** bound to the request's `resolution` (default `"720p"`). Match the surrounding control style (the existing aspect/duration controls). Show the credit cost beside each (`720p · 7 credits`, `1080p · 16 credits`) using the same credit-display the composer already uses. Keep it to the two options the active model supports.
- [ ] **Step 3: Manually verify in dev** (covered by Task 7's runtime check): the picker sets `resolution` on the gen request; default is 720p.
- [ ] **Step 4: Commit.** `git add -A apps/web/components && git commit -m "feat(gen): 720p/1080p video quality picker in the composer"`

## Task 7: Cutover + real-API verification

(Operator/integration — flips the provider in dev and proves it end-to-end against the real account; the `BYTEPLUS_API_KEY` lives in the MAIN checkout `apps/web/.env.local`.)

- [ ] **Step 1: Set dev env** — add to the worktree's `apps/web/.env.local` (copy from MAIN if absent): `GENERATION_PROVIDER=byteplus`, `OTTO_DEFAULT_VIDEO_MODEL=seedance-2-fast`, `BYTEPLUS_API_KEY=<the ark- key>`. The worker reads the same env.
- [ ] **Step 2: Real image** — run a real `startGen` image (model `seedream`) through the dev app/worker; confirm the bytes are stored content-addressed and the credit reserved/settled = 1 cr. Confirm a real **i2i** (with `sourceGenerationId`) returns an image (this verifies the Task-2 `image` param; fix that one line if Ark rejects it).
- [ ] **Step 3: Real video** — run a real i2v (`seedance-2-fast`, 720p) and a 1080p; confirm: the job completes (~90s), the mp4 is stored, credits settled = 7 cr (720p) / 16 cr (1080p). **Confirm the 1080p token count** from the task `usage` (lock or adjust the 16 cr if the 2.25× estimate is off).
- [ ] **Step 4: Worker timeout** — confirm the worker tolerates a ~90s `generateVideo` await (no premature job timeout). If the worker has a shorter per-job timeout, raise it for video jobs (note the exact config in the PR).
- [ ] **Step 5: Record** the verification (image, i2i, 720p, 1080p, token counts, timings) in the PR description. No commit.

---

## Self-Review (against the spec)

**Spec coverage:** §3 BytePlusProvider (image sync) → Task 2; (video async-poll) → Task 3; factory/env switch → Task 4. §4 quality picker → Task 6; registry collapse → the active-model gate already enforces seedream + seedance-2-fast (Task 7 env), no menu rewrite needed (fal models stay defined for the fallback per spec §2). §5 re-cost (flat per-resolution) → Task 5. §6 cutover + verification (incl. 1080p token confirm) → Task 7. §7 money-safety → pre/post-charge error discipline in Tasks 2-3 (chargedError), gate untouched. §8 open items: Seedream $/M + 1080p tokens → Task 7 Step 3; i2i param → Task 2 note + Task 7 Step 2; audio default-on left as-is (no task changes it).

**Placeholder scan:** the two non-code tasks (6 locate-the-control, 7 operator verify) carry exact env values + commands; the i2i `image` param + 1080p credits are flagged as build-time confirmations with the exact line/number to adjust, not vague TODOs.

**Type consistency:** `BytePlusProvider`, `IMAGE_MODEL_MAP`/`VIDEO_MODEL_MAP`, `ARK_BASE` (Task 1) are used verbatim in Tasks 2-4. `pricedGenCredits`'s `GenSpendInput` shape (kind/model/count/videoOptions{seconds,resolution,audio}) matches the existing signature in `spend.ts`. `chargedError`/`extFromUrl` exported in Task 1 are imported in Tasks 2-3.

**Note:** `genSpentUsd` (record-only USD cost) still reports the fal number after this plan — a non-money-critical follow-up to repoint at the BytePlus token basis (flagged in Task 5). The Otto "frame→i2v" video skill is a separate follow-on (spec §8), not in this plan.

# Otto reference attachment → vision + i2v decouple — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Otto actually *see* an attached reference image and stop force-coercing a reference into a video, then roll the streaming chat out to all users — in one branch/PR.

**Architecture:** The dropped reference (`sourceGenerationId`, already server-validated) is resolved to a bounded base64 data URL in `buildOttoContext` and appended as an `input_image` content part to the **current** Otto user turn (both the non-streaming action and the streaming route). Historical image parts are stripped on rehydration so `ottoState` never accumulates image bytes. Separately, the propose helper stops keying `kind` off the mere presence of a reference: the planner decides image-vs-video from user intent; a reference becomes an i2v start-frame **only** when the plan is a video. A one-line flag flip makes the streaming surface available to all users.

**Tech Stack:** TypeScript, `@openai/agents-core@0.11.8` (agent runtime; content parts are `{type:"input_text"|"input_image"}`), Prisma, vitest, Next.js (custom fork), pnpm workspaces (`@fikirtive/otto`, `@fikirtive/core`, `apps/web`).

## Global Constraints

- **Money path is not edited.** No changes to pricing functions (`pricedGenCredits`, `videoPriceUsd`, `GEN_PRICE_USD_PER_IMAGE`), `startGen`, reserve/settle, or dedup. Price stays keyed off the *resolved* `kind`, so reservation==settlement holds by construction (`propose.helpers.ts` Step 4/4.5). **Run the `money-safety-review` skill on the `propose.helpers.ts` diff before ship** (Task 4) — decoupling changes *which tier* is selected for an attached-reference request, even though no pricing code changes.
- **Custom Next.js:** `apps/web` is a modified Next.js fork — per `apps/web/AGENTS.md`, read the relevant guide in `node_modules/next/dist/docs/` before writing any Next-API code. Only Task 6 (the `page.tsx` gate flip) touches a Next surface, and it is a value change to an existing variable — no new Next APIs.
- **Vision is bounded + best-effort:** reuse `resolveVisionConfig()` (`{ enabled, maxImages, maxBytes }`). Any miss / oversize / read error → return no image and fall back to text-only. **Never throw the turn** (mirror `refImageDataUrl`).
- **Current turn only:** image bytes attach to the current user turn; rehydrated history is stripped of `input_image` parts so persisted `ottoState` cannot balloon across turns.
- **Content-part shape is the agents-SDK shape** `{type:"input_image", image: <dataUrl>}` — NOT the legacy cowork/OpenAI `{type:"image_url", image_url:{url}}` shape (the SDK silently ignores the wrong shape).
- **Scope:** only the *dropped* reference (`sourceGenerationId`) is fed to vision. @-mention entity base images, image-to-image conditioning for `kind:"image"`, video-as-reference, and deleting `OttoConversation` are all out of scope (see spec Non-goals).

---

### Task 1: Pure run-input helpers + `OttoContext.images` field

Build the two pure functions that assemble a multimodal user turn and strip image bytes from history, plus the context field that carries gathered images. Pure (no DB/SDK-run), unit-tested in the `@fikirtive/otto` vitest.

**Files:**
- Modify: `packages/otto/src/context.ts` (add `images?` to `OttoContext`, after the `sourceGenerationId` field ~line 33)
- Create: `packages/otto/src/run-input.ts`
- Create: `packages/otto/src/run-input.test.ts`
- Modify: `packages/otto/src/index.ts` (export the helpers + `RefImage` type)

**Interfaces:**
- Produces:
  - `type RefImage = { label: string; dataUrl: string }`
  - `buildUserTurn(text: string, images?: RefImage[]): AgentInputItem`
  - `stripHistoryImages(history: AgentInputItem[]): AgentInputItem[]`
  - `OttoContext.images?: RefImage[]`

- [ ] **Step 1: Add the `images` field to `OttoContext`**

In `packages/otto/src/context.ts`, immediately after the `sourceGenerationId` field (the block ending `sourceGenerationId?: string | null;` ~line 33), add:

```ts
  /** Reference images shown to Otto THIS turn (the dropped reference → vision). Bounded +
   *  best-effort (gathered by the web caller). Appended as input_image parts to the CURRENT
   *  user turn only; never persisted into RunState history (stripHistoryImages drops them). */
  images?: { label: string; dataUrl: string }[];
```

- [ ] **Step 2: Write the failing tests**

Create `packages/otto/src/run-input.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildUserTurn, stripHistoryImages, type RefImage } from "./run-input.js";
import type { AgentInputItem } from "@openai/agents";

describe("buildUserTurn", () => {
  it("no images → plain string content", () => {
    const turn = buildUserTurn("hello") as { role: string; content: unknown };
    expect(turn.role).toBe("user");
    expect(turn.content).toBe("hello");
  });

  it("empty images array → plain string content", () => {
    const turn = buildUserTurn("hi", []) as { content: unknown };
    expect(turn.content).toBe("hi");
  });

  it("with images → [input_text, input_image...] using the agents-SDK shape", () => {
    const images: RefImage[] = [{ label: "reference", dataUrl: "data:image/png;base64,AAAA" }];
    const turn = buildUserTurn("make this pop", images) as {
      role: string;
      content: Array<{ type: string; text?: string; image?: string }>;
    };
    expect(turn.role).toBe("user");
    expect(Array.isArray(turn.content)).toBe(true);
    expect(turn.content[0]).toEqual({ type: "input_text", text: "make this pop" });
    expect(turn.content[1]).toEqual({ type: "input_image", image: "data:image/png;base64,AAAA" });
  });
});

describe("stripHistoryImages", () => {
  it("drops input_image parts from a user turn and collapses a lone input_text to a string", () => {
    const history = [
      { role: "user", content: [
        { type: "input_text", text: "earlier turn" },
        { type: "input_image", image: "data:image/png;base64,BIG" },
      ] },
    ] as unknown as AgentInputItem[];
    const out = stripHistoryImages(history) as unknown as Array<{ content: unknown }>;
    expect(out[0]!.content).toBe("earlier turn");
  });

  it("leaves string-content user turns untouched", () => {
    const history = [{ role: "user", content: "plain" }] as unknown as AgentInputItem[];
    const out = stripHistoryImages(history) as unknown as Array<{ content: unknown }>;
    expect(out[0]!.content).toBe("plain");
  });

  it("leaves non-user items untouched", () => {
    const history = [{ role: "assistant", content: [{ type: "output_text", text: "ok" }] }] as unknown as AgentInputItem[];
    const out = stripHistoryImages(history) as unknown as Array<{ role: string; content: unknown }>;
    expect(out[0]!.role).toBe("assistant");
    expect(Array.isArray(out[0]!.content)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/run-input.test.ts`
Expected: FAIL — `Cannot find module './run-input.js'`.

- [ ] **Step 4: Write the implementation**

Create `packages/otto/src/run-input.ts`:

```ts
import type { AgentInputItem } from "@openai/agents";

export type RefImage = { label: string; dataUrl: string };

/**
 * Build the current user turn for an Otto run. Text-only (plain string content) when there
 * are no images; otherwise a multimodal content array of one input_text part plus one
 * input_image part per image. Uses the @openai/agents content-part shape
 * ({ type: "input_image", image }) — NOT the OpenAI chat-completions { image_url:{url} } shape.
 */
export function buildUserTurn(text: string, images?: RefImage[]): AgentInputItem {
  if (!images || images.length === 0) {
    return { role: "user", content: text } as AgentInputItem;
  }
  return {
    role: "user",
    content: [
      { type: "input_text", text },
      ...images.map((img) => ({ type: "input_image", image: img.dataUrl })),
    ],
  } as AgentInputItem;
}

/**
 * Strip input_image parts from rehydrated history so image bytes never accumulate in the
 * persisted ottoState across turns. A historical user turn that carried images keeps its
 * text (Otto already saw the image on the turn it was sent). A user turn left with a single
 * input_text part is collapsed back to a plain string to match the fresh-turn shape.
 */
export function stripHistoryImages(history: AgentInputItem[]): AgentInputItem[] {
  return history.map((item) => {
    const it = item as { role?: string; content?: unknown };
    if (it.role !== "user" || !Array.isArray(it.content)) return item;
    const kept = (it.content as Array<{ type?: string; text?: string }>).filter(
      (p) => p?.type !== "input_image",
    );
    if (kept.length === 1 && kept[0]?.type === "input_text") {
      return { ...it, content: kept[0]!.text ?? "" } as AgentInputItem;
    }
    return { ...it, content: kept } as AgentInputItem;
  });
}
```

- [ ] **Step 5: Export from the package index**

In `packages/otto/src/index.ts`, after the `export type { OttoContext } from "./context.js";` line (line 8), add:

```ts
export { buildUserTurn, stripHistoryImages } from "./run-input.js";
export type { RefImage } from "./run-input.js";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/run-input.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Typecheck the package**

Run: `pnpm --filter @fikirtive/otto exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/otto/src/context.ts packages/otto/src/run-input.ts packages/otto/src/run-input.test.ts packages/otto/src/index.ts
git commit -m "feat(otto): pure multimodal run-input helpers + OttoContext.images"
```

---

### Task 2: Gather the dropped reference image (web, DB + storage, best-effort)

Resolve the validated `sourceGenerationId` to a bounded base64 data URL and hang it on `ctx.images` inside `buildOttoContext`, so both entry paths pick it up for free.

**Files:**
- Create: `apps/web/lib/otto-ref-images.ts`
- Create: `apps/web/lib/__tests__/otto-ref-images.test.ts`
- Modify: `apps/web/lib/otto-actions.ts` (`buildOttoContext`, ~132-164)

**Interfaces:**
- Consumes: `RefImage` from `@fikirtive/otto` (Task 1); `resolveVisionConfig()` from `./runtime-config`; `storage`, `mimeOf` from `./storage`; `storageKey` from `@fikirtive/core`; `prisma` from `@fikirtive/db`.
- Produces: `gatherReferenceImages(ownerId: string, projectId: string, sourceGenerationId: string | null | undefined): Promise<RefImage[]>`; sets `ctx.images` in `buildOttoContext`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/__tests__/otto-ref-images.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@fikirtive/db", () => ({ prisma: { generation: { findFirst: vi.fn() } } }));
vi.mock("../storage", () => ({
  storage: { get: vi.fn() },
  mimeOf: (ext: string) => (ext === "png" ? "image/png" : "image/jpeg"),
}));
vi.mock("@fikirtive/core", () => ({ storageKey: () => "k/e/y" }));
vi.mock("../runtime-config", () => ({ resolveVisionConfig: vi.fn() }));

import { gatherReferenceImages } from "../otto-ref-images.js";
import { prisma } from "@fikirtive/db";
import { storage } from "../storage";
import { resolveVisionConfig } from "../runtime-config";

const genFindFirst = prisma.generation.findFirst as ReturnType<typeof vi.fn>;
const storageGet = storage.get as ReturnType<typeof vi.fn>;
const visionCfg = resolveVisionConfig as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  visionCfg.mockResolvedValue({ enabled: true, policy: "C", maxImages: 3, maxBytes: 5_000_000 });
});

describe("gatherReferenceImages", () => {
  it("returns [] when no sourceGenerationId", async () => {
    expect(await gatherReferenceImages("o", "p", null)).toEqual([]);
    expect(genFindFirst).not.toHaveBeenCalled();
  });

  it("returns [] when vision disabled", async () => {
    visionCfg.mockResolvedValue({ enabled: false, policy: "C", maxImages: 3, maxBytes: 5_000_000 });
    expect(await gatherReferenceImages("o", "p", "gen-1")).toEqual([]);
    expect(genFindFirst).not.toHaveBeenCalled();
  });

  it("returns [] when the generation/asset is not found", async () => {
    genFindFirst.mockResolvedValue(null);
    expect(await gatherReferenceImages("o", "p", "gen-1")).toEqual([]);
  });

  it("returns [] when the asset is oversize (by sizeBytes)", async () => {
    genFindFirst.mockResolvedValue({ asset: { ownerId: "o", contentHash: "h", ext: "png", sizeBytes: 9_000_000 } });
    expect(await gatherReferenceImages("o", "p", "gen-1")).toEqual([]);
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("returns a data URL on success", async () => {
    genFindFirst.mockResolvedValue({ asset: { ownerId: "o", contentHash: "h", ext: "png", sizeBytes: 1234 } });
    storageGet.mockResolvedValue(Buffer.from([0xde, 0xad]));
    const out = await gatherReferenceImages("o", "p", "gen-1");
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe("reference");
    expect(out[0]!.dataUrl).toBe(`data:image/png;base64,${Buffer.from([0xde, 0xad]).toString("base64")}`);
  });

  it("never throws — returns [] on a storage error", async () => {
    genFindFirst.mockResolvedValue({ asset: { ownerId: "o", contentHash: "h", ext: "png", sizeBytes: 1234 } });
    storageGet.mockRejectedValue(new Error("s3 down"));
    await expect(gatherReferenceImages("o", "p", "gen-1")).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web exec vitest run lib/__tests__/otto-ref-images.test.ts`
Expected: FAIL — `Cannot find module '../otto-ref-images.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/otto-ref-images.ts`:

```ts
import { prisma } from "@fikirtive/db";
import { storageKey } from "@fikirtive/core";
import type { RefImage } from "@fikirtive/otto";
import { storage, mimeOf } from "./storage";
import { resolveVisionConfig } from "./runtime-config";

/**
 * Resolve the turn's dropped reference (a Generation id — already validated owned +
 * in-project + image-ext by the caller) to a bounded base64 data URL for Otto's vision.
 * Best-effort: returns [] on disabled-vision / miss / oversize / read error — NEVER throws,
 * so a bad reference degrades to a text-only turn instead of failing the run.
 */
export async function gatherReferenceImages(
  ownerId: string,
  projectId: string,
  sourceGenerationId: string | null | undefined,
): Promise<RefImage[]> {
  if (!sourceGenerationId) return [];
  const { enabled, maxBytes } = await resolveVisionConfig();
  if (!enabled) return [];
  try {
    const gen = await prisma.generation.findFirst({
      where: {
        id: sourceGenerationId,
        ownerId,
        projectId,
        deletedAt: null,
        asset: { ext: { in: ["png", "jpg", "jpeg", "webp"] } },
      },
      include: { asset: { select: { ownerId: true, contentHash: true, ext: true, sizeBytes: true } } },
    });
    const asset = gen?.asset;
    if (!asset) return [];
    if (asset.sizeBytes != null && Number(asset.sizeBytes) > maxBytes) return [];
    const bytes = await storage.get(storageKey(asset.ownerId, asset.contentHash, asset.ext));
    if (bytes.length > maxBytes) return [];
    return [{ label: "reference", dataUrl: `data:${mimeOf(asset.ext)};base64,${Buffer.from(bytes).toString("base64")}` }];
  } catch {
    return []; // read/query error → skip; NEVER throw the turn
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web exec vitest run lib/__tests__/otto-ref-images.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire the gather into `buildOttoContext`**

In `apps/web/lib/otto-actions.ts`: add the import near the other `./` lib imports at the top of the file:

```ts
import { gatherReferenceImages } from "./otto-ref-images";
```

Then in `buildOttoContext`, add the gather to the existing `Promise.all` and set `images` on the returned context. Change the destructuring (~line 133):

```ts
  const [brandContext, availableRefs, activeJob, images] = await Promise.all([
    getBrandContextText(ownerId, null).catch(() => ""),
    loadAvailableRefsForAgent(ownerId),
    prisma.genJob.findFirst({
      where: { threadId, ownerId },
      orderBy: { createdAt: "desc" },
      select: { status: true, kind: true, error: true },
    }).catch(() => null),
    gatherReferenceImages(ownerId, projectId, sourceGenerationId ?? null),
  ]);
```

And in the returned object literal, add `images,` right after the `sourceGenerationId: sourceGenerationId ?? null,` line (~line 148):

```ts
    sourceGenerationId: sourceGenerationId ?? null,
    images,
    startGen,
```

- [ ] **Step 6: Typecheck web**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/otto-ref-images.ts apps/web/lib/__tests__/otto-ref-images.test.ts apps/web/lib/otto-actions.ts
git commit -m "feat(otto): gather dropped reference image into OttoContext.images (best-effort)"
```

---

### Task 3: Wire the multimodal user turn into both entry paths

Replace the text-only user-turn construction in the non-streaming action and the streaming route with the Task-1 helpers, so the gathered image reaches the model and prior-turn images are stripped.

**Files:**
- Modify: `apps/web/lib/otto-actions.ts` (`runInput` block, ~432-439)
- Modify: `apps/web/app/api/otto/stream/route.ts` (`runInput` block, ~177-183)

**Interfaces:**
- Consumes: `buildUserTurn`, `stripHistoryImages` from `@fikirtive/otto`; `ctx.images` from Task 2.

- [ ] **Step 1: Import the helpers in both files**

In `apps/web/lib/otto-actions.ts`, add `buildUserTurn` and `stripHistoryImages` to the existing `@fikirtive/otto` import (the one that already imports `withLlmBudget`, `OTTO_DEFAULT_MODEL`, `run`, `otto`, `RunState`, `AgentInputItem`, etc.).

In `apps/web/app/api/otto/stream/route.ts`, do the same on its `@fikirtive/otto` import.

- [ ] **Step 2: Rewrite the `runInput` block in `otto-actions.ts`**

Replace lines ~432-439 (from `const sys = buildContextSystemMessage(ctx);` through the `else` branch) with:

```ts
    const sys = buildContextSystemMessage(ctx);
    const userTurn = buildUserTurn(text, ctx.images);
    let runInput: AgentInputItem[];
    if (priorOttoState) {
      const priorState = await RunState.fromString(otto, priorOttoState);
      runInput = [...(sys ? [sys] : []), ...stripHistoryImages(priorState.history), userTurn];
    } else {
      runInput = [...(sys ? [sys] : []), userTurn];
    }
```

- [ ] **Step 3: Rewrite the `runInput` block in `stream/route.ts`**

Replace lines ~177-183 (from `const sys = buildContextSystemMessage(ctx);` through the `else` branch) with:

```ts
    const sys = buildContextSystemMessage(ctx);
    const userTurn = buildUserTurn(text, ctx.images);
    if (priorOttoState) {
      const priorState = await RunState.fromString(otto, priorOttoState);
      runInput = [...(sys ? [sys] : []), ...stripHistoryImages(priorState.history), userTurn];
    } else {
      runInput = [...(sys ? [sys] : []), userTurn];
    }
```

> Note: `runInput` is already declared with `let runInput: AgentInputItem[];` earlier in the route (line ~94), so this branch assigns it — do not re-declare.

- [ ] **Step 4: Typecheck web**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the existing Otto action tests (guard against regression)**

Run: `pnpm --filter web exec vitest run lib/__tests__/otto-actions.test.ts`
Expected: PASS (no behavior change for text-only turns — `buildUserTurn(text, undefined)` returns the same `{ role:"user", content:text }` shape as before).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/otto-actions.ts apps/web/app/api/otto/stream/route.ts
git commit -m "feat(otto): append attached reference image to the current user turn (both paths)"
```

---

### Task 4: Decouple i2v from reference presence (propose helper) + money-safety-review

Stop forcing `kind="video"` when a reference is attached. The planner's `kind` wins; a reference becomes an i2v start-frame **only** for a video plan and is never threaded into an image gen.

**Files:**
- Modify: `packages/otto/src/skills/propose.helpers.ts` (Step 1 block, lines 93-104; CardPayload spread, line 210)
- Modify: `packages/otto/src/skills/propose.test.ts` (replace Test 4; add the image+source test)

**Interfaces:**
- Consumes: `ctx.sourceGenerationId`, `input.kind` (unchanged types).
- Produces: same `ProposeCardResult` shape; `cardPayload.sourceGenerationId` now present only for i2v (video + reference).

- [ ] **Step 1: Rewrite the failing test (encodes the new rule)**

In `packages/otto/src/skills/propose.test.ts`, **replace** Test 4 ("i2v coercion", lines ~157-172) with these two tests:

```ts
  // Test 4a: i2v — a VIDEO plan + reference conditions on the start frame (entities dropped)
  it("i2v: kind=video + sourceGenerationId → video, entityIds=[], sourceGenerationId in payload", () => {
    const ctx = makeCtx({ sourceGenerationId: "gen-abc123" });
    const input = {
      kind: "video" as const, // user wants to animate the reference
      structuredPrompt: "Animate this into a 5s clip",
      entityIds: ["entity-1"],
      variantSel: { "entity-1": "variant-1" },
    };
    const { cardPayload } = buildProposeCard(input, ctx, ["entity-1"]);

    expect(cardPayload.kind).toBe("video");
    expect(cardPayload.entityIds).toEqual([]);
    expect(cardPayload.variantSel).toEqual({});
    expect((cardPayload as Record<string, unknown>)["sourceGenerationId"]).toBe("gen-abc123");
  });

  // Test 4b: DECOUPLE — an IMAGE plan + reference stays an image (NOT forced to video),
  // keeps its owned entity refs, and does NOT thread sourceGenerationId into the gen request.
  it("decouple: kind=image + sourceGenerationId → stays image, entities kept, sourceGenerationId NOT in payload", () => {
    const ctx = makeCtx({ sourceGenerationId: "gen-abc123" });
    const input = {
      kind: "image" as const, // user wants an image in the reference's style
      structuredPrompt: "A product shot in this style",
      entityIds: ["entity-1"],
      variantSel: { "entity-1": "variant-1" },
    };
    const { cardPayload } = buildProposeCard(input, ctx, ["entity-1"]);

    expect(cardPayload.kind).toBe("image");
    expect(cardPayload.entityIds).toEqual(["entity-1"]);
    expect(cardPayload.variantSel).toEqual({ "entity-1": "variant-1" });
    expect((cardPayload as Record<string, unknown>)["sourceGenerationId"]).toBeUndefined();
    // image tier pricing (1 credit/image), not video
    expect(cardPayload.estimatedCredits).toBe(1);
  });
```

- [ ] **Step 2: Run the tests to verify the new image+source test fails**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/propose.test.ts`
Expected: FAIL — Test 4b fails because the current code forces `kind="video"` (so `cardPayload.kind` is `"video"`, `entityIds` is `[]`, `sourceGenerationId` is present).

- [ ] **Step 3: Implement the decouple**

In `packages/otto/src/skills/propose.helpers.ts`, replace the Step 1 block (lines 93-104):

```ts
  // Step 1: kind is the PLANNER'S decision — an attached reference no longer forces video.
  // A reference (ctx.sourceGenerationId) becomes an i2v start-frame ONLY for a video plan;
  // for an image plan it is a vision reference the planner already SAW (buildOttoContext)
  // and is NOT threaded into the gen request (no silent image-to-image).
  let kind = input.kind;
  let entityIds = input.entityIds;
  let variantSel = input.variantSel;
  const isI2V = kind === "video" && !!ctx.sourceGenerationId;
  const hasSourceImage = isI2V;

  if (isI2V) {
    // i2v conditions on the start frame, not on entity refs (preserve prior behavior)
    entityIds = [];
    variantSel = {};
  }
```

Then replace the CardPayload source-frame spread (line 210):

```ts
    ...(isI2V ? { sourceGenerationId: ctx.sourceGenerationId } : {}),
```

> `hasSourceImage` remains `const` and still feeds `suggestModel` (Step 3) and the `if (!hasSourceImage)` entity-scoping guard (Step 2) — for an image plan `hasSourceImage` is now `false`, so entities are scoped/kept and a regular t2i model is chosen (not i2i). No other lines change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/propose.test.ts`
Expected: PASS — Test 4a and 4b pass; all pre-existing tests (image pricing, ad-pack count, video-model lock, entity scoping, forVideo) stay green.

- [ ] **Step 5: Run the money-safety-review skill on the diff**

Invoke the `money-safety-review` skill against the `propose.helpers.ts` change. Confirm: (a) price still keyed off resolved `kind`; (b) `estimatedCredits` still equals `pricedGenCredits(...)` (reservation==settlement); (c) the `count` clamp (Step 3.5, `kind==="image"`) still runs after the source block; (d) an image plan no longer forces the video tier. Address any finding before continuing.

- [ ] **Step 6: Typecheck the package**

Run: `pnpm --filter @fikirtive/otto exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/otto/src/skills/propose.helpers.ts packages/otto/src/skills/propose.test.ts
git commit -m "feat(otto): decouple i2v from reference presence — planner intent decides kind"
```

---

### Task 5: Planner guidance so Otto picks `kind` correctly for an attached reference

With the force gone, Otto must choose `kind` from intent — animate → video (start-frame), style → image. Add explicit guidance so the "animate a still" flow is preserved and the new "image in this style" flow works.

**Files:**
- Modify: `packages/otto/src/instructions.ts` (add a section after "## Video keyframes", ~line 39)
- Modify: `packages/otto/src/instructions.test.ts` (assert the new guidance text is present)

**Interfaces:**
- Consumes: nothing new. Produces: updated `ottoInstructions` string content.

- [ ] **Step 1: Write the failing test**

In `packages/otto/src/instructions.test.ts`, add (inside the existing describe block):

```ts
  it("instructs Otto to pick kind from intent for an attached reference (animate → video, style → image)", () => {
    expect(ottoInstructions).toContain("Attached reference");
    expect(ottoInstructions.toLowerCase()).toContain("animate");
    // default-to-image guidance so a reference never silently forces video
    expect(ottoInstructions.toLowerCase()).toContain("default to");
  });
```

> If `ottoInstructions` is not already imported in this test file, add `import { ottoInstructions } from "./instructions.js";` (or `from "./otto.js"` — match how the file currently imports it; check the top of `instructions.test.ts`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/instructions.test.ts`
Expected: FAIL — the string is not yet present.

- [ ] **Step 3: Add the guidance section**

In `packages/otto/src/instructions.ts`, immediately after the "## Video keyframes" block (after line 39, the `forVideo` bullet), insert:

```ts
## Attached reference image

- The user can attach a reference image to their message — when they do, you can SEE it. Use it to inform your plan.
- Decide \`kind\` from what the user ASKS FOR, not from the mere presence of the reference:
  - Animate it / turn it into a video → \`kind: "video"\` (the attached image becomes the video's start frame).
  - An image in its style, or using it as inspiration → \`kind: "image"\` (the reference guides your prompt; it is not pasted into the output).
- When the intent is unclear, default to \`"image"\` and ask what they'd like.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/instructions.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full Otto package test suite**

Run: `pnpm --filter @fikirtive/otto exec vitest run`
Expected: PASS (guards the propose/instruction changes together).

- [ ] **Step 6: Commit**

```bash
git add packages/otto/src/instructions.ts packages/otto/src/instructions.test.ts
git commit -m "feat(otto): guide kind selection for an attached reference (animate→video, style→image)"
```

---

### Task 6: Roll the streaming surface out to all users + verify end-to-end

Flip the founder gate so every user gets the streaming chat (attach UI + vision), then verify the whole feature in the real app before it counts as done.

**Files:**
- Modify: `apps/web/app/otto/page.tsx` (line ~70-71; and the `isFounderAdmin` import line 2 if it becomes unused)

**Interfaces:**
- Consumes: nothing. Produces: `ottoStreamEnabled = true` for all users.

- [ ] **Step 1: Flip the gate**

In `apps/web/app/otto/page.tsx`, replace lines 70-71:

```ts
  // Founder-first streaming chat. Temporary flag (deleted in Task 8 once verified).
  const ottoStreamEnabled = isFounderAdmin(email);
```

with:

```ts
  // Streaming chat is the single Otto surface for all users (reference-vision rollout, 2026-07-01).
  const ottoStreamEnabled = true;
```

- [ ] **Step 2: Remove the now-orphaned import if unused**

Run: `grep -n "isFounderAdmin" apps/web/app/otto/page.tsx`
If the only remaining hit is the `import { isFounderAdmin } from "@/lib/allowlist";` line (2), delete that import line. If `isFounderAdmin` is used elsewhere in the file, leave it.

- [ ] **Step 3: Typecheck + lint web**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors (no unused-import error).

- [ ] **Step 4: Run the full web + otto test suites**

Run: `pnpm --filter @fikirtive/otto exec vitest run && pnpm --filter web exec vitest run`
Expected: PASS.

- [ ] **Step 5: Manual smoke test in the real app (REQUIRED before ship — global constraint)**

Use the `/run` skill (or `pnpm --filter web dev`) and, signed in as a normal (non-founder) account if possible:
1. Confirm the streaming composer (with the attach button) renders — the gate flip reached non-founders.
2. Attach an image, send **"make an image in this style"** → Otto's reply references what it sees; the proposed card is `kind: image` (no forced video).
3. Attach an image, send **"animate this"** → the proposed card is `kind: video` (i2v start-frame preserved).
4. Send a follow-up turn in the same thread → confirm no error and the turn works (history-strip path exercised).

Record the outcome (screenshots to `~/Desktop/`). Do NOT mark done until observed.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/otto/page.tsx
git commit -m "feat(otto): roll streaming chat out to all users (one door) — reference-vision rollout"
```

---

## Self-Review (completed against the spec)

- **Spec coverage:** Part 1 看懂图 → Tasks 1-3 (helpers, gather, wiring). Part 2 不强制变视频 → Tasks 4-5 (decouple + planner guidance). Part 3 一个门 → Task 6 (gate flip). Money-safety surface → Task 4 Step 5. Testing/verification → per-task tests + Task 6 Step 5 smoke. Non-goals honored (no video-ref, no i2i, no @-mention images, no OttoConversation delete).
- **Placeholder scan:** every code step has literal code; test commands have exact filter paths and expected pass/fail.
- **Type consistency:** `RefImage = {label,dataUrl}` defined Task 1, consumed Tasks 2-3; `buildUserTurn`/`stripHistoryImages` signatures match across tasks; content-part shape `{type:"input_image", image}` matches `@openai/agents-core` `protocol.d.ts`; `isI2V`/`hasSourceImage` naming consistent in Task 4.

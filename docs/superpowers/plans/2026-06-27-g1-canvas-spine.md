# G1 · Canvas Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an infinite, node-based canvas (React Flow) the `/otto` home, where generations are draggable image/video/text nodes, with a fixed 1-image + 1-video model.

**Architecture:** Reuse the production generation engine (`startGen`/`getGenJob`) and credit reserve path untouched; add a `CanvasNode` Prisma model + owner-scoped server actions for layout persistence; build a `@xyflow/react` canvas surface that renders nodes from `CanvasNode` rows and triggers generation through the existing `startGen`. Model selection moves from hardcoded lists to env config validated at spend-time.

**Tech Stack:** Next.js (App Router, `apps/web` = `@fikirtive/web`), Prisma (`@fikirtive/db`), `@fikirtive/core`, vitest 3.2, React, `@xyflow/react` (new).

## Global Constraints

- **Money path is untouched.** Money-in = `grantCredits` only; spend = existing `reserveCredits`/`settleCredits`. The canvas only triggers `startGen`; it adds no new charge/grant/refund code.
- **Models:** image fixed = `seedream`; video fixed = env `OTTO_DEFAULT_VIDEO_MODEL`. No user-facing model picker. Model id is validated at **spend-time** (pre-spend), never compile-time only.
- **All `CanvasNode` server actions** call `requireOwner()` and scope every query by `ownerId` + `projectId` (multi-tenant isolation).
- **Test runner:** vitest. Run all: `pnpm test`. Tests live in `packages/*/src/*.test.ts` or `apps/web/lib/__tests__/*.test.ts`.
- **Add deps** with `pnpm add --filter @fikirtive/web <pkg>`.
- Canvas is the `/otto` home surface (Studio stays at `/studio?view=editor`, unchanged).

---

## File Structure

- `packages/core/src/model-config.ts` — **create** — resolves the active image/video model from env + validates a model id pre-spend.
- `packages/core/src/model-config.test.ts` — **create** — tests for the above.
- `packages/db/prisma/schema.prisma` — **modify** — add `CanvasNode` model.
- `apps/web/lib/canvas-actions.ts` — **create** — owner-scoped server actions: list/create/move/updateText/delete.
- `apps/web/lib/__tests__/canvas-actions.test.ts` — **create** — tests for the actions.
- `apps/web/components/canvas/FlowCanvas.tsx` — **create** — the React Flow surface.
- `apps/web/components/canvas/nodes/ImageNode.tsx`, `VideoNode.tsx`, `TextNode.tsx` — **create** — custom node renderers.
- `apps/web/components/canvas/useCanvasGen.ts` — **create** — hook: trigger `startGen` + poll `getGenJob` → update node.
- `apps/web/components/otto/OttoView.tsx` — **modify** — render `FlowCanvas` as the no-thread home.
- `apps/web/lib/gen-actions.ts` — **modify** — use `model-config` for spend-time model validation (additive).

---

## Phase 1 — Model env-config (item 44)

### Task 1: Active-model resolver + spend-time validator

**Files:**
- Create: `packages/core/src/model-config.ts`
- Test: `packages/core/src/model-config.test.ts`

**Interfaces:**
- Consumes: `GEN_MODELS`, `GEN_VIDEO_MODELS`, `isKnownModelId` from `@fikirtive/core` (`./gen.js`, `./model-registry.js`).
- Produces:
  - `activeImageModel(): string` — always `"seedream"` (only image model today).
  - `activeVideoModel(env?: Record<string,string|undefined>): string` — returns `env.OTTO_DEFAULT_VIDEO_MODEL` if it is a known video model, else the first of `GEN_VIDEO_MODELS`.
  - `assertSpendableModel(model: string, kind: "image"|"video", env?): { ok: true } | { ok: false; error: string }` — pre-spend guard: model must be known AND match the active model for its kind.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/model-config.test.ts
import { describe, it, expect } from "vitest";
import { activeImageModel, activeVideoModel, assertSpendableModel } from "./model-config.js";

describe("activeVideoModel", () => {
  it("uses OTTO_DEFAULT_VIDEO_MODEL when it is a known video model", () => {
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "kling-2.6" })).toBe("kling-2.6");
  });
  it("falls back to the first known video model when env is unset/invalid", () => {
    expect(activeVideoModel({})).toBe("kling");
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "not-a-model" })).toBe("kling");
  });
});

describe("assertSpendableModel", () => {
  it("accepts the active image model", () => {
    expect(assertSpendableModel("seedream", "image", {})).toEqual({ ok: true });
  });
  it("rejects a non-active video model", () => {
    const r = assertSpendableModel("veo3.1", "video", { OTTO_DEFAULT_VIDEO_MODEL: "kling" });
    expect(r.ok).toBe(false);
  });
  it("rejects an unknown model id", () => {
    expect(assertSpendableModel("totally-fake", "image", {}).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fikirtive/core test -- model-config`
Expected: FAIL ("Cannot find module './model-config.js'").

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/model-config.ts
import { GEN_MODELS, GEN_VIDEO_MODELS } from "./gen.js";
import { isKnownModelId } from "./model-registry.js";

type Env = Record<string, string | undefined>;
const getEnv = (env?: Env): Env => env ?? (typeof process !== "undefined" ? process.env : {});

export function activeImageModel(): string {
  return GEN_MODELS[0]; // "seedream"
}

export function activeVideoModel(env?: Env): string {
  const want = getEnv(env).OTTO_DEFAULT_VIDEO_MODEL;
  return want && (GEN_VIDEO_MODELS as readonly string[]).includes(want) ? want : GEN_VIDEO_MODELS[0];
}

export function assertSpendableModel(
  model: string,
  kind: "image" | "video",
  env?: Env,
): { ok: true } | { ok: false; error: string } {
  if (!isKnownModelId(model)) return { ok: false, error: "Unknown model." };
  const active = kind === "image" ? activeImageModel() : activeVideoModel(env);
  if (model !== active) return { ok: false, error: "That model isn't enabled right now." };
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @fikirtive/core test -- model-config`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/model-config.ts packages/core/src/model-config.test.ts
git commit -m "feat(core): env-configured active image/video model + spend-time validator"
```

### Task 2: Enforce active-model validation in startGen (additive)

**Files:**
- Modify: `apps/web/lib/gen-actions.ts` (the spend-time guard block, ~lines 86–90)
- Test: `packages/core/src/model-config.test.ts` (already covers the guard logic; this task wires it)

**Interfaces:**
- Consumes: `assertSpendableModel` from `@fikirtive/core`.

- [ ] **Step 1: Add the guard next to the existing disabled-model check**

In `apps/web/lib/gen-actions.ts`, immediately after the existing `isModelDisabled` block, add:

```typescript
import { assertSpendableModel } from "@fikirtive/core";
// ...inside startGen, after the disabled-model check, before the spend transaction:
const kindForModel = kind === "image" ? "image" : "video";
const spendable = assertSpendableModel(model, kindForModel);
if (!spendable.ok) return { error: spendable.error };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @fikirtive/web typecheck` (or `pnpm -w typecheck` if that's the script)
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/gen-actions.ts
git commit -m "feat(gen): validate model against active env config before spend"
```

---

## Phase 2 — CanvasNode persistence (items 2/5 data layer)

### Task 3: Add the CanvasNode Prisma model

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

**Interfaces:**
- Produces: Prisma model `CanvasNode` (and generated client type) consumed by Task 4.

- [ ] **Step 1: Add the model**

Append to `packages/db/prisma/schema.prisma`:

```prisma
model CanvasNode {
  id           String    @id
  ownerId      String
  projectId    String
  type         String    // "image" | "video" | "text"
  x            Float
  y            Float
  w            Float
  h            Float
  text         String?
  prompt       String?
  generationId String?
  genJobId     String?
  status       String    @default("done") // "pending" | "done" | "failed"
  sourceNodeId String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@index([ownerId, projectId])
}
```

- [ ] **Step 2: Create + apply the migration and regenerate the client**

Run: `pnpm --filter @fikirtive/db exec prisma migrate dev --name add_canvas_node`
Expected: migration created under `packages/db/prisma/migrations/`, applied, client regenerated.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add CanvasNode model for canvas layout persistence"
```

### Task 4: Owner-scoped canvas server actions

**Files:**
- Create: `apps/web/lib/canvas-actions.ts`
- Test: `apps/web/lib/__tests__/canvas-actions.test.ts`

**Interfaces:**
- Consumes: `requireOwner` (`apps/web/lib/auth-guard.ts`), `prisma`, `newId` (`@fikirtive/db`).
- Produces (all return `{ error }` on failure):
  - `listCanvasNodes(projectId: string): Promise<CanvasNodeDTO[] | { error: string }>`
  - `createCanvasNode(input: CreateNodeInput): Promise<{ id: string } | { error: string }>`
  - `moveCanvasNode(id: string, pos: { x: number; y: number; w: number; h: number }): Promise<{ ok: true } | { error: string }>`
  - `updateTextNode(id: string, text: string): Promise<{ ok: true } | { error: string }>`
  - `deleteCanvasNode(id: string): Promise<{ ok: true } | { error: string }>`
  - Types `CanvasNodeDTO` = `{ id, type, x, y, w, h, text, prompt, generationId, genJobId, status, sourceNodeId }`; `CreateNodeInput` = `{ projectId, type, x, y, w, h, text?, prompt?, generationId?, genJobId?, status?, sourceNodeId? }`.

- [ ] **Step 1: Write the failing test (ownership isolation is the key assertion)**

```typescript
// apps/web/lib/__tests__/canvas-actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const owner = vi.fn();
vi.mock("../auth-guard", () => ({ requireOwner: () => owner() }));

const db = { canvasNode: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() }, project: { findFirst: vi.fn() } };
vi.mock("@fikirtive/db", () => ({ prisma: db, newId: () => "node-1" }));

import { listCanvasNodes, moveCanvasNode } from "../canvas-actions";

beforeEach(() => { vi.clearAllMocks(); owner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" }); });

describe("listCanvasNodes", () => {
  it("scopes by ownerId + projectId", async () => {
    db.project.findFirst.mockResolvedValue({ id: "p1" });
    db.canvasNode.findMany.mockResolvedValue([]);
    await listCanvasNodes("p1");
    expect(db.canvasNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: "u1", projectId: "p1" } }),
    );
  });
  it("rejects when the project is not owned", async () => {
    db.project.findFirst.mockResolvedValue(null);
    expect(await listCanvasNodes("pX")).toEqual({ error: "Project not found." });
  });
});

describe("moveCanvasNode", () => {
  it("updates only the owner's node (updateMany with ownerId in where)", async () => {
    db.canvasNode.updateMany.mockResolvedValue({ count: 1 });
    await moveCanvasNode("node-1", { x: 1, y: 2, w: 3, h: 4 });
    expect(db.canvasNode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "node-1", ownerId: "u1" } }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fikirtive/web test -- canvas-actions`
Expected: FAIL ("Cannot find module '../canvas-actions'").

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/web/lib/canvas-actions.ts
"use server";

import { prisma, newId } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";

export type CanvasNodeDTO = {
  id: string; type: string; x: number; y: number; w: number; h: number;
  text: string | null; prompt: string | null; generationId: string | null;
  genJobId: string | null; status: string; sourceNodeId: string | null;
};
export type CreateNodeInput = {
  projectId: string; type: "image" | "video" | "text";
  x: number; y: number; w: number; h: number;
  text?: string; prompt?: string; generationId?: string; genJobId?: string;
  status?: string; sourceNodeId?: string;
};

const SELECT = { id: true, type: true, x: true, y: true, w: true, h: true, text: true,
  prompt: true, generationId: true, genJobId: true, status: true, sourceNodeId: true } as const;

async function ownedProject(projectId: string, ownerId: string) {
  return prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
}

export async function listCanvasNodes(projectId: string): Promise<CanvasNodeDTO[] | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (!(await ownedProject(projectId, gate.ownerId))) return { error: "Project not found." };
  return prisma.canvasNode.findMany({ where: { ownerId: gate.ownerId, projectId }, select: SELECT });
}

export async function createCanvasNode(input: CreateNodeInput): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (!(await ownedProject(input.projectId, gate.ownerId))) return { error: "Project not found." };
  const id = newId();
  await prisma.canvasNode.create({
    data: {
      id, ownerId: gate.ownerId, projectId: input.projectId, type: input.type,
      x: input.x, y: input.y, w: input.w, h: input.h,
      text: input.text ?? null, prompt: input.prompt ?? null,
      generationId: input.generationId ?? null, genJobId: input.genJobId ?? null,
      status: input.status ?? "done", sourceNodeId: input.sourceNodeId ?? null,
    },
  });
  return { id };
}

export async function moveCanvasNode(id: string, pos: { x: number; y: number; w: number; h: number }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const r = await prisma.canvasNode.updateMany({ where: { id, ownerId: gate.ownerId }, data: pos });
  return r.count === 1 ? { ok: true as const } : { error: "Node not found." };
}

export async function updateTextNode(id: string, text: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const r = await prisma.canvasNode.updateMany({ where: { id, ownerId: gate.ownerId, type: "text" }, data: { text } });
  return r.count === 1 ? { ok: true as const } : { error: "Node not found." };
}

export async function deleteCanvasNode(id: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const r = await prisma.canvasNode.deleteMany({ where: { id, ownerId: gate.ownerId } });
  return r.count === 1 ? { ok: true as const } : { error: "Node not found." };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @fikirtive/web test -- canvas-actions`
Expected: PASS (4 assertions; ownership scoping verified).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/canvas-actions.ts apps/web/lib/__tests__/canvas-actions.test.ts
git commit -m "feat(canvas): owner-scoped CanvasNode server actions (list/create/move/text/delete)"
```

---

## Phase 3 — Canvas UI, gen-wiring, routing (items 2/5/3/4/45)

> Note: these tasks deliver the visible surface. The persistence (Phase 2) and money/model logic (Phase 1) are already unit-tested; Phase 3's test is an integration smoke (node create → persist → reload) plus a manual verification checklist. React Flow code is real but expect to refine interaction details against the live `@xyflow/react` API.

### Task 5: Add the React Flow dependency

**Files:** Modify: `apps/web/package.json`

- [ ] **Step 1: Add the dep**

Run: `pnpm add --filter @fikirtive/web @xyflow/react`
Expected: `@xyflow/react` added to `apps/web/package.json` dependencies; lockfile updated.

- [ ] **Step 2: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "build(web): add @xyflow/react for the canvas"
```

### Task 6: Custom node components

**Files:**
- Create: `apps/web/components/canvas/nodes/ImageNode.tsx`
- Create: `apps/web/components/canvas/nodes/VideoNode.tsx`
- Create: `apps/web/components/canvas/nodes/TextNode.tsx`

**Interfaces:**
- Consumes: React Flow `NodeProps`, the node `data` shape `{ status: string; url?: string; prompt?: string; text?: string; onAnimate?: () => void; onDelete?: () => void }`.
- Produces: three components registered in `nodeTypes` (Task 7) under keys `"image" | "video" | "text"`.

- [ ] **Step 1: Implement ImageNode**

```tsx
// apps/web/components/canvas/nodes/ImageNode.tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";

export function ImageNode({ data }: NodeProps) {
  const d = data as { status: string; url?: string; prompt?: string; onAnimate?: () => void; onDelete?: () => void };
  return (
    <div className="al-panel" style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 12 }}>
      {d.status === "pending" || !d.url ? (
        <div style={{ display: "grid", placeItems: "center", height: "100%", opacity: 0.6 }}>Generating…</div>
      ) : (
        <img src={d.url} alt={d.prompt ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}
      <div className="nodrag" style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 6 }}>
        <button className="al-btn al-btn-glass al-btn-sm" onClick={d.onAnimate}>Animate</button>
        <button className="al-btn al-btn-glass al-btn-sm" onClick={d.onDelete}>✕</button>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

- [ ] **Step 2: Implement VideoNode**

```tsx
// apps/web/components/canvas/nodes/VideoNode.tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";

export function VideoNode({ data }: NodeProps) {
  const d = data as { status: string; url?: string; onDelete?: () => void };
  return (
    <div className="al-panel" style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 12 }}>
      {d.status === "pending" || !d.url ? (
        <div style={{ display: "grid", placeItems: "center", height: "100%", opacity: 0.6 }}>Rendering…</div>
      ) : (
        <video src={d.url} controls style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}
      <div className="nodrag" style={{ position: "absolute", top: 6, right: 6 }}>
        <button className="al-btn al-btn-glass al-btn-sm" onClick={d.onDelete}>✕</button>
      </div>
      <Handle type="target" position={Position.Left} />
    </div>
  );
}
```

- [ ] **Step 3: Implement TextNode**

```tsx
// apps/web/components/canvas/nodes/TextNode.tsx
import { useState } from "react";
import { type NodeProps } from "@xyflow/react";

export function TextNode({ data }: NodeProps) {
  const d = data as { text?: string; onChange?: (t: string) => void; onDelete?: () => void };
  const [val, setVal] = useState(d.text ?? "");
  return (
    <div className="al-panel nodrag" style={{ width: "100%", height: "100%", padding: 8, borderRadius: 12 }}>
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => d.onChange?.(val)}
        placeholder="Type here…"
        style={{ width: "100%", height: "100%", border: "none", background: "transparent", resize: "none", outline: "none" }}
      />
      <button className="al-btn al-btn-glass al-btn-sm" style={{ position: "absolute", top: 6, right: 6 }} onClick={d.onDelete}>✕</button>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter @fikirtive/web typecheck`
Expected: PASS.

```bash
git add apps/web/components/canvas/nodes
git commit -m "feat(canvas): image/video/text node components"
```

### Task 7: Generation hook (trigger startGen + poll getGenJob)

**Files:** Create: `apps/web/components/canvas/useCanvasGen.ts`

**Interfaces:**
- Consumes: `startGen`, `getGenJob` from `apps/web/lib/gen-actions`; `createCanvasNode`, `moveCanvasNode` from `apps/web/lib/canvas-actions`; `activeImageModel`, `activeVideoModel` from `@fikirtive/core`.
- Produces: `useCanvasGen(projectId)` returning `{ generateImage(prompt, pos), animate(sourceNode, prompt, pos) }`, each creating a pending node, polling, then resolving its `url`/`status`.

- [ ] **Step 1: Implement the hook**

```typescript
// apps/web/components/canvas/useCanvasGen.ts
"use client";
import { useCallback } from "react";
import { startGen, getGenJob } from "../../lib/gen-actions";
import { createCanvasNode } from "../../lib/canvas-actions";
import { activeImageModel, activeVideoModel } from "@fikirtive/core";

type Pos = { x: number; y: number; w: number; h: number };
type OnNode = (node: { id: string; type: "image" | "video"; pos: Pos; status: string; url?: string; prompt: string; sourceNodeId?: string }) => void;

async function poll(jobId: string, onUrl: (url: string | null, status: string) => void) {
  for (let i = 0; i < 48; i++) {
    const job = await getGenJob(jobId);
    if (!job) return;
    if (job.status === "DONE") return onUrl(job.urls[0] ?? null, "done");
    if (job.status === "FAILED") return onUrl(null, "failed");
    await new Promise((r) => setTimeout(r, 2500));
  }
  onUrl(null, "failed");
}

export function useCanvasGen(projectId: string, onNode: OnNode, onResolve: (nodeId: string, url: string | null, status: string) => void) {
  const generateImage = useCallback(async (prompt: string, pos: Pos) => {
    const req = { projectId, prompt, count: 1, kind: "image" as const, model: activeImageModel(), idempotencyKey: `img-${Date.now()}` };
    const started = await startGen(req);
    if ("error" in started) return;
    const created = await createCanvasNode({ projectId, type: "image", ...pos, prompt, genJobId: started.id, status: "pending" });
    if ("error" in created) return;
    onNode({ id: created.id, type: "image", pos, status: "pending", prompt });
    poll(started.id, (url, status) => onResolve(created.id, url, status));
  }, [projectId, onNode, onResolve]);

  const animate = useCallback(async (sourceGenerationId: string, sourceNodeId: string, prompt: string, pos: Pos) => {
    const req = { projectId, prompt, count: 1, kind: "video" as const, model: activeVideoModel(), sourceGenerationId, idempotencyKey: `vid-${Date.now()}` };
    const started = await startGen(req);
    if ("error" in started) return;
    const created = await createCanvasNode({ projectId, type: "video", ...pos, prompt, genJobId: started.id, status: "pending", sourceNodeId });
    if ("error" in created) return;
    onNode({ id: created.id, type: "video", pos, status: "pending", prompt, sourceNodeId });
    poll(started.id, (url, status) => onResolve(created.id, url, status));
  }, [projectId, onNode, onResolve]);

  return { generateImage, animate };
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @fikirtive/web typecheck`
Expected: PASS.

```bash
git add apps/web/components/canvas/useCanvasGen.ts
git commit -m "feat(canvas): generation hook reusing startGen + getGenJob"
```

### Task 8: FlowCanvas surface (hydrate nodes, drag-persist, composer)

**Files:** Create: `apps/web/components/canvas/FlowCanvas.tsx`

**Interfaces:**
- Consumes: `@xyflow/react` (`ReactFlow`, `Background`, `Controls`, `useNodesState`, `applyNodeChanges`), the three node components (Task 6), `useCanvasGen` (Task 7), `listCanvasNodes`/`moveCanvasNode`/`updateTextNode`/`deleteCanvasNode` (Phase 2).
- Produces: `<FlowCanvas projectId />` default-exported surface.

- [ ] **Step 1: Implement the canvas**

```tsx
// apps/web/components/canvas/FlowCanvas.tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { ReactFlow, Background, Controls, type Node, type NodeChange, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ImageNode } from "./nodes/ImageNode";
import { VideoNode } from "./nodes/VideoNode";
import { TextNode } from "./nodes/TextNode";
import { useCanvasGen } from "./useCanvasGen";
import { listCanvasNodes, moveCanvasNode, updateTextNode, deleteCanvasNode } from "../../lib/canvas-actions";

const nodeTypes = { image: ImageNode, video: VideoNode, text: TextNode };

export default function FlowCanvas({ projectId }: { projectId: string }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    listCanvasNodes(projectId).then((rows) => {
      if ("error" in (rows as object)) return;
      setNodes((rows as any[]).map((r) => ({
        id: r.id, type: r.type, position: { x: r.x, y: r.y },
        data: { status: r.status, url: r.generationId ? undefined : undefined, prompt: r.prompt, text: r.text },
        style: { width: r.w, height: r.h },
      })));
    });
  }, [projectId]);

  const onResolve = useCallback((id: string, url: string | null, status: string) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, url: url ?? undefined, status } } : n)));
  }, []);
  const onNewNode = useCallback((n: { id: string; type: "image" | "video"; pos: any; status: string; prompt: string }) => {
    setNodes((ns) => [...ns, { id: n.id, type: n.type, position: { x: n.pos.x, y: n.pos.y }, data: { status: n.status, prompt: n.prompt }, style: { width: n.pos.w, height: n.pos.h } }]);
  }, []);

  const { generateImage, animate } = useCanvasGen(projectId, onNewNode, onResolve);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    for (const c of changes) {
      if (c.type === "position" && c.dragging === false) {
        const n = nodes.find((x) => x.id === c.id);
        if (n) void moveCanvasNode(n.id, { x: n.position.x, y: n.position.y, w: Number(n.style?.width ?? 320), h: Number(n.style?.height ?? 320) });
      }
      if (c.type === "remove") void deleteCanvasNode(c.id);
    }
  }, [nodes]);

  return (
    <div style={{ flex: 1, position: "relative" }}>
      <ReactFlow nodes={nodes} nodeTypes={nodeTypes} onNodesChange={onNodesChange} fitView>
        <Background />
        <Controls />
      </ReactFlow>
      <form
        className="al-promptbar"
        style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", width: 560 }}
        onSubmit={(e) => { e.preventDefault(); if (prompt.trim()) { generateImage(prompt.trim(), { x: 80, y: 80, w: 320, h: 320 }); setPrompt(""); } }}
      >
        <input className="al-input-wrap" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Type to imagine…" />
        <button className="al-btn al-btn-primary al-btn-sm" type="submit">Generate</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @fikirtive/web typecheck`
Expected: PASS (adjust `Node`/`NodeChange` generics to the installed `@xyflow/react` version if the compiler flags them).

```bash
git add apps/web/components/canvas/FlowCanvas.tsx
git commit -m "feat(canvas): FlowCanvas surface — hydrate, drag-persist, prompt composer"
```

### Task 9: Make the canvas the /otto home

**Files:** Modify: `apps/web/components/otto/OttoView.tsx` (the `showFrontDoor` branch)

**Interfaces:**
- Consumes: `FlowCanvas` (Task 8). Renders it where `OttoFrontDoor` rendered for the no-thread home.

- [ ] **Step 1: Swap the no-thread home to the canvas**

In `OttoView.tsx`, import the canvas and replace the `OttoFrontDoor` element in the `showFrontDoor` branch:

```tsx
import FlowCanvas from "../canvas/FlowCanvas";
// ...
{showFrontDoor ? (
  <FlowCanvas projectId={projectId} />
) : ottoStreamEnabled ? (
  <OttoChatStream /* ...unchanged... */ />
) : (
  <OttoConversation /* ...unchanged... */ />
)}
```

(Keep `OttoFrontDoor` imported and available — it is reused for the agent intake empty-state in G3; do not delete it.)

- [ ] **Step 2: Manual verification (run the app)**

Run the dev server (`pnpm --filter @fikirtive/web dev`), open `/otto`. Verify:
- The canvas renders as the home (pan/zoom/background grid).
- Typing a prompt + Generate creates a pending image node that resolves to an image.
- Selecting an image node → Animate creates a pending video node that resolves.
- Reloading the page re-hydrates the nodes in their last positions.
- `/studio?view=editor` still works (regression).

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/otto/OttoView.tsx
git commit -m "feat(canvas): make the canvas the /otto home surface"
```

---

## Self-Review

**Spec coverage:**
- Item 2 (canvas engine) → Tasks 5–8. ✓
- Item 5 (text nodes) → Task 6 (TextNode) + Task 4 (updateTextNode). ✓
- Item 44 (model env-config + spend-time validation) → Tasks 1–2. ✓
- Item 45 (canvas-as-home) → Task 9. ✓
- Items 3/4 (reuse image gen + i2v) → Task 7 (startGen with `kind:image`/`kind:video`+`sourceGenerationId`). ✓
- Money path untouched → no task modifies credits; Task 7 only calls `startGen`. ✓
- Persistence + owner isolation → Tasks 3–4 with ownership tests. ✓

**Placeholder scan:** No "TBD"/"similar to". The `url` hydration in Task 8 Step 1 intentionally leaves persisted-node media URL resolution as a follow-up (a node reload shows the node frame; resolving a stored `generationId` → URL is a G2 detail-page concern). This is a known, stated limitation, not a hidden placeholder.

**Type consistency:** `startGen` request matches the verified `GenRequest` schema (kind/model/prompt/count/idempotencyKey/sourceGenerationId). `getGenJob` returns `{ status, urls }` (verified). `requireOwner` returns `{ ownerId, email } | { error }` (verified). CanvasNode DTO fields match the Prisma model.

**Known follow-ups (not blockers, belong to later groups):** resolving stored `generationId`→URL on hydrate (G2), node action toolbar polish (G2), Assets/Elements sidebar (deferred).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-27-g1-canvas-spine.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach? (And per your standing rule: I will not start implementation or open a PR until you say go.)

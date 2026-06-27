# G4c — Multi-convo Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one project run several parallel Otto conversations, surfaced on the shared canvas — convo tab strip, activity dots, persistent board, and light per-convo node attribution.

**Architecture:** Each convo is an independent `ChatThread` (own state/stream/approval); they share the project's `projectId`-scoped canvas board (already a stable sibling, so it persists across switches). We add: a `CanvasNode.threadId` attribution column, an owner+project-scoped activity reader, pure helpers (tab model, node color, convo filter), a presentational `<ConvoTabs>`, and wiring in `OttoView`/`OttoApp`. The Otto engine, skills, and money path are untouched.

**Tech Stack:** Next.js App Router (server actions), Prisma 7.8 + Postgres, `@xyflow/react` canvas, React `useState`/prop-drilling + `al-*`/`ds.tsx` styling, vitest 3.2 (prisma mocked via `vi.hoisted`/`vi.mock`).

## Global Constraints

- **Money path untouched** — no new charge/grant/reserve/settle path; every spend still flows card-by-card through the existing `generate` → `ctx.startGen`. No file under the spend path is modified.
- **Single Otto engine, capabilities via skills** — no personas/roles; do NOT modify `packages/otto` agent or skill definitions.
- **Owner + project scoped** — every new server action gates with `requireOwner()` then `ownedProject(projectId, ownerId)`; cross-owner/cross-project ids are rejected fail-closed.
- **Additive, nullable migration** — `CanvasNode.threadId` is `String?`, no backfill; old rows = `null` = "unattributed".
- **In-flight GenJob statuses** = `QUEUED`, `GENERATING` (verbatim `GenStatus` values).
- **Build gate** — `pnpm -r build` must complete and show `├ ƒ /otto` plus `Done`. (The `| tail` pipe masks exit codes; grep the build log, do not trust a bare exit 0.)
- **Test runner** — `cd apps/web && pnpm exec vitest run <relative path>` (the `pnpm test -- <name>` form is broken in this repo).
- **Out of scope (do NOT build):** auto-spawn orchestrator, personas, chat-as-canvas-node, simultaneous multi-stream live tokens, cross-convo history sharing.

---

### Task 1: `CanvasNode.threadId` attribution column + write-path validation

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (CanvasNode model, ~line 944)
- Create: `packages/db/prisma/migrations/20260627120000_canvas_node_thread_id/migration.sql`
- Modify: `apps/web/lib/canvas-actions.ts` (CanvasNodeDTO, CreateNodeInput, SELECT, createCanvasNode)
- Test: `apps/web/lib/__tests__/canvas-actions.test.ts`

**Interfaces:**
- Produces: `CreateNodeInput` gains optional `threadId?: string`. `CanvasNodeDTO` gains `threadId: string | null`. `createCanvasNode` stamps `threadId` only when it names a `ChatThread` with the SAME `ownerId` AND `projectId` (else stores `null`). `listCanvasNodes` returns `threadId` in each DTO.

- [ ] **Step 1: Write the failing tests**

Add `chatThread` to the prisma mock and a `mockThreadFindFirst`, then add tests. In `apps/web/lib/__tests__/canvas-actions.test.ts`, extend the `vi.hoisted` block and the `@fikirtive/db` mock:

```ts
const { mockOwner, mockFindMany, mockCreate, mockUpdateMany, mockDeleteMany, mockProjectFindFirst, mockThreadFindFirst } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockFindMany: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockProjectFindFirst: vi.fn(),
  mockThreadFindFirst: vi.fn(),
}));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    canvasNode: { findMany: mockFindMany, create: mockCreate, updateMany: mockUpdateMany, deleteMany: mockDeleteMany },
    project: { findFirst: mockProjectFindFirst },
    chatThread: { findFirst: mockThreadFindFirst },
  },
}));
```

Then add the `createCanvasNode` import and tests:

```ts
import { listCanvasNodes, moveCanvasNode, createCanvasNode } from "../canvas-actions";

describe("createCanvasNode attribution", () => {
  beforeEach(() => mockProjectFindFirst.mockResolvedValue({ id: "p1" }));

  it("stamps threadId when the thread is in the same owner+project", async () => {
    mockThreadFindFirst.mockResolvedValue({ id: "t1" });
    mockCreate.mockResolvedValue({ id: "node-1" });
    await createCanvasNode({ projectId: "p1", type: "image", x: 0, y: 0, w: 1, h: 1, threadId: "t1" });
    expect(mockThreadFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t1", ownerId: "u1", projectId: "p1", deletedAt: null } }),
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ threadId: "t1" }) }),
    );
  });

  it("clears threadId (null) when the thread is not in this owner+project", async () => {
    mockThreadFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "node-1" });
    await createCanvasNode({ projectId: "p1", type: "image", x: 0, y: 0, w: 1, h: 1, threadId: "t-other" });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ threadId: null }) }),
    );
  });

  it("stores null threadId when none is provided (no thread lookup)", async () => {
    mockCreate.mockResolvedValue({ id: "node-1" });
    await createCanvasNode({ projectId: "p1", type: "text", x: 0, y: 0, w: 1, h: 1 });
    expect(mockThreadFindFirst).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ threadId: null }) }),
    );
  });
});

describe("listCanvasNodes selects threadId", () => {
  it("includes threadId in the select", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
    mockFindMany.mockResolvedValue([]);
    await listCanvasNodes("p1");
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ threadId: true }) }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/canvas-actions.test.ts`
Expected: FAIL — `createCanvasNode` not imported / `threadId` not in create data / `threadId` not in select.

- [ ] **Step 3: Edit the Prisma schema**

In `packages/db/prisma/schema.prisma`, add to the `CanvasNode` model (after `sourceNodeId String?`, before `createdAt`):

```prisma
  // G4c: convo attribution — which ChatThread created this node. Nullable, no backfill;
  // validated (same owner+project) in createCanvasNode, no FK. null = "unattributed".
  threadId     String?
```

And change the index line from `@@index([ownerId, projectId])` to add a second index:

```prisma
  @@index([ownerId, projectId])
  @@index([ownerId, projectId, threadId])
```

- [ ] **Step 4: Write the migration SQL**

Create `packages/db/prisma/migrations/20260627120000_canvas_node_thread_id/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "CanvasNode" ADD COLUMN "threadId" TEXT;

-- CreateIndex
CREATE INDEX "CanvasNode_ownerId_projectId_threadId_idx" ON "CanvasNode"("ownerId", "projectId", "threadId");
```

- [ ] **Step 5: Regenerate the Prisma client**

Run: `pnpm --filter @fikirtive/db run generate`
Expected: "Generated Prisma Client" with no error.

- [ ] **Step 6: Implement the action changes**

In `apps/web/lib/canvas-actions.ts`:

Add `threadId` to the DTO and input types and the SELECT:

```ts
export type CanvasNodeDTO = {
  id: string; type: string; x: number; y: number; w: number; h: number;
  text: string | null; prompt: string | null; generationId: string | null;
  genJobId: string | null; status: string; sourceNodeId: string | null;
  threadId: string | null;
};
export type CreateNodeInput = {
  projectId: string; type: "image" | "video" | "text";
  x: number; y: number; w: number; h: number;
  text?: string; prompt?: string; generationId?: string; genJobId?: string;
  status?: string; sourceNodeId?: string; threadId?: string;
};

const SELECT = { id: true, type: true, x: true, y: true, w: true, h: true, text: true,
  prompt: true, generationId: true, genJobId: true, status: true, sourceNodeId: true,
  threadId: true } as const;
```

Replace `createCanvasNode` with:

```ts
export async function createCanvasNode(input: CreateNodeInput): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (!(await ownedProject(input.projectId, gate.ownerId))) return { error: "Project not found." };
  // Attribution is fail-closed: only stamp threadId when it names a live thread in THIS
  // owner+project; otherwise store null. Never trust a client-supplied threadId blindly.
  let threadId: string | null = null;
  if (input.threadId) {
    const t = await prisma.chatThread.findFirst({
      where: { id: input.threadId, ownerId: gate.ownerId, projectId: input.projectId, deletedAt: null },
      select: { id: true },
    });
    threadId = t ? t.id : null;
  }
  const id = newId();
  await prisma.canvasNode.create({
    data: {
      id, ownerId: gate.ownerId, projectId: input.projectId, type: input.type,
      x: input.x, y: input.y, w: input.w, h: input.h,
      text: input.text ?? null, prompt: input.prompt ?? null,
      generationId: input.generationId ?? null, genJobId: input.genJobId ?? null,
      status: input.status ?? "done", sourceNodeId: input.sourceNodeId ?? null,
      threadId,
    },
  });
  return { id };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/canvas-actions.test.ts`
Expected: PASS (all attribution + select tests green, existing tests still green).

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260627120000_canvas_node_thread_id apps/web/lib/canvas-actions.ts apps/web/lib/__tests__/canvas-actions.test.ts
git commit -m "feat(g4c): CanvasNode.threadId attribution (fail-closed, owner+project scoped)"
```

---

### Task 2: `listProjectThreadActivity` reader (activity dots data)

**Files:**
- Create: `apps/web/lib/thread-activity.ts`
- Test: `apps/web/lib/__tests__/thread-activity.test.ts`

**Interfaces:**
- Produces: `listProjectThreadActivity(projectId: string): Promise<{ threadId: string; pending: boolean }[] | { error: string }>`. `pending` = the thread has an in-flight `GenJob` (status `QUEUED`/`GENERATING`, `threadId` set) OR a pending `CanvasNode` (`status="pending"`, `threadId` set), all owner+project scoped.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/__tests__/thread-activity.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockProjectFindFirst, mockThreadFindMany, mockGenJobFindMany, mockNodeFindMany } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockProjectFindFirst: vi.fn(),
  mockThreadFindMany: vi.fn(),
  mockGenJobFindMany: vi.fn(),
  mockNodeFindMany: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst },
    chatThread: { findMany: mockThreadFindMany },
    genJob: { findMany: mockGenJobFindMany },
    canvasNode: { findMany: mockNodeFindMany },
  },
}));

import { listProjectThreadActivity } from "../thread-activity";

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
});

describe("listProjectThreadActivity", () => {
  it("rejects when the project is not owned", async () => {
    mockProjectFindFirst.mockResolvedValue(null);
    expect(await listProjectThreadActivity("pX")).toEqual({ error: "Project not found." });
  });

  it("marks threads pending from an in-flight GenJob or a pending CanvasNode", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
    mockThreadFindMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }, { id: "t3" }]);
    mockGenJobFindMany.mockResolvedValue([{ threadId: "t1" }]);
    mockNodeFindMany.mockResolvedValue([{ threadId: "t2" }]);
    const res = await listProjectThreadActivity("p1");
    expect(res).toEqual([
      { threadId: "t1", pending: true },
      { threadId: "t2", pending: true },
      { threadId: "t3", pending: false },
    ]);
  });

  it("scopes GenJob query to owner+project and in-flight statuses", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
    mockThreadFindMany.mockResolvedValue([]);
    mockGenJobFindMany.mockResolvedValue([]);
    mockNodeFindMany.mockResolvedValue([]);
    await listProjectThreadActivity("p1");
    expect(mockGenJobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: "u1", projectId: "p1", status: { in: ["QUEUED", "GENERATING"] }, threadId: { not: null } },
      }),
    );
    expect(mockNodeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: "u1", projectId: "p1", status: "pending", threadId: { not: null } },
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/thread-activity.test.ts`
Expected: FAIL — cannot find module `../thread-activity`.

- [ ] **Step 3: Implement the reader**

Create `apps/web/lib/thread-activity.ts`:

```ts
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";

async function ownedProject(projectId: string, ownerId: string) {
  return prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
}

/**
 * Per-thread activity for one project: a thread is "pending" when it has an in-flight
 * GenJob (QUEUED/GENERATING) or a pending CanvasNode. Read-only, owner+project scoped.
 */
export async function listProjectThreadActivity(
  projectId: string,
): Promise<{ threadId: string; pending: boolean }[] | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (!(await ownedProject(projectId, gate.ownerId))) return { error: "Project not found." };
  const { ownerId } = gate;

  const [threads, jobs, nodes] = await Promise.all([
    prisma.chatThread.findMany({ where: { ownerId, projectId, deletedAt: null }, select: { id: true } }),
    prisma.genJob.findMany({
      where: { ownerId, projectId, status: { in: ["QUEUED", "GENERATING"] }, threadId: { not: null } },
      select: { threadId: true },
    }),
    prisma.canvasNode.findMany({
      where: { ownerId, projectId, status: "pending", threadId: { not: null } },
      select: { threadId: true },
    }),
  ]);

  const pending = new Set<string>();
  for (const j of jobs) if (j.threadId) pending.add(j.threadId);
  for (const n of nodes) if (n.threadId) pending.add(n.threadId);

  return threads.map((t) => ({ threadId: t.id, pending: pending.has(t.id) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/thread-activity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/thread-activity.ts apps/web/lib/__tests__/thread-activity.test.ts
git commit -m "feat(g4c): listProjectThreadActivity reader (owner+project scoped, in-flight signal)"
```

---

### Task 3: Pure helpers — node color + convo filter + tab model

**Files:**
- Create: `apps/web/lib/convo-canvas.ts`
- Test: `apps/web/lib/__tests__/convo-canvas.test.ts`

**Interfaces:**
- Produces:
  - `convoColor(threadId: string | null): string` — deterministic hex for a thread id; `null` → the neutral `UNATTRIBUTED_COLOR`.
  - `filterNodesByConvo<T extends { threadId: string | null }>(nodes: T[], activeThreadId: string | null, on: boolean): T[]` — when `on` and `activeThreadId` set, keep only nodes with that `threadId`; otherwise return all.
  - `convoTabModel(threads: {id:string; title:string}[], activeThreadId: string | null, activity: Set<string>): {id:string; title:string; active:boolean; working:boolean}[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/__tests__/convo-canvas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convoColor, UNATTRIBUTED_COLOR, filterNodesByConvo, convoTabModel } from "../convo-canvas";

describe("convoColor", () => {
  it("is deterministic for a given id", () => {
    expect(convoColor("t1")).toBe(convoColor("t1"));
  });
  it("returns the neutral color for null", () => {
    expect(convoColor(null)).toBe(UNATTRIBUTED_COLOR);
  });
  it("spreads different ids across the palette", () => {
    const colors = new Set(["a", "b", "c", "d", "e"].map(convoColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe("filterNodesByConvo", () => {
  const nodes = [
    { id: "n1", threadId: "t1" },
    { id: "n2", threadId: "t2" },
    { id: "n3", threadId: null },
  ];
  it("returns all nodes when off", () => {
    expect(filterNodesByConvo(nodes, "t1", false)).toHaveLength(3);
  });
  it("returns all nodes when on but no active thread", () => {
    expect(filterNodesByConvo(nodes, null, true)).toHaveLength(3);
  });
  it("keeps only the active convo's nodes when on", () => {
    expect(filterNodesByConvo(nodes, "t1", true).map((n) => n.id)).toEqual(["n1"]);
  });
});

describe("convoTabModel", () => {
  it("marks active + working flags", () => {
    const model = convoTabModel(
      [{ id: "t1", title: "A" }, { id: "t2", title: "B" }],
      "t2",
      new Set(["t1"]),
    );
    expect(model).toEqual([
      { id: "t1", title: "A", active: false, working: true },
      { id: "t2", title: "B", active: true, working: false },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/convo-canvas.test.ts`
Expected: FAIL — cannot find module `../convo-canvas`.

- [ ] **Step 3: Implement the helpers**

Create `apps/web/lib/convo-canvas.ts`:

```ts
// Pure helpers for the multi-convo canvas (G4c). No DB, no React — unit-tested in isolation.

export const UNATTRIBUTED_COLOR = "#9aa0a6"; // neutral grey for nodes with no convo

// A small, visually-distinct palette. A node's tint is a stable function of its threadId.
const PALETTE = ["#5b8def", "#e2725b", "#3aa675", "#b86fd1", "#e0a32e", "#2bb1c4", "#d65a8e", "#7a6ff0"];

export function convoColor(threadId: string | null): string {
  if (!threadId) return UNATTRIBUTED_COLOR;
  let hash = 0;
  for (let i = 0; i < threadId.length; i++) {
    hash = (hash * 31 + threadId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function filterNodesByConvo<T extends { threadId: string | null }>(
  nodes: T[],
  activeThreadId: string | null,
  on: boolean,
): T[] {
  if (!on || !activeThreadId) return nodes;
  return nodes.filter((n) => n.threadId === activeThreadId);
}

export function convoTabModel(
  threads: { id: string; title: string }[],
  activeThreadId: string | null,
  activity: Set<string>,
): { id: string; title: string; active: boolean; working: boolean }[] {
  return threads.map((t) => ({
    id: t.id,
    title: t.title,
    active: t.id === activeThreadId,
    working: activity.has(t.id),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/convo-canvas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/convo-canvas.ts apps/web/lib/__tests__/convo-canvas.test.ts
git commit -m "feat(g4c): pure helpers — convoColor, filterNodesByConvo, convoTabModel"
```

---

### Task 4: `<ConvoTabs>` presentational component

**Files:**
- Create: `apps/web/components/otto/ConvoTabs.tsx`

**Interfaces:**
- Consumes: `convoTabModel` (Task 3).
- Produces: `ConvoTabs({ threads, activeThreadId, activity, onSelect, onNew, onDelete })` where `threads: ChatThreadDTO[]`, `activity: Set<string>`, `onSelect: (id: string) => void`, `onNew: () => void`, `onDelete: (id: string) => void`.

> No RTL render test (the repo unit-tests pure helpers, not JSX). The component's logic lives in `convoTabModel` (Task 3, tested). This task is verified by `pnpm -r build` (Task 7) and manual review.

- [ ] **Step 1: Implement the component**

Create `apps/web/components/otto/ConvoTabs.tsx`:

```tsx
"use client";
import React from "react";
import type { ChatThreadDTO } from "@/lib/types";
import { convoColor, convoTabModel } from "@/lib/convo-canvas";

interface ConvoTabsProps {
  threads: ChatThreadDTO[];
  activeThreadId: string | null;
  activity: Set<string>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function ConvoTabs({ threads, activeThreadId, activity, onSelect, onNew, onDelete }: ConvoTabsProps) {
  const tabs = convoTabModel(
    threads.map((t) => ({ id: t.id, title: t.title || "Untitled" })),
    activeThreadId,
    activity,
  );
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: "var(--space-2)",
        padding: "var(--space-2) var(--space-3)", overflowX: "auto", flexShrink: 0,
        borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-card)",
      }}
    >
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.active}
          onClick={() => onSelect(t.id)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
            padding: "4px 10px", borderRadius: "var(--radius-md)", whiteSpace: "nowrap",
            border: "1px solid " + (t.active ? "var(--border-strong)" : "transparent"),
            background: t.active ? "var(--surface-raised)" : "transparent",
            color: "var(--text-body)", fontSize: 13, maxWidth: 180,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: convoColor(t.id) }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
          {t.working && (
            <span
              aria-label="working"
              style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: "var(--accent)" }}
            />
          )}
          <button
            type="button"
            aria-label="Delete conversation"
            onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
            style={{ border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", padding: 0, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={onNew}
        style={{
          marginLeft: "auto", flexShrink: 0, border: "1px solid var(--border-subtle)",
          background: "transparent", color: "var(--text-body)", cursor: "pointer",
          padding: "4px 10px", borderRadius: "var(--radius-md)", fontSize: 13,
        }}
      >
        + New convo
      </button>
    </div>
  );
}

export default ConvoTabs;
```

- [ ] **Step 2: Typecheck (no test for JSX)**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: no errors referencing `ConvoTabs.tsx`. (If `--accent` etc. are missing CSS vars, swap for an existing token used elsewhere in `apps/web/app/otto/otto-theme.css`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/otto/ConvoTabs.tsx
git commit -m "feat(g4c): ConvoTabs presentational tab strip (color dot + activity dot + new/delete)"
```

---

### Task 5: Attribution write path — thread `activeThreadId` into the canvas

**Files:**
- Modify: `apps/web/components/canvas/useCanvasGen.ts`
- Modify: `apps/web/components/canvas/FlowCanvas.tsx` (props + text-node create + useCanvasGen call)
- Modify: `apps/web/components/otto/OttoView.tsx` (pass `activeThreadId` to `FlowCanvas`)

**Interfaces:**
- Consumes: `createCanvasNode` with `threadId` (Task 1).
- Produces: `useCanvasGen(projectId, onNode, onResolve, activeThreadId?: string | null)`; `FlowCanvas` accepts `activeThreadId?: string | null`. Canvas-direct image/video/text nodes are stamped with the focused convo.

> Wiring task. The unit guarantee that `threadId` is handled correctly lives in Task 1; this passes the value through. Verified by `pnpm -r build` (Task 7) + manual.

- [ ] **Step 1: Thread `activeThreadId` through `useCanvasGen`**

In `apps/web/components/canvas/useCanvasGen.ts`, change the signature and both `createCanvasNode` calls:

```ts
export function useCanvasGen(
  projectId: string,
  onNode: (node: CanvasNodeDTO) => void,
  onResolve: (nodeId: string, result: { generationId?: string; status: string }) => void,
  activeThreadId?: string | null,
) {
```

In `generateImage`, add `threadId` to the create call:

```ts
    const created = await createCanvasNode({ projectId, type: "image", ...pos, prompt, genJobId: started.id, status: "pending", ...(activeThreadId ? { threadId: activeThreadId } : {}) });
```

In `animate`, likewise:

```ts
    const created = await createCanvasNode({ projectId, type: "video", ...pos, prompt, genJobId: started.id, status: "pending", sourceNodeId, ...(activeThreadId ? { threadId: activeThreadId } : {}) });
```

Add `activeThreadId` to the `useCallback` dependency arrays for `generateImage` and `animate` (append `, activeThreadId`).

> Confirm the exact callback param names/types of `onNode`/`onResolve` against the current file before editing; keep them unchanged — only append the 4th param.

- [ ] **Step 2: Accept + pass `activeThreadId` in `FlowCanvas`**

In `apps/web/components/canvas/FlowCanvas.tsx`, change the component signature:

```tsx
export default function FlowCanvas({ projectId, entities = [], activeThreadId = null }: { projectId: string; entities?: EntityDTO[]; activeThreadId?: string | null }) {
```

Pass it to the hook (around line 115):

```tsx
  const { generateImage, animate, cancelledRef } = useCanvasGen(projectId, onNewNode, onResolve, activeThreadId);
```

And stamp the text-node create (around line 219):

```tsx
            const result = await createCanvasNode({ projectId, type: "text", x, y: 80, w: 240, h: 120, text: "", status: "done", ...(activeThreadId ? { threadId: activeThreadId } : {}) });
```

- [ ] **Step 3: Pass `activeThreadId` from `OttoView`**

In `apps/web/components/otto/OttoView.tsx`, update the `FlowCanvas` usage (~line 175):

```tsx
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <FlowCanvas projectId={projectId} entities={entities} activeThreadId={activeThreadId} />
      </div>
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: no errors in the three edited files.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/canvas/useCanvasGen.ts apps/web/components/canvas/FlowCanvas.tsx apps/web/components/otto/OttoView.tsx
git commit -m "feat(g4c): stamp canvas nodes with the focused convo (activeThreadId → createCanvasNode)"
```

---

### Task 6: Board tinting + "filter to this convo" toggle

**Files:**
- Modify: `apps/web/components/canvas/FlowCanvas.tsx` (filter toggle + tint), and the image/video node renderers if a border tint is added there.

**Interfaces:**
- Consumes: `filterNodesByConvo`, `convoColor` (Task 3); node DTOs now carry `threadId` (Task 1).

> The filter logic is `filterNodesByConvo` (Task 3, tested). This task wires it into the live node list + adds a toolbar toggle. Verified by `pnpm -r build` + manual.

- [ ] **Step 1: Add a filter toggle state**

In `apps/web/components/canvas/FlowCanvas.tsx`, add near the other `useState` hooks:

```tsx
  const [filterToConvo, setFilterToConvo] = useState(false);
```

Import the helpers at the top:

```tsx
import { filterNodesByConvo, convoColor } from "@/lib/convo-canvas";
```

- [ ] **Step 2: Apply the filter to the rendered nodes**

Find where the React Flow `nodes` array (the DTO-backed list mapped into RF nodes) is built. Before mapping rows → RF nodes, filter the source rows:

```tsx
  const visibleRows = filterNodesByConvo(rows, activeThreadId, filterToConvo);
```

(Use `visibleRows` in place of `rows` in the existing `.map(...)` that produces RF nodes. `rows` is whatever the file currently calls the `CanvasNodeDTO[]` state — confirm its name before editing.)

- [ ] **Step 3: Tint each node by its convo**

In the RF-node mapping, set a border color from `convoColor(row.threadId)`. If the node's `style`/`data` carries presentation, add:

```tsx
    style: { ...existingStyle, boxShadow: `0 0 0 2px ${convoColor(row.threadId)}` },
```

(Adapt to the existing node `style`/`data` shape — keep current styles, only add the tinted ring.)

- [ ] **Step 4: Add the toolbar toggle (only meaningful when a convo is focused)**

In the canvas toolbar JSX, add:

```tsx
  {activeThreadId && (
    <button
      type="button"
      onClick={() => setFilterToConvo((v) => !v)}
      aria-pressed={filterToConvo}
      style={{ border: "1px solid var(--border-subtle)", background: filterToConvo ? "var(--surface-raised)" : "transparent", color: "var(--text-body)", cursor: "pointer", padding: "4px 10px", borderRadius: "var(--radius-md)", fontSize: 13 }}
    >
      {filterToConvo ? "Showing this convo" : "Filter to this convo"}
    </button>
  )}
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: no errors in `FlowCanvas.tsx`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/canvas/FlowCanvas.tsx
git commit -m "feat(g4c): tint canvas nodes by convo + filter-to-this-convo toggle"
```

---

### Task 7: Mount `<ConvoTabs>` + poll activity; final build gate

**Files:**
- Modify: `apps/web/components/otto/OttoApp.tsx` (activity poll state + pass-down)
- Modify: `apps/web/components/otto/OttoView.tsx` (render `<ConvoTabs>`; accept new props)

**Interfaces:**
- Consumes: `listProjectThreadActivity` (Task 2), `<ConvoTabs>` (Task 4), existing `handleDeleteThread`/`setActiveThreadId` (OttoApp).

> Integration task. The reader and tab logic are unit-tested (Tasks 2–4). Verified end-to-end by the full build gate below + manual.

- [ ] **Step 1: Poll activity in `OttoApp`**

In `apps/web/components/otto/OttoApp.tsx`, add an activity state + a poll effect (only while the `otto` view is open):

```tsx
import { useEffect } from "react"; // merge into the existing React import
import { listProjectThreadActivity } from "@/lib/thread-activity";
```

```tsx
  const [activity, setActivity] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (view !== "otto") return;
    let alive = true;
    async function poll() {
      const res = await listProjectThreadActivity(projectId);
      if (alive && Array.isArray(res)) {
        setActivity(new Set(res.filter((r) => r.pending).map((r) => r.threadId)));
      }
    }
    poll();
    const h = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(h); };
  }, [view, projectId, threads.length]);
```

Pass `activity`, the delete handler, and the new-convo handler down to `OttoView`:

```tsx
        <OttoView
          // ...existing props...
          activity={activity}
          onDeleteThread={handleDeleteThread}
          onNewConvo={() => setActiveThreadId(null)}
        />
```

- [ ] **Step 2: Render `<ConvoTabs>` in `OttoView`**

In `apps/web/components/otto/OttoView.tsx`, extend `OttoViewProps`:

```tsx
  activity: Set<string>;
  onDeleteThread: (id: string) => void;
  onNewConvo: () => void;
```

Destructure them in the function signature. Import the component:

```tsx
import { ConvoTabs } from "./ConvoTabs";
```

Render `<ConvoTabs>` at the very top of the left chat pane, above both the front-door and the chat. The left pane is the column with `flex: "0 0 clamp(360px, 38%, 520px)"`. Wrap its contents so the tabs sit above:

```tsx
      <div style={{ flex: "0 0 clamp(360px, 38%, 520px)", display: "flex", flexDirection: "column", minWidth: 0, borderRight: "1px solid var(--border-subtle)" }}>
        <ConvoTabs
          threads={threads}
          activeThreadId={activeThreadId}
          activity={activity}
          onSelect={onActiveThreadChange}
          onNew={onNewConvo}
          onDelete={onDeleteThread}
        />
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {/* existing showFrontDoor ? <OttoFrontDoor/> : <OttoChatStream/> : <OttoConversation/> block */}
        </div>
      </div>
```

> Preserve the existing left-pane wrapper's flex sizing — move the conditional block inside the new inner `<div>`. Do not change `key={activeThread.id}` on `OttoChatStream` (it keeps per-thread chat isolation).

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: no errors; `OttoApp`→`OttoView`→`ConvoTabs` props all line up.

- [ ] **Step 4: Run the whole web test suite**

Run: `cd apps/web && pnpm exec vitest run`
Expected: PASS (all G4c tests + existing suite green).

- [ ] **Step 5: Full monorepo build gate**

Run: `pnpm -r build 2>&1 | tee /tmp/g4c-build.log; grep -E "ƒ /otto|Done|error" /tmp/g4c-build.log`
Expected: the log shows `├ ƒ /otto` and `Done`, and NO `error`/type failures. (Do not trust the pipe's exit code — read the grep output.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/otto/OttoApp.tsx apps/web/components/otto/OttoView.tsx
git commit -m "feat(g4c): mount ConvoTabs + poll per-convo activity; build-verified"
```

---

## Self-Review

**Spec coverage:**
- §2.1 Convo tab strip → Tasks 4 (component) + 7 (mount). ✓
- §2.2 Activity dots → Tasks 2 (reader) + 3 (`convoTabModel.working`) + 7 (poll). ✓
- §2.3 Shared-board persistence guard → board is a stable sibling; Task 7 keeps `FlowCanvas` mounted across switches and does NOT key it by thread. (Regression is structural — `FlowCanvas` stays outside the per-thread conditional; a render-remount test is impractical without RTL, so the guard is the explicit structural note here + manual check that switching tabs preserves board state.) ✓
- §2.4 Node attribution → Tasks 1 (schema + write validation) + 5 (write path) + 6 (tint + filter). ✓
- §5 Money/safety → no spend file touched; new reader + write are `requireOwner` + `ownedProject` scoped; cross-project `threadId` rejected (Task 1). ✓
- §6 Testing → Tasks 1–3 carry unit tests; integration tasks gated by full build + suite (Task 7). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The two "confirm the current name before editing" notes (Task 5 `onNode`/`onResolve`, Task 6 `rows`) are guardrails against drift, not missing content — the edits are fully specified.

**Type consistency:** `threadId` is `string?`/`string | null` consistently across schema, `CreateNodeInput`, `CanvasNodeDTO`, and helpers. `listProjectThreadActivity` return shape matches its consumer in Task 7 (`{threadId, pending}[]` → `Set<string>`). `convoTabModel` `{id,title,active,working}` matches `ConvoTabs` usage. `useCanvasGen` 4th param `activeThreadId` matches `FlowCanvas` prop and `OttoView` pass-down.

**Note on the shared-board guard:** It is the one item without an automated test (no RTL in this repo). Flagged explicitly so the reviewer manually verifies "switch convo tab → board nodes/positions unchanged".

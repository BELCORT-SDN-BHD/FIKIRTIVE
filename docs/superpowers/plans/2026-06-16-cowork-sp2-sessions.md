# Cowork SP2 · Sessions (chatbox thread list) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. Use codegraph to ground edits.

**Goal:** Turn the Cowork surface into a chatbox: a left rail listing the project's conversation threads, with new-chat / switch / rename / soft-delete — on the EXISTING `ChatThread` model (no schema change, no money-path change).

**Architecture:** The `getCoworkThreads(projectId)` hydrate already returns every live thread WITH its messages, passed to `Cowork` as `threads: ChatThreadDTO[]`. So the sidebar + thread-switching are pure client-state over that prop (no new fetch to switch). Two new owner-scoped server actions — `coworkRenameThread` + `coworkDeleteThread` (soft-delete) — handle the mutations. New chat = clear the active thread; the first `coworkTurn` with no `threadId` creates one (existing behavior). Titles stay auto-from-first-message (coworkTurn already sets `title = text.slice(0,80)`), now editable via rename.

**Tech Stack:** Next.js 16 (customized), React client components, Prisma, `@fikirtive/core`/`@fikirtive/db`, vitest.

**House rules:** rename/delete are NOT spend paths (metadata-only on ChatThread, owner-scoped, soft-delete) — but still owner-guarded + validated. No schema change. Surgical. No auto-commit/push (per-task local commits on a feature branch). `/codex` review before deploy; deploy needs explicit user authorization.

**Scope (user-decided 2026-06-16):** auto-title (first message) + rename; minimal v1 = list / new / switch / rename / soft-delete; NO search/pin. Threads are per-project (`ChatThread.projectId`) + soft-deletable (`deletedAt` + the live-thread partial index) — both already in the schema.

---

### Task 1: `coworkRenameThread` + `coworkDeleteThread` server actions

**Files:**
- Modify: `packages/core/src/cowork.ts` (+ 2 request schemas)
- Modify: `apps/web/lib/cowork-actions.ts` (+ 2 actions)
- Create: `scripts/verify-cowork-sessions.mjs` (mock-$0: owner-guard + soft-delete + no GenJob)

- [ ] **Step 1: Request schemas in `cowork.ts`** (near `coworkGenerateRequest`):
```ts
export const coworkRenameThreadRequest = z.object({
  threadId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(120),
}).strict();
export type CoworkRenameThreadRequest = z.infer<typeof coworkRenameThreadRequest>;

export const coworkDeleteThreadRequest = z.object({
  threadId: z.string().min(1).max(64),
}).strict();
export type CoworkDeleteThreadRequest = z.infer<typeof coworkDeleteThreadRequest>;
```

- [ ] **Step 2: Actions in `cowork-actions.ts`** (add imports `coworkRenameThreadRequest`, `coworkDeleteThreadRequest`). Owner-scoped `updateMany` (the `where: { ownerId }` makes it impossible to touch another owner's thread; `count===0` ⇒ not found/owned). Soft-delete sets `deletedAt` (messages stay; getCoworkThreads filters `deletedAt:null`; any threadId-tagged GenJobs stay isolated):
```ts
export async function coworkRenameThread(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const parsed = coworkRenameThreadRequest.safeParse(raw);
  if (!parsed.success) return { error: "Give the conversation a title (1-120 chars)." };
  const { threadId, title } = parsed.data;
  const { count } = await prisma.chatThread.updateMany({
    where: { id: threadId, ownerId: FOUNDER_OWNER_ID, deletedAt: null },
    data: { title },
  });
  if (!count) return { error: "Conversation not found." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function coworkDeleteThread(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const parsed = coworkDeleteThreadRequest.safeParse(raw);
  if (!parsed.success) return { error: "Invalid request." };
  const { threadId } = parsed.data;
  const { count } = await prisma.chatThread.updateMany({
    where: { id: threadId, ownerId: FOUNDER_OWNER_ID, deletedAt: null },
    data: { deletedAt: new Date() }, // soft-delete: hides from the list; messages + isolation untouched
  });
  if (!count) return { error: "Conversation not found." };
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 3: Build + typecheck.** `pnpm --filter @fikirtive/core build && pnpm --filter web typecheck` → PASS.

- [ ] **Step 4: Mock-$0 verify** `scripts/verify-cowork-sessions.mjs` (mirrors the other verify scripts — replicates the actions' DB effects; no `"use server"` import). Proves: rename updates only the owned thread; a cross-owner thread is NOT renamed/deleted; soft-delete sets deletedAt + the thread drops out of the live-list query + its messages remain + ZERO GenJob touched:
```js
import { readFileSync } from "node:fs";
const envPath = new URL("../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
if (process.env.GENERATION_PROVIDER === "fal" || process.env.COWORK_PROVIDER === "fal") { console.error("✗ refusing: fal provider set"); process.exit(1); }
const { prisma } = await import("../packages/db/dist/src/index.js");
const { newId, FOUNDER_OWNER_ID } = await import("../packages/core/dist/index.js");
let failed = false; const check = (l, ok, d) => { console.log(`${ok ? "✓" : "✗"} ${l}`, d ?? ""); if (!ok) failed = true; };
const created = { projects: [] };
try {
  const project = await prisma.project.create({ data: { id: newId(), name: "sessions verify" } });
  created.projects.push(project.id);
  const t = await prisma.chatThread.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, title: "orig" } });
  await prisma.chatMessage.create({ data: { id: newId(), threadId: t.id, ownerId: FOUNDER_OWNER_ID, role: "USER", kind: "TEXT", seq: 1, text: "hi" } });
  const genBefore = await prisma.genJob.count();
  // rename (owner-scoped updateMany) — owned thread renamed
  const r1 = await prisma.chatThread.updateMany({ where: { id: t.id, ownerId: FOUNDER_OWNER_ID, deletedAt: null }, data: { title: "renamed" } });
  check("owned thread renamed (count=1)", r1.count === 1, r1);
  // cross-owner guard: a wrong owner cannot rename
  const r2 = await prisma.chatThread.updateMany({ where: { id: t.id, ownerId: "not-the-owner", deletedAt: null }, data: { title: "hacked" } });
  check("cross-owner rename blocked (count=0)", r2.count === 0, r2);
  // soft-delete
  const d1 = await prisma.chatThread.updateMany({ where: { id: t.id, ownerId: FOUNDER_OWNER_ID, deletedAt: null }, data: { deletedAt: new Date() } });
  check("owned thread soft-deleted (count=1)", d1.count === 1, d1);
  const live = await prisma.chatThread.count({ where: { projectId: project.id, ownerId: FOUNDER_OWNER_ID, deletedAt: null } });
  check("soft-deleted thread drops out of the live list", live === 0, { live });
  const msgs = await prisma.chatMessage.count({ where: { threadId: t.id } });
  check("messages survive the soft-delete (not cascaded)", msgs === 1, { msgs });
  const genAfter = await prisma.genJob.count();
  check("ZERO GenJob touched (sessions are not a spend path)", genAfter === genBefore, { before: genBefore, after: genAfter });
  if (failed) { console.error("\n✗ sessions verify FAILED"); process.exit(1); }
  console.log("\n✓ sessions: owner-scoped rename/soft-delete, messages survive, $0, no GenJob");
} finally {
  for (const id of created.projects) {
    await prisma.chatMessage.deleteMany({ where: { thread: { projectId: id } } }).catch(() => {});
    await prisma.chatThread.deleteMany({ where: { projectId: id } }).catch(() => {});
    await prisma.project.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
}
```
Run: `pnpm --filter @fikirtive/core build && pnpm --filter @fikirtive/db build && node scripts/verify-cowork-sessions.mjs 2>&1 | grep -E "✓|✗"` → all ✓.

- [ ] **Step 5: Commit (local, no push).** `git add packages/core/src/cowork.ts apps/web/lib/cowork-actions.ts scripts/verify-cowork-sessions.mjs && git commit -m "feat(cowork): rename + soft-delete thread server actions (SP2 sessions)"`

---

### Task 2: `Cowork.tsx` — the chatbox sidebar (list / new / switch / rename / delete)

**Files:**
- Modify: `apps/web/components/studio/Cowork.tsx`
- Modify: the studio stylesheet (`apps/web/app/globals.css`) — `cw-rail*` classes

Refactor the single-thread surface into **list + active**. The `threads` prop already carries every thread with messages, so switching is client-state. Read the current `Cowork.tsx` first.

- [ ] **Step 1: State refactor.** Replace the single `thread`/`messages` state with a mutable thread list + an active id; derive messages from the active thread:
```tsx
const [list, setList] = useState<ChatThreadDTO[]>(threads);
const [activeId, setActiveId] = useState<string | null>(threads[0]?.id ?? null);
const active = list.find((t) => t.id === activeId) ?? null;
const messages = active?.messages ?? [];
```
(Drop the old `thread`/`messages` useState. Keep text/ids/variantSel/busy/busyRef/composerKey/error.)

- [ ] **Step 2: `send()` updates the list + active.** After a turn, refetch the active (or new) thread via `getCoworkThreadClient(res.threadId)` and splice it into `list` (replace if present, prepend if new), set `activeId = res.threadId`:
```tsx
const fresh = await getCoworkThreadClient(res.threadId);
if (fresh) {
  setList((cur) => { const rest = cur.filter((t) => t.id !== fresh.id); return [fresh, ...rest]; }); // newest-first
  setActiveId(fresh.id);
}
```

- [ ] **Step 3: New chat / switch handlers.**
```tsx
function newChat() { setActiveId(null); setText(""); setIds([]); setVariantSel({}); setComposerKey((k) => k + 1); setError(null); }
function selectThread(id: string) { setActiveId(id); setError(null); }
```
(`activeId === null` ⇒ empty composer; the next `send()` calls `coworkTurn` with `threadId: undefined` → creates a new thread.)

- [ ] **Step 4: Rename + delete handlers** (call the Task-1 actions; update local list optimistically; revalidate handles the server copy):
```tsx
async function renameThread(id: string, title: string) {
  const t = title.trim(); if (!t) return;
  setList((cur) => cur.map((x) => (x.id === id ? { ...x, title: t } : x)));
  const res = await coworkRenameThread({ threadId: id, title: t });
  if ("error" in res) setError(res.error); // (optionally re-fetch to revert on error)
}
async function deleteThread(id: string) {
  const res = await coworkDeleteThread({ threadId: id });
  if ("error" in res) { setError(res.error); return; }
  setList((cur) => cur.filter((x) => x.id !== id));
  if (activeId === id) setActiveId((cur) => { const next = list.find((x) => x.id !== id); return next?.id ?? null; });
}
```
Add the imports: `coworkRenameThread`, `coworkDeleteThread` from `@/lib/cowork-actions`.

- [ ] **Step 5: Layout — a left rail + the existing chat area.** Wrap the surface in a flex row: a `cw-rail` (thread list) on the left + the existing `.screen` on the right. The rail: a "+ New chat" button at top, then the threads (newest-first) as rows — each row shows the title (click to switch, active highlighted), an inline rename (double-click or a pencil icon → an input), and a delete (trash icon → confirm). Use a delete-confirm (a simple `window.confirm` or an inline confirm state) to avoid accidental loss. Keep it consistent with the studio design tokens. Reuse `al-btn`/`al-iconbtn` classes where they exist (grep GenSpace).

- [ ] **Step 6: CSS** — add `cw-rail`, `cw-rail-new`, `cw-rail-item`, `cw-rail-item-active`, `cw-rail-title`, `cw-rail-actions` (+ rename input) to `globals.css`, matching the existing studio tokens (the `.screen`/`.cw-*` neighborhood). Minimal, consistent.

- [ ] **Step 7: Typecheck + build.** `pnpm --filter web typecheck && pnpm --filter web build` → PASS.

- [ ] **Step 8: Commit (local, no push).** `git add apps/web/components/studio/Cowork.tsx apps/web/app/globals.css && git commit -m "feat(cowork): chatbox sidebar — thread list/new/switch/rename/delete (SP2 sessions)"`

---

### Task 3: Gate + Codex

- [ ] **Step 1: Full gate.** Kill stale fal workers; `pnpm -r typecheck && pnpm --filter @fikirtive/core test && pnpm --filter web build && node scripts/verify-cowork-sessions.mjs` → all green.
- [ ] **Step 2: Codex review** the SP2 diff. Focus: rename/delete are owner-scoped (no cross-owner mutation), soft-delete only (no hard delete / no cascade surprise), NOT a spend path (no GenJob/startGen), the UI switch/new/delete can't strand the user or lose the active thread. Address P1/P2.
- [ ] **Step 3: STOP** — deploy needs explicit user authorization (then the standard `railway up --service web`; no migration this time — no schema change).

---

## Self-Review
- **Scope coverage:** list (T2) ✓; new (T2 newChat) ✓; switch (T2 selectThread, client-state over the hydrated prop) ✓; rename (T1 action + T2 handler, auto-title preserved) ✓; soft-delete (T1 action + T2 handler) ✓. No search/pin (out of v1 per user). No schema change (uses existing ChatThread). 
- **Money-safety:** rename/delete touch only ChatThread metadata, owner-scoped, soft-delete — no GenJob, no startGen, no spend (T1 verify asserts ZERO GenJob). Sessions can't affect the spend path.
- **Type consistency:** `coworkRenameThreadRequest`/`coworkDeleteThreadRequest` (core) ↔ the actions (web) ↔ the T2 handlers. `ChatThreadDTO`/`ChatMessageDTO` (existing) flow into the refactored list/active state unchanged.

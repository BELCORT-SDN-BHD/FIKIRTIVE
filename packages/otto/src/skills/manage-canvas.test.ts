import { describe, it, expect, vi } from "vitest";
import { canvasCardIsInFlightPaid } from "@fikirtive/core/canvas-card-status";
import { executeManageCanvas, manageCanvasSkill, isInFlightPaidNode, VIEW_NODE_CAP } from "./manage-canvas.js";
import type { OttoContext, CanvasNodeView } from "../context.js";

// W-B3-A (parity debts 33-37 + 60 / E1-01): the skill routes EVERY operation through the
// injected ctx.canvas port — thin closures over the same owner-gated $0 server actions the
// human canvas UI uses. Tests mock the port and assert the skill's orchestration: routing,
// $0 hard lines (no generationId ⇒ refuse media placement), the in-flight-delete confirm,
// and the C1 $0 sub-journey (empty board → place → derivation visible).

type Port = NonNullable<OttoContext["canvas"]>;

function makeCtx(canvas?: Partial<Port>): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    sourceGenerationId: null,
    ...(canvas ? { canvas: canvas as Port } : {}),
  } as unknown as OttoContext;
}

function node(over: Partial<CanvasNodeView> = {}): CanvasNodeView {
  return {
    id: "n-1", type: "text", x: 80, y: 80, w: 240, h: 120,
    text: "hello", prompt: null, generationId: null, status: "done",
    genJobId: null, batchIndex: null, batchSize: null, madeFromNodeId: null,
    url: null, ...over,
  };
}

describe("manageCanvas registration hygiene", () => {
  it("instructions.ts carries the model-facing 'When to call' entry (REVIEWER-PLAYBOOK:107)", async () => {
    const { ottoInstructions } = await import("../instructions.js");
    expect(ottoInstructions).toContain("When to call \`manageCanvas\`");
    expect(ottoInstructions).toContain("by hand on the canvas");
  });
});

describe("manageCanvas gate", () => {
  it("free/write/internal → needsApproval false ($0 canvas surface, same as the human UI)", () => {
    expect(manageCanvasSkill.cost).toBe("free");
    expect(manageCanvasSkill.effect).toBe("write");
    expect(manageCanvasSkill.reach).toBe("internal");
    expect(manageCanvasSkill.needsApproval).toBe(false);
  });
});

describe("executeManageCanvas — port required", () => {
  it("degrades gracefully when ctx.canvas is not injected (minimal worker ctx)", async () => {
    const res = await executeManageCanvas({ action: "view" }, { context: makeCtx() });
    expect(res).toEqual({ ok: false, error: "The canvas isn't available right now." });
  });
});

describe("view", () => {
  it("syncs (display-only bridge) then returns trimmed nodes", async () => {
    const sync = vi.fn(async () => [node({ id: "a", url: "https://cdn/x.png", type: "image", generationId: "g1" })]);
    const res = await executeManageCanvas({ action: "view" }, { context: makeCtx({ sync }) });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(res).toEqual({
      ok: true,
      count: 1,
      truncated: false,
      nodes: [{
        id: "a", type: "image", status: "done", x: 80, y: 80, w: 240, h: 120,
        text: "hello", prompt: null, generationId: "g1", hasMedia: true,
        // The two relationships, under their own names (#603 T4).
        genJobId: null, batchIndex: null, batchSize: null, madeFromNodeId: null,
      }],
    });
  });
  it("caps the payload on a busy canvas and says so", async () => {
    const many = Array.from({ length: VIEW_NODE_CAP + 5 }, (_, i) => node({ id: `n-${i}` }));
    const sync = vi.fn(async () => many);
    const res = (await executeManageCanvas({ action: "view" }, { context: makeCtx({ sync }) })) as {
      ok: boolean; count: number; truncated: boolean; nodes: unknown[];
    };
    expect(res.count).toBe(VIEW_NODE_CAP + 5);
    expect(res.truncated).toBe(true);
    expect(res.nodes).toHaveLength(VIEW_NODE_CAP);
  });
  it("surfaces port errors instead of throwing", async () => {
    const sync = vi.fn(async () => ({ error: "Project not found." }));
    const res = await executeManageCanvas({ action: "view" }, { context: makeCtx({ sync }) });
    expect(res).toEqual({ ok: false, error: "Project not found." });
  });
});

describe("place — $0 hard line", () => {
  it("places a text note with text-sized defaults", async () => {
    const place = vi.fn(async () => ({ id: "new-1" }));
    const res = await executeManageCanvas(
      { action: "place", type: "text", text: "Ramadan promo ideas" },
      { context: makeCtx({ place }) },
    );
    expect(res).toEqual({ ok: true, id: "new-1" });
    expect(place).toHaveBeenCalledWith({ type: "text", x: 80, y: 80, w: 240, h: 120, text: "Ramadan promo ideas" });
  });
  it("REFUSES to place image/video without generationId — new media is generate's job (spend, gated)", async () => {
    const place = vi.fn(async () => ({ id: "never" }));
    const res = (await executeManageCanvas(
      { action: "place", type: "image", prompt: "a latte" },
      { context: makeCtx({ place }) },
    )) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("generationId");
    expect(place).not.toHaveBeenCalled();
  });
  it("places an existing generation at an explicit position", async () => {
    const place = vi.fn(async () => ({ id: "new-2" }));
    await executeManageCanvas(
      { action: "place", type: "image", generationId: "g7", x: 420, y: 80, prompt: "warmer light" },
      { context: makeCtx({ place }) },
    );
    expect(place).toHaveBeenCalledWith({
      type: "image", x: 420, y: 80, w: 320, h: 320, prompt: "warmer light",
      generationId: "g7",
    });
  });
});

describe("edit_text / resolve — pass-through to the shared actions", () => {
  it("edit_text routes nodeId + text; missing params are named", async () => {
    const editText = vi.fn(async () => ({ ok: true as const }));
    const ctx = makeCtx({ editText });
    expect(await executeManageCanvas({ action: "edit_text", nodeId: "n-1", text: "new copy" }, { context: ctx })).toEqual({ ok: true });
    expect(editText).toHaveBeenCalledWith("n-1", "new copy");
    const missing = (await executeManageCanvas({ action: "edit_text", nodeId: "n-1" }, { context: ctx })) as { error: string };
    expect(missing.error).toContain("text");
  });
  it("resolve routes status (+ optional generationId); the server action stays the validator", async () => {
    const resolve = vi.fn(async () => ({ ok: true as const }));
    const ctx = makeCtx({ resolve });
    expect(await executeManageCanvas({ action: "resolve", nodeId: "n-1", status: "done", generationId: "g1" }, { context: ctx })).toEqual({ ok: true });
    expect(resolve).toHaveBeenCalledWith("n-1", { status: "done", generationId: "g1" });
    const failed = vi.fn(async () => ({ error: "Generation required." }));
    const res = await executeManageCanvas({ action: "resolve", nodeId: "n-1", status: "done" }, { context: makeCtx({ resolve: failed }) });
    expect(res).toEqual({ ok: false, error: "Generation required." });
  });
});

describe("remove — in-flight paid cards are UI-only, pre-check is fail-closed (debt-37, v2)", () => {
  // A board read returns the card FACE. `generating` is what a running job's card actually says
  // (#602 T3) — the fixture used to say `pending`, a row word no read ever returns, so this whole
  // guard was being exercised against a value the product cannot produce.
  const inFlight = node({ id: "n-hot", type: "video", status: "generating", url: null, generationId: null });
  it("HARD-refuses an in-flight paid card and directs the user to the canvas (no model self-confirm)", async () => {
    const list = vi.fn(async () => [inFlight]);
    const remove = vi.fn(async () => ({ ok: true as const }));
    const res = (await executeManageCanvas(
      { action: "remove", nodeId: "n-hot" },
      { context: makeCtx({ list, remove }) },
    )) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("refund");
    expect(res.error).toContain("by hand on the canvas");
    expect(remove).not.toHaveBeenCalled();
  });
  it("fail-closed: a failing list pre-check REFUSES the removal (never 'couldn't check, delete anyway')", async () => {
    const list = vi.fn(async () => ({ error: "Project not found." }));
    const remove = vi.fn(async () => ({ ok: true as const }));
    const res = await executeManageCanvas({ action: "remove", nodeId: "n-hot" }, { context: makeCtx({ list, remove }) });
    expect(res).toEqual({ ok: false, error: "Project not found." });
    expect(remove).not.toHaveBeenCalled();
  });
  it("fail-closed: a node absent from the project's list is refused, not deleted blind", async () => {
    const list = vi.fn(async () => [inFlight]);
    const remove = vi.fn(async () => ({ ok: true as const }));
    const res = await executeManageCanvas({ action: "remove", nodeId: "n-elsewhere" }, { context: makeCtx({ list, remove }) });
    expect(res).toEqual({ ok: false, error: "Node not found." });
    expect(remove).not.toHaveBeenCalled();
  });
  it("a settled node is removed without ceremony", async () => {
    const list = vi.fn(async () => [node({ id: "n-done", type: "image", status: "done", url: "https://cdn/x.png" })]);
    const remove = vi.fn(async () => ({ ok: true as const }));
    const res = await executeManageCanvas({ action: "remove", nodeId: "n-done" }, { context: makeCtx({ list, remove }) });
    expect(res).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith("n-done");
  });
  it("isInFlightPaidNode IS the human UI guard — same function, not a copy of it (#602 r2)", () => {
    // The words this reads are CARD FACES: it is handed a board read (`canvas.list()`), and a
    // board read returns faces. The old hand-kept copy tested `pending`, a stored ROW word that
    // no board read has returned since the faces split queued/generating apart — so Otto could
    // delete a merchant's in-flight PAID card with no refusal at all.
    expect(isInFlightPaidNode({ type: "image", status: "queued", url: null })).toBe(true);
    expect(isInFlightPaidNode({ type: "video", status: "generating", url: null })).toBe(true);
    // The browser stopped watching, but the job may still be running — still costly to delete.
    expect(isInFlightPaidNode({ type: "image", status: "timeout", url: null })).toBe(true);
    // Every resting face is an answer: the warning would be false.
    for (const settled of ["failed", "cancelled", "missing", "unknown", "done"]) {
      expect(isInFlightPaidNode({ type: "image", status: settled, url: null }), settled).toBe(false);
    }
    expect(isInFlightPaidNode({ type: "image", status: "generating", url: "https://cdn/x.png" })).toBe(false);
    expect(isInFlightPaidNode({ type: "text", status: "generating", url: null })).toBe(false);
    // …and it is literally the shared definition, so the two can never drift again.
    expect(isInFlightPaidNode).toBeTypeOf("function");
    expect(canvasCardIsInFlightPaid({ type: "image", status: "queued", url: null })).toBe(true);
  });
});

// 锚 C1 $0 子旅程（组件级证据）：空布 → 节点操作 → 派生关系可见。
// A stateful fake port (standing in for the owner-scoped canvas-actions, which have their own
// tests in apps/web/lib/__tests__/canvas-actions.test.ts) proves the Otto executor can drive
// the whole journey through ctx.canvas alone — no startGen, no credits, no provider anywhere.
describe("C1 $0 sub-journey: empty board → place → derivation visible (Otto executor path)", () => {
  it("walks the journey through the port only", async () => {
    const store: CanvasNodeView[] = [];
    let seq = 0;
    const port: Port = {
      list: async () => [...store],
      sync: async () => [...store],
      place: async (input) => {
        const id = `n-${++seq}`;
        store.push({
          id, type: input.type, x: input.x, y: input.y, w: input.w, h: input.h,
          text: input.text ?? null, prompt: input.prompt ?? null,
          generationId: input.generationId ?? null, status: "done",
          genJobId: null, batchIndex: null, batchSize: null, madeFromNodeId: null,
          url: input.generationId ? "https://cdn/g.png" : null,
        });
        return { id };
      },
      editText: async (id, text) => {
        const n = store.find((s) => s.id === id && s.type === "text");
        if (!n) return { error: "Node not found." };
        n.text = text;
        return { ok: true };
      },
      resolve: async () => ({ ok: true }),
      remove: async (id) => {
        const i = store.findIndex((s) => s.id === id);
        if (i < 0) return { error: "Node not found." };
        store.splice(i, 1);
        return { ok: true };
      },
    };
    const ctx = makeCtx(port);

    // 1. Empty board.
    const empty = (await executeManageCanvas({ action: "view" }, { context: ctx })) as { count: number };
    expect(empty.count).toBe(0);

    // 2. Place a text note, then reword it.
    const note = (await executeManageCanvas({ action: "place", type: "text", text: "hero shot ideas" }, { context: ctx })) as { id: string };
    await executeManageCanvas({ action: "edit_text", nodeId: note.id, text: "hero shot — warm light" }, { context: ctx });

    // 3. Place two ALREADY-generated images. Otto cannot declare that one came from the other:
    //     parentage is the paid job's own record, and placing a finished picture is not one
    //     (#603 T4).
    const base = (await executeManageCanvas(
      { action: "place", type: "image", generationId: "gen-base", prompt: "latte on marble" },
      { context: ctx },
    )) as { id: string };
    await executeManageCanvas(
      { action: "place", type: "image", generationId: "gen-derived", prompt: "same, golden hour", x: 420 },
      { context: ctx },
    );

    // 4. The view carries the relationships the SERVER recorded, under their own names.
    const view = (await executeManageCanvas({ action: "view" }, { context: ctx })) as {
      count: number;
      nodes: Array<{
        id: string; text: string | null; hasMedia: boolean;
        genJobId: string | null; batchIndex: number | null; batchSize: number | null;
        madeFromNodeId: string | null;
      }>;
    };
    expect(view.count).toBe(3);
    expect(view.nodes.find((n) => n.id === note.id)?.text).toBe("hero shot — warm light");
    expect(view.nodes.find((n) => n.id === base.id)?.hasMedia).toBe(true);
    // Nothing on this board was made from anything: the model is told exactly that.
    expect(view.nodes.every((n) => n.madeFromNodeId === null)).toBe(true);

    // 5. Remove the note — the board keeps the media pair.
    await executeManageCanvas({ action: "remove", nodeId: note.id }, { context: ctx });
    const after = (await executeManageCanvas({ action: "view" }, { context: ctx })) as { count: number };
    expect(after.count).toBe(2);
  });
});

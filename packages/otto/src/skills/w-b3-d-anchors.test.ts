import { describe, it, expect } from "vitest";
import { executeIngestProduct } from "./ingest-product.js";
import { executeProposeIdeas } from "./propose-ideas.js";
import { executeManageCanvas } from "./manage-canvas.js";
import type { OttoContext, CanvasNodeView } from "../context.js";

// W-B3-D anchor sub-journeys (组件级证据, Otto-executor path + stateful fake ports). Like the
// manage-canvas C1 test, these prove the executor can drive the whole $0 journey through ctx ports
// alone — no startGen, no credits, no provider anywhere. Server-action truth is covered by the web
// action tests; the cold-start honesty copy (A1 gate4 threshold) is asserted web-side against
// HOOK_COLDSTART_NOTE (apps/web/.../studio-factory/data.ts).

function makeCtx(over: Partial<OttoContext>): OttoContext {
  return {
    orgId: "org-test", userId: "user-test", projectId: "proj-test", threadId: "thread-test", disabledModels: [], ...over,
  } as unknown as OttoContext;
}

// 锚 A1 · 品牌记忆护城河 —— ingest → 品牌记忆 → 注入链 的 $0 部分。
describe("A1 $0 sub-journey: ingest a product link → brand memory → injected into generation context", () => {
  it("walks ingest → (save) → brand-context injection with zero spend on the executor path", async () => {
    // 1. Ingest a product LINK ($0 external read via the port). Otto gets a DRAFT, not a save.
    const ingestCtx = makeCtx({
      productIngest: {
        fromUrl: async (url: string) => ({
          draft: { name: "Signature Latte", price: "RM 15", description: "House blend, oat option", imageUrl: null, sourceUrl: url } as never,
          text: "Signature Latte — RM 15. Our house blend...",
        }),
      },
    });
    const ingest = (await executeIngestProduct({ url: "https://shop.example/latte" }, { context: ingestCtx })) as {
      draft: { name: string; price: string }; pageText: string; note: string;
    };
    expect(ingest.draft.name).toBe("Signature Latte");
    expect(ingest.note).toContain("saveProduct"); // the next $0 write step the user confirms into
    // $0 by construction: the ingest port exposes no spend surface.
    expect(ingestCtx.startGen).toBeUndefined();
    expect("credits" in (ingestCtx.productIngest as object)).toBe(false);

    // 2. After the user confirms + saveProduct persists it (web action, tested there), the compiled
    //    brand memory is what gets INJECTED at generation time — the moat's payoff. Model the
    //    injection port returning brand text that now carries the ingested product.
    const injected = "Products: Signature Latte (RM 15) — House blend, oat option.";
    const genCtx = makeCtx({ brandBrain: { context: async () => injected } });
    const brandText = await genCtx.brandBrain!.context();
    expect(brandText).toContain("Signature Latte"); // ingest → memory → injection link is closed
    expect(genCtx.startGen).toBeUndefined(); // still $0 on this executor path
  });
});

// 锚 I1 · 想法清单（反 Buffer 自证）—— 捕获 → suggest → 转画布提案。
describe("I1 $0 sub-journey: capture an idea → Suggest 3 ideas → turn one into a canvas proposal", () => {
  it("walks capture → proposeIdeas → manageCanvas.place, all through ports, zero spend", async () => {
    const ctx0 = makeCtx({});

    // 1. Capture: the user jots a raw idea (a plain string Otto holds — no heavy pipeline, anchor I1).
    const captured = "we keep selling out of croissants by noon";

    // 2. Suggest: Otto brainstorms 3 ideas (grounded in brand context) and proposes them ($0, no save).
    const suggested = (await executeProposeIdeas(
      {
        theme: "this week",
        ideas: [
          { title: "'Sold out by noon' restock teaser", why: captured, format: "teaser" },
          { title: "3pm croissant POV", format: "POV short-form" },
          { title: "Kaya toast steam macro" },
        ],
      },
      { context: ctx0 },
    )) as { ok: boolean; count: number; ideas: { title: string }[] };
    expect(suggested.ok).toBe(true);
    expect(suggested.count).toBe(3);

    // 3. Turn one into a canvas PROPOSAL: place it as a $0 text note on the canvas (real order is
    //    deferred to the canvas confirm — H1). Stateful fake canvas port, no startGen anywhere.
    const store: CanvasNodeView[] = [];
    let seq = 0;
    const canvasCtx = makeCtx({
      canvas: {
        list: async () => [...store],
        sync: async () => [...store],
        place: async (input) => {
          const id = `n-${++seq}`;
          store.push({
            id, type: input.type, x: input.x, y: input.y, w: input.w, h: input.h,
            text: input.text ?? null, prompt: input.prompt ?? null, generationId: input.generationId ?? null,
            status: "done", genJobId: null, batchIndex: null, batchSize: null,
            madeFromNodeId: null, url: null,
          });
          return { id };
        },
        editText: async () => ({ ok: true }),
        resolve: async () => ({ ok: true }),
        remove: async () => ({ ok: true }),
      },
    });
    const chosen = suggested.ideas[0]!.title;
    const placed = (await executeManageCanvas({ action: "place", type: "text", text: chosen }, { context: canvasCtx })) as { ok: boolean; id: string };
    expect(placed.ok).toBe(true);

    // The idea is now a visible $0 proposal on the canvas; nothing was charged along the way.
    const view = (await executeManageCanvas({ action: "view" }, { context: canvasCtx })) as { count: number; nodes: { text: string | null }[] };
    expect(view.count).toBe(1);
    expect(view.nodes[0]!.text).toBe("'Sold out by noon' restock teaser");
    expect(canvasCtx.startGen).toBeUndefined();
  });
});

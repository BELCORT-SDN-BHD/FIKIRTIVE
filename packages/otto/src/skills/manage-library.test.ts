import { describe, it, expect, vi } from "vitest";
import { executeManageLibrary, manageLibrarySkill, HISTORY_ITEM_CAP } from "./manage-library.js";
import type { OttoContext, LibraryItemView } from "../context.js";

// W-B3-D (parity debts 29/30/50 / E1-14): the skill routes through ctx.library — thin closures over
// the same owner-gated read/preference actions the human Library uses. Tests assert routing, the
// history cap, missing-param guards, and $0 gate.

type Port = NonNullable<OttoContext["library"]>;

function makeCtx(library?: Partial<Port>): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    ...(library ? { library: library as Port } : {}),
  } as unknown as OttoContext;
}

function item(over: Partial<LibraryItemView> = {}): LibraryItemView {
  return { id: "g-1", projectId: "p-1", kind: "image", prompt: "a latte", favorite: false, createdAt: "2026-07-13T00:00:00.000Z", ...over };
}

describe("manageLibrary gate", () => {
  it("free/write/internal → needsApproval false ($0 Library surface)", () => {
    expect(manageLibrarySkill.cost).toBe("free");
    expect(manageLibrarySkill.effect).toBe("write");
    expect(manageLibrarySkill.reach).toBe("internal");
    expect(manageLibrarySkill.needsApproval).toBe(false);
  });
});

describe("executeManageLibrary — port required", () => {
  it("degrades gracefully when ctx.library is not injected", async () => {
    const res = await executeManageLibrary({ action: "history" }, { context: makeCtx() });
    expect(res).toEqual({ ok: false, error: "The Library isn't available right now." });
  });
});

describe("history (debt-50)", () => {
  it("passes filters through and returns trimmed items + paging", async () => {
    const history = vi.fn(async () => ({ items: [item({ id: "g-a" }), item({ id: "g-b", favorite: true })], nextCursor: "c1", hasMore: true }));
    const res = (await executeManageLibrary({ action: "history", search: "latte", favoriteOnly: true }, { context: makeCtx({ history }) })) as {
      ok: boolean; count: number; items: LibraryItemView[]; nextCursor: string | null; hasMore: boolean;
    };
    expect(history).toHaveBeenCalledWith({ search: "latte", favoriteOnly: true });
    expect(res.ok).toBe(true);
    expect(res.count).toBe(2);
    expect(res.items[0]).toEqual({ id: "g-a", projectId: "p-1", kind: "image", prompt: "a latte", favorite: false, createdAt: "2026-07-13T00:00:00.000Z" });
    expect(res.nextCursor).toBe("c1");
    expect(res.hasMore).toBe(true);
  });
  it("caps a large page and says so", async () => {
    const many = Array.from({ length: HISTORY_ITEM_CAP + 5 }, (_, i) => item({ id: `g-${i}` }));
    const history = vi.fn(async () => ({ items: many, nextCursor: null, hasMore: false }));
    const res = (await executeManageLibrary({ action: "history" }, { context: makeCtx({ history }) })) as { count: number; truncated: boolean };
    expect(res.count).toBe(HISTORY_ITEM_CAP);
    expect(res.truncated).toBe(true);
  });
  it("surfaces port errors instead of throwing", async () => {
    const history = vi.fn(async () => ({ error: "Auth required." }));
    expect(await executeManageLibrary({ action: "history" }, { context: makeCtx({ history }) })).toEqual({ ok: false, error: "Auth required." });
  });
});

describe("detail / set_favorite (debt-29/30)", () => {
  it("detail needs generationId, then returns the trimmed item (debt-29)", async () => {
    const detail = vi.fn(async () => item({ id: "g-x", favorite: true }));
    const ctx = makeCtx({ detail });
    expect((await executeManageLibrary({ action: "detail" }, { context: ctx })) as { error: string }).toHaveProperty("error");
    const res = (await executeManageLibrary({ action: "detail", generationId: "g-x" }, { context: ctx })) as { ok: boolean; item: LibraryItemView };
    expect(res.ok).toBe(true);
    expect(res.item.id).toBe("g-x");
    expect(res.item.favorite).toBe(true);
    expect(detail).toHaveBeenCalledWith("g-x");
  });
  it("set_favorite needs generationId + favorite; false is honored (debt-30)", async () => {
    const setFavorite = vi.fn(async () => ({ favorite: false }));
    const ctx = makeCtx({ setFavorite });
    expect((await executeManageLibrary({ action: "set_favorite", generationId: "g-x" }, { context: ctx })) as { error: string }).toHaveProperty("error");
    const res = await executeManageLibrary({ action: "set_favorite", generationId: "g-x", favorite: false }, { context: ctx });
    expect(res).toEqual({ ok: true, favorite: false });
    expect(setFavorite).toHaveBeenCalledWith("g-x", false);
  });
});

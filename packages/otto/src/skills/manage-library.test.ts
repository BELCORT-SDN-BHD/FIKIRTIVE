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
  /**
   * #914 r6(判官 r5 P1-2)—— **裁剪层**也得把回执带上。
   *
   * r4 把「我们实际送出的那句」一路接到了端口(`otto-library-port`),却漏了这一层:
   * `toModelItem` 把它裁掉了,于是工具描述里写着「detail 带 sentPrompt」,模型手上却从来
   * 没有这个键 —— 说的与做的失同步,而模型只会照着描述去回答商家。所以这里断言的是
   * **模型真正收到的那个对象**,不是端口的返回值。
   */
  describe("#914 r6 sentPrompt —— 模型手上真的拿得到,三态原样", () => {
    const detailItem = async (over: Partial<LibraryItemView>) => {
      const detail = vi.fn(async () => item(over));
      const res = (await executeManageLibrary(
        { action: "detail", generationId: "g-x" },
        { context: makeCtx({ detail }) },
      )) as { item: Record<string, unknown> };
      return res.item;
    };

    it("逐字相同 ⇒ 结论原样递给模型", async () => {
      expect(await detailItem({ sentPrompt: { verbatim: true } })).toMatchObject({ sentPrompt: { verbatim: true } });
    });

    it("不同 ⇒ 全文原样递给模型(裁剪层不摘要、不改写)", async () => {
      const text = "<Image_1> is the image being edited.\na latte";
      expect(await detailItem({ sentPrompt: { verbatim: false, text } })).toMatchObject({
        sentPrompt: { verbatim: false, text },
      });
    });

    it("没有这条记录(上传/裁剪/历史行)⇒ 键**在**、值是 null:模型据此什么都别说", async () => {
      const shown = await detailItem({ sentPrompt: null });
      expect("sentPrompt" in shown).toBe(true);
      expect(shown.sentPrompt).toBeNull();
      // 绝不许在裁剪途中被商家自己那句话顶上。
      expect(shown.prompt).toBe("a latte");
    });

    it("history 那条路根本没查这一列 ⇒ 键**缺席**,与「查了但没有」不合并", async () => {
      const history = vi.fn(async () => ({ items: [item()], nextCursor: null, hasMore: false }));
      const res = (await executeManageLibrary({ action: "history" }, { context: makeCtx({ history }) })) as {
        items: Record<string, unknown>[];
      };
      expect("sentPrompt" in res.items[0]!).toBe(false);
    });

    it("工具描述里对这个键的承诺,与实际返回的形状对得上", () => {
      expect(manageLibrarySkill.description).toContain("sentPrompt");
      expect(manageLibrarySkill.description).toContain("verbatim");
    });
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

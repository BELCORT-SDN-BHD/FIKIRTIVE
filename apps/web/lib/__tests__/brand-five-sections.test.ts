/**
 * Brand 五节 ＋ 草稿流的行为测试(FRONT-A8 / FRONT-A9;规格 docs/specs/frontend-baseline.md
 * §7.3④,Founder 2026-09-03 裁决三 / 四 / 十一)。
 *
 * 这一份用 mock 过的 Prisma 断言**行为与查询形状**;真库上的双向租户断言在
 * `brand-context-tenant.test.ts`。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRequireOwner, mockMemoryCreate, mockMemoryFindMany, mockMemoryFindFirst, mockMemoryUpdateMany,
  mockKitFindFirst, mockRuleFindMany, mockRecordFindMany, mockRevisionCreate, mockUserFindUnique,
} = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockMemoryCreate: vi.fn(),
  mockMemoryFindMany: vi.fn(),
  mockMemoryFindFirst: vi.fn(),
  mockMemoryUpdateMany: vi.fn(),
  mockKitFindFirst: vi.fn(),
  mockRuleFindMany: vi.fn(),
  mockRecordFindMany: vi.fn(),
  mockRevisionCreate: vi.fn(),
  mockUserFindUnique: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    memory: {
      create: mockMemoryCreate, findMany: mockMemoryFindMany,
      findFirst: mockMemoryFindFirst, updateMany: mockMemoryUpdateMany,
    },
    brandKit: { findFirst: mockKitFindFirst },
    brandRule: { findMany: mockRuleFindMany },
    brandRecord: { findMany: mockRecordFindMany, findFirst: vi.fn().mockResolvedValue(null) },
    brandContextRevision: { create: mockRevisionCreate, findMany: vi.fn().mockResolvedValue([]) },
    user: { findUnique: mockUserFindUnique, findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@fikirtive/core", async () => ({
  ...(await vi.importActual<typeof import("@fikirtive/core")>("@fikirtive/core")),
  newId: () => "m_new",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  addBrandSource, extractBrandDraft, saveBrandDraft, previewBrandContextEffect,
  confirmBrandDraft, discardBrandDraft, getBrandContextText, listMemory, addMemory,
} from "../memory-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: "o1", email: "merchant@fikirtive.test" });
  mockUserFindUnique.mockResolvedValue({ id: "usr_1", name: "Aisyah" });
  mockKitFindFirst.mockResolvedValue(null);
  mockRuleFindMany.mockResolvedValue([]);
  mockRecordFindMany.mockResolvedValue([]);
  mockMemoryFindMany.mockResolvedValue([]);
  mockMemoryCreate.mockResolvedValue({ updatedAt: new Date("2026-09-03T00:00:00.000Z") });
  mockMemoryUpdateMany.mockResolvedValue({ count: 1 });
  mockRevisionCreate.mockResolvedValue({});
});

// ── FRONT-A9:Otto 读到的内容与迁移前逐字相同 ─────────────────────────────────
//
// 这条断言的字面量是从**迁移前** main 上的 `getBrandContextText` 算出来的:同样三条
// legacy category 的备注,同样的段落顺序、标题与前缀。之所以它现在仍然成立,是因为
// 六→五节的归属是**读的时候**算的(brandSectionForCategory),`Memory.category` 一个
// 字节都没改,而 Otto 这条读路径仍然按老六节分段。
const OTTO_CONTEXT_BEFORE_MIGRATION =
  "Brand rules:\nnever say cheap\n\nAbout the brand: warm, family tone\n\nYour customers:\n- young parents";

describe("FRONT-A9 Otto 读到的品牌上下文与五节迁移前逐字相同", () => {
  it("FRONT-A9 同样的存量备注,拼出的上下文与迁移前逐字相同", async () => {
    mockMemoryFindMany.mockResolvedValue([
      { category: "voice", content: "warm, family tone" },
      { category: "rules", content: "never say cheap" },
      { category: "customers", content: "young parents" },
    ]);
    expect(await getBrandContextText("o1", null)).toBe(OTTO_CONTEXT_BEFORE_MIGRATION);
  });

  it("FRONT-A9 五节的新 key 与旧 key 拼出完全相同的一段(归节口径没换)", async () => {
    mockMemoryFindMany.mockResolvedValue([
      { category: "brand-voice", content: "warm, family tone" },
      { category: "style-guide", content: "never say cheap" },
      { category: "audiences", content: "young parents" },
    ]);
    expect(await getBrandContextText("o1", null)).toBe(OTTO_CONTEXT_BEFORE_MIGRATION);
  });

  it("FRONT-A9 草稿永远进不了 Otto 上下文:两条读路径都只取 Ready", async () => {
    await getBrandContextText("o1", null);
    expect(mockMemoryFindMany.mock.calls[0]![0].where).toMatchObject({ contextStatus: "Ready" });
    expect(mockRecordFindMany.mock.calls[0]![0].where).toMatchObject({ contextStatus: "Ready" });
  });

  it("FRONT-A9 正式清单也只列 Ready —— 草稿不冒充成已保存的记录", async () => {
    await listMemory("o1", null);
    expect(mockMemoryFindMany.mock.calls[0]![0].where).toMatchObject({ contextStatus: "Ready" });
  });
});

// ── FRONT-A8:草稿流五步,确认之前不落正式记录(裁决四)───────────────────────
describe("FRONT-A8 草稿流:确认之前不落正式记录", () => {
  it("FRONT-A8 加来源与抽取两步一个字节都不写库", async () => {
    const source = await addBrandSource({ sourceKind: "text", text: "  We are a family bakery.  " });
    expect(source).toEqual({ ok: true, origin: "text", originDetail: "Pasted text", text: "We are a family bakery." });
    const draft = await extractBrandDraft({ name: "Family bakery voice", text: source.ok ? source.text : "" });
    expect(draft).toEqual({ ok: true, name: "Family bakery voice", content: "We are a family bakery." });
    expect(mockMemoryCreate).not.toHaveBeenCalled();
    expect(mockMemoryUpdateMany).not.toHaveBeenCalled();
  });

  it("FRONT-A8 只收粘贴文本;URL 与文件在拿到价目之前直接拒收,不假装读了", async () => {
    expect(await addBrandSource({ sourceKind: "url", text: "https://example.com" })).toEqual({ error: expect.any(String) });
    expect(await addBrandSource({ sourceKind: "file", text: "menu.pdf" })).toEqual({ error: expect.any(String) });
  });

  it("FRONT-A8 生成草稿写的是 contextStatus='Draft',并记下来源与是谁写的", async () => {
    const saved = await saveBrandDraft({
      section: "knowledge-base", name: "Menu facts", content: "Nasi lemak RM8",
      origin: "text", originDetail: "Pasted text",
    });
    expect(saved).toEqual({ ok: true, id: "m_new" });
    expect(mockMemoryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: "o1", category: "knowledge-base", contextStatus: "Draft",
        origin: "text", originDetail: "Pasted text", updatedById: "usr_1",
      }),
    });
  });

  it("FRONT-A8 不认不存在的分区,也不接受没有名字或正文的草稿", async () => {
    expect(await saveBrandDraft({ section: "offers", name: "x", content: "y" })).toEqual({ error: "Unknown section." });
    expect(await saveBrandDraft({ section: "audiences", name: "", content: "y" })).toEqual({ error: expect.any(String) });
  });

  it("FRONT-A8 预览摆的是保存前后 Otto 真读到的两段,免费、不调模型", async () => {
    mockMemoryFindFirst.mockResolvedValue({ id: "m_draft" });
    mockMemoryFindMany
      .mockResolvedValueOnce([{ category: "about", content: "warm" }])                                   // without
      .mockResolvedValueOnce([{ category: "about", content: "warm" }, { category: "about", content: "family run" }]); // with
    const result = await previewBrandContextEffect({ id: "m_draft" });
    expect(result).toEqual({
      ok: true,
      without: "About the brand: warm",
      with: "About the brand: warm; family run",
    });
    // 「with」那一次必须只额外放行这一条草稿,而不是放行所有草稿。
    expect(mockMemoryFindMany.mock.calls[1]![0].where).toMatchObject({
      OR: [{ contextStatus: "Ready" }, { id: "m_draft" }],
    });
  });

  it("FRONT-A8 预览只认自己的草稿:别人的行或已保存的行都查不到", async () => {
    mockMemoryFindFirst.mockResolvedValue(null);
    expect(await previewBrandContextEffect({ id: "someone-elses" })).toEqual({ error: expect.any(String) });
    expect(mockMemoryFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: "o1", contextStatus: "Draft" }) }),
    );
  });

  it("FRONT-A8 确认保存是草稿变正式记录的唯一一步,并留下一行改动史", async () => {
    mockMemoryFindFirst.mockResolvedValue({ updatedAt: new Date("2026-09-03T01:00:00.000Z") });
    expect(await confirmBrandDraft({ id: "m_draft" })).toEqual({ ok: true });
    expect(mockMemoryUpdateMany).toHaveBeenCalledWith({
      where: { id: "m_draft", ownerId: "o1", deletedAt: null },
      data: { contextStatus: "Ready", updatedById: "usr_1" },
    });
    expect(mockRevisionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: "o1", targetKind: "memory", targetId: "m_draft", action: "confirmed",
        revisionKey: "confirmed:2026-09-03T01:00:00.000Z", changedByLabel: "Aisyah",
      }),
    });
  });

  it("FRONT-A8 放弃草稿走软删除,而且只碰草稿行", async () => {
    expect(await discardBrandDraft({ id: "m_draft" })).toEqual({ ok: true });
    expect(mockMemoryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "m_draft", ownerId: "o1", contextStatus: "Draft" } }),
    );
  });
});

// ── FRONT-A8:谁改的、何时改的 ────────────────────────────────────────────────
describe("FRONT-A8 每条记录都答得出谁改的、何时改的", () => {
  it("FRONT-A8 新增一条记录就写下作者,并追加一行「created」改动史", async () => {
    expect(await addMemory({ category: "brand-voice", content: "warm" })).toEqual({ ok: true, id: "m_new" });
    expect(mockMemoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ updatedById: "usr_1" }),
    }));
    expect(mockRevisionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "created", changedById: "usr_1", changedByLabel: "Aisyah",
        revisionKey: "created:2026-09-03T00:00:00.000Z",
      }),
    });
  });

  it("FRONT-A8 查不到 User 行时留空作者、用邮箱当标签,而不是编一个人", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    await addMemory({ category: "brand-voice", content: "warm" });
    expect(mockRevisionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ changedById: null, changedByLabel: "merchant@fikirtive.test" }),
    });
  });

  it("FRONT-A8 改动史写失败绝不把商家已经成功的保存变成失败", async () => {
    mockRevisionCreate.mockRejectedValue(new Error("history table is having a bad day"));
    expect(await addMemory({ category: "brand-voice", content: "warm" })).toEqual({ ok: true, id: "m_new" });
  });
});

// ── 租户:每一条读写都带 session 的 ownerId(真库双向断言在 tenant 那一份)──────
describe("FRONT-A8 租户边界:客户端传来的 ownerId 一律不认", () => {
  it("FRONT-A8 草稿写入用 SESSION 的 org,不是调用方给的那个", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "session-org", email: "merchant@fikirtive.test" });
    await saveBrandDraft({ section: "audiences", name: "n", content: "c", ownerId: "attacker-org" });
    expect(mockMemoryCreate.mock.calls[0]![0].data.ownerId).toBe("session-org");
  });

  it("FRONT-A8 没有会话时草稿流每一步都拒绝,不写任何东西", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await addBrandSource({ sourceKind: "text", text: "x" })).toEqual({ error: "Not authorized." });
    expect(await saveBrandDraft({ section: "audiences", name: "n", content: "c" })).toEqual({ error: "Not authorized." });
    expect(await confirmBrandDraft({ id: "m_draft" })).toEqual({ error: "Not authorized." });
    expect(mockMemoryCreate).not.toHaveBeenCalled();
    expect(mockMemoryUpdateMany).not.toHaveBeenCalled();
  });
});

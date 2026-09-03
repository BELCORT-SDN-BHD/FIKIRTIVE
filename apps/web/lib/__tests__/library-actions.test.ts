import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockGenFindMany, mockFavoriteFindMany, mockStorageExists } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockGenFindMany: vi.fn(),
  mockFavoriteFindMany: vi.fn(),
  mockStorageExists: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    generation: { findMany: mockGenFindMany },
    // 收藏的权威从 2026-09-03 起是 `Favorite` 那张跨类型的表(前端基线 §7.3② / 裁决十),
    // 所以每一页的 favorite 都要向它问一次 —— `Generation.favorite` 那一列已经没有读者。
    favorite: { findMany: mockFavoriteFindMany },
  },
}));
vi.mock("@fikirtive/core", () => ({
  storageKey: (o: string, h: string, e: string) => `${o}/${h}.${e}`,
  storageKeyToSrc: (k: string) => `https://cdn/${k}`,
}));
vi.mock("../storage", () => ({
  storage: { exists: mockStorageExists },
}));

import { getGenerationHistory } from "../library-actions";

function row(id: string, ext: string, createdAtIso: string, favorite = false, source = "RENDER") {
  return {
    id, projectId: `p-${id}`, assetId: `asset-${id}`, promptText: `p-${id}`, favorite, source,
    createdAt: new Date(createdAtIso),
    asset: { ownerId: "u1", contentHash: `h-${id}`, ext, originalFilename: "", width: null, height: null, durationS: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
  mockFavoriteFindMany.mockResolvedValue([]);
  mockStorageExists.mockResolvedValue(true);
});

describe("getGenerationHistory — scoping & errors", () => {
  it("returns the gate error for a non-owner", async () => {
    mockOwner.mockResolvedValue({ error: "Unauthorized." });
    expect(await getGenerationHistory()).toEqual({ error: "Unauthorized." });
    expect(mockGenFindMany).not.toHaveBeenCalled();
  });
  it("always scopes where to owner+deletedAt:null, newest-first, over-fetches a scan window", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory({ take: 10 });
    expect(mockGenFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: "u1", deletedAt: null }),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 31,
      }),
    );
    expect(mockGenFindMany.mock.calls[0][0].where.projectId).toBeUndefined();
  });
});

describe("getGenerationHistory — filters", () => {
  it("FRONT-A5 favoriteOnly 走收藏自己的读模型,而不是在生成表上加一个条件", async () => {
    // 收藏的权威是另一张表,这里没有关系可以 join(那是故意的:收藏是链接,加外键会
    // 把「取消收藏」和「删素材」焊死)。所以这一路整个交给收藏读模型 —— 生成表这一次
    // 连问都不问,答案由 `Favorite` 的那一页决定。
    mockFavoriteFindMany.mockResolvedValue([]);
    const res = await getGenerationHistory({ favoriteOnly: true });
    expect(mockGenFindMany).not.toHaveBeenCalled();
    expect(mockFavoriteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: "u1" }),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
    expect(res).toEqual({ items: [], nextCursor: null, hasMore: false });
  });
  it("FRONT-A5 favoriteOnly 配上收藏读模型接不住的筛选时当场回错误,不静静把筛选丢掉", async () => {
    // 这是 Otto 真会发的一句:`manageLibrary { action: "history", search: "laksa",
    // favoriteOnly: true }`。收藏读模型今天只认 cursor / take;把 search 吃掉再照样返回
    // 一页,商家拿到的是「全部收藏」,而 Otto 会把它们当成命中的那几张报出去 ——
    // 一个读起来很像答案的错答案。宁可说不行。
    const res = await getGenerationHistory({ favoriteOnly: true, search: "laksa" });
    expect("error" in res && res.error).toContain("Favorites can't be filtered yet");
    expect("error" in res && res.error).toContain("search");
    // 两张表一张都没查 —— 拦在读之前,不是读完再挑。
    expect(mockGenFindMany).not.toHaveBeenCalled();
    expect(mockFavoriteFindMany).not.toHaveBeenCalled();
  });
  it("FRONT-A5 接不住的筛选键逐个都拦,cursor / take 照旧放行", async () => {
    for (const opts of [
      { sources: ["upload"] as const },
      { mediaKind: "video" as const },
      { projectId: "prj_1" },
      { since: "2026-01-01T00:00:00.000Z" },
      { order: "oldest" as const },
    ]) {
      const res = await getGenerationHistory({ favoriteOnly: true, ...opts });
      expect("error" in res, `${Object.keys(opts)[0]} 被静静吃掉了`).toBe(true);
    }
    // 收藏读模型接得住的这两个不是筛选,不该被拦。
    mockFavoriteFindMany.mockResolvedValue([]);
    const ok = await getGenerationHistory({ favoriteOnly: true, cursor: null, take: 10 });
    expect(ok).toEqual({ items: [], nextCursor: null, hasMore: false });
  });
  it("adds a case-insensitive promptText contains when search is set", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory({ search: "  sale  " });
    expect(mockGenFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ promptText: { contains: "sale", mode: "insensitive" } }) }),
    );
  });
  it("omits the search filter for blank/whitespace search", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory({ search: "   " });
    const arg = mockGenFindMany.mock.calls[0][0];
    expect("promptText" in arg.where).toBe(false);
  });
  it("builds the keyset OR clause from a cursor", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory({ cursor: "2026-01-02T00:00:00.000Z|gen-9" });
    const arg = mockGenFindMany.mock.calls[0][0];
    expect(arg.where.OR).toEqual([
      { createdAt: { lt: new Date("2026-01-02T00:00:00.000Z") } },
      { createdAt: new Date("2026-01-02T00:00:00.000Z"), id: { lt: "gen-9" } },
    ]);
  });
});

describe("getGenerationHistory — paging & mapping", () => {
  it("derives kind from ext, resolves url, maps fields", async () => {
    mockGenFindMany.mockResolvedValue([
      row("a", "mp4", "2026-01-03T00:00:00.000Z", true),
      row("b", "png", "2026-01-02T00:00:00.000Z"),
    ]);
    // 心亮不亮由收藏表说了算 —— 行上那一列(第四个参数)已经没有读者。
    mockFavoriteFindMany.mockResolvedValue([{ subjectId: "a" }]);
    const res = await getGenerationHistory({ take: 60 });
    if ("error" in res) throw new Error("unexpected error");
    expect(res.items[0]).toEqual({ id: "a", projectId: "p-a", assetId: "asset-a", url: "https://cdn/u1/h-a.mp4", kind: "video", source: "generated", prompt: "p-a", filename: "", width: null, height: null, durationS: null, favorite: true, createdAt: "2026-01-03T00:00:00.000Z" });
    expect(res.items[1].kind).toBe("image");
    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBe(null);
  });
  it("filters rows whose storage object is missing", async () => {
    mockStorageExists.mockImplementation(async (key: string) => !key.includes("h-b.png"));
    mockGenFindMany.mockResolvedValue([
      row("a", "png", "2026-01-03T00:00:00.000Z"),
      row("b", "png", "2026-01-02T00:00:00.000Z"),
    ]);
    const res = await getGenerationHistory({ take: 60 });
    if ("error" in res) throw new Error("unexpected error");
    expect(res.items.map((item) => item.id)).toEqual(["a"]);
    expect(mockStorageExists).toHaveBeenCalledWith("u1/h-a.png");
    expect(mockStorageExists).toHaveBeenCalledWith("u1/h-b.png");
  });
  it("sets hasMore + nextCursor when more visible rows exist than requested", async () => {
    mockGenFindMany.mockResolvedValue([
      row("a", "png", "2026-01-03T00:00:00.000Z"),
      row("b", "png", "2026-01-02T00:00:00.000Z"),
    ]);
    const res = await getGenerationHistory({ take: 1 });
    if ("error" in res) throw new Error("unexpected error");
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe("a");
    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toBe("2026-01-03T00:00:00.000Z|a");
  });
});

/**
 * 前端基线 §7.1 段②(FRONT-A5):Library 的 toolbar 上每一个筛选、排序与页签都必须落到
 * **服务端的 where / orderBy** 上 —— 在浏览器里过滤已加载的那几条,只会在第二页开始骗人
 * (`patterns/library/backend-handoff-contract.md` §8.3①「筛选作用于完整结果集」)。
 */
describe("FRONT-A5 Library toolbar 的每一条筛选都落到服务端查询上", () => {
  it("Uploads 与 Generated 由 Generation.source 区分,不是靠猜文件名", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory({ sources: ["upload"] });
    expect(mockGenFindMany.mock.calls[0][0].where.source).toBe("UPLOAD");

    mockGenFindMany.mockClear();
    await getGenerationHistory({ sources: ["generated"] });
    expect(mockGenFindMany.mock.calls[0][0].where.source).toEqual({ not: "UPLOAD" });

    mockGenFindMany.mockClear();
    await getGenerationHistory({ sources: ["generated", "upload"] });
    expect("source" in mockGenFindMany.mock.calls[0][0].where).toBe(false);
  });

  it("两个来源都不勾 = 一条都不该返回,而不是整库", async () => {
    const res = await getGenerationHistory({ sources: [] });
    if ("error" in res) throw new Error("unexpected error");
    expect(res.items).toEqual([]);
    expect(res.hasMore).toBe(false);
    expect(mockGenFindMany, "把「什么都不选」当成了「全选」").not.toHaveBeenCalled();
  });

  it("Images / Videos 用的扩展名与映射 kind 用的是同一份清单(两边不可能打架)", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory({ mediaKind: "video" });
    const videoWhere = mockGenFindMany.mock.calls[0][0].where.asset.ext.in as string[];
    expect(videoWhere).toEqual(expect.arrayContaining(["mp4", "mov", "webm", "mkv", "MP4"]));

    mockGenFindMany.mockClear();
    await getGenerationHistory({ mediaKind: "image" });
    expect(mockGenFindMany.mock.calls[0][0].where.asset.ext.notIn).toEqual(videoWhere);
  });

  it("Source Canvas 与 Date created 落到 projectId 与 createdAt 上", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory({ projectId: "prj_1", since: "2026-09-01T00:00:00.000Z" });
    const where = mockGenFindMany.mock.calls[0][0].where;
    expect(where.projectId).toBe("prj_1");
    expect(where.createdAt).toEqual({ gte: new Date("2026-09-01T00:00:00.000Z") });
  });

  it("Oldest first 连游标比较一起翻面 —— 不然第二页会重复或跳行", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory({ order: "oldest", cursor: "2026-01-02T00:00:00.000Z|gen-9" });
    const arg = mockGenFindMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
    expect(arg.where.OR).toEqual([
      { createdAt: { gt: new Date("2026-01-02T00:00:00.000Z") } },
      { createdAt: new Date("2026-01-02T00:00:00.000Z"), id: { gt: "gen-9" } },
    ]);
  });

  it("上传行带回商家自己的文件名与真实尺寸 —— 详情与网格都不用编", async () => {
    mockGenFindMany.mockResolvedValue([
      {
        id: "u1g", projectId: "p1", assetId: "a1", promptText: "", favorite: false, source: "UPLOAD",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
        asset: { ownerId: "u1", contentHash: "h-u", ext: "png", originalFilename: "raya.png", width: 1024, height: 1280, durationS: null },
      },
    ]);
    const res = await getGenerationHistory({ take: 10 });
    if ("error" in res) throw new Error("unexpected error");
    expect(res.items[0].source).toBe("upload");
    expect(res.items[0].filename).toBe("raya.png");
    expect(res.items[0].width).toBe(1024);
    expect(res.items[0].height).toBe(1280);
  });
});

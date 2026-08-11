/**
 * #776 —— 生成回执的 Otto 一侧。
 *
 * 双面产品:同一件事实,商家在面板上看得到,Otto 也得能引用来解释「上次为什么长这样」。
 * 面板那一侧由 asset-actions.test.ts 钉住;这里钉的是 Otto 端口不会在传递途中把「未知」
 * 变成别的东西 —— 缺席就该缺席,不该冒出一个空串,更不该冒出商家自己那句话。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetGeneration, mockGetGenerationHistory, mockSetFavorite } = vi.hoisted(() => ({
  mockGetGeneration: vi.fn(),
  mockGetGenerationHistory: vi.fn(),
  mockSetFavorite: vi.fn(),
}));

vi.mock("../asset-actions", () => ({ getGeneration: mockGetGeneration, setFavorite: mockSetFavorite }));
vi.mock("../library-actions", () => ({ getGenerationHistory: mockGetGenerationHistory }));

import { makeOttoLibraryPort } from "../otto-library-port";

const detailRow = (finalPrompt: string | null) => ({
  id: "g1",
  projectId: "p1",
  kind: "video",
  prompt: "a poster for the weekend sale",
  finalPrompt,
  favorite: false,
});

beforeEach(() => vi.clearAllMocks());

describe("#776 ctx.library.detail 把「引擎真正跑的那句」交给 Otto", () => {
  it("有就带上", async () => {
    mockGetGeneration.mockResolvedValue(detailRow("a bright poster, weekend sale, bold type"));
    const item = await makeOttoLibraryPort().detail("g1");
    expect(item).toMatchObject({ prompt: "a poster for the weekend sale", finalPrompt: "a bright poster, weekend sale, bold type" });
  });

  it("null(未知)⇒ 这个键**根本不出现**,而不是一个空串", async () => {
    mockGetGeneration.mockResolvedValue(detailRow(null));
    const item = await makeOttoLibraryPort().detail("g1");
    expect("finalPrompt" in (item as object)).toBe(false);
    // 未知绝不许在传递途中被商家自己那句话顶上 —— 那样 Otto 会把商家的话当成引擎的话去解释结果。
    expect((item as { prompt: string }).prompt).toBe("a poster for the weekend sale");
  });

  it("读不到那条 generation 时照旧只回 error", async () => {
    mockGetGeneration.mockResolvedValue({ error: "Not found." });
    expect(await makeOttoLibraryPort().detail("g-nope")).toEqual({ error: "Not found." });
  });
});

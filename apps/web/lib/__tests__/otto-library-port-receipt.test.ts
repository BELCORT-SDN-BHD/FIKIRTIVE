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

type SentReceipt = null | { verbatim: true } | { verbatim: false; text: string };

const detailRow = (finalPrompt: string | null, sentPrompt: SentReceipt = { verbatim: true }) => ({
  id: "g1",
  projectId: "p1",
  kind: "video",
  prompt: "a poster for the weekend sale",
  finalPrompt,
  sentPrompt,
  favorite: false,
});

beforeEach(() => vi.clearAllMocks());

describe("#776 ctx.library.detail 把「引擎真正跑的那句」交给 Otto", () => {
  it("有就带上", async () => {
    mockGetGeneration.mockResolvedValue(detailRow("a bright poster, weekend sale, bold type"));
    const item = await makeOttoLibraryPort().detail("g1");
    expect(item).toMatchObject({ prompt: "a poster for the weekend sale", finalPrompt: "a bright poster, weekend sale, bold type" });
  });

  it("null(未知)⇒ 键**在**,值是 null —— 与商家面板同一口径", async () => {
    mockGetGeneration.mockResolvedValue(detailRow(null));
    const item = await makeOttoLibraryPort().detail("g1");
    // r2:r1 在这里把键删掉,于是「引擎没报」和「这条产品链不存在」在 Otto 眼里长得一模一样。
    // 键缺席的语义留给 history(我们根本没查这一列),两种「没有」不能混。
    expect("finalPrompt" in (item as object)).toBe(true);
    expect((item as { finalPrompt: string | null }).finalPrompt).toBeNull();
    // 未知绝不许在传递途中被商家自己那句话顶上 —— 那样 Otto 会把商家的话当成引擎的话去解释结果。
    expect((item as { prompt: string }).prompt).toBe("a poster for the weekend sale");
    expect((item as { finalPrompt: string | null }).finalPrompt).not.toBe("a poster for the weekend sale");
  });

  it("读不到那条 generation 时照旧只回 error", async () => {
    mockGetGeneration.mockResolvedValue({ error: "Not found." });
    expect(await makeOttoLibraryPort().detail("g-nope")).toEqual({ error: "Not found." });
  });
});

/**
 * #914 r4 双面同源 —— 商家在面板上看到的那条「我们实际送出的那句」,Otto 必须读**同一条**
 * 记录、**同一次**比对的结论。端口在这里只做一件事:原样递过去。
 *
 * 为什么这件事值得钉:两边各自去比一次,就是本票被判两次 FAIL 的那类病(面板说「原样」、
 * Otto 说「加过料」,商家两边都听过一遍)。这里的断言形状因此是「端口给出的 === 动作给出
 * 的」,而不是把结论在测试里重写一遍。
 */
describe("#914 r4 ctx.library.detail 把「我们实际送出的那句」交给 Otto", () => {
  it("逐字相同 ⇒ 原样递过去", async () => {
    mockGetGeneration.mockResolvedValue(detailRow(null, { verbatim: true }));
    expect(await makeOttoLibraryPort().detail("g1")).toMatchObject({ sentPrompt: { verbatim: true } });
  });

  it("不同 ⇒ 全文原样递过去,途中不被摘要、不被改写", async () => {
    const sent = "<Image_1> is the image being edited.\na poster for the weekend sale";
    mockGetGeneration.mockResolvedValue(detailRow(null, { verbatim: false, text: sent }));
    expect(await makeOttoLibraryPort().detail("g1")).toMatchObject({ sentPrompt: { verbatim: false, text: sent } });
  });

  it("历史行(没有这条记录)⇒ 键**在**、值是 null —— Otto 据此什么都别说,而不是当成「原样送出」", async () => {
    mockGetGeneration.mockResolvedValue(detailRow(null, null));
    const item = await makeOttoLibraryPort().detail("g1");
    expect("sentPrompt" in (item as object)).toBe(true);
    expect((item as { sentPrompt: SentReceipt }).sentPrompt).toBeNull();
    // 绝不许在传递途中被商家自己那句话顶上 —— 那样 Otto 会把一个我们没有的记录说成事实。
    expect((item as { prompt: string }).prompt).toBe("a poster for the weekend sale");
  });
});

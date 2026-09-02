// @vitest-environment jsdom
/**
 * #776 r2 → #914 → #914 r2 —— 资产详情面板上的生成回执:「引擎真正跑的那句话」。
 *
 * #914(Founder 裁决 2026-08-13,市调见 #909):图片引擎按官方契约永不回报改写后的提示词
 * (packages/core/src/refgen.ts 的 GenerationReceipt 注释:图片响应结构上没有 revised_prompt),
 * 而 r2 在图片这条路上让这一整块永远显示 "Not reported by the engine." —— 那不是诚实报告
 * 未知,是一个字段模板在填不上时自己编的句子。这一票把它改成通行做法:有则显示、无则整行
 * 不出现,而且图片这条路上**不分「有/无」两种形状**,因为它结构上恒为未知,不是「这次没报」。
 * 视频回执行为不变(r2 判官的五条纪律原样保留,下移到本文件的「视频回执」describe 块)。
 *
 * #914 r4(判官 r3 FAIL):图片这条路新增的那条事实,r2/r3 记在 web 层 —— 而 worker 在真正
 * 发送前还会再拼一次(#774 的参考图编号句),所以记下的永远不是送出去的全文,「原样送出」
 * 在模板一键成片这类必带底图的单上恒为谎;更糟的是当时的测试把历史行(我们根本没有记录的
 * 那些图)也锁成了「原样送出」的绿色契约。r4 把记录点搬到真实发送层,比对在服务端一次做完
 * (asset-actions.sentPromptReceipt),面板只显示三种结论:没有记录 ⇒ **整块不出现**;
 * 逐字相同 ⇒ 一句话;不同 ⇒ 实际送出的全文。
 *
 * 真组件 + 真 React;只有服务端动作是假件,所以一个积分都花不出去。断言的是**屏幕上的字**,
 * 不是源码里的标识符 —— 前者才是商家看到的东西。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGeneration: vi.fn(),
  getActiveGenModels: vi.fn(),
  startGen: vi.fn(),
  startAssetGen: vi.fn(),
  getGenJob: vi.fn(),
  setFavorite: vi.fn(),
  saveCroppedGeneration: vi.fn(),
  deleteGeneration: vi.fn(),
}));

vi.mock("@/lib/asset-actions", () => ({
  getGeneration: mocks.getGeneration,
  setFavorite: mocks.setFavorite,
  saveCroppedGeneration: mocks.saveCroppedGeneration,
}));
vi.mock("@/lib/actions", () => ({ deleteGeneration: mocks.deleteGeneration }));
vi.mock("@/lib/gen-actions", () => ({
  startGen: mocks.startGen,
  startAssetGen: mocks.startAssetGen,
  getGenJob: mocks.getGenJob,
  getActiveGenModels: mocks.getActiveGenModels,
}));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: vi.fn() }));
vi.mock("react-easy-crop", () => ({ default: () => null }));
vi.mock("@/components/MentionInput", () => ({
  MentionInput: () => createElement("textarea", { "data-testid": "edit-input" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: DetailPanel } = await import("@/components/asset/DetailPanel");

const MERCHANT_PROMPT = "a poster for the weekend sale";

type Variant = { id: string; url: string; favorite: boolean; finalPrompt: string | null };
/** #914 r4:服务端已经比完的结论(asset-actions.sentPromptReceipt),面板只负责显示。 */
type SentReceipt = null | { verbatim: true } | { verbatim: false; text: string };

// #914 r4:sentPrompt is a per-JOB fact — one paid call per job sends ONE string, so every
// output row carries the same one (unlike finalPrompt, which the engine reports per output).
// Hence a plain third argument here, not a field on each Variant.
const generation = (variants: Variant[], kind: "image" | "video" = "image", sentPrompt: SentReceipt = { verbatim: true }) => ({
  id: variants[0]!.id,
  projectId: "p1",
  url: variants[0]!.url,
  urls: variants.map((v) => v.url),
  variants,
  kind,
  prompt: MERCHANT_PROMPT,
  finalPrompt: variants[0]!.finalPrompt,
  sentPrompt,
  favorite: false,
  sourceGenerationId: null,
  imageAspect: "1:1",
});

const one = (finalPrompt: string | null): Variant[] => [{ id: "g1", url: "https://cdn.test/g1.png", favorite: false, finalPrompt }];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  // Every fixture reuses id "g1" (and "g2" for multi-variant cases); result-pick.ts persists the
  // selected variant per generation id in localStorage across the whole jsdom test file. Without
  // clearing it, a thumbnail click in one test (e.g. the image multi-variant case) leaks into a
  // later test that mounts a fresh panel under the same id and expects to start at index 0.
  window.localStorage.clear();
  mocks.getActiveGenModels.mockResolvedValue({
    image: "capability-image-1",
    video: "capability-video-1",
    imageCredits: 8,
    videoCredits: 80,
    videoDefaults: { seconds: 5, resolution: "720p", aspectRatio: "16:9", fps: 0, audio: true },
    videoAspectRatios: ["16:9", "9:16", "1:1"],
    videoDurations: [5],
    videoResolutions: ["720p"],
    videoI2vDefaultAspect: "adaptive",
    videoCreditsBySpec: { "720p:5": 11 },
    imageAspectRatios: ["1:1", "9:16", "16:9"],
    imageDefaultAspect: "1:1",
  });
  mocks.startGen.mockResolvedValue({ id: "job-1", disposition: "fresh" });
  mocks.startAssetGen.mockResolvedValue({ id: "job-1", disposition: "fresh" });
  mocks.getGenJob.mockResolvedValue({ status: "DONE", generationIds: [] });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function renderPanel(variants: Variant[], kind: "image" | "video" = "image", sentPrompt: SentReceipt = { verbatim: true }): Promise<void> {
  mocks.getGeneration.mockResolvedValue(generation(variants, kind, sentPrompt));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(DetailPanel, {
      generationId: "g1", projectId: "p1", onClose: () => {}, entities: [],
    } as never));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

/** Sheet content is portalled to document.body, outside the React mount node. */
function detailSurface(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('[data-slot="sheet-content"]');
  expect(found, "资产详情 Sheet 应该已经打开").not.toBeNull();
  return found!;
}

/** 「What the engine ran」那一块底下的那句话 —— 屏幕上真正写着的字。只在这一块存在时调用。 */
function engineRanText(): string {
  const labels = [...detailSurface().querySelectorAll("span")].filter((s) => s.textContent?.trim() === "What the engine ran");
  expect(labels[0], "面板上应该有「What the engine ran」这一块").toBeDefined();
  const body = labels[0]!.parentElement!.querySelector("p");
  expect(body, "这一块底下应该有一句话").not.toBeNull();
  return body!.textContent!.trim();
}

/** #914:「What the engine ran」这一块存不存在 —— 图片回执的核心断言,不看文案看有没有这一行。 */
function hasEngineRanRow(): boolean {
  return [...detailSurface().querySelectorAll("span")].some((s) => s.textContent?.trim() === "What the engine ran");
}

/** #914 r4:「What we sent to the engine」这一块存不存在 —— 历史行的核心断言。 */
function hasSentToEngineRow(): boolean {
  return [...detailSurface().querySelectorAll("span")].some((s) => s.textContent?.trim() === "What we sent to the engine");
}

/** #914 r4:「What we sent to the engine」那一块底下的那句话 —— 我们实际送出的事实。 */
function sentToEngineText(): string {
  const labels = [...detailSurface().querySelectorAll("span")].filter((s) => s.textContent?.trim() === "What we sent to the engine");
  expect(labels[0], "图片回执应该有「What we sent to the engine」这一块").toBeDefined();
  const body = labels[0]!.parentElement!.querySelector("p");
  expect(body, "这一块底下应该有一句话").not.toBeNull();
  return body!.textContent!.trim();
}

describe("#914 图片回执:「引擎实际提示词」整行永不出现", () => {
  it("引擎(结构上)没报 ⇒ 不出现占位句,这一行整个不渲染", async () => {
    await renderPanel(one(null), "image");
    expect(hasEngineRanRow()).toBe(false);
    expect(detailSurface().textContent).not.toContain("Not reported by the engine.");
  });

  it("即便这一张带着 finalPrompt 值,图片回执也不显示这一行 —— 不分「有/无」两种形状", async () => {
    await renderPanel(one("a bright poster, weekend sale, bold type"), "image");
    expect(hasEngineRanRow()).toBe(false);
    // 有值也不许泄漏到别处——这一行整块不存在,不是换了个地方藏起来。
    expect(detailSurface().textContent).not.toContain("a bright poster, weekend sale, bold type");
  });

  it("多图切换缩略图,图片回执始终不出现这一行", async () => {
    await renderPanel([
      { id: "g1", url: "https://cdn.test/g1.png", favorite: false, finalPrompt: "first rewrite" },
      { id: "g2", url: "https://cdn.test/g2.png", favorite: false, finalPrompt: null },
    ], "image");
    expect(hasEngineRanRow()).toBe(false);
    const thumbs = [...detailSurface().querySelectorAll("button")].filter((b) => b.querySelector('img[alt^="Variant"]'));
    expect(thumbs.length, "多图时应该有变体缩略图").toBeGreaterThanOrEqual(2);
    await act(async () => { thumbs[1]!.click(); });
    expect(hasEngineRanRow()).toBe(false);
  });
});

describe("#914 r4(判官 r3)图片回执:我们实际送出的那一句", () => {
  // r2/r3 的病在这里:那时这一块**恒定**存在,历史行也照样宣布「原样送出」—— 一个我们
  // 根本没有记录的事实被说成了确定的事实,而且当时的测试还把这个谎锁成了绿色契约。
  it("历史生成(worker 记这一列之前产的图)⇒ 整块不渲染,一个字都不说", async () => {
    await renderPanel(one(null), "image", null);
    expect(hasSentToEngineRow()).toBe(false);
    expect(detailSurface().textContent).not.toContain("Sent exactly as you wrote it.");
  });

  it("逐字相同 ⇒ 一句「原样送出」,不把同一段文字再贴一遍", async () => {
    await renderPanel(one(null), "image", { verbatim: true });
    expect(sentToEngineText()).toBe("Sent exactly as you wrote it.");
  });

  it("不同(worker 在发送前加了 #774 的参考图编号句)⇒ 亮出实际送出的全文", async () => {
    const sent = `<Image_1> is the image being edited.\n${MERCHANT_PROMPT}`;
    await renderPanel(one(null), "image", { verbatim: false, text: sent });
    expect(sentToEngineText()).toBe(sent);
    expect(sentToEngineText()).not.toBe("Sent exactly as you wrote it.");
  });

  it("这一行不受(结构上不可能出现的)finalPrompt 影响 —— 它是我们自己的记录,不问引擎要", async () => {
    await renderPanel(one("a bright poster, weekend sale, bold type"), "image", { verbatim: true });
    expect(sentToEngineText()).toBe("Sent exactly as you wrote it.");
  });

  it("多图:一次付费调用一个字符串,切缩略图这一行不变脸", async () => {
    const sent = `<Image_1> is the image being edited.\n${MERCHANT_PROMPT}`;
    await renderPanel([
      { id: "g1", url: "https://cdn.test/g1.png", favorite: false, finalPrompt: null },
      { id: "g2", url: "https://cdn.test/g2.png", favorite: false, finalPrompt: null },
    ], "image", { verbatim: false, text: sent });
    expect(sentToEngineText()).toBe(sent);
    const thumbs = [...detailSurface().querySelectorAll("button")].filter((b) => b.querySelector('img[alt^="Variant"]'));
    await act(async () => { thumbs[1]!.click(); });
    expect(sentToEngineText()).toBe(sent);
  });
});

describe("#776 r2 → #914:视频回执行为不变", () => {
  it("引擎报了 ⇒ 原样显示那一句", async () => {
    await renderPanel(one("a bright poster, weekend sale, bold type"), "video");
    expect(engineRanText()).toBe("a bright poster, weekend sale, bold type");
  });

  it("引擎没报 ⇒ **说出来**,而不是整块消失", async () => {
    await renderPanel(one(null), "video");
    // r1 在这里什么都不渲染。不知道要长得像不知道 —— 消失长得像「没有这回事」。
    expect(engineRanText()).toBe("Not reported by the engine.");
    // 而且绝不许被商家自己写的那句顶上:那样这个字段就变成一句永远为真的废话。
    expect(engineRanText()).not.toContain(MERCHANT_PROMPT);
  });

  it("与商家写的一模一样 ⇒ 只说一句,不把同一段文字贴两遍", async () => {
    await renderPanel(one(MERCHANT_PROMPT), "video");
    expect(engineRanText()).toBe("Your prompt, exactly as you wrote it.");
  });

  it("多图:切到第二张,显示的是**第二张**那一句(r1 在这里串台)", async () => {
    await renderPanel([
      { id: "g1", url: "https://cdn.test/g1.png", favorite: false, finalPrompt: "first rewrite" },
      { id: "g2", url: "https://cdn.test/g2.png", favorite: false, finalPrompt: "second rewrite" },
    ], "video");
    expect(engineRanText()).toBe("first rewrite");

    const thumbs = [...detailSurface().querySelectorAll("button")].filter((b) => b.querySelector('img[alt^="Variant"]'));
    expect(thumbs.length, "多图时应该有变体缩略图").toBeGreaterThanOrEqual(2);
    await act(async () => { thumbs[1]!.click(); });
    expect(engineRanText()).toBe("second rewrite");
  });

  it("多图:第二张没报 ⇒ 第二张说不知道,**不继承**第一张那一句", async () => {
    await renderPanel([
      { id: "g1", url: "https://cdn.test/g1.png", favorite: false, finalPrompt: "first rewrite" },
      { id: "g2", url: "https://cdn.test/g2.png", favorite: false, finalPrompt: null },
    ], "video");
    const thumbs = [...detailSurface().querySelectorAll("button")].filter((b) => b.querySelector('img[alt^="Variant"]'));
    await act(async () => { thumbs[1]!.click(); });
    expect(engineRanText()).toBe("Not reported by the engine.");
  });

  // 记录本身对视频也在落(同一个发送点),但视频这一面的展示**一个字都没动**:
  // 它照旧只说「引擎跑的那句」。fixture 这里刻意带着一份非空的 sentPrompt。
  it("视频回执不显示图片专属的「What we sent to the engine」这一行", async () => {
    await renderPanel(one("a bright poster, weekend sale, bold type"), "video", { verbatim: true });
    expect(detailSurface().textContent).not.toContain("What we sent to the engine");
  });
});

/**
 * Creation S2 §8.1①(CREATE-A4 / CREATE-A12,Codex 跨厂复审 r1 P1-3 落修)——
 * **「为什么是这一档」这句话真的到得了商家眼前**。
 *
 * 判官说的是:`routeReason` 只被写、没有任何产品路径读它,所以「路由理由可查」这条验收
 * 在生产代码上是空的。服务端那一半(getGenJob / getGeneration 真的交出来)钉在
 * `creation-routing-ledger.test.ts`;这一份钉的是最后一段:面板把它显示出来,
 * 而「没升档」长得像没升档 —— 整块消失,不是一句编出来的占位话。
 */
/** 面板上「Why this tier」这一块底下那句话 —— 屏幕上真正写着的字。 */
function whyThisTierRow(): HTMLElement | null {
  return [...container!.querySelectorAll("span")]
    .find((el) => el.textContent?.trim() === "Why this tier") ?? null;
}

/** 与 renderPanel 同一条路,只是这一份要额外塞一个字段进 DTO。 */
async function renderPanelWith(extra: Record<string, unknown>): Promise<void> {
  mocks.getGeneration.mockResolvedValue({ ...generation(one(null), "video", null), ...extra });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(DetailPanel, {
      generationId: "g1", projectId: "p1", onClose: () => {}, entities: [],
    } as never));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

describe("CREATE-A12 资产回执:这一趟为什么落到这一档", () => {
  it("CREATE-A12 有理由 ⇒ 面板把这句话显示出来,且不带型号名", async () => {
    const reason = "You asked for 1080p, so this went to the HD tier.";
    await renderPanelWith({ routeReason: reason });
    expect(whyThisTierRow(), "面板上应该有「Why this tier」这一块").not.toBeNull();
    const text = container!.textContent ?? "";
    expect(text).toContain("Why this tier");
    expect(text).toContain(reason);
    for (const secret of ["seedance", "seedream", "dreamina", "byteplus", "mini"]) {
      expect(text.toLowerCase()).not.toContain(secret);
    }
  });

  it("CREATE-A12 没升档(null)⇒ 整块不渲染,一个字都不说", async () => {
    await renderPanelWith({ routeReason: null });
    expect(whyThisTierRow()).toBeNull();
  });

  it("CREATE-A12 字段整个读不到(老调用点)⇒ 同样什么都不说", async () => {
    await renderPanelWith({});
    expect(whyThisTierRow()).toBeNull();
  });
});

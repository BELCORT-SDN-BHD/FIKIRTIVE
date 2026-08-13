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
 * #914 r2(判官 r1 P1 FAIL):图片这条路新增的那条事实原本恒定显示 "Sent exactly as you
 * wrote it." —— 判官指出这不实:官方契约只证明「引擎不回报改写」,不证明「引擎不改写」,
 * 而我们自己的拼装管线(coworkGenerate 的 composePrompt)确实会给部分图片模型家族加工提示
 * 词。这一票把它改成按真实比对条件化:`requestedPrompt`(拼装前,我们自己的数据,null =
 * 与 `prompt` 无分家)与 `prompt`(拼装后,平台真正送出的那句)逐字相同才说「原样」,不同
 * 就把 `prompt` 整句亮出来 —— 断言覆盖两个分支,而不是像 r1 那样只有恒真一种形状。
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

// #914 r2:requestedPrompt is a per-JOB fact (composePrompt runs once on the whole job's
// prompt, before any output image exists), not per-variant like finalPrompt — so it's a
// plain third argument here, not a field on each Variant.
const generation = (variants: Variant[], kind: "image" | "video" = "image", requestedPrompt: string | null = null) => ({
  id: variants[0]!.id,
  projectId: "p1",
  url: variants[0]!.url,
  urls: variants.map((v) => v.url),
  variants,
  kind,
  prompt: MERCHANT_PROMPT,
  finalPrompt: variants[0]!.finalPrompt,
  requestedPrompt,
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

async function renderPanel(variants: Variant[], kind: "image" | "video" = "image", requestedPrompt: string | null = null): Promise<void> {
  mocks.getGeneration.mockResolvedValue(generation(variants, kind, requestedPrompt));
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

/** 「What the engine ran」那一块底下的那句话 —— 屏幕上真正写着的字。只在这一块存在时调用。 */
function engineRanText(): string {
  const labels = [...container!.querySelectorAll("span")].filter((s) => s.textContent?.trim() === "What the engine ran");
  expect(labels[0], "面板上应该有「What the engine ran」这一块").toBeDefined();
  const body = labels[0]!.parentElement!.querySelector("p");
  expect(body, "这一块底下应该有一句话").not.toBeNull();
  return body!.textContent!.trim();
}

/** #914:「What the engine ran」这一块存不存在 —— 图片回执的核心断言,不看文案看有没有这一行。 */
function hasEngineRanRow(): boolean {
  return [...container!.querySelectorAll("span")].some((s) => s.textContent?.trim() === "What the engine ran");
}

/** #914 r2:「What we sent to the engine」那一块底下的那句话 —— 图片回执的平台加工事实。 */
function sentToEngineText(): string {
  const labels = [...container!.querySelectorAll("span")].filter((s) => s.textContent?.trim() === "What we sent to the engine");
  expect(labels[0], "图片回执应该有「What we sent to the engine」这一块").toBeDefined();
  const body = labels[0]!.parentElement!.querySelector("p");
  expect(body, "这一块底下应该有一句话").not.toBeNull();
  return body!.textContent!.trim();
}

describe("#914 图片回执:「引擎实际提示词」整行永不出现", () => {
  it("引擎(结构上)没报 ⇒ 不出现占位句,这一行整个不渲染", async () => {
    await renderPanel(one(null), "image");
    expect(hasEngineRanRow()).toBe(false);
    expect(container!.textContent).not.toContain("Not reported by the engine.");
  });

  it("即便这一张带着 finalPrompt 值,图片回执也不显示这一行 —— 不分「有/无」两种形状", async () => {
    await renderPanel(one("a bright poster, weekend sale, bold type"), "image");
    expect(hasEngineRanRow()).toBe(false);
    // 有值也不许泄漏到别处——这一行整块不存在,不是换了个地方藏起来。
    expect(container!.textContent).not.toContain("a bright poster, weekend sale, bold type");
  });

  it("多图切换缩略图,图片回执始终不出现这一行", async () => {
    await renderPanel([
      { id: "g1", url: "https://cdn.test/g1.png", favorite: false, finalPrompt: "first rewrite" },
      { id: "g2", url: "https://cdn.test/g2.png", favorite: false, finalPrompt: null },
    ], "image");
    expect(hasEngineRanRow()).toBe(false);
    const thumbs = [...container!.querySelectorAll("button")].filter((b) => b.querySelector('img[alt^="Variant"]'));
    expect(thumbs.length, "多图时应该有变体缩略图").toBeGreaterThanOrEqual(2);
    await act(async () => { thumbs[1]!.click(); });
    expect(hasEngineRanRow()).toBe(false);
  });
});

describe("#914 r2(判官 r1 P1)图片回执:平台加工展示路径,按真实比对条件化", () => {
  it("requestedPrompt 缺省(null)⇒ 没有可分家的两句话,明写「按原文送出」", async () => {
    await renderPanel(one(null), "image", null);
    expect(sentToEngineText()).toBe("Sent exactly as you wrote it.");
  });

  it("requestedPrompt 与实际送出的 prompt 逐字相同(显式传入,不是靠 null 缺省)⇒ 仍说原样", async () => {
    await renderPanel(one(null), "image", MERCHANT_PROMPT);
    expect(sentToEngineText()).toBe("Sent exactly as you wrote it.");
  });

  it("requestedPrompt 与实际送出的 prompt 不同(拼装管线真的加工过)⇒ 展示平台实际送出的提示词全文", async () => {
    const requested = "a poster, weekend sale"; // 商家批的那句 —— 拼装之前
    await renderPanel(one(null), "image", requested);
    // MERCHANT_PROMPT 是 fixture 里 gen.prompt 的值 —— 平台真正送出的那一句。
    expect(sentToEngineText()).toBe(MERCHANT_PROMPT);
    expect(sentToEngineText()).not.toBe("Sent exactly as you wrote it.");
  });

  it("这一行不受(结构上不可能出现的)finalPrompt 影响 —— 只比 requestedPrompt vs prompt,不看引擎回执", async () => {
    await renderPanel(one("a bright poster, weekend sale, bold type"), "image", null);
    expect(sentToEngineText()).toBe("Sent exactly as you wrote it.");
  });

  it("多图:requestedPrompt 是整单一份事实,不随缩略图切换而变", async () => {
    const requested = "a poster, weekend sale"; // 不同于 MERCHANT_PROMPT,应该显示 gen.prompt
    await renderPanel([
      { id: "g1", url: "https://cdn.test/g1.png", favorite: false, finalPrompt: null },
      { id: "g2", url: "https://cdn.test/g2.png", favorite: false, finalPrompt: null },
    ], "image", requested);
    expect(sentToEngineText()).toBe(MERCHANT_PROMPT);
    const thumbs = [...container!.querySelectorAll("button")].filter((b) => b.querySelector('img[alt^="Variant"]'));
    await act(async () => { thumbs[1]!.click(); });
    expect(sentToEngineText()).toBe(MERCHANT_PROMPT);
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

    const thumbs = [...container!.querySelectorAll("button")].filter((b) => b.querySelector('img[alt^="Variant"]'));
    expect(thumbs.length, "多图时应该有变体缩略图").toBeGreaterThanOrEqual(2);
    await act(async () => { thumbs[1]!.click(); });
    expect(engineRanText()).toBe("second rewrite");
  });

  it("多图:第二张没报 ⇒ 第二张说不知道,**不继承**第一张那一句", async () => {
    await renderPanel([
      { id: "g1", url: "https://cdn.test/g1.png", favorite: false, finalPrompt: "first rewrite" },
      { id: "g2", url: "https://cdn.test/g2.png", favorite: false, finalPrompt: null },
    ], "video");
    const thumbs = [...container!.querySelectorAll("button")].filter((b) => b.querySelector('img[alt^="Variant"]'));
    await act(async () => { thumbs[1]!.click(); });
    expect(engineRanText()).toBe("Not reported by the engine.");
  });

  it("视频回执不显示图片专属的「What we sent to the engine」平台加工行", async () => {
    await renderPanel(one("a bright poster, weekend sale, bold type"), "video");
    expect(container!.textContent).not.toContain("What we sent to the engine");
  });
});

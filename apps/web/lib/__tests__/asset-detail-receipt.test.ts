// @vitest-environment jsdom
/**
 * #776 r2 —— 资产详情面板上的生成回执:「引擎真正跑的那句话」。
 *
 * 判官 r1 在这里点了两处,都不是逻辑写错,是**说法**错:
 *   · `finalPrompt = null` 时整块隐藏 —— 于是「引擎没报」和「这条链根本不存在」在屏幕上
 *     长得一模一样。商家看不出到底有没有这回事,而这张票的全部意义就是让这件事可追溯;
 *   · 多图时只带主图那一句 —— 切到第二张,面板拿第一张的话去解释第二张。一个**确定错误**
 *     的答案,比空着更糟。
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

const generation = (variants: Variant[]) => ({
  id: variants[0]!.id,
  projectId: "p1",
  url: variants[0]!.url,
  urls: variants.map((v) => v.url),
  variants,
  kind: "image",
  prompt: MERCHANT_PROMPT,
  finalPrompt: variants[0]!.finalPrompt,
  favorite: false,
  sourceGenerationId: null,
  imageAspect: "1:1",
});

const one = (finalPrompt: string | null): Variant[] => [{ id: "g1", url: "https://cdn.test/g1.png", favorite: false, finalPrompt }];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
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

async function renderPanel(variants: Variant[]): Promise<void> {
  mocks.getGeneration.mockResolvedValue(generation(variants));
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

/** 「What the engine ran」那一块底下的那句话 —— 屏幕上真正写着的字。 */
function engineRanText(): string {
  const labels = [...container!.querySelectorAll("span")].filter((s) => s.textContent?.trim() === "What the engine ran");
  expect(labels[0], "面板上应该有「What the engine ran」这一块").toBeDefined();
  const body = labels[0]!.parentElement!.querySelector("p");
  expect(body, "这一块底下应该有一句话").not.toBeNull();
  return body!.textContent!.trim();
}

describe("#776 r2:引擎真正跑的那句话,在商家面板上", () => {
  it("引擎报了 ⇒ 原样显示那一句", async () => {
    await renderPanel(one("a bright poster, weekend sale, bold type"));
    expect(engineRanText()).toBe("a bright poster, weekend sale, bold type");
  });

  it("引擎没报 ⇒ **说出来**,而不是整块消失", async () => {
    await renderPanel(one(null));
    // r1 在这里什么都不渲染。不知道要长得像不知道 —— 消失长得像「没有这回事」。
    expect(engineRanText()).toBe("Not reported by the engine.");
    // 而且绝不许被商家自己写的那句顶上:那样这个字段就变成一句永远为真的废话。
    expect(engineRanText()).not.toContain(MERCHANT_PROMPT);
  });

  it("与商家写的一模一样 ⇒ 只说一句,不把同一段文字贴两遍", async () => {
    await renderPanel(one(MERCHANT_PROMPT));
    expect(engineRanText()).toBe("Your prompt, exactly as you wrote it.");
  });

  it("多图:切到第二张,显示的是**第二张**那一句(r1 在这里串台)", async () => {
    await renderPanel([
      { id: "g1", url: "https://cdn.test/g1.png", favorite: false, finalPrompt: "first rewrite" },
      { id: "g2", url: "https://cdn.test/g2.png", favorite: false, finalPrompt: "second rewrite" },
    ]);
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
    ]);
    const thumbs = [...container!.querySelectorAll("button")].filter((b) => b.querySelector('img[alt^="Variant"]'));
    await act(async () => { thumbs[1]!.click(); });
    expect(engineRanText()).toBe("Not reported by the engine.");
  });
});

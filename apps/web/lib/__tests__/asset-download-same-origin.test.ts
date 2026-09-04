// @vitest-environment jsdom
/**
 * 登记 2026-09-04 P0-2 —— 资产详情的「Download」到底指向哪里。
 *
 * 走查现场:按下去不是存文件,是整个人被导航去 `…r2.cloudflarestorage.com/….mp4`。根因不在
 * 按钮上,在**跨源**上 —— `/files/…` 会 302 到 R2,而 `download` 属性只在同源时生效,跨源被
 * 浏览器直接忽略,于是那次点击退化成一次普通导航。
 *
 * 所以这一份不去断言「有一颗 Download 按钮」(那颗按钮一直都在,坏的时候也在),断言的是
 * **它指向同源的附件地址**。真组件、真 React;服务端动作全是假件,一个积分也花不出去
 * (与 video-audio-toggle.test.ts 同一套做法)。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sameOriginDownloadUrl, safeDownloadFileName } from "@/lib/download-url";

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
vi.mock("@/components/MentionInput", () => ({ MentionInput: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: DetailPanel } = await import("@/components/asset/DetailPanel");

const MODELS = {
  image: "capability-image-1",
  video: "capability-video-1",
  imageCredits: 8,
  videoCredits: 80,
  videoDefaults: { seconds: 5, resolution: "720p", aspectRatio: "16:9", fps: 0, audio: true },
  videoAspectRatios: ["16:9", "9:16", "1:1", "adaptive"],
  videoDurations: [5, 12],
  videoResolutions: ["720p", "480p"],
  videoI2vDefaultAspect: "adaptive",
  videoCreditsBySpec: { "720p:5": 11 },
  imageAspectRatios: ["1:1", "9:16"],
  imageDefaultAspect: "1:1",
};

/** 商家真实看到的那种地址:app-relative 的 `/files/…`,生产上它会 302 去 R2。 */
const MEDIA_URL = `/files/u/org-a/${"c".repeat(64)}.png`;

const generation = () => ({
  id: "g1",
  projectId: "p1",
  url: MEDIA_URL,
  urls: [MEDIA_URL],
  variants: [{ id: "g1", url: MEDIA_URL, favorite: false }],
  kind: "image",
  prompt: "red sneakers on sand",
  favorite: false,
  sourceGenerationId: null,
  imageAspect: "1:1",
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  mocks.getActiveGenModels.mockResolvedValue(MODELS);
  mocks.getGeneration.mockResolvedValue(generation());
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function renderPanel(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(DetailPanel, {
      generationId: "g1",
      projectId: "p1",
      onClose: () => {},
      entities: [],
    } as never));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

/** 面板走 Portal 挂在 body 上,不在挂载点那一支里。 */
function detailSurface(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('[data-slot="sheet-content"]');
  expect(found, "资产详情 Sheet 应该已经打开").not.toBeNull();
  return found!;
}

function downloadLink(): HTMLAnchorElement {
  const found = [...detailSurface().querySelectorAll("a")]
    .find((a) => a.textContent?.trim() === "Download");
  expect(found, "行动栏上应该有「Download」").toBeDefined();
  return found!;
}

describe("登记 2026-09-04 P0-2:资产详情的 Download 指向同源附件地址", () => {
  it("登记 2026-09-04 P0-2:href 是同源的 /files/…?download=1,不是会 302 去 R2 的裸地址", async () => {
    await renderPanel();
    const href = downloadLink().getAttribute("href")!;
    expect(href.startsWith("/files/")).toBe(true); // app-relative = 同源,download 属性才算数
    expect(href).not.toBe(MEDIA_URL); // 改前就是这一串,按下去等于导航走
    expect(new URL(href, "http://app.test").searchParams.get("download")).toBe("1");
    expect(downloadLink().hasAttribute("download")).toBe(true);
  });

  it("登记 2026-09-04 P0-2:文件名与画布批量下载同一个函数,商家两处存到的名字一样", async () => {
    await renderPanel();
    const href = downloadLink().getAttribute("href")!;
    expect(new URL(href, "http://app.test").searchParams.get("name")).toBe("red-sneakers-on-sand-1.png");
  });
});

describe("登记 2026-09-04 P0-2:同源下载地址的改写规则", () => {
  it("登记 2026-09-04 P0-2:只改写我们自己的 /files/ 地址,别的原样不动", () => {
    expect(sameOriginDownloadUrl("blob:http://app.test/abc", "x.png")).toBe("blob:http://app.test/abc");
    expect(sameOriginDownloadUrl("https://cdn.example/a.png", "x.png")).toBe("https://cdn.example/a.png");
  });

  it("登记 2026-09-04 P0-2:返回值仍是 app-relative,解析用的 base 一个字不漏出去", () => {
    const out = sameOriginDownloadUrl(MEDIA_URL, "red-sneakers-1.png");
    expect(out).toBe(`${MEDIA_URL}?download=1&name=red-sneakers-1.png`);
  });

  it("登记 2026-09-04 P0-2:文件名洗掉引号、换行与路径分隔符", () => {
    // 点本身是合法字符(扩展名要用),分隔符没了就走不成路径 —— 剩下的 `..` 只是普通字符。
    expect(safeDownloadFileName('a"b\r\nc/../d.png', "fallback.png")).toBe("a-b-c-..-d.png");
    expect(safeDownloadFileName("   ", "fallback.png")).toBe("fallback.png");
    expect(safeDownloadFileName("../../etc/passwd", "fallback.png")).toBe("etc-passwd");
  });
});

// @vitest-environment jsdom
/**
 * product-entrance-signposting —— **R3-F20:每一条「去加个产品」的指路,都要落在真有
 * 「Add product」那颗键的那一屏上**(第三轮走查 R3-F20;规格
 * `docs/specs/brand-product-identity.md` §1.2 入口表 / §1.3 空态 / 验收 PRODID-A1)。
 *
 * 走查现场:手工建产品的门今天只有一扇 —— `/brand/records` 的 Products 页签
 * (`components/otto/memory/ProductShowcase.tsx`:工具条一颗、空态一颗「Add product」)。
 * 而产品里所有指向它的话,没有一句真的指到它:
 *   · `lib/exits.ts` 的 `BRAND_MEMORY_HREF` 指 `/brand` —— 那是设计的五节工作台,
 *     一颗产品控件都没有(`app/brand/BrandWorkspace.tsx`);
 *   · `/brand/records` 不在导航里,它在产品里唯一的入口是 Brand 页顶那一行
 *     「Open the record editor」,而那一行原本只在 Knowledge base 与 Audiences 两节画 ——
 *     商家从导航点 Brand 落的是默认的 Brand voice(`app/brand/page.tsx`),那一屏上没有它;
 *   · Library 的 Elements → Products 空着时只说「保存的元素会出现在这里」,没有下一步。
 *
 * 所以这份文件钉三条,全部按**商家点得到的 DOM**断言,不看源码字面:
 *   ① 地址本身:`BRAND_MEMORY_HREF` 是记录编辑器的 Products 页签,而 `products` 是
 *      `SECTIONS`(`@fikirtive/core/memory-sections`)里真实存在的一个页签 key ——
 *      `?tab=` 认不出来的值会静静落回 "about",那一屏上同样没有「Add product」;
 *   ② Brand 五节**每一节**都画得出一条通向它的链接(而不是五节里的两节),而且落在**这一节
 *      说的那类记录**上(判官 P2-1:站在 Audiences 上点它落到「Your products」,读到的是客群、
 *      到手的是产品);
 *   ③ Library 的 Products 那一栏空着时,画得出一条通向同一个地址的链接。
 *
 * 它不证的事(留给旅程 23 与判官):那一屏上那颗键按下去真的建得出产品 —— 那是
 * `e2e/journeys/23-brand-product-identity.spec.ts` 从导航一路点到 `Add product` 的活。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SECTIONS } from "@fikirtive/core/memory-sections";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { capabilitiesForOrigin } from "@fikirtive/core/entity-policy";
import { BRAND_MEMORY_HREF, brandRecordsHref } from "@/lib/exits";
import type { BrandSectionKey } from "@fikirtive/core/memory-sections";
import type { BrandSectionView } from "@/lib/brand-context-data";
import type { LibraryElement } from "@/lib/library-elements-model";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  getGenerationHistory: vi.fn(),
  listLibraryFavorites: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn() }),
}));
// 这份文件只问「屏幕上有没有那条路」。两面各自的写入动作都不按,全部替身掉,
// 免得把品牌上下文与素材库两条真链路拖进来。
vi.mock("@/lib/memory-actions", () => ({
  addBrandSource: vi.fn(), confirmBrandDraft: vi.fn(), deleteMemory: vi.fn(),
  discardBrandDraft: vi.fn(), extractBrandDraft: vi.fn(), previewBrandContextEffect: vi.fn(),
  restoreMemory: vi.fn(), saveBrandDraft: vi.fn(), updateMemory: vi.fn(),
}));
vi.mock("@/lib/brand-record-actions", () => ({
  confirmBrandRecordDraft: vi.fn(), deleteBrandRecord: vi.fn(),
  discardBrandRecordDraft: vi.fn(), restoreBrandRecord: vi.fn(),
}));
vi.mock("@/lib/brand-revision-actions", () => ({ listBrandRevisionsAction: vi.fn() }));
vi.mock("@/lib/library-actions", () => ({ getGenerationHistory: mocks.getGenerationHistory }));
vi.mock("@/lib/actions", () => ({ restoreGeneration: vi.fn(), softDeleteEntity: vi.fn(), updateEntity: vi.fn() }));
vi.mock("@/lib/refgen-actions", () => ({ setBaseAsset: vi.fn() }));
vi.mock("@/lib/library-favorites", () => ({
  listLibraryFavorites: mocks.listLibraryFavorites,
  setLibraryFavorite: vi.fn(),
}));
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/library/CollectionsView", () => ({ CollectionsView: () => null }));
vi.mock("@/components/library/CollectionDialogs", () => ({ CollectionDialogs: () => null }));

const { BrandWorkspace } = await import("@/app/brand/BrandWorkspace");
const { LibraryView } = await import("@/components/library/LibraryView");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  mocks.getGenerationHistory.mockResolvedValue({ items: [], nextCursor: null });
  mocks.listLibraryFavorites.mockResolvedValue({ items: [], nextCursor: null });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await act(async () => { await Promise.resolve(); });
}

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  await settle();
  return container;
}

/** 屏幕上通向记录编辑器的那些链接(按 href 找,不按文案找)。 */
function linksToRecordsEditor(dom: HTMLElement, href: string): HTMLAnchorElement[] {
  return [...dom.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`)];
}

const EMPTY_SECTIONS: BrandSectionView[] = [
  { key: "brand-voice", label: "Brand voice", entries: [], removed: [] },
  { key: "audiences", label: "Audiences", entries: [], removed: [] },
  { key: "knowledge-base", label: "Knowledge base", entries: [], removed: [] },
  { key: "style-guide", label: "Style guide", entries: [], removed: [] },
  { key: "visual-guidelines", label: "Visual guidelines", entries: [], removed: [] },
];

/**
 * 每一节点过去该落在哪个页签 —— **在这里手写第二遍**,故意的。
 *
 * 断言若写成 `brandRecordsHref(section)`,它就只是在复述被测的那个函数:映射表改一格,
 * 测试跟着改一格,永远绿。这张表是「商家读到的这一节,交到手里的应该是哪类记录」这句话的
 * 独立一份(判官 P2-1:Audiences 上点它落到「Your products」就是这条被违反)。
 */
const EXPECTED_TAB: Record<string, string> = {
  "brand-voice": "products",
  audiences: "customers",
  "knowledge-base": "products",
  "style-guide": "products",
  "visual-guidelines": "products",
};

function libraryProduct(): LibraryElement {
  return {
    id: "ent_kaya",
    kind: "products",
    name: "Pandan kaya toast",
    origin: "USER",
    capabilities: capabilitiesForOrigin("USER"),
    coverUrl: null,
    baseAssetId: null,
    images: [],
    mediaCount: 0,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// ① 地址本身:指的是那颗键所在的那一屏
// ───────────────────────────────────────────────────────────────────────────────
describe("R3-F20 ① 指路常量指的是「Add product」那一屏", () => {
  it("BRAND_MEMORY_HREF = 记录编辑器 + Products 页签,不是 Brand 首页", () => {
    expect(BRAND_MEMORY_HREF).toBe(`${SHELL_ROUTES.brand}/records?tab=products`);
    expect(BRAND_MEMORY_HREF, "指回了五节工作台 —— 那一屏上没有任何产品控件").not.toBe(SHELL_ROUTES.brand);
  });

  it("`?tab=products` 是记录编辑器认得的页签 key —— 认不出来它会静静落回 About", () => {
    const tab = new URL(BRAND_MEMORY_HREF, "https://fikirtive.test").searchParams.get("tab");
    expect(SECTIONS.map((section) => section.key)).toContain(tab);
  });

  it("R3-F20 判官 P2-1:brandRecordsHref 按出处落页签,每一个落点都是真页签", () => {
    for (const [section, tab] of Object.entries(EXPECTED_TAB)) {
      expect(
        brandRecordsHref(section as BrandSectionKey),
        `从「${section}」指过去落错了页签`,
      ).toBe(`${SHELL_ROUTES.brand}/records?tab=${tab}`);
      expect(SECTIONS.map((item) => item.key), `${tab} 不是记录编辑器认得的页签`).toContain(tab);
    }
    // 不带出处 = 产品入口,与常量同一条。
    expect(brandRecordsHref()).toBe(BRAND_MEMORY_HREF);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// ② Brand 五节:每一节都指得出路
// ───────────────────────────────────────────────────────────────────────────────
describe("R3-F20 ② Brand 的每一节都有一条通向记录编辑器的链接,且落在这一节说的那类记录上", () => {
  for (const section of EMPTY_SECTIONS) {
    const expected = `${SHELL_ROUTES.brand}/records?tab=${EXPECTED_TAB[section.key]}`;
    it(`R3-F20 「${section.label}」这一节画得出那条链接,落在 ?tab=${EXPECTED_TAB[section.key]}`, async () => {
      const dom = await mount(
        createElement(BrandWorkspace, { sections: EMPTY_SECTIONS, initialSection: section.key }),
      );
      const links = linksToRecordsEditor(dom, expected);
      expect(
        links.length,
        `商家停在「${section.label}」这一节时,屏幕上没有一条落在 ${expected} 的路 —— 屏幕上是:${dom.textContent}`,
      ).toBeGreaterThan(0);
      expect(links[0].textContent?.trim(), "那条链接没有可读的字").not.toBe("");
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// ③ Library 的 Products 空态(规格 §1.3)
// ───────────────────────────────────────────────────────────────────────────────
describe("R3-F20 ③ Library 的 Products 空态说得出去哪里加一个", () => {
  async function mountLibrary(elements: LibraryElement[]): Promise<HTMLDivElement> {
    return mount(
      createElement(LibraryView, {
        initialView: "elements",
        initialElementView: "products",
        initialPage: { items: [], nextCursor: null },
        projects: [],
        elements,
      } as never),
    );
  }

  it("R3-F20 一件产品都没有时,空态里有一条通向产品编辑器的链接", async () => {
    const dom = await mountLibrary([]);
    expect(dom.textContent, "空态那句话不见了").toContain("No products yet");
    expect(
      linksToRecordsEditor(dom, BRAND_MEMORY_HREF).length,
      `商家读到「还没有产品」,却没有下一步 —— 屏幕上是:${dom.textContent}`,
    ).toBeGreaterThan(0);
  });

  it("R3-F20 已经有产品时不画这条指路 —— 空态的话只在空的时候说", async () => {
    const dom = await mountLibrary([libraryProduct()]);
    expect(dom.textContent).not.toContain("No products yet");
    expect(linksToRecordsEditor(dom, BRAND_MEMORY_HREF)).toHaveLength(0);
  });
});

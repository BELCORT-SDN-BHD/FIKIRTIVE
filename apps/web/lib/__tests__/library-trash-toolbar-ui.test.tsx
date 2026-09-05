// @vitest-environment jsdom
/**
 * library-trash-toolbar-ui —— 回收站**不是一扇单向门**,以及卡片标题的整组接线
 * (清单 B3 / B4;前端基线规格 `docs/specs/frontend-baseline.md` §5 2026-09-05 行;
 *  验收行 FRONT-A5 / FRONT-A14)。
 *
 * 病象(判官 2026-09-05 在 #1238 上实测):切到 More filters → Show → Trash 之后,整条工具条
 * 连同「回 In library」的入口一起卸载 —— 屏幕上只剩五个页签和一句「Trash is empty」,唯一的
 * 出路是整页刷新;而 `show` 不进地址、换页签也不复位,于是 Trash 语义会跟着商家渗进
 * Uploads 那一格。再加一条:已经开着的选择模式带着两颗**必然失败**的批量键进了回收站。
 *
 * 根因是一句把两件事绑在一起的判据(`LibraryView.tsx` 改前的 `selectableView`):
 * 「工具条要不要画」与「能不能进选择模式」共用同一个布尔值。改后拆成 `toolbarView` 与
 * `canSelect` 两件事。
 *
 * 这份文件钉的是**商家在屏幕上看得见的四件事**:
 *   ① 进了回收站,搜索与 More filters 还在,而 Select 那一颗不在;
 *   ② 从回收站选得回 In library —— 不用刷新页面;
 *   ③ `show` 进地址(`?show=trash`),换页签跟着复位,Trash 不渗进别的一格;
 *   ④ 带着选择模式进回收站:勾选框与批量条都不出现。
 * 外加清单 B4 的那一组:卡片标题 = Otto 摘要,同组重名才编号,tooltip 仍是完整原名。
 *
 * 变异自查(逐一实做,做完还原,红→绿):
 *   · 把工具条的渲染判据换回 `canSelect` ⇒ ①②④ 红;
 *   · 去掉 `writeRoute` 的 `show` 分支 ⇒ ③ 红;
 *   · 去掉 `changeView` 里 `show` 的复位 ⇒ ③ 换页签那一条红;
 *   · 让 `MediaGrid` 一格一格各算各的标题(不走整组的 `libraryCardTitles`)⇒ 序号那一条红。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@/lib/library-actions";

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
  getGenerationHistory: vi.fn(),
  restoreGeneration: vi.fn(),
  softDeleteEntity: vi.fn(),
  listLibraryFavorites: vi.fn(),
  setLibraryFavorite: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/library-actions", () => ({ getGenerationHistory: mocks.getGenerationHistory }));
vi.mock("@/lib/actions", () => ({
  restoreGeneration: mocks.restoreGeneration,
  softDeleteEntity: mocks.softDeleteEntity,
}));
vi.mock("@/lib/library-favorites", () => ({
  listLibraryFavorites: mocks.listLibraryFavorites,
  setLibraryFavorite: mocks.setLibraryFavorite,
}));
// 详情面与合集那两块各有自己的挂载测试;这一面只关心网格与工具条,所以它们是存根。
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/library/CollectionsView", () => ({ CollectionsView: () => null }));
vi.mock("@/components/library/CollectionDialogs", () => ({ CollectionDialogs: () => null }));

const { LibraryView } = await import("@/components/library/LibraryView");
const { MediaGrid } = await import("@/components/library/MediaGrid");

const NOW = new Date().toISOString();

function item(over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: "gen_live",
    projectId: "prj_1",
    assetId: "ast_1",
    url: "/files/org/aa/bb/live.png",
    kind: "image",
    source: "generated",
    prompt: "a storefront at dusk",
    filename: "",
    summary: "",
    width: 8,
    height: 10,
    durationS: null,
    favorite: false,
    createdAt: NOW,
    ...over,
  };
}

const LIVE = item();
const TRASHED = item({ id: "gen_trashed", prompt: "a kaya jar on rattan" });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/library");
  mocks.getGenerationHistory.mockImplementation(async (query: { trashed?: boolean }) => ({
    items: query?.trashed ? [TRASHED] : [LIVE],
    nextCursor: null,
  }));
  mocks.listLibraryFavorites.mockResolvedValue({ items: [], nextCursor: null });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function mountLibrary(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(LibraryView, {
      initialView: "history",
      initialElementView: "people",
      initialPage: { items: [LIVE], nextCursor: null },
      projects: [],
      elements: [],
    } as never));
  });
  await settle();
}

/** 条件一变就是 300ms 的防抖 + 一次服务端往返 —— 两样都等到。 */
async function settle(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
  await act(async () => { await Promise.resolve(); });
}

function screenText(): string {
  return document.body.textContent ?? "";
}

function buttonNamed(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === label);
}

function toolbar(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>("[data-library-toolbar]");
}

/** 打开 More filters 那个菜单,按下里面写着 `label` 的那一项。 */
async function pickInMoreFilters(label: string): Promise<void> {
  const trigger = [...document.body.querySelectorAll("button")]
    .find((button) => button.textContent?.trim().startsWith("More filters"));
  expect(trigger, "More filters 这颗键不在屏幕上").toBeTruthy();
  await act(async () => {
    trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  const option = [...document.body.querySelectorAll<HTMLElement>(
    '[role="menuitemradio"], [role="menuitem"], [role="menuitemcheckbox"]',
  )].find((row) => row.textContent?.trim() === label);
  expect(option, `More filters 里没有写着「${label}」的那一项`).toBeTruthy();
  await act(async () => { option!.click(); });
  await settle();
}

describe("FRONT-A5 回收站不是单向门", () => {
  it("FRONT-A5 进了回收站,工具条还在 —— 搜索与 More filters 都在,只有 Select 不在", async () => {
    await mountLibrary();
    expect(buttonNamed("Select"), "改前这一格本来就该有 Select").toBeTruthy();

    await pickInMoreFilters("Trash");

    expect(screenText()).toContain("a kaya jar on rattan");
    expect(toolbar(), "整条工具条跟着 Trash 一起卸载了 —— 商家只剩整页刷新一条出路").not.toBeNull();
    expect(
      document.body.querySelector('[aria-label="Search Library"]'),
      "回收站里搜索框不见了",
    ).not.toBeNull();
    expect(
      [...document.body.querySelectorAll("button")].some((b) => b.textContent?.trim().startsWith("More filters")),
      "回收站里 More filters 不见了 —— 而详情面的确认框正让商家去那里找它",
    ).toBe(true);
    // 唯一该消失的就是这一颗:回收站里的批量动作写入前都要过存活校验,必然失败。
    expect(buttonNamed("Select"), "回收站里还画着一颗必然失败的 Select").toBeUndefined();
  });

  it("FRONT-A5 从回收站选得回 In library —— 不用刷新页面", async () => {
    await mountLibrary();
    await pickInMoreFilters("Trash");
    expect(screenText()).toContain("a kaya jar on rattan");

    await pickInMoreFilters("In library");

    expect(screenText()).toContain("a storefront at dusk");
    expect(screenText()).not.toContain("Trash is empty");
    expect(buttonNamed("Select"), "回到 In library 之后 Select 没回来").toBeTruthy();
  });

  it("FRONT-A5 回收站进地址(`?show=trash`),换页签跟着复位 —— Trash 不渗进 Uploads", async () => {
    await mountLibrary();
    await pickInMoreFilters("Trash");
    expect(window.location.search, "屏幕上是回收站,地址却说不出来").toContain("show=trash");

    const uploads = [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((tab) => tab.textContent?.trim() === "Uploads");
    expect(uploads, "Uploads 页签不在").toBeTruthy();
    await act(async () => { uploads!.click(); });
    await settle();

    expect(window.location.search, "换了页签,地址里还留着 Trash").not.toContain("show=trash");
    expect(screenText(), "换了页签,正文还是回收站").not.toContain("Trash is empty");
    expect(screenText()).toContain("a storefront at dusk");
  });

  it("FRONT-A5 带着选择模式进回收站:勾选框与批量条都不出现", async () => {
    await mountLibrary();
    await act(async () => { buttonNamed("Select")!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(
      document.body.querySelector('[aria-label^="Select a storefront"]'),
      "按下 Select 之后勾选框应该出现",
    ).not.toBeNull();

    await pickInMoreFilters("Trash");

    expect(
      [...document.body.querySelectorAll("[aria-label]")]
        .filter((node) => node.getAttribute("aria-label")?.startsWith("Select a kaya")),
      "回收站里的格子上还挂着勾选框",
    ).toHaveLength(0);
    expect(screenText(), "回收站里出现了两颗必然失败的批量键").not.toContain("Add to collection");
  });
});

/**
 * 清单 B4 —— 卡片标题 = Otto 摘要 ＋(同组重名才有的)序号,tooltip 仍是完整原名。
 * 规则本身的用例在 `library-view-model.test.ts`;这里钉的是**网格真的这么接线**。
 */
describe("FRONT-A14 卡片标题:摘要优先,同组重名才编号", () => {
  it("FRONT-A14 有摘要就写摘要;同组同名的那几格按顺序编号,单独一格不编", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(MediaGrid, {
        items: [
          item({ id: "g1", summary: "Kaya jar on rattan", prompt: "long prompt one" }),
          item({ id: "g2", summary: "Kaya jar on rattan", prompt: "long prompt two" }),
          item({ id: "g3", summary: "Storefront at dusk", prompt: "long prompt three" }),
        ],
        selectedId: undefined,
        onOpen: () => {},
        timeZone: "UTC",
      } as never));
    });

    const captions = [...document.body.querySelectorAll("button")]
      .map((button) => button.querySelector("span:last-of-type")?.textContent?.trim())
      .filter(Boolean);
    expect(captions).toContain("Kaya jar on rattan · 1");
    expect(captions).toContain("Kaya jar on rattan · 2");
    // 同名只有一格时不写序号 —— 孤零零的「· 1」只是噪音。
    expect(captions).toContain("Storefront at dusk");
    expect(captions).not.toContain("Storefront at dusk · 1");
    // 摘要上屏之后,整段提示词仍然是 tooltip(悬停看得到完整原名)。
    const first = document.body.querySelector<HTMLButtonElement>("button");
    expect(first?.getAttribute("title")).toBe("long prompt one");
  });
});

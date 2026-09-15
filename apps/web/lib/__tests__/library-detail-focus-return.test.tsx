// @vitest-environment jsdom
/**
 * library-detail-focus-return —— 素材详情面关掉之后,键盘焦点回到打开它的那张卡(R3-F05)。
 *
 * 病象(round-3 staging 走查,build 14bcd038):在 `/library` 的 Generation history 里 Tab 到
 * 一张素材卡、Enter 打开 Asset details、Escape 关掉 —— `document.activeElement` 变成 `<body>`。
 * 只用键盘或读屏的商家等于被丢回页面最顶上:想看下一件,得从头再 Tab 一遍导航、页签与工具条。
 *
 * 机理(这份文件钉的就是它):关掉详情面的同一批 setState 里,`LibraryView` 会按同一组条件重取
 * 一次网格(详情面里删除、收藏、裁剪都写库,不重取就会留一屏假状态)。`reload` 第一句
 * `setLoading(true)` 把 `MediaGrid` 换成骨架屏 —— 于是**那张卡在这一次提交里就被卸载了**。
 * 任何「把焦点还给原来那个 DOM 节点」的机制到这一刻都已经落空:节点不在文档里,`focus()`
 * 是一次空操作(Base UI 的焦点管理器甚至会先用 `isConnected` 把它过滤掉),浏览器把焦点丢回
 * `<body>`。所以焦点只能由网格这一侧、按**素材 id** 在重取结束之后重新安放。
 *
 * 这一面是机理证明;商家那一侧的证明在 `e2e/journeys/20-library-favorites-and-collections.spec.ts`
 * 的 R3-F05 旅程(真浏览器、真面板、真 Escape)。两份都要:`document.activeElement` 是浏览器的
 * 状态,而这一份能把「重取把卡片卸掉」这一步单独拎出来看。
 *
 * 断言只认商家看得见的东西:卡片按可及名称(`Open <名字>`)找,焦点按 `document.activeElement`
 * 判 —— 恢复用的那个 `data-library-card` 是实现细节,这份文件不替它站台。
 *
 * 「不该抢就别抢」是这份文件的另一半(复核 2026-09-15 补的两条):重取是一次真的服务器往返,
 * 商家在这几百毫秒里会点进搜索框打字 —— 归位不能把焦点从他手里夺回来;那件素材已经不在
 * 网格里(被删掉,或只是被「Load older」翻出来、而关闭那次重取只取第一页)时,焦点落在网格
 * 那块区域上,**不落在别人的卡上** —— 停在别人的卡上,读屏念的是别人的名字,一个空格打开的
 * 也是别人那件素材。
 *
 * 变异自查(逐一实做,做完还原,红→绿):
 *   · 删掉 LibraryView 里整段焦点恢复 ⇒ 四条都红,activeElement 是 `<body>` —— 改前的病象;
 *   · 把恢复挪到 `loading` 仍为 true 时做 ⇒ 第一条红(那一刻卡片还没挂回来);
 *   · 把「焦点已经在别人手里就放手」那道闸拿掉 ⇒ 第四条红(焦点被从搜索框抢到卡上);
 *   · 认不出那件素材就退回 `cards[0]` ⇒ 第二、三条红(焦点落到一件陌生素材上)。
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
/**
 * 详情面在这一面是**存根**:它只要有一颗「关掉」的键。真面板(Base UI Sheet)的焦点管理
 * 由旅程在真浏览器里验;这里问的是网格这一侧 —— 面板关掉、网格重取完之后,焦点落在哪。
 */
vi.mock("@/components/asset/DetailPanel", () => ({
  default: ({ onClose }: { onClose: () => void }) =>
    createElement("button", { type: "button", onClick: onClose }, "Close detail"),
}));
vi.mock("@/components/library/CollectionsView", () => ({ CollectionsView: () => null }));
vi.mock("@/components/library/CollectionDialogs", () => ({ CollectionDialogs: () => null }));

const { LibraryView } = await import("@/components/library/LibraryView");

const NOW = new Date().toISOString();

function item(over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: "gen_first",
    projectId: "prj_1",
    assetId: "ast_1",
    url: "/files/org/aa/bb/first.png",
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

const FIRST = item();
const SECOND = item({ id: "gen_second", assetId: "ast_2", prompt: "a kaya jar on rattan" });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
/** 关掉详情面之后那一次重取交回什么 —— 「那件素材还在」与「它被删掉了」是两条不同的路。 */
let itemsAfterClose: LibraryItem[] = [FIRST, SECOND];
/** 第一页之后还有没有下一页(非 null ⇒ 屏幕上出现「Load older」)。 */
let cursorAfterClose: string | null = null;
/** 「Load older」按下去那一次交回什么 —— 第二页的素材**不在**第一页的重取结果里。 */
let olderPage: LibraryItem[] = [];
/**
 * 把重取按住不放。重取是一次真的服务器往返(几百毫秒),商家在这段时间里照样能点、能打字;
 * 不按住的话这几百毫秒在测试里压成一个微任务,「重取还在飞的时候商家把焦点挪走了」那条路
 * 根本摊不开。
 */
let heldReload: { promise: Promise<void>; release: () => void } | null = null;

/** 按住下一次重取,返回一把「放行」的钥匙。 */
function holdNextReload(): () => void {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  heldReload = { promise, release };
  return () => { heldReload = null; release(); };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/library");
  itemsAfterClose = [FIRST, SECOND];
  cursorAfterClose = null;
  olderPage = [];
  heldReload = null;
  mocks.getGenerationHistory.mockImplementation(async (query: { cursor?: string | null }) => {
    // 「Load older」那一次:另一页,与第一页各走各的。
    if (query?.cursor) return { items: olderPage, nextCursor: null };
    if (heldReload) await heldReload.promise;
    return { items: itemsAfterClose, nextCursor: cursorAfterClose };
  });
  mocks.listLibraryFavorites.mockResolvedValue({ items: [], nextCursor: null });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function mountLibrary(
  initialPage: { items: LibraryItem[]; nextCursor: string | null } = { items: [FIRST, SECOND], nextCursor: null },
): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(LibraryView, {
      initialView: "history",
      initialElementView: "people",
      initialPage,
      projects: [],
      elements: [],
    } as never));
  });
  await settle();
}

/** 重取是一次 await —— 让它走完,骨架屏收掉、卡片挂回来。 */
async function settle(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  await act(async () => { await Promise.resolve(); });
}

/** 商家怎么认这张卡,测试就怎么认:读屏念出来的那一句(可及名称后面还跟着媒体类型,
 *  所以这里按前缀认 —— 与 `library-trash-toolbar-ui` 同一种写法)。 */
function card(name: string): HTMLButtonElement | null {
  return document.body.querySelector<HTMLButtonElement>(`button[aria-label^="Open ${name}"]`);
}

function closeDetailButton(): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "Close detail");
}

/** 工具条那个搜索框 —— 商家关掉详情面之后最常点的下一个地方。 */
function searchBox(): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>('input[aria-label^="Search "]');
  expect(input, "工具条里没有搜索框").not.toBeNull();
  return input!;
}

/** 「Load older」那颗键 —— 翻出第二页。 */
function loadOlderButton(): HTMLButtonElement {
  const button = [...document.body.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === "Load older");
  expect(button, "屏幕上没有「Load older」").toBeTruthy();
  return button as HTMLButtonElement;
}

/**
 * 装着网格的那块可滚动区域(`tabIndex={-1}`)—— 那件素材已经不在网格里时,焦点的落脚点。
 * 按「装着卡片的那个能接焦点的祖先」找,不按 test id:商家看得见的是区域,不是属性。
 */
function gridRegion(): HTMLElement {
  const anyCard = document.body.querySelector<HTMLElement>("[data-library-card]");
  const region = anyCard
    ? anyCard.closest<HTMLElement>("div[tabindex='-1']")
    : document.body.querySelector<HTMLElement>("main div[tabindex='-1']");
  expect(region, "找不到网格那块区域").not.toBeNull();
  return region!;
}

/** 商家的动作:焦点在卡上(Tab 过来的那一下),按下去(Enter)。 */
async function openFromKeyboard(name: string): Promise<HTMLButtonElement> {
  const opener = card(name);
  expect(opener, `网格里没有「${name}」这张卡`).not.toBeNull();
  opener!.focus();
  expect(document.activeElement, "按下去之前焦点就不在卡上").toBe(opener);
  await act(async () => { opener!.click(); });
  await act(async () => { await Promise.resolve(); });
  expect(closeDetailButton(), "详情面没有打开").toBeTruthy();
  return opener!;
}

describe("R3-F05 素材详情关掉之后,焦点回到原来那张卡", () => {
  it("R3-F05 关掉之后焦点回到同一件素材的卡上 —— 即便网格已经整块重取过一次", async () => {
    await mountLibrary();
    const openedNode = await openFromKeyboard("a storefront at dusk");

    await act(async () => { closeDetailButton()!.click(); });
    await settle();

    const restored = card("a storefront at dusk");
    expect(restored, "重取之后这张卡不见了").not.toBeNull();
    // 病象长这样:activeElement 是 <body>,商家的焦点被丢回页面最顶上。
    expect(document.activeElement, "关掉详情面之后焦点没有回到那张卡").toBe(restored);
    // 而且它确实是**重新挂上去**的那个节点 —— 原节点在重取时被卸载了,这正是「把焦点还给
    // 记下来的那个 DOM 节点」这条路必然落空的原因(机理,见文件头)。
    expect(restored).not.toBe(openedNode);
    expect(openedNode.isConnected, "原来那个按钮节点居然还在文档里").toBe(false);
  });

  it("R3-F05 那件素材在详情面里被删掉了 —— 焦点落在网格那块区域上,不是 <body>、也不是别人的卡", async () => {
    await mountLibrary();
    await openFromKeyboard("a storefront at dusk");
    // 详情面里删掉它:关掉之后的重取里,它不再回来。
    itemsAfterClose = [SECOND];

    await act(async () => { closeDetailButton()!.click(); });
    await settle();

    expect(card("a storefront at dusk"), "被删掉的那件素材还在网格里").toBeNull();
    // 落脚点是**那块区域**,不是随便哪一张卡:焦点停在别人的卡上,读屏念的是别人的名字,
    // 一个空格就把那件别人的素材打开了(复核 2026-09-15)。
    expect(document.activeElement, "素材没了就把焦点丢回 <body>").toBe(gridRegion());
    expect(document.activeElement, "焦点停在了另一件素材的卡上").not.toBe(card("a kaya jar on rattan"));
  });

  it("R3-F05 那件素材是「Load older」翻出来的 —— 关掉之后焦点不落在第一页某个陌生人的卡上", async () => {
    // 商家的素材不止一页:第一页一件,按「Load older」又翻出一件。
    const OLDER = item({ id: "gen_older", assetId: "ast_9", prompt: "a kopitiam counter at dawn" });
    cursorAfterClose = "cursor_page_1";
    olderPage = [OLDER];
    await mountLibrary({ items: [FIRST], nextCursor: "cursor_page_1" });

    await act(async () => { loadOlderButton().click(); });
    await settle();
    expect(card("a kopitiam counter at dawn"), "第二页没翻出来").not.toBeNull();

    // 打开第二页那一件,再关掉。关闭那一次重取只取第一页(`cursor: null`),
    // 于是这件素材连同商家翻过的那几页一起从网格里消失 —— 它并没有被删掉。
    await openFromKeyboard("a kopitiam counter at dawn");
    await act(async () => { closeDetailButton()!.click(); });
    await settle();

    expect(card("a kopitiam counter at dawn"), "第二页那件素材居然还在网格里").toBeNull();
    expect(document.activeElement, "焦点被丢给了第一页某一件完全不相干的素材").not.toBe(
      card("a storefront at dusk"),
    );
    expect(document.activeElement, "焦点掉回了 <body>").toBe(gridRegion());
  });

  it("R3-F05 重取还在飞的时候商家自己把焦点挪走了 —— 归位放手,不把焦点从搜索框抢回来", async () => {
    await mountLibrary();
    await openFromKeyboard("a storefront at dusk");

    // 这一次重取按住不放:关掉面板之后、结果回来之前,那几百毫秒是商家的。
    const releaseReload = holdNextReload();
    await act(async () => { closeDetailButton()!.click(); });

    // 商家点进搜索框开始打字 —— 工具条一直挂在屏幕上,骨架屏只换掉网格那一块。
    const search = searchBox();
    search.focus();
    expect(document.activeElement, "搜索框没接住焦点").toBe(search);

    // 服务器这时候才回话。
    await act(async () => { releaseReload(); });
    await settle();

    // 病象长这样:焦点被从搜索框拽到某张卡上,后面打的字全落在按钮上,
    // 一个空格就把刚关掉的详情面又打开了(复核 2026-09-15)。
    expect(document.activeElement, "重取回来把焦点从商家手里抢走了").toBe(search);
  });
});

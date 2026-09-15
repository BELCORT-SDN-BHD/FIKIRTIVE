// @vitest-environment jsdom
/**
 * **Library 产品详情的身份两格 —— UI 层,真挂载(验收 PRODID-A4;规格 §5 2026-09-11「缺口」③)**
 *
 * 规格 §5 那一行把这个缺口逐字写出来过:「**Library 元素详情没有改名栏**:`updateEntity` 今天的
 * 调用方是 `components/otto/OttoStuff.tsx:260`(聊天壳时代的旧件,已无路由渲染)与
 * `lib/otto-entities-port.ts:37`(Otto 改名技能),Library 那一面一个字都没接,所以 A4 那句
 * 『在 Library 改名』演示不出来」。换封面同理:`setBaseAsset` 只有 Cast 的变体弹层在用。
 * 这份文件把那一行翻成会红的断言。
 *
 * 断言落在**商家按得到的东西**与**递出去的那一趟**上,不落在组件内部长什么样:
 *   ① 产品详情里有名字栏,改完按下去 → `updateEntity` 收到这一行的 id 与新名字;
 *   ② **只交名字这一格**(PRODID-R6 / R9):`type`、`notes` 这些键一个都不许出现 ——
 *      这一屏没在编辑它们,递过去就是拿一份可能过期的快照静默覆盖别处刚改的东西;
 *   ③ 详情里那排图上按「Use as cover」→ `setBaseAsset` 收到这一行的 id 与那张图的 asset id,
 *      屏幕上那枚 `Cover` 标签当场跟着挪过去(封面判据 = 身份上的 `baseAssetId`);
 *   ④ 被拒时**什么都不变**:名字与封面都还是库里那一份,屏幕上照抄服务端那句话;
 *   ⑤ 价格、卖点、分类一格都没有(PRODID-A5:这三项只在 Brand 页可改);
 *   ⑥ 官方演员那一栏两个控件都**不画**(判据是域层能力表,不是「哪一栏」)。
 *
 * 变异自查(实做过,做完还原,红→绿):把 `LibraryView.tsx` 那个 `<ElementIdentityFields>`
 * 挂载点注释掉 ⇒ ①②③④⑤ 一起红(⑤ 因为连弹层里那两格都没有了,断言的锚点消失)。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capabilitiesForOrigin } from "@fikirtive/core/entity-policy";
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
  getGenerationHistory: vi.fn(),
  restoreGeneration: vi.fn(),
  softDeleteEntity: vi.fn(),
  updateEntity: vi.fn(),
  setBaseAsset: vi.fn(),
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
  updateEntity: mocks.updateEntity,
}));
vi.mock("@/lib/refgen-actions", () => ({ setBaseAsset: mocks.setBaseAsset }));
vi.mock("@/lib/library-favorites", () => ({
  listLibraryFavorites: mocks.listLibraryFavorites,
  setLibraryFavorite: mocks.setLibraryFavorite,
}));
// 这一面只关心 Elements 那一格;网格、详情面与合集各有自己的挂载测试。
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/library/CollectionsView", () => ({ CollectionsView: () => null }));
vi.mock("@/components/library/CollectionDialogs", () => ({ CollectionDialogs: () => null }));

const { LibraryView } = await import("@/components/library/LibraryView");

const FIRST = { assetId: "ast_first", url: "/files/org/aa/bb/first.png" };
const SECOND = { assetId: "ast_second", url: "/files/org/aa/bb/second.png" };

function product(over: Partial<LibraryElement> = {}): LibraryElement {
  return {
    id: "ent_kaya",
    kind: "products",
    name: "Pandan kaya toast",
    origin: "USER",
    capabilities: capabilitiesForOrigin("USER"),
    coverUrl: FIRST.url,
    baseAssetId: FIRST.assetId,
    images: [FIRST, SECOND],
    mediaCount: 2,
    ...over,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/library?view=elements&element=products");
  mocks.getGenerationHistory.mockResolvedValue({ items: [], nextCursor: null });
  mocks.listLibraryFavorites.mockResolvedValue({ items: [], nextCursor: null });
  mocks.updateEntity.mockResolvedValue({ ok: true });
  mocks.setBaseAsset.mockResolvedValue({ ok: true });
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

/** 挂上 Library,切到 Elements → Products,点开这张卡。 */
async function openDetail(element: LibraryElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(LibraryView, {
      initialView: "elements",
      initialElementView: element.kind,
      initialPage: { items: [], nextCursor: null },
      projects: [],
      elements: [element],
    } as never));
  });
  await settle();
  const card = document.body.querySelector<HTMLButtonElement>(`button[aria-label="Open ${element.name}"]`);
  expect(card, `Library 里没有写着「Open ${element.name}」的那张卡`).toBeTruthy();
  await act(async () => { card!.click(); });
  await settle();
}

function screenText(): string {
  return document.body.textContent ?? "";
}

function buttonNamed(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === label);
}

function nameField(): HTMLInputElement {
  const label = [...document.body.querySelectorAll("label")]
    .find((item) => item.textContent?.trim() === "Name");
  expect(label, `产品详情里没有「Name」这一栏 —— 屏幕上是:${screenText()}`).toBeTruthy();
  const input = document.getElementById(label!.htmlFor) as HTMLInputElement | null;
  expect(input, "「Name」这一栏没有绑到输入框上(label.htmlFor 指不到控件)").toBeTruthy();
  return input!;
}

/** React 受控输入:直接改 value 会被 React 自己的 value tracker 吃掉,要走原生 setter。 */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

/** 那排图里第 n 张底下的「Use as cover」。 */
function useAsCoverButtons(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll("button")]
    .filter((button) => button.textContent?.trim() === "Use as cover");
}

/** 那排图上挂着的 `Cover` 角标(区块标题那一行是 `h3`,不是角标)。 */
function coverBadges(): HTMLSpanElement[] {
  return [...document.body.querySelectorAll("span")]
    .filter((node) => node.textContent?.trim() === "Cover");
}

describe("PRODID-A4 Library 产品详情:改名走共享动作 updateEntity", () => {
  it("PRODID-A4 在 Library 改名:updateEntity 收到这一行的 id 与新名字,屏幕上跟着变", async () => {
    await openDetail(product());
    await type(nameField(), "Pandan kaya toast (large)");

    const save = buttonNamed("Save name");
    expect(save, `详情里没有保存名字的那一颗 —— 屏幕上是:${screenText()}`).toBeTruthy();
    await act(async () => { save!.click(); });
    await settle();

    expect(mocks.updateEntity).toHaveBeenCalledTimes(1);
    expect(mocks.updateEntity.mock.calls[0]![0]).toBe("ent_kaya");
    // 卡片与弹层是同一行:两处一起跟上,不靠整页重取。
    expect(screenText()).toContain("Pandan kaya toast (large)");
    expect(document.body.querySelector('button[aria-label="Open Pandan kaya toast (large)"]')).toBeTruthy();
  });

  it("PRODID-R6 / PRODID-R9 只交名字这一格:type / notes 这些键一个都不递下去", async () => {
    // 身份的写路只认显式意图(`lib/actions.ts:updateEntity`:`fields.name !== undefined` 才写)。
    // 这一屏只编辑名字 —— 多递一格,就是拿这一屏手里那份可能过期的快照覆盖别处刚改的东西。
    await openDetail(product());
    await type(nameField(), "Kaya toast set");
    await act(async () => { buttonNamed("Save name")!.click(); });
    await settle();

    expect(mocks.updateEntity.mock.calls[0]![1]).toEqual({ name: "Kaya toast set" });
  });

  it("PRODID-A4 改名被拒:名字一个字没变,屏幕上照抄服务端那句话", async () => {
    mocks.updateEntity.mockResolvedValue({ error: "You already have a product with that name." });
    await openDetail(product());
    await type(nameField(), "Nasi lemak");
    await act(async () => { buttonNamed("Save name")!.click(); });
    await settle();

    expect(screenText()).toContain("You already have a product with that name.");
    // 一次被拒的改动不许在屏幕上留痕:那张卡还叫原来的名字。
    expect(document.body.querySelector('button[aria-label="Open Pandan kaya toast"]')).toBeTruthy();
    expect(document.body.querySelector('button[aria-label="Open Nasi lemak"]')).toBeFalsy();
  });

  it("PRODID-A5 产品详情里没有价格、卖点、分类的编辑入口", async () => {
    await openDetail(product());
    const text = screenText();
    for (const forbidden of ["Price", "Selling angle", "Category"]) {
      expect(text, `产品详情里出现了「${forbidden}」—— A5 说这三项只在 Brand 页可改`)
        .not.toContain(forbidden);
    }
  });
});

describe("PRODID-A4 Library 产品详情:换主图走共享动作 setBaseAsset", () => {
  it("PRODID-A4 在 Library 换封面:setBaseAsset 收到这一行的 id 与那张图,Cover 标签跟着挪过去", async () => {
    await openDetail(product());
    const buttons = useAsCoverButtons();
    // 封面那一张自己不画这颗键(它已经是封面了),所以两张图只剩一颗。
    expect(buttons, `详情里没有换封面的那一排 —— 屏幕上是:${screenText()}`).toHaveLength(1);

    await act(async () => { buttons[0]!.click(); });
    await settle();

    expect(mocks.setBaseAsset).toHaveBeenCalledTimes(1);
    expect(mocks.setBaseAsset.mock.calls[0]).toEqual(["ent_kaya", SECOND.assetId]);
    // 换完之后轮到原来那张画这颗键 —— `Cover` 标签真的挪了位,不是按完没反应。
    expect(useAsCoverButtons()).toHaveLength(1);
    const cover = document.body.querySelector<HTMLImageElement>(`img[src="${SECOND.url}"]`);
    expect(cover).toBeTruthy();
  });

  it("PRODID-A4 换封面被拒:封面还是原来那张,屏幕上照抄服务端那句话", async () => {
    mocks.setBaseAsset.mockResolvedValue({ error: "That image is not a base reference of this element." });
    await openDetail(product());
    await act(async () => { useAsCoverButtons()[0]!.click(); });
    await settle();

    expect(screenText()).toContain("That image is not a base reference of this element.");
    // 没有乐观写入,所以没有要回滚的东西:第二张底下那颗键还在,说明它还不是封面。
    expect(useAsCoverButtons()).toHaveLength(1);
  });

  it("PRODID-A4 只有一张图时不画换封面那一排(没有第二张可挑)", async () => {
    await openDetail(product({ images: [FIRST], mediaCount: 1 }));
    expect(useAsCoverButtons()).toHaveLength(0);
    // 名字那一栏照旧在 —— 两格互不牵连。
    expect(nameField()).toBeTruthy();
  });

  // ── 复核修正(判官 P1):身份上那一格是空的时候 ─────────────────────────────
  //
  // 这个状态走正常的路就到得了:Brand 页只填名字与价格建出来的产品,`Entity.baseAssetId`
  // 就是 null(`packages/db/src/create-product.ts:195`);Otto 的参考图默认走 REFSHEET
  // (`lib/otto-refgen-port.ts:86`),而 worker 只有 BASE 那一档才钉
  // (`apps/worker/src/jobs/refgen.ts:634`)—— 图挂上去了,身份上那一格还空着。
  //
  // 此刻 Brand 页那张产品卡**一张图都不画**(`withProductIdentity`:`baseAssetId` 为空就把
  // `imageAssetId` 删掉),所以这一屏不许把排在最前的那一张挂上 `Cover` 冒充封面 —— 冒充
  // 会同时坏两件事:标签在说谎,而且它底下那颗「Use as cover」被吃掉,商家恰恰在这个状态下
  // 最需要把一张钉上去。
  it("PRODID-A4 身份上还没钉过封面:一张都不挂 Cover 标签,每张底下都按得动", async () => {
    await openDetail(product({ baseAssetId: null }));

    expect(coverBadges(), `没钉过封面却有图被挂上了 Cover —— 屏幕上是:${screenText()}`).toHaveLength(0);
    // 两张都还能钉:第一张那颗键没有被「它就是封面」吃掉。
    expect(useAsCoverButtons()).toHaveLength(2);

    await act(async () => { useAsCoverButtons()[0]!.click(); });
    await settle();

    expect(mocks.setBaseAsset.mock.calls[0]).toEqual(["ent_kaya", FIRST.assetId]);
    // 钉上之后才有封面:标签落在第一张上,剩第二张底下还有那颗键。
    expect(coverBadges()).toHaveLength(1);
    expect(useAsCoverButtons()).toHaveLength(1);
  });

  it("PRODID-A4 只有一张图且没钉过:那一排照画 —— 那一张正是要钉上去的", async () => {
    await openDetail(product({ images: [FIRST], mediaCount: 1, baseAssetId: null }));

    // 「只有一张就不画」在这个状态下等于:唯一需要这个入口的时候它不在。
    expect(useAsCoverButtons(), `没钉过封面的单图产品里没有换封面那一排 —— 屏幕上是:${screenText()}`).toHaveLength(1);

    await act(async () => { useAsCoverButtons()[0]!.click(); });
    await settle();

    expect(mocks.setBaseAsset.mock.calls[0]).toEqual(["ent_kaya", FIRST.assetId]);
    // 钉上了就没得挑了:一张图、已经是封面 —— 整一排(连同那枚角标)收起来,
    // 与「只有一张图时不画换封面那一排」那条同一个结果。
    expect(useAsCoverButtons()).toHaveLength(0);
    expect(coverBadges()).toHaveLength(0);
  });
});

describe("官方演员只读:两个控件都不画(判据是域层能力表,不是哪一栏)", () => {
  it("PRODID-A4 官方演员的详情里既没有改名栏,也没有换封面那一排", async () => {
    await openDetail(product({
      id: "ent_official",
      kind: "official-avatars",
      name: "Aisyah",
      origin: "OFFICIAL_CATALOG",
      capabilities: capabilitiesForOrigin("OFFICIAL_CATALOG"),
    }));
    // 「不画」而不是「画成禁用」:一个能按、按完道歉的假控件正是这条纪律要拆掉的东西。
    expect(buttonNamed("Save name")).toBeUndefined();
    expect(useAsCoverButtons()).toHaveLength(0);
    expect([...document.body.querySelectorAll("label")].some((item) => item.textContent?.trim() === "Name")).toBe(false);
    expect(mocks.updateEntity).not.toHaveBeenCalled();
    expect(mocks.setBaseAsset).not.toHaveBeenCalled();
  });
});

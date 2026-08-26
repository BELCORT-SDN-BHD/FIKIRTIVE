// @vitest-environment jsdom
/**
 * r22-image-edit.test.ts —— 单图编辑层的行为契约(Founder 2026-08-26 裁决,对比稿 1 决定 #5)。
 *
 * 这一层是样机:真的改图还没接上,所以屏幕上那句话逐字说清楚「预览还是原来那一张」。
 * 样机不等于可以含糊 —— 下面每一条看的都是商家真的会遇到的事:
 *
 *   ⑤ 两个入口(Library 单图详情、画布逐图动作排)开的是**同一层**,不是两套长得像的东西;
 *   ⑥ 改一版 = 库里多出**新的一条**,原图一个字节都不动;
 *   ⑦ 同一张图上同一句改动按两次,库里仍然只有一条 —— 而且它如实说「已经改过这一版」,
 *      不是报一句 Done 然后什么都没发生;
 *   ⑧ 版本条切得动:点 Original / 点某一版,预览跟着换;
 *   ⑨ 视频没有可改的那一帧,所以那颗键是关着的,而且**说得出为什么**;
 *   ⑩ 改出来的那一条在详情层认得回它的原图。
 *
 * 变异自检(逐条实做,做完以 commit 为锚还原,红 → 绿):
 *   · `ArtCell` 里删掉 `data-canvas-art-action="edit"` 那一颗 ⇒ ⑤ 画布那一半红;
 *   · `editedLibraryAsset` 的 `id` 去掉 `input.source.id` 那一段 ⇒ ⑦ 红(两次改动撞成一条别的东西);
 *   · `makeEdit` 里把 `addLibraryAssets(current, [created])` 换成直接改原图 ⇒ ⑥ 红;
 *   · `ImageEditLayer` 的版本条 `onClick` 不再 `setPreviewId` ⇒ ⑧ 红;
 *   · `LibraryDetailLayer` 里 `disabled={asset.kind === "video"}` 删掉 ⇒ ⑨ 红。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImmersiveCanvasRuntimeContext } from "@/components/canvas/NorthstarCanvasWorkspace";

vi.mock("next/navigation", () => ({
  usePathname: () => "/library",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/canvas-actions", () => ({ listCanvasNodes: vi.fn().mockResolvedValue([]) }));
vi.mock("@/components/canvas/useCanvasGen", () => ({
  freshCanvasActionId: () => "canvas-action-test",
  useCanvasGen: () => ({ generateImage: vi.fn(), quoteCosts: vi.fn(), imageShapes: vi.fn() }),
}));

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

const { LibraryWorkroom } = await import("@/components/library/LibraryWorkroom");
const { R22CanvasSurface } = await import("@/components/canvas/R22CanvasSurface");
const { LIBRARY_FIXTURE_KEY, LIBRARY_SEED_ASSETS } = await import("@/components/library/library-fixture");
const { scopedR22FixtureKey } = await import("@/components/r22/r22-workspace-fixture");

type StoredAsset = { id: string; name: string; poster: string; starred: boolean; packIds: string[]; editedFromId?: string; editedFromName?: string };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = null;
  container = null;
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

function mount(element: ReactElement) {
  act(() => root!.render(element));
}

function click(node: Element) {
  act(() => { node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
}

/** 层走 Portal 挂在 `document.body` 上,不在挂载点那一支里。 */
function inLayer<T extends Element>(selector: string): T {
  const node = document.body.querySelector<T>(selector);
  if (!node) throw new Error(`${selector} 不在屏幕上 —— 下面的断言在核对空气`);
  return node;
}

function storedAssets(): StoredAsset[] {
  const raw = window.sessionStorage.getItem(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY));
  return raw ? (JSON.parse(raw) as { assets: StoredAsset[] }).assets : [];
}

/** 编辑层里那颗主键会等一小段人话状态,所以断言前要真的等它落地。 */
async function makeEdit() {
  const go = inLayer<HTMLButtonElement>("[data-r22-edit-go]");
  expect(go.disabled, "什么都没选就能按下去 —— 那一按是花钱的").toBe(false);
  await act(async () => {
    go.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 800));
  });
}

function openLibraryDetail(name: string) {
  mount(createElement(LibraryWorkroom, {}));
  const opener = container!.querySelector<HTMLElement>(`button[aria-label="Open ${name}"]`);
  if (!opener) throw new Error(`网格里没有 ${name}`);
  click(opener);
}

/* ── ⑤ 两个入口,同一层 ────────────────────────────────────────────────────── */

describe("单图编辑:两个入口开的是同一层", () => {
  it("⑤a Library 单图详情的「Edit image」开得出编辑层", () => {
    openLibraryDetail("Raya table setting");
    click(inLayer("[data-r22-lib-edit]"));

    expect(inLayer(".r22-edit-layer").textContent).toContain("Edit Raya table setting");
    expect(document.body.querySelectorAll("[data-r22-edit-preset]").length).toBe(6);
  });

  it("⑤b 画布逐图动作排的 Edit 开的是同一层(同一个组件、同一批预设)", async () => {
    await act(async () => {
      root!.render(createElement(R22CanvasSurface, {
        runtimeContext: {
          projects: [{ id: "project-a", name: "Raya launch" }],
          threads: [],
          activeProjectId: "project-a",
          activeThreadId: null,
          initialBalance: null,
          visualFixture: "r22",
        } as ImmersiveCanvasRuntimeContext,
        entities: [],
      }));
    });
    await act(async () => { await Promise.resolve(); });

    const edit = container!.querySelector<HTMLButtonElement>('button[aria-label="Edit Image 1"]');
    expect(edit, "板上那一张没有 Edit 这一颗").toBeTruthy();
    click(edit!);

    expect(inLayer(".r22-edit-layer").textContent).toContain("Edit Image 1");
    expect(document.body.querySelectorAll("[data-r22-edit-preset]").length).toBe(6);
  });
});

/* ── ⑥⑦⑧⑩ 改一版 ────────────────────────────────────────────────────────── */

describe("单图编辑:改一版", () => {
  async function editWarmerLight() {
    openLibraryDetail("Raya table setting");
    click(inLayer("[data-r22-lib-edit]"));
    click(inLayer('[data-r22-edit-preset="warmer-light"]'));
    await makeEdit();
  }

  it("⑥ 改出来的是库里新的一条,原图一个字节都不动", async () => {
    openLibraryDetail("Raya table setting");
    // 还没落过盘的时候存档是空的(工作台只在写入那一刻落盘),所以「改之前」的实况就是种子。
    const originalBefore = LIBRARY_SEED_ASSETS.find((asset) => asset.name === "Raya table setting")! as unknown as StoredAsset;

    click(inLayer("[data-r22-lib-edit]"));
    click(inLayer('[data-r22-edit-preset="warmer-light"]'));
    await makeEdit();

    const after = storedAssets();
    expect(after.length, "库里没有多出那一条").toBe(LIBRARY_SEED_ASSETS.length + 1);

    const made = after.find((asset) => asset.name === "Raya table setting — Warmer light");
    expect(made, "改出来的那一条不在库里").toBeTruthy();
    expect(made!.editedFromId).toBe(originalBefore.id);
    expect(made!.editedFromName).toBe("Raya table setting");
    // 样机诚实:预览与新条目用的都是原来那一张,层里那句话说的正是这件事。
    expect(made!.poster).toBe(originalBefore.poster);
    expect(inLayer(".r22-edit-layer").textContent).toContain("the picture on screen stays as it was");

    const originalAfter = after.find((asset) => asset.id === originalBefore.id);
    expect(originalAfter, "原图不见了").toEqual(originalBefore);
    expect(inLayer(".r22-edit-layer").textContent).toContain("is in your Library — 3 cr.");
  });

  it("⑦ 同一句改动按两次,库里仍然只有一条,而且它如实说出来", async () => {
    await editWarmerLight();
    const afterFirst = storedAssets().length;

    click(inLayer('[data-r22-edit-preset="warmer-light"]'));
    await makeEdit();

    expect(storedAssets().length, "同一句改动做出了第二条").toBe(afterFirst);
    expect(storedAssets().filter((asset) => asset.name === "Raya table setting — Warmer light").length).toBe(1);
    expect(inLayer(".r22-edit-layer").textContent).toContain("You already made that same edit");
  });

  it("⑧ 版本条切得动 —— Original 与改出来的那一版各是一格", async () => {
    await editWarmerLight();

    const original = inLayer<HTMLButtonElement>('[data-r22-edit-version="original"]');
    const versions = [...document.body.querySelectorAll<HTMLButtonElement>("[data-r22-edit-version]")];
    expect(versions.length, "改完之后版本条上还是只有原图").toBe(2);
    expect(original.getAttribute("aria-pressed")).toBe("true");

    const made = versions.find((node) => node.getAttribute("data-r22-edit-version") !== "original")!;
    click(made);
    expect(made.getAttribute("aria-pressed"), "点了那一版,预览没跟着换").toBe("true");
    expect(inLayer('[data-r22-edit-version="original"]').getAttribute("aria-pressed")).toBe("false");

    click(inLayer('[data-r22-edit-version="original"]'));
    expect(inLayer('[data-r22-edit-version="original"]').getAttribute("aria-pressed")).toBe("true");
  });

  it("⑩ 人话也改得了,而且改出来的那一条在详情层认得回原图", async () => {
    openLibraryDetail("Raya table setting");
    click(inLayer("[data-r22-lib-edit]"));

    const phrase = inLayer<HTMLTextAreaElement>('textarea[aria-label="Describe the change"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(phrase, "Put it on a rattan tray");
      phrase.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await makeEdit();

    const made = storedAssets().find((asset) => asset.name === "Raya table setting — Put it on a rattan tray");
    expect(made, "人话那一句没做出东西").toBeTruthy();

    // 关掉编辑层,回网格点开刚做出来的那一条 —— 它自己说得出是从哪一张来的。
    click(inLayer('[aria-label="Close editing"]'));
    click(container!.querySelector<HTMLElement>('button[aria-label="Open Raya table setting — Put it on a rattan tray"]')!);
    expect(inLayer(".r22-lib-layer").textContent).toContain("Edited from Raya table setting");
  });
});

/* ── ⑨ 视频 ─────────────────────────────────────────────────────────────────── */

describe("单图编辑:视频说得出自己为什么改不了", () => {
  it("⑨ 那颗键是关着的,旁边有一句人话", () => {
    openLibraryDetail("Raya opening clip");

    expect(inLayer<HTMLButtonElement>("[data-r22-lib-edit]").disabled, "视频上那颗 Edit 还按得动").toBe(true);
    expect(inLayer("[data-r22-lib-edit-note]").textContent).toBe("Editing works on pictures, so this clip cannot be restyled here.");
    expect(document.body.querySelector(".r22-edit-layer"), "视频居然开出了编辑层").toBeNull();
  });
});

// @vitest-environment jsdom
/**
 * r22-creation-templates.test.ts —— 起手模板那一排的行为契约(Founder 2026-08-26 裁决,对比稿 1 决定 #2)。
 *
 * 这一排解决的是「空白输入框是一道作文题」:商家知道自己要一张能发的产品图,不知道该
 * 怎么把它说成一句话。所以四条断言全部围着**那句话到底去了哪儿**:
 *
 *   ① Library 快产车间:点一下,成句 prompt 落进输入框 —— **而且什么都没发出去**
 *      (发送是花钱的那一下,那一下必须商家自己按);
 *   ② 问题卡在的时候整排锁住 —— 与类型/张数/比例三个控件同一条「所见即所付」纪律;
 *   ③ 画布空板上也有同一排,点一下同样只填进 composer,板上不多出任何东西;
 *   ④ 板上已经有东西的时候不出这一排 —— 那时商家要的是「再改一版」,不是「从头起手」。
 *
 * 变异自检(2026-08-26 逐条实做,做完以 commit 为锚还原,红 → 绿):
 *   · `LibraryQuickCreate` 的 `onPick` 里去掉 `setPrompt(template.prompt)` ⇒ ① 红
 *     (「expected '' to be 'Clean product shot …'」);
 *   · 同一处 `locked={locked}` 改成 `locked={false}` ⇒ ② 红(「Product shot 在问题卡在的时候还按得动」);
 *   · `R22CanvasSurface` 的 `boardEmpty` 前面加 `false &&` ⇒ ③ 红(「空板上没有起手模板」);
 *   · 同一个 `boardEmpty` 前面加 `true ||` ⇒ ④ 红(「板上有东西了还在劝商家从头起手」)。
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
const { CREATION_TEMPLATES } = await import("@/components/creation/creation-templates");

const PRODUCT_SHOT = CREATION_TEMPLATES[0]!;

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

/** React 受控输入要走原生 setter,直接改 `.value` 组件收不到。 */
function type(node: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function templateButton(id: string): HTMLButtonElement {
  const node = container!.querySelector<HTMLButtonElement>(`[data-r22-template="${id}"]`);
  if (!node) throw new Error(`模板 ${id} 不在屏幕上 —— 下面的断言在核对空气`);
  return node;
}

function need<T extends Element>(selector: string): T {
  const node = container!.querySelector<T>(selector);
  if (!node) throw new Error(`找不到 ${selector}`);
  return node;
}

/* ── ①② Library 快产车间 ───────────────────────────────────────────────────── */

describe("起手模板:Library 快产车间", () => {
  function openQuickCreate() {
    mount(createElement(LibraryWorkroom, {}));
    click(need("[data-r22-lib-quick]"));
  }

  it("① 点一下只把那一句填进输入框,一个字都没发出去", () => {
    openQuickCreate();
    const before = container!.querySelectorAll(".r22-lib-tile").length;

    click(templateButton(PRODUCT_SHOT.id));

    expect(need<HTMLTextAreaElement>('textarea[aria-label="Describe what to make"]').value).toBe(PRODUCT_SHOT.prompt);
    // 发出去会有回执、会多出东西、生成条会关上 —— 三样一样都不该发生。
    expect(container!.querySelector(".r22-lib-notice"), "点模板就发出去了:屏幕上出现了回执").toBeNull();
    expect(container!.querySelectorAll(".r22-lib-tile").length, "点模板就发出去了:库里多了东西").toBe(before);
    expect(container!.querySelector("[data-r22-lib-make]"), "生成条被关掉了 —— 那只有发送才会发生").toBeTruthy();
  });

  it("② 问题卡在的时候整排锁住 —— 与参数控件同一条纪律", () => {
    openQuickCreate();
    // 「make something nice」两条判词都中:实词不足四个 + 命中含糊词族。
    type(need<HTMLTextAreaElement>('textarea[aria-label="Describe what to make"]'), "make something nice");
    click(need(".r22-lib-make-send"));

    expect(container!.querySelector("[data-r22-lib-ask]"), "问题卡没出来 —— 下面的断言在核对空气").toBeTruthy();
    for (const template of CREATION_TEMPLATES) {
      expect(templateButton(template.id).disabled, `${template.name} 在问题卡在的时候还按得动`).toBe(true);
    }
    // 参数那三个控件本来就锁着 —— 模板与它们锁的是同一件事:这一次请求。
    expect(need<HTMLButtonElement>('[data-r22-lib-kind="image"]').disabled).toBe(true);
  });
});

/* ── ③④ 画布 ───────────────────────────────────────────────────────────────── */

describe("起手模板:画布空板", () => {
  function runtimeContext(): ImmersiveCanvasRuntimeContext {
    return {
      projects: [{ id: "project-a", name: "Raya launch" }],
      threads: [],
      activeProjectId: "project-a",
      activeThreadId: null,
      initialBalance: null,
      visualFixture: "r22",
    };
  }

  async function openCanvas(workspaceId: string) {
    window.sessionStorage.setItem(
      "r22:workspace-directory:v1",
      JSON.stringify({ activeId: workspaceId, workspaces: [{ id: "batik-house", name: "Batik House", role: "Admin" }, { id: "nadi-studio", name: "Nadi Studio", role: "Admin" }] }),
    );
    await act(async () => { root!.render(createElement(R22CanvasSurface, { runtimeContext: runtimeContext(), entities: [] })); });
    await act(async () => { await Promise.resolve(); });
  }

  it("③ 空板上有同一排模板,点一下只填进 composer,板上不多出任何东西", async () => {
    await openCanvas("nadi-studio");

    expect(container!.querySelector("[data-r22-template-row]"), "空板上没有起手模板").toBeTruthy();
    const batchesBefore = container!.querySelectorAll("[data-canvas-batch]").length;

    click(templateButton(PRODUCT_SHOT.id));

    expect(need<HTMLTextAreaElement>('textarea[aria-label="Describe what to make"]').value).toBe(PRODUCT_SHOT.prompt);
    expect(container!.querySelectorAll("[data-canvas-batch]").length, "点模板就跑起来了:板上多了一批").toBe(batchesBefore);
    expect(container!.querySelector("[data-canvas-job-status]"), "点模板就排上队了").toBeNull();
  });

  it("④ 板上已经有东西的时候不出这一排", async () => {
    await openCanvas("batik-house");

    expect(container!.querySelectorAll("[data-canvas-batch]").length, "样例板上一批都没有 —— 这条在核对空气").toBeGreaterThan(0);
    expect(container!.querySelector("[data-r22-template-row]"), "板上有东西了还在劝商家从头起手").toBeNull();
  });
});

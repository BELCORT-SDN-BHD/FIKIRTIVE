// @vitest-environment jsdom
/**
 * R22 · Otto pet 与面板 —— 两个 Founder 实机看到的病根,加上原型那几条承重的版式。
 *
 * 视觉权威 = R22 原型 `preserved/prototype-2026-08-24-r22/fikirtive-prototype-r22.html`
 * 的 `.pet` 段(L468-489 / L5473-5482 / L5933-5981)与 Otto 面板段(L448-467 / L5433-5469)。
 *
 * ── 病根一:拖不动 ─────────────────────────────────────────────────────────────
 * 云朵原来是 `next/image`,渲染出来是一个真的 `<img>`,而 `<img>` 默认可原生拖拽。
 * 2026-08-25 在 4300 端口那棵树上实测到的事件序列一字不差是:
 *
 *     ["pointerdown","pointermove","dragstart","pointercancel"]
 *
 * 第一次 `pointermove` 之后浏览器就把这次手势收走去做原生图片拖拽,`pointerup` 永远
 * 不来,存档里的落点一动不动。jsdom 不实现原生拖拽,所以这里钉的是**成因**而不是症状:
 * pet 里不许再有可原生拖拽的 `<img>`,按钮自己也要挡住 `dragstart`。
 *
 * ── 病根二:半腰漂移 ───────────────────────────────────────────────────────────
 * 出厂落点原来是 JS 算的,而视窗只在挂载时量一次;量到 0(后台标签页、预渲染、首帧还没
 * 布局完)就被 `normalizeViewport` 安静地换成 1440×900,pet 从此钉在 1368/828 ——
 * 1280×720 的窗口里整颗在屏幕外。实测:导航完成那一刻 `window.innerWidth === 0`,稍后
 * 才变 1280,而这中间**不会**有 `resize` 事件。下面第一条测试就是把这个时序照抄一遍。
 */
import { act, createElement, type FC, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OttoPanelShell, type OttoPanelShellProps } from "@/components/otto/panel/OttoPanelShell";
import { OttoPanelConversation } from "@/components/otto/panel/OttoPanelConversation";
import type { OttoPanelSeed } from "@/lib/otto-panel-seed";
import { OTTO_PET_LINES, OTTO_PET_FIRST_SAY_MS, OTTO_PET_SAY_HOLD_MS } from "@/components/otto/panel/OttoLauncher";
import { OTTO_PANEL_STORAGE_KEY } from "@/components/otto/panel/panel-state";
import { R22_LAUNCHER_MARGIN, R22_LAUNCHER_SIZE } from "@/components/otto/panel/panel-geometry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT = { width: 1280, height: 720 };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, writable: true, configurable: true });
  Object.defineProperty(document.documentElement, "clientWidth", { value: width, writable: true, configurable: true });
  Object.defineProperty(document.documentElement, "clientHeight", { value: height, writable: true, configurable: true });
}

beforeEach(() => {
  setViewport(VIEWPORT.width, VIEWPORT.height);
  window.localStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

const Shell = OttoPanelShell as FC<Omit<OttoPanelShellProps, "children">>;

function shell(props: Partial<Omit<OttoPanelShellProps, "children">> = {}) {
  return createElement(
    Shell,
    { variant: "r22", ...props },
    createElement("div", { "data-main-content": "" }, "Page content"),
  );
}

/** jsdom 没有 PointerEvent 的构造器,repo 里既有的面板测试也是用 MouseEvent 顶名字。 */
function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
}

function pet(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-otto-launcher-pet]");
  if (!el) throw new Error("r22 pet not rendered");
  return el;
}

function petButton(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-otto-launcher]");
  if (!el) throw new Error("r22 pet button not rendered");
  return el;
}

/** 面板体里那段会话。用 fixture 路径 —— 它是 Founder 实机看的那一条。 */
const SEED: OttoPanelSeed = {
  projectId: "fixture-raya",
  entities: [],
  projects: [{ id: "fixture-raya", name: "Raya launch", pinnedAt: null }],
  threads: [],
  activeThreadId: null,
  balanceUsd: 250,
  userName: "Nadia",
};

function conversation() {
  return createElement(OttoPanelConversation, {
    state: { status: "ready", seed: SEED, threads: [], activeThreadId: null, pendingFirst: null },
    fixture: true,
    onThreadStarted: () => {},
    onStreamStart: () => {},
    onThreadUpdate: () => {},
    onActiveThreadChange: () => {},
    onPendingFirstSent: () => {},
  });
}

/** 面板默认收着(r22 的壳这么定),测面板时先按 pet 打开。 */
async function openPanel(): Promise<HTMLElement> {
  await render(shell({ panelBody: conversation(), onOpenHistory: () => {}, onNewChat: () => {} }));
  await act(async () => petButton().click());
  const panel = document.querySelector<HTMLElement>("[data-otto-panel]");
  if (!panel) throw new Error("panel not rendered");
  return panel;
}

describe("病根二:出厂位置不经过任何视窗测量(半腰漂移)", () => {
  it("挂载时视窗读数是 0,pet 仍然贴在右下角 22px —— 不飘到 1368/828", async () => {
    // 实测时序:导航完成那一刻 innerWidth 是 0。
    setViewport(0, 0);
    await render(shell());

    const el = pet();
    expect(el.style.position).toBe("fixed");
    expect(el.style.right).toBe(`${R22_LAUNCHER_MARGIN}px`);
    expect(el.style.bottom).toBe(`${R22_LAUNCHER_MARGIN}px`);
    // 贴角靠的是 CSS,不是算出来的坐标 —— 所以这两个必须是空的。
    expect(el.style.left).toBe("");
    expect(el.style.top).toBe("");
    // 1368/828 = 假视窗 1440×900 算出来的那个落点,它一次都不许出现。
    expect(el.style.left).not.toBe("1368px");
  });

  it("视窗从 0 变成真数(没有 resize 事件)之后,面板几何跟着纠正", async () => {
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );

    setViewport(0, 0);
    await render(shell());

    setViewport(VIEWPORT.width, VIEWPORT.height);
    await act(async () => observers.forEach((fire) => fire()));

    // pet 拖过之后才用算出来的坐标;这里用它证明纠正真的落地了。
    await act(async () => petButton().dispatchEvent(pointer("pointerdown", 40, 40)));
    await act(async () => window.dispatchEvent(pointer("pointermove", 60, 400)));
    await act(async () => window.dispatchEvent(pointer("pointerup", 60, 400)));

    const stored = JSON.parse(window.localStorage.getItem(OTTO_PANEL_STORAGE_KEY)!);
    expect(stored.launcher.edge).toBe("left");
    // 高度比例按真视窗 720 算(0.55 上下),而不是按假的 900。
    expect(stored.launcher.y).toBeGreaterThan(0.4);
    expect(stored.launcher.y).toBeLessThan(0.7);
  });

  it("r22 的尺寸只有一个来源:算落点用的和画出来的是同一个 56px", async () => {
    await render(shell());
    expect(petButton().style.width).toBe(`${R22_LAUNCHER_SIZE}px`);
    expect(petButton().style.height).toBe(`${R22_LAUNCHER_SIZE}px`);
  });
});

describe("病根一:pet 里没有可原生拖拽的东西(拖不动)", () => {
  it("云朵是内联 SVG,不是 <img>", async () => {
    await render(shell());
    // `<img>` 默认 draggable=true:按住再动一下,浏览器就发 dragstart + pointercancel,
    // 这次拖拽从此没有 pointerup 可等。
    expect(petButton().querySelector("img")).toBeNull();
    expect(petButton().querySelector("svg")).not.toBeNull();
  });

  it("按钮自己也挡住 dragstart", async () => {
    await render(shell());
    expect(petButton().getAttribute("draggable")).toBe("false");

    const dragstart = new Event("dragstart", { bubbles: true, cancelable: true });
    await act(async () => {
      petButton().dispatchEvent(dragstart);
    });
    expect(dragstart.defaultPrevented).toBe(true);
  });

  it("面板头那朵云也不是 <img>", async () => {
    const panel = await openPanel();
    const header = panel.querySelector<HTMLElement>("[data-otto-panel-header]")!;
    expect(header.querySelector("img")).toBeNull();
    expect(header.querySelector("svg")).not.toBeNull();
  });
});

describe("拖拽与持久化", () => {
  it("拖一段再松手:pet 换了地方,存档记住了,刷新不回弹", async () => {
    await render(shell());
    expect(pet().style.right).toBe("22px");

    await act(async () => petButton().dispatchEvent(pointer("pointerdown", 1230, 660)));
    await act(async () => window.dispatchEvent(pointer("pointermove", 200, 120)));
    await act(async () => window.dispatchEvent(pointer("pointerup", 200, 120)));
    // 浏览器在 pointerup 之后补的那一发 click 不算点击 —— 拖完不该顺手开面板。
    await act(async () => petButton().dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(document.querySelector("[data-otto-panel]")).toBeNull();
    expect(pet().getAttribute("data-otto-launcher-edge")).toBe("left");
    const stored = JSON.parse(window.localStorage.getItem(OTTO_PANEL_STORAGE_KEY)!);
    expect(stored.launcher.edge).toBe("left");

    // 重新挂载 = 刷新。落点必须还在左边,而不是弹回右下角。
    await act(async () => root!.unmount());
    root = createRoot(container!);
    await act(async () => root!.render(shell()));

    expect(pet().getAttribute("data-otto-launcher-edge")).toBe("left");
    expect(pet().style.left).toBe(`${R22_LAUNCHER_MARGIN}px`);
    expect(pet().style.right).toBe("");
  });

  it("手抖 4px 不算拖动,还是一次点击(原型阈值 6px)", async () => {
    await render(shell());
    await act(async () => petButton().dispatchEvent(pointer("pointerdown", 1230, 660)));
    await act(async () => window.dispatchEvent(pointer("pointermove", 1233, 662)));
    await act(async () => window.dispatchEvent(pointer("pointerup", 1233, 662)));
    await act(async () => petButton().dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(document.querySelector("[data-otto-panel]")).not.toBeNull();
  });
});

describe("pet 是活的(原型 L5933-5951)", () => {
  it("挂载 4.5 秒后说第一句,5 秒后收起来 —— 五句原文一字不改", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root!.render(shell()));

    const say = () => document.querySelector<HTMLElement>("[data-otto-launcher-say]")!;
    expect(say().hasAttribute("data-shown")).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(OTTO_PET_FIRST_SAY_MS);
    });
    expect(say().textContent).toBe(OTTO_PET_LINES[0]);
    expect(say().textContent).toBe("Need some help?");
    expect(say().hasAttribute("data-shown")).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(OTTO_PET_SAY_HOLD_MS);
    });
    expect(say().hasAttribute("data-shown")).toBe(false);
  });

  it("拖起来的时候不说话,而且按钮带上 dragging 标记(呼吸动画靠它暂停)", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root!.render(shell()));

    await act(async () => {
      vi.advanceTimersByTime(OTTO_PET_FIRST_SAY_MS);
    });
    expect(document.querySelector("[data-otto-launcher-say]")!.hasAttribute("data-shown")).toBe(true);

    await act(async () => petButton().dispatchEvent(pointer("pointerdown", 1230, 660)));
    await act(async () => window.dispatchEvent(pointer("pointermove", 900, 300)));

    expect(pet().hasAttribute("data-otto-launcher-dragging")).toBe(true);
    expect(document.querySelector("[data-otto-launcher-say]")!.hasAttribute("data-shown")).toBe(false);
  });
});

describe("面板版式锚点(原型 L448-467)", () => {
  it("体是一根 flex 列 —— 输入框才落得到底部", async () => {
    const panel = await openPanel();
    const body = panel.querySelector<HTMLElement>("[data-otto-panel-body]")!;
    // 父级不是 flex 容器时,会话那棵树的 `flex-1` 是废的,整段贴着顶走、输入框浮到上沿。
    expect(body.className).toContain("flex");
    expect(body.className).toContain("flex-col");
    expect(body.className).not.toContain("overflow-y-auto");
  });

  it("composer 是会话那根列的最后一格,不是第一格", async () => {
    const panel = await openPanel();
    const thread = panel.querySelector<HTMLElement>('[data-otto-panel-conversation="fixture"]')!;
    const composer = thread.querySelector<HTMLElement>("[data-otto-panel-composer]")!;
    expect(thread.lastElementChild).toBe(composer);
    expect(composer.className).toContain("r22-otto-foot");
  });

  it("头部按原型:会话名 + 切换器 + New / Expand / Close", async () => {
    const panel = await openPanel();
    const header = panel.querySelector<HTMLElement>("[data-otto-panel-header]")!;
    expect(header.querySelector("[data-otto-panel-title]")?.textContent).toContain("New conversation");
    expect(header.querySelector('[aria-label="Expand Otto"]')?.textContent).toBe("Expand");
    expect(header.querySelector('[aria-label="Close Otto"]')).not.toBeNull();
    // 原型头部没有第二颗单独的历史按钮 —— 标题本身就是入口。
    expect(header.querySelector('[aria-label="Conversation history"]')).toBeNull();
  });

  it("停靠宽度就是原型那 408px", async () => {
    const panel = await openPanel();
    expect(panel.style.width).toBe("408px");
  });
});

describe("面板里没有工程黑话(Founder 裁决:fixture 诚实由顶栏徽章承担)", () => {
  it("商家读得到的字里没有 fixture / deterministic / server 这类词", async () => {
    const panel = await openPanel();
    const text = panel.textContent ?? "";
    for (const jargon of ["Visual fixture", "fixture", "deterministic", "nothing is sent", "server"]) {
      expect(text.toLowerCase()).not.toContain(jargon.toLowerCase());
    }
  });

  it("底下那句话与 placeholder 逐字照原型", async () => {
    const panel = await openPanel();
    const text = panel.textContent ?? "";
    expect(text).toContain("General workspace help · no action will run from chat");
    expect(text).toContain("Enter to send");
    const composer = panel.querySelector<HTMLInputElement>("#r22-otto-fixture-composer")!;
    expect(composer.placeholder).toBe("Ask Otto — @ adds references");
  });
});

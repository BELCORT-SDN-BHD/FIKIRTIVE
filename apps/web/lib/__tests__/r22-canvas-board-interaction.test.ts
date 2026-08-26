// @vitest-environment jsdom
/**
 * R22 画布**板本身**的六条行为契约 —— 拖拽 / 平移 / 缩放 / 框选 / Esc / 切项目。
 * 行为权威是 R22 原型 L5983-6189(`fikirtive-prototype-r22.html`),这里逐条钉住它。
 *
 * 这一面整个是 fixture:零后端、零 provider、零积分。下面每条断言看的都是商家屏幕上真实
 * 出现的东西(DOM 上的 `style.left` / `aria-pressed` / `transform`)与浏览器里真实存下的
 * 东西(sessionStorage),不是源码字符串。
 *
 * 六条里有一条是**其余五条的前提**:越过阈值之前那一下必须仍然是一次点击。原型把这件事
 * 写成了 L6085-6086 的注释 —— 一按下就抢指针捕获,随后的 click 会被重定向到 stage,卡上
 * 的每一颗按钮就再也点不动了。所以第一条钉的是「按下即拖」这个病本身。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImmersiveCanvasRuntimeContext } from "@/components/canvas/NorthstarCanvasWorkspace";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/canvas-actions", () => ({ listCanvasNodes: vi.fn().mockResolvedValue([]) }));
vi.mock("@/components/canvas/useCanvasGen", () => ({
  freshCanvasActionId: () => "canvas-action-test",
  useCanvasGen: () => ({ generateImage: vi.fn(), quoteCosts: vi.fn(), imageShapes: vi.fn() }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { R22CanvasSurface } = await import("@/components/canvas/R22CanvasSurface");

/** `DEFAULT_R22_WORKSPACE_DIRECTORY.activeId` —— 没有 seed directory 时的默认 workspace。 */
const WORKSPACE_ID = "batik-house";
const storageKey = (projectId: string) => `r22:canvas:${projectId}:new:${WORKSPACE_ID}`;

/** 便签的老家(`FIXTURE_OBJECT_HOME.sticky`)。没被拖过时它就该待在这儿。 */
const STICKY_HOME = { x: 640, y: 560 };
/** 出发时那个视角(`CANVAS_HOME_VIEW`)。 */
const HOME_TRANSFORM = "translate(-560px, -260px) scale(1)";

function runtimeContext(activeProjectId: string): ImmersiveCanvasRuntimeContext {
  return {
    projects: [{ id: "project-a", name: "Raya launch" }, { id: "project-b", name: "Merdeka teaser" }],
    threads: [],
    activeProjectId,
    activeThreadId: null,
    initialBalance: null,
    visualFixture: "r22",
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

async function render(activeProjectId: string): Promise<void> {
  await act(async () => {
    root!.render(createElement(R22CanvasSurface, { runtimeContext: runtimeContext(activeProjectId), entities: [] }));
  });
  await act(async () => { await Promise.resolve(); });
}

async function mount(activeProjectId = "project-a"): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await render(activeProjectId);
}

function need<T extends Element>(selector: string): T {
  const node = container!.querySelector<T>(selector);
  expect(node, `找不到 ${selector} —— 下面的断言在核对空气`).not.toBeNull();
  return node as T;
}

/** jsdom 没有 PointerEvent 的构造器,repo 里既有的面板测试也是用 MouseEvent 顶名字。 */
function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
}

function escapeKey(): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
}

/**
 * 一次完整的手势:按在 `from`,中途经过 `via` 的每一点,最后在最后一点松手。
 * `via` 为空就是「按下就松手」—— 一次干净的点击。
 */
async function gesture(target: Element, from: [number, number], ...via: Array<[number, number]>): Promise<void> {
  await act(async () => { target.dispatchEvent(pointer("pointerdown", from[0], from[1])); });
  for (const [x, y] of via) {
    await act(async () => { window.dispatchEvent(pointer("pointermove", x, y)); });
  }
  const [lastX, lastY] = via.length ? via[via.length - 1] : from;
  await act(async () => { window.dispatchEvent(pointer("pointerup", lastX, lastY)); });
}

/**
 * 一次干干净净的点击:按下、原地松手、click。浏览器里 click 前面**永远**有一记
 * pointerdown,而正是那一记把上一次拖拽留下的旗子清掉 —— 直接 `.click()` 少了它,
 * 就不是商家手上会发生的形状。
 */
async function clickArt(id: string): Promise<void> {
  await gesture(art(id), [400, 400]);
  await act(async () => { art(id).click(); });
}

function stage(): HTMLElement { return need<HTMLElement>("[data-r22-canvas-stage]"); }
function world(): HTMLElement { return need<HTMLElement>(".r22-canvas-world"); }
function sticky(): HTMLElement { return need<HTMLElement>('[data-canvas-object="sticky"]'); }
function art(id: string): HTMLElement { return need<HTMLElement>(`[data-canvas-select="${id}"]`); }
function selectedArt(): string[] {
  return [...container!.querySelectorAll<HTMLElement>('[data-canvas-select][aria-pressed="true"]')]
    .map((node) => node.dataset.canvasSelect!);
}
function toolButton(label: string): HTMLElement { return need<HTMLElement>(`[data-r22-canvas-tools] button[aria-label="${label}"]`); }
function zoomLabel(): string { return need<HTMLElement>(".r22-canvas-zoom-label").textContent ?? ""; }

function storedObjects(projectId: string): Record<string, { x: number; y: number }> {
  const raw = window.sessionStorage.getItem(storageKey(projectId));
  expect(raw, `${storageKey(projectId)} 里什么都没存 —— 这一面根本没写过存档`).not.toBeNull();
  return (JSON.parse(raw!) as { objects?: Record<string, { x: number; y: number }> }).objects ?? {};
}

/** jsdom 的 `getBoundingClientRect()` 一律返回全 0,框选的命中判定得有真几何才验得动。 */
function stubRect(node: Element, left: number, top: number, right: number, bottom: number): void {
  Object.defineProperty(node, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) }),
  });
}

/** 四张图横排,每张 128 宽、间距 16 —— 与 `.r22-canvas-batch-row` 的实况同形。 */
function layoutArt(): void {
  ["art-1", "art-2", "art-3", "art-4"].forEach((id, index) => {
    const left = 100 + index * 144;
    stubRect(art(id), left, 100, left + 128, 328);
  });
}

describe("① 越过阈值之前那一下仍然是一次点击(原型 L6085-6089)", () => {
  it("按住图片抖 2px 再松手,卡内那颗按钮照样按得动", async () => {
    await mount();

    // 2px < 3px 阈值:这不是拖拽,是一次带抖动的点击。
    await gesture(art("art-1"), [400, 400], [401, 401], [402, 402]);
    await act(async () => { art("art-1").click(); });

    expect(selectedArt(), "手抖 2px 就被当成拖拽,卡内按钮从此点不动").toEqual(["art-1"]);
    // 而且那一下不是拖拽:整块板一个像素都没挪。
    expect(sticky().style.left).toBe(`${STICKY_HOME.x}px`);
  });

  it("真拖过一段之后补上来的那一记 click 不算一次点击", async () => {
    await mount();

    await gesture(art("art-1"), [400, 400], [460, 430]);
    await act(async () => { art("art-1").click(); });

    expect(selectedArt(), "拖完手一松,浏览器补的那记 click 被当成了一次选择").toEqual([]);
  });
});

describe("② 拖过之后位置真的变了,而且刷新还在(原型 L6084-6100)", () => {
  it("拖便签 120×80,屏上位置跟着走,存档里也记下了同一个数", async () => {
    await mount();
    expect(sticky().style.left).toBe(`${STICKY_HOME.x}px`);

    await gesture(sticky(), [500, 500], [620, 580]);

    expect(sticky().style.left, "拖了但屏上没动").toBe(`${STICKY_HOME.x + 120}px`);
    expect(sticky().style.top).toBe(`${STICKY_HOME.y + 80}px`);
    expect(storedObjects("project-a").sticky, "拖出来的位置没进存档,刷新一次就回老家").toEqual({
      x: STICKY_HOME.x + 120,
      y: STICKY_HOME.y + 80,
    });
  });

  it("重新挂载(= 刷新)之后,便签还在商家拖到的地方", async () => {
    await mount();
    await gesture(sticky(), [500, 500], [620, 580]);
    await act(async () => root!.unmount());
    container!.remove();

    await mount();

    expect(sticky().style.left, "存档读回来了但没落到屏上").toBe(`${STICKY_HOME.x + 120}px`);
    expect(sticky().style.top).toBe(`${STICKY_HOME.y + 80}px`);
  });
});

describe("③ 平移与缩放(原型 L5988-6022)", () => {
  it("在空地上拖动整块板跟着走", async () => {
    await mount();
    expect(world().style.transform).toBe(HOME_TRANSFORM);

    await gesture(stage(), [400, 400], [500, 460]);

    expect(world().style.transform, "空地上拖了,板没动").toBe("translate(-460px, -200px) scale(1)");
  });

  it("放大一档是 120%,再按重置回到出发时那个视角", async () => {
    await mount();
    expect(zoomLabel()).toBe("100%");

    await act(async () => { need<HTMLElement>('[data-r22-canvas-zoom] button[aria-label="Zoom in"]').click(); });
    expect(zoomLabel(), "缩放按钮没接上视角").toBe("120%");

    // 先把板推走,再按重置 —— 重置的是整个视角,不只是倍率。
    await gesture(stage(), [400, 400], [500, 460]);
    await act(async () => { need<HTMLElement>(".r22-canvas-zoom-label").click(); });

    expect(zoomLabel()).toBe("100%");
    expect(world().style.transform, "重置只把倍率拨回去,板还停在推走的地方").toBe(HOME_TRANSFORM);
  });

  it("手形工具在手上时,按在物件上也是平移,不是拖物件", async () => {
    await mount();
    await act(async () => { toolButton("Pan").click(); });

    await gesture(sticky(), [500, 500], [620, 580]);

    expect(sticky().style.left, "手形工具下按在便签上把便签拖走了").toBe(`${STICKY_HOME.x}px`);
    expect(world().style.transform).toBe("translate(-440px, -180px) scale(1)");
  });
});

describe("④ 框选拉出一个框,框住几张就选中几张(原型 L6053-6076)", () => {
  it("框住前两张,后两张不动;松手之后工具自己回到 Select", async () => {
    await mount();
    layoutArt();
    await act(async () => { toolButton("Box select").click(); });

    await gesture(stage(), [90, 90], [200, 200], [380, 340]);

    expect(selectedArt(), "框选没有框住该框的那两张").toEqual(["art-1", "art-2"]);
    expect(toolButton("Select").getAttribute("aria-pressed"), "框完了工具没有自己回到 Select").toBe("true");
  });
});

describe("⑤ Esc 只剥一层(壳层同一道守卫:commit 67de2bd5)", () => {
  it("有选中时 Esc 清选并吃掉这一记;没得清时不吃,留给外面那一层", async () => {
    await mount();
    await clickArt("art-1");
    expect(selectedArt()).toEqual(["art-1"]);

    const consumed = escapeKey();
    await act(async () => { document.dispatchEvent(consumed); });
    expect(selectedArt(), "Esc 没清掉选择").toEqual([]);
    expect(consumed.defaultPrevented, "画布吃掉了这一记却没喊 preventDefault,外面那层会跟着再剥一层").toBe(true);

    // 已经没得清了:这一记不归画布,它必须原样放过去。
    const passedThrough = escapeKey();
    await act(async () => { document.dispatchEvent(passedThrough); });
    expect(passedThrough.defaultPrevented, "画布把不归自己的那一记 Esc 也吃掉了").toBe(false);
  });

  it("更上面那一层已经吃掉的那一记,画布不再吃第二口", async () => {
    await mount();
    await clickArt("art-1");

    const guard = (event: Event) => event.preventDefault();
    window.addEventListener("keydown", guard, true);
    try {
      await act(async () => { document.dispatchEvent(escapeKey()); });
    } finally {
      window.removeEventListener("keydown", guard, true);
    }

    expect(selectedArt(), "一记 Esc 撕了两层:上面那层已经消费掉了,画布还把选择也清了").toEqual(["art-1"]);
  });
});

describe("⑥ 切项目不带走位置与选择(与会话同一条隔离)", () => {
  it("A 里拖过的便签不跟到 B,也不被写进 B 的存档;切回 A 原样还在", async () => {
    await mount("project-a");
    await gesture(sticky(), [500, 500], [620, 580]);
    await clickArt("art-1");
    expect(selectedArt()).toEqual(["art-1"]);

    await render("project-b");

    expect(sticky().style.left, "上一个项目的摆法跟着切过来了").toBe(`${STICKY_HOME.x}px`);
    expect(sticky().style.top).toBe(`${STICKY_HOME.y}px`);
    expect(selectedArt(), "上一个项目的选中跟着切过来了").toEqual([]);
    expect(storedObjects("project-b"), "project A 的摆法被存进了 project B 的 key").toEqual({});

    await render("project-a");
    expect(sticky().style.left, "清内存态时把 project A 的存档也一起清了").toBe(`${STICKY_HOME.x + 120}px`);
  });
});

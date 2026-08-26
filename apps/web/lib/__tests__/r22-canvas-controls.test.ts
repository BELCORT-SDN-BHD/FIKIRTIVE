// @vitest-environment jsdom
/**
 * r22-canvas-controls.test.ts —— 画布上那几件**控件**的行为契约(2026-08-26 审计定案)。
 *
 * 审计抓到的病灶有三处,这份文件逐条钉住修完之后的样子:
 *
 *   A-1 / A-14 / C-6 —— 五层弹层(切项目 / 附件 / 素材库 / 参数 / 选素材包)是手搓的
 *       `absolute` div,**只有 Esc 一条关闭路径**:商家点到别处、点回板上,弹层照旧挂在
 *       那儿。归位到 shadcn 的 popover / dropdown-menu 之后,点外面关、Esc 关、焦点回到
 *       开它的那颗按钮,三件都由 Radix 出。
 *   C-1 —— 撤销/重做只有屏幕右下角那两颗按钮,键盘上一个入口都没有。
 *   C-4 —— 换工具只能用鼠标点,画布类产品的通用单键(V / H / B)一个都不认。
 *   A-15 —— 工具条是 `role="toolbar"` + 一排 `aria-pressed` 手搓出来的「一组里挑一个」,
 *       比例格与张数格同样。手搓的那一份说不出「只能选一个」,也没有方向键循环。
 *
 * 每条断言看的都是商家屏幕上真的发生的事(DOM / aria / 弹层在不在),不是源码字符串。
 * 零后端、零 provider、零积分。
 *
 * 变异自检(逐条实做,证红后还原):
 *   · 五层弹层里任何一层退回手搓 `absolute` div ⇒ 「点外面关」那一组红;
 *   · 删掉 ⌘Z / ⇧⌘Z 的 window 绑定 ⇒ ③ 红;
 *   · 删掉「焦点在能打字的地方就不吃」那道守卫 ⇒ ④ 红;
 *   · 把 V 的映射改成 hand ⇒ ⑤ 红;
 *   · 工具条退回 `role="toolbar"` + `aria-pressed` ⇒ ⑥ 红(外加 r22-shadcn-composition
 *     的「禁手搓语义」一格红)。
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

// Radix 的 popover / menu / tooltip 在 jsdom 里要这几样才活得起来(popper 量尺寸、
// 指针捕获、滚动到高亮项)。抄 `r22-home-create-menu.test.ts` 的同一份,不重发明。
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

const { R22CanvasSurface } = await import("@/components/canvas/R22CanvasSurface");

/** 便签的老家(`FIXTURE_OBJECT_HOME.sticky`)。 */
const STICKY_HOME = { x: 640, y: 560 };

function runtimeContext(): ImmersiveCanvasRuntimeContext {
  return {
    projects: [{ id: "fixture-raya", name: "Raya launch" }, { id: "project-b", name: "Merdeka teaser" }],
    threads: [],
    activeProjectId: "fixture-raya",
    activeThreadId: null,
    initialBalance: null,
    visualFixture: "r22",
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

async function mount(): Promise<void> {
  await act(async () => {
    root!.render(createElement(R22CanvasSurface, { runtimeContext: runtimeContext(), entities: [] }));
  });
  await act(async () => { await Promise.resolve(); });
}

/** 从 `document` 找 —— 五层浮层都 portal 到 `document.body`,不在 container 里。 */
function need<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  expect(node, `找不到 ${selector} —— 下面的断言在核对空气`).not.toBeNull();
  return node as T;
}

function seen(selector: string): boolean {
  return document.querySelector(selector) !== null;
}

async function click(node: Element): Promise<void> {
  await act(async () => { (node as HTMLElement).click(); });
}

/** 开一个 Radix **menu**:菜单是在 `pointerdown` 上开的,popover 是在 `click` 上。 */
async function openMenu(node: Element): Promise<void> {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    (node as HTMLElement).click();
  });
}

/**
 * 商家把手指按到了别处 —— 浏览器里这是一记 `pointerdown` 加一记 `click`,两记都送到
 * `document.body` 上(浮层之外的任何地方)。Radix 的 dismissable layer 认的就是这两记。
 */
async function pointerDownOutside(): Promise<void> {
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
  // Radix 的焦点搬运走的是 macrotask(`setTimeout`),断言前等一拍
  // (仓库既有先例:`r22-creation-pipeline` ⑦-b 那段注释)。
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function pressKey(init: KeyboardEventInit & { key: string }, target: EventTarget = window): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}

/** 一次真的拖拽 —— 撤销栈上要有一步,⌘Z 才有东西可撤。 */
async function dragSticky(): Promise<void> {
  const sticky = need<HTMLElement>('[data-canvas-object="sticky"]');
  await act(async () => { sticky.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 500, clientY: 500, button: 0 })); });
  await act(async () => { window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: 620, clientY: 580, button: 0 })); });
  await act(async () => { window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 620, clientY: 580, button: 0 })); });
}

function stickyLeft(): string {
  return need<HTMLElement>('[data-canvas-object="sticky"]').style.left;
}

function toolButton(label: string): HTMLElement {
  return need<HTMLElement>(`[data-r22-canvas-tools] button[aria-label="${label}"]`);
}

// ---------------------------------------------------------------------------
// ① 点外面就关 —— 四层各钉一条(A-1 / A-14 / C-6)
// ---------------------------------------------------------------------------
describe("① 弹层点外面就关(上一版只有 Esc 一条路)", () => {
  it("参数弹层:开着,手指按到别处 → 关", async () => {
    await mount();

    await click(need(".r22-canvas-ratio"));
    expect(seen("[data-r22-canvas-params]"), "参数弹层根本没开出来").toBe(true);

    await pointerDownOutside();

    expect(seen("[data-r22-canvas-params]"), "点到别处了,参数弹层还挂在那儿").toBe(false);
  });

  it("附件菜单:开着,手指按到别处 → 关", async () => {
    await mount();

    await openMenu(need('button[aria-label="Attach"]'));
    expect(seen(".r22-canvas-attach-menu"), "附件菜单根本没开出来").toBe(true);

    await pointerDownOutside();

    expect(seen(".r22-canvas-attach-menu"), "点到别处了,附件菜单还挂在那儿").toBe(false);
  });

  it("素材库弹层:开着,手指按到别处 → 关", async () => {
    await mount();
    await openMenu(need('button[aria-label="Attach"]'));
    const fromLibrary = [...document.querySelectorAll<HTMLButtonElement>(".r22-canvas-attach-menu button")]
      .find((node) => node.textContent === "From Library");
    await click(fromLibrary!);
    expect(seen("[data-r22-canvas-library-picker]"), "素材库弹层根本没开出来").toBe(true);

    await pointerDownOutside();

    expect(seen("[data-r22-canvas-library-picker]"), "点到别处了,素材库弹层还挂在那儿").toBe(false);
  });

  it("选素材包弹层:开着,手指按到别处 → 关", async () => {
    await mount();

    await click(need('[aria-label="Add Image 1 to a Library pack"]'));
    expect(seen('[data-canvas-pack-menu="art-1"]'), "选包弹层根本没开出来").toBe(true);

    await pointerDownOutside();

    expect(seen('[data-canvas-pack-menu="art-1"]'), "点到别处了,选包弹层还挂在那儿").toBe(false);
  });

  it("切项目菜单:开着,手指按到别处 → 关", async () => {
    await mount();

    await openMenu(need(".r22-canvas-project-button"));
    expect(seen(".r22-canvas-project-menu"), "切项目菜单根本没开出来").toBe(true);

    await pointerDownOutside();

    expect(seen(".r22-canvas-project-menu"), "点到别处了,切项目菜单还挂在那儿").toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ② Esc 仍然关,而且只关一层 —— 选中不许被顺手清掉
// ---------------------------------------------------------------------------
describe("② Esc 仍然关弹层,而且一记只剥一层", () => {
  it("参数弹层开着时按 Esc:弹层关了,板上的选中一个都没少", async () => {
    await mount();
    // 先选中一张,这样「有没有被顺手清掉」才量得出来。
    const art = need<HTMLElement>('[data-canvas-select="art-1"]');
    await act(async () => { art.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 400, clientY: 400, button: 0 })); });
    await act(async () => { window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 400, clientY: 400, button: 0 })); });
    await click(art);
    expect(art.getAttribute("aria-pressed"), "先选中这一步就没成,后面的断言在核对空气").toBe("true");

    await click(need(".r22-canvas-ratio"));
    expect(seen("[data-r22-canvas-params]")).toBe(true);

    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(seen("[data-r22-canvas-params]"), "Esc 没关掉参数弹层").toBe(false);
    expect(
      need('[data-canvas-select="art-1"]').getAttribute("aria-pressed"),
      "一记 Esc 撕了两层:弹层关了,板上的选中也被顺手清了",
    ).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// ③ ⌘Z / ⇧⌘Z(C-1)
// ---------------------------------------------------------------------------
describe("③ 键盘上的撤销与重做", () => {
  it("⌘Z 把刚拖走的便签送回老家,⇧⌘Z 再把它送回去", async () => {
    await mount();
    await dragSticky();
    expect(stickyLeft(), "拖这一步就没成,后面的断言在核对空气").toBe(`${STICKY_HOME.x + 120}px`);

    const undo = await pressKey({ key: "z", metaKey: true });

    expect(stickyLeft(), "⌘Z 没有把便签送回老家").toBe(`${STICKY_HOME.x}px`);
    expect(undo.defaultPrevented, "没喊 preventDefault —— 浏览器自己的撤销会跟着跑一遍").toBe(true);

    const redo = await pressKey({ key: "z", metaKey: true, shiftKey: true });

    expect(stickyLeft(), "⇧⌘Z 没有把便签再送回去").toBe(`${STICKY_HOME.x + 120}px`);
    expect(redo.defaultPrevented).toBe(true);
  });

  it("Ctrl+Z / Ctrl+⇧+Z 一样管用 —— 不是只有一半的人按得动", async () => {
    await mount();
    await dragSticky();

    await pressKey({ key: "z", ctrlKey: true });
    expect(stickyLeft(), "Ctrl+Z 撤不动").toBe(`${STICKY_HOME.x}px`);

    await pressKey({ key: "z", ctrlKey: true, shiftKey: true });
    expect(stickyLeft(), "Ctrl+⇧+Z 重做不了").toBe(`${STICKY_HOME.x + 120}px`);
  });
});

// ---------------------------------------------------------------------------
// ④ 焦点在能打字的地方,快捷键一个字都不吃
// ---------------------------------------------------------------------------
describe("④ 正在打字的时候快捷键不抢键", () => {
  it("在 composer 里敲 v,工具没有被换掉,那个字也没被吞", async () => {
    await mount();
    const composer = need<HTMLTextAreaElement>('textarea[aria-label="Describe what to make"]');
    await act(async () => { composer.focus(); });

    const event = await pressKey({ key: "v" }, composer);

    expect(toolButton("Select").getAttribute("aria-checked"), "在输入框里打字把工具换掉了").toBe("true");
    expect(event.defaultPrevented, "输入框里那个字被快捷键吞掉了 —— 商家会以为键盘坏了").toBe(false);
  });

  it("在 composer 里按 ⌘Z,撤的是输入框自己的历史,不是板上的位置", async () => {
    await mount();
    await dragSticky();
    const composer = need<HTMLTextAreaElement>('textarea[aria-label="Describe what to make"]');
    await act(async () => { composer.focus(); });

    await pressKey({ key: "z", metaKey: true }, composer);

    expect(stickyLeft(), "在输入框里按 ⌘Z 把板上的东西撤回去了").toBe(`${STICKY_HOME.x + 120}px`);
  });
});

// ---------------------------------------------------------------------------
// ⑤ V / H / B 单键换工具(C-4)
// ---------------------------------------------------------------------------
describe("⑤ 工具单键", () => {
  it.each([
    ["h", "Pan"],
    ["b", "Box select"],
    ["v", "Select"],
  ])("按 %s 换到「%s」", async (key, label) => {
    await mount();
    // 先离开 Select,这样每一条都真的换了一次工具(V 那条也不是「本来就在那儿」)。
    await pressKey({ key: "h" });
    if (key === "h") expect(toolButton("Pan").getAttribute("aria-checked")).toBe("true");
    else await pressKey({ key });

    expect(toolButton(label).getAttribute("aria-checked"), `按 ${key} 没有换到 ${label}`).toBe("true");
  });

  it("按 H 之后板上按在便签上是平移,不是拖便签 —— 换的是真工具,不只是那颗按钮的样子", async () => {
    await mount();

    await pressKey({ key: "h" });
    await dragSticky();

    expect(stickyLeft(), "手形工具下按在便签上还是把便签拖走了").toBe(`${STICKY_HOME.x}px`);
  });

  it("带修饰键的 V 不算快捷键(⌘V 是粘贴)", async () => {
    await mount();
    await pressKey({ key: "h" });

    await pressKey({ key: "v", metaKey: true });

    expect(toolButton("Pan").getAttribute("aria-checked"), "⌘V 被当成了换工具 —— 粘贴从此按不动").toBe("true");
  });
});

// ---------------------------------------------------------------------------
// ⑥ 成组按钮说得出「一组里挑一个」(A-15)
// ---------------------------------------------------------------------------
describe("⑥ 工具条 / 比例 / 张数 是真的成组单选", () => {
  it("工具条是一组单选,不是一条手搓的 toolbar 加一排 aria-pressed", async () => {
    await mount();
    const tools = need<HTMLElement>("[data-r22-canvas-tools]");

    expect(tools.getAttribute("role"), "工具条还是手搓的 toolbar").toBe("radiogroup");
    expect(toolButton("Select").getAttribute("role")).toBe("radio");
    expect(toolButton("Select").getAttribute("aria-pressed"), "同一颗按钮同时说着两种语义").toBeNull();

    await click(toolButton("Pan"));

    expect(toolButton("Pan").getAttribute("aria-checked")).toBe("true");
    expect(toolButton("Select").getAttribute("aria-checked"), "换了工具,上一件还亮着 —— 那不叫一组里挑一个").toBe("false");
  });

  it("张数格子是一组单选,挑一个,价钱当场跟着改", async () => {
    await mount();
    await click(need(".r22-canvas-ratio"));

    const counts = need<HTMLElement>('[data-canvas-count="1"]').closest('[role="radiogroup"]');
    expect(counts, "张数格子不是一组单选").not.toBeNull();

    await click(need('[data-canvas-count="4"]'));

    expect(need('[data-canvas-count="4"]').getAttribute("aria-checked")).toBe("true");
    expect(need('[data-canvas-count="1"]').getAttribute("aria-checked"), "两个张数同时亮着").toBe("false");
    expect(need(".r22-canvas-price").textContent, "张数改了价钱没动").toBe("12 cr");
  });

  it("图 / 视频那一排同理:一组里挑一个", async () => {
    await mount();
    await click(need(".r22-canvas-ratio"));

    expect(need('[data-canvas-kind="image"]').closest('[role="radiogroup"]'), "图/视频那一排不是一组单选").not.toBeNull();

    await click(need('[data-canvas-kind="video"]'));

    expect(need('[data-canvas-kind="video"]').getAttribute("aria-checked")).toBe("true");
    expect(need('[data-canvas-kind="image"]').getAttribute("aria-checked")).toBe("false");
  });

  it("缩放条是一组按钮,五颗都还按得动", async () => {
    await mount();
    const zoom = need<HTMLElement>("[data-r22-canvas-zoom]");

    expect(zoom.getAttribute("role"), "缩放条不是一组按钮").toBe("group");
    expect(zoom.querySelectorAll("button").length, "缩放条少了几颗键").toBe(5);

    await click(need('[data-r22-canvas-zoom] button[aria-label="Zoom in"]'));
    expect(need(".r22-canvas-zoom-label").textContent, "放大那一颗按不动了").toBe("120%");

    await click(need('[data-r22-canvas-zoom] button[aria-label="Zoom out"]'));
    expect(need(".r22-canvas-zoom-label").textContent, "缩小那一颗按不动了").toBe("100%");

    await dragSticky();
    await click(need('[data-r22-canvas-zoom] button[aria-label="Undo"]'));
    expect(stickyLeft(), "撤销那一颗按不动了").toBe(`${STICKY_HOME.x}px`);
  });
});

// ---------------------------------------------------------------------------
// ⑦ beta 卫生大扫除 · 画布波(2026-08-26 台账 P1-1 / P1-3 / P2-1 / P2-2)
//
// Founder 原话:「会遇到死按钮或没有意义的东西的情况…把没有用的东西删除(for 这个 beta
// phase),避免产生不必要的问题」。这一组钉住的是**删干净了、且没伤到活的那几件**。
//
// 变异自检(逐条实做,证红后还原):
//   · `TOOL_BUTTONS` 里把 image / star / arrange 三颗加回去 ⇒ ⑦-a 红;
//   · `r22-canvas-send` 的 disabled 里删掉 `!message.trim()` ⇒ ⑦-c 红;
//   · 顶栏把 Share(或 Export)那颗加回去 ⇒ ⑦-d 红。
// ---------------------------------------------------------------------------
describe("⑦ beta 收窄之后:死件不在了,活件一件没少", () => {
  it("⑦-a 工具条只剩三颗真工具 —— 没读者的 image / star / arrange 一颗都不在", async () => {
    await mount();

    const labels = Array.from(need<HTMLElement>("[data-r22-canvas-tools]").querySelectorAll("button"))
      .map((button) => button.getAttribute("aria-label"));

    expect(labels, "工具条上还摆着没人消费那档的按钮").toEqual(["Select", "Box select", "Pan"]);
    for (const dead of ["Add image", "Star selected", "Arrange canvas"]) {
      expect(seen(`[data-r22-canvas-tools] button[aria-label="${dead}"]`), `死工具 ${dead} 还在工具条上`).toBe(false);
    }
  });

  it("⑦-b 三颗真工具照旧:V / B / H 换得动,手形工具下拖不走便签", async () => {
    await mount();

    await pressKey({ key: "b" });
    expect(toolButton("Box select").getAttribute("aria-checked"), "删了三颗死的,B 也跟着不认了").toBe("true");

    await pressKey({ key: "h" });
    expect(toolButton("Pan").getAttribute("aria-checked"), "H 换不到手形工具了").toBe("true");
    await dragSticky();
    expect(stickyLeft(), "手形工具下按在便签上把便签拖走了 —— 平移被删坏了").toBe(`${STICKY_HOME.x}px`);

    await pressKey({ key: "v" });
    expect(toolButton("Select").getAttribute("aria-checked"), "V 回不到选择工具了").toBe("true");
    await dragSticky();
    expect(stickyLeft(), "选择工具下便签拖不动了 —— 框选/拖拽被删坏了").not.toBe(`${STICKY_HOME.x}px`);
  });

  it("⑦-c 空输入时 Send 是灰的,打了字就亮 —— 不再有「按得动、什么也不发生」", async () => {
    await mount();

    const send = need<HTMLButtonElement>(".r22-canvas-send");
    const composer = need<HTMLTextAreaElement>('textarea[aria-label="Describe what to make"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    const typeInto = async (value: string) => {
      await act(async () => {
        setValue.call(composer, value);
        composer.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    expect(send.disabled, "一个字都没打,Send 还按得动").toBe(true);

    await typeInto("   ");
    expect(send.disabled, "只打了几个空格,Send 就亮了 —— 送出去的守卫会把它 trim 成空").toBe(true);

    await typeInto("A tray of kuih for Raya");
    expect(send.disabled, "打了字,Send 还是灰的").toBe(false);

    await typeInto("");
    expect(send.disabled, "把字删光了,Send 没跟着灰回去").toBe(true);
  });

  it("⑦-d 顶栏没有 Share / Export —— 只会道歉的按钮不摆在 beta 的屏幕上", async () => {
    await mount();

    const topbarText = Array.from(container!.querySelectorAll("header button")).map((button) => button.textContent ?? "");
    expect(topbarText.some((text) => /share/i.test(text)), "Share 还在顶栏上").toBe(false);
    expect(topbarText.some((text) => /export/i.test(text)), "Export 还在顶栏上").toBe(false);
    expect(seen(".r22-canvas-quiet-button"), "那两颗的壳还留在顶栏上").toBe(false);

    // 顶栏活着的那几件一件没少:项目名开菜单、保存状态照旧说话。
    expect(seen(".r22-canvas-project-button"), "顶栏切项目那颗被顺手删掉了").toBe(true);
    expect(need(".r22-canvas-saved").textContent, "顶栏的保存状态不说话了").toBeTruthy();
  });
});

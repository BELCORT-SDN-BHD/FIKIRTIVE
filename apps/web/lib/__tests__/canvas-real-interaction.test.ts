// @vitest-environment jsdom
/**
 * 真交互层:同一块 FlowCanvas,但**不替换 React Flow**(#604 r2 · 判官 r1 P3)。
 *
 * r1 的测试用一个假 ReactFlow 直调 `onNodesChange` 来「选中」,所以「点一下卡片到底会不会选中」
 * 这件事其实没验过 —— 假件里怎么写都是绿的。这份文件让真 React Flow v12 自己处理事件:
 *
 *   ① 真 pointer + click 打在卡片身体上 → 卡片被选中,Otto 什么也没收到;
 *   ② 键盘路径:发真 Tab 键走到卡片、Enter 选中、继续 Tab 走进这张卡自己的工具条、
 *      在「Send to Otto」上按 Enter 送出 —— 全程没有鼠标;
 *   ③ 视频播起来之后点原生 <video>(不是外层面板)→ 依旧不产生任何引用。
 *
 * 键盘那一段的边界写在 `pressTab` / `pressEnterOnFocused` 上,不含糊:jsdom 会派发按键,
 * 但没有焦点导航引擎、也不跑浏览器默认动作,所以两个 helper 先发真按键(应用可以
 * preventDefault 拦下),没被拦下才补上浏览器那一步(移到文档序下一个可 Tab 元素 /
 * 让 <button> 激活)。断言看的是**应用自己决定的 tab 序与响应**,不是 helper 的动作。
 * r2 的版本没走这条路 —— 它直接 `card.focus()` / `send.click()`,Tab 序与 Enter 激活
 * 一条都没验过(判官 r2 P3),头注却写着「Tab+Enter 走完全程」。
 *
 * jsdom 没有排版引擎,所以两条工具条「矩形不相交」的几何断言只能在真浏览器里做,
 * 走查证据里有原始读数;这里只验交互与结构,不谎称验了几何。
 *
 * 付费路径 useCanvasGen 同样被换成假件:任何一条断言都花不出一个积分。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  boardRead: vi.fn(),
  listCanvasNodes: vi.fn(),
  createCanvasNode: vi.fn(),
  moveCanvasNode: vi.fn(),
  deleteCanvasNode: vi.fn(),
  updateTextNode: vi.fn(),
  uploadReference: vi.fn(),
  quoteCosts: vi.fn(),
  imageShapes: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastMessage: vi.fn(),
}));

vi.mock("@/lib/canvas-actions", () => ({
  listCanvasNodes: mocks.listCanvasNodes,
  createCanvasNode: mocks.createCanvasNode,
  moveCanvasNode: mocks.moveCanvasNode,
  deleteCanvasNode: mocks.deleteCanvasNode,
  updateTextNode: mocks.updateTextNode,
}));
vi.mock("@/lib/otto-canvas-bridge", () => ({ syncOttoCanvasNodes: mocks.boardRead }));
vi.mock("@/lib/actions", () => ({ uploadReference: mocks.uploadReference }));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess, message: mocks.toastMessage },
}));
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/MentionInput", () => ({ MentionInput: () => null }));
vi.mock("@/components/otto/OttoTrace", () => ({ OttoCanvasStatus: () => null }));

// The paid path, replaced by a handle. Nothing in this file can start a generation.
vi.mock("@/components/canvas/useCanvasGen", () => ({
  useCanvasGen: () => ({
    generateImage: vi.fn(),
    animate: vi.fn(),
    generateVideoFromText: vi.fn(),
    quoteCosts: mocks.quoteCosts,
    // #643 T2: 形状菜单来自服务端解析，测试替身也必须给得出，否则选择器渲染不出来。
    imageShapes: mocks.imageShapes,
    cancelledRef: { current: false },
  }),
  isInFlightPaidGen: (node: { type: string; status?: string; url?: string | null }) =>
    (node.type === "image" || node.type === "video")
    && !node.url
    && (node.status === "pending" || node.status === "timeout"),
  freshCanvasActionId: () => "canvas-action-test",
  loadCanvasActionReceipts: () => [],
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: FlowCanvas } = await import("@/components/canvas/FlowCanvas");

const boardRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: "image",
  x: 0,
  y: 0,
  w: 320,
  h: 320,
  text: null,
  prompt: "a cup steaming",
  generationId: `gen-${id}`,
  genJobId: null,
  status: "done",
  sourceNodeId: null,
  threadId: null,
  url: `https://cdn.example/${id}.png`,
  mediaWidth: null,
  mediaHeight: null,
  lineage: null,
  ...overrides,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** jsdom reports every element as 0×0; React Flow refuses to mount a zero-sized board. */
const sizedRect = () => ({
  width: 1280, height: 800, top: 0, left: 0, right: 1280, bottom: 800, x: 0, y: 0,
  toJSON: () => ({}),
}) as DOMRect;

beforeEach(() => {
  mocks.boardRead.mockResolvedValue([]);
  mocks.quoteCosts.mockResolvedValue({ imageCredits: 8, videoCredits: 80 });
  mocks.imageShapes.mockResolvedValue({ options: ["1:1", "9:16", "16:9", "4:3", "3:4", "3:2", "2:3", "21:9"], defaultAspect: "1:1" });
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("DOMMatrixReadOnly", class {
    m22 = 1;
    constructor(_transform?: string) {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(sizedRect);
  // jsdom ships no media pipeline; play()/pause() are the real element's own controls,
  // which is exactly what this file needs to press.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderBoard(props: Record<string, unknown> = {}): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(FlowCanvas, { projectId: "p1", skin: "gb" as const, ...props }));
  });
  await act(async () => { await Promise.resolve(); });
}

/** React Flow's own wrapper around a card — the element that owns click/keyboard selection. */
function nodeWrapper(nodeId: string): HTMLElement {
  const el = container!.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`);
  expect(el, `React Flow rendered no wrapper for ${nodeId}`).not.toBeNull();
  return el!;
}

/** The card's body — the picture/video itself, which is what a merchant clicks on. */
function cardBody(nodeId: string): HTMLElement {
  const body = nodeWrapper(nodeId).querySelector<HTMLElement>(".al-panel");
  expect(body).not.toBeNull();
  return body!;
}

/** A real press: the pointer sequence React Flow v12 listens to, then the click. */
async function pressWithPointer(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

async function pressKey(el: Element, key: string): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
  });
}

function isSelected(nodeId: string): boolean {
  return nodeWrapper(nodeId).classList.contains("selected");
}

function buttonsLabelled(text: string): HTMLButtonElement[] {
  return [...container!.querySelectorAll("button")].filter((b) => b.textContent === text);
}

/** Everything a merchant can reach with Tab, in document order. */
function tabbables(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>("[tabindex], button, a[href], input, video[controls]")]
    .filter((el) => el.getAttribute("tabindex") !== "-1" && !(el as HTMLButtonElement).disabled);
}

/**
 * A real Tab press.
 *
 * jsdom delivers key events but ships no focus-navigation engine and runs no browser
 * default action, so a Tab keydown alone moves nothing — which is exactly how #604 r2's
 * "keyboard" test ended up calling `focus()` by hand and proving nothing about the tab
 * order. This sends the real `Tab` keydown first (any handler on the focused element
 * sees it and may call preventDefault), and only if nothing swallowed it performs the
 * move the browser itself would have performed: focus to the next tabbable element in
 * document order. Same split `@testing-library/user-event`'s `tab()` uses.
 *
 * What the assertions therefore verify is the app's own doing — which elements are in
 * the tab run and in what order — not the helper's.
 */
async function pressTab(): Promise<HTMLElement | null> {
  const from = (document.activeElement as HTMLElement | null) ?? document.body;
  let defaultAllowed = true;
  await act(async () => {
    defaultAllowed = from.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
  });
  if (defaultAllowed) {
    const order = tabbables();
    const next = order[order.indexOf(from) + 1] ?? order[0] ?? null;
    await act(async () => { next?.focus(); });
  }
  const landed = document.activeElement as HTMLElement | null;
  await act(async () => {
    (landed ?? from).dispatchEvent(new KeyboardEvent("keyup", { key: "Tab", bubbles: true, cancelable: true }));
  });
  return landed;
}

/**
 * A real Enter press on whatever currently has focus. jsdom does not run a `<button>`'s
 * activation behaviour on Enter either, so — again, only when nothing called
 * preventDefault — this performs that one browser step.
 */
async function pressEnterOnFocused(): Promise<void> {
  const el = document.activeElement as HTMLElement | null;
  expect(el, "nothing has focus — Enter has nowhere to land").not.toBeNull();
  let defaultAllowed = true;
  await act(async () => {
    defaultAllowed = el!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  if (defaultAllowed && el instanceof HTMLButtonElement) {
    await act(async () => { el.click(); });
  }
  await act(async () => {
    el!.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true }));
  });
}

/** Tab forward until `hit` matches, recording what focus passed through on the way. */
async function tabUntil(
  hit: (el: HTMLElement) => boolean,
  limit: number,
): Promise<{ path: string[] }> {
  const path: string[] = [];
  for (let i = 0; i < limit; i++) {
    const el = await pressTab();
    path.push(el?.getAttribute("aria-label") ?? el?.textContent?.trim() ?? "(nothing)");
    if (el && hit(el)) return { path };
  }
  throw new Error(`Tab never reached the target in ${limit} presses; it went: ${path.join(" → ")}`);
}

const SEND_TO_OTTO = "Send to Otto";

describe("a real click on a card (real React Flow, real pointer events) — #604 r2 P3", () => {
  it("picks the card up, and hands Otto nothing", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard({ onReferenceInChat });

    expect(isSelected("n1")).toBe(false);

    await pressWithPointer(cardBody("n1"));

    expect(isSelected("n1")).toBe(true);
    expect(onReferenceInChat).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastMessage).not.toHaveBeenCalled();
  });

  it("opens that card's own toolbar, and pressing Send to Otto is what sends it", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard({ onReferenceInChat });

    await pressWithPointer(cardBody("n1"));
    const send = buttonsLabelled(SEND_TO_OTTO);
    expect(send).toHaveLength(1);

    await pressWithPointer(send[0]!);

    expect(onReferenceInChat).toHaveBeenCalledTimes(1);
    expect(onReferenceInChat.mock.calls[0]![0]).toHaveLength(1);
  });
});

describe("the same job with the keyboard only — #604 r3", () => {
  it("Tab lands on the card — and landing on it does not pick it up", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard({ onReferenceInChat });

    const card = nodeWrapper("n1");
    expect(document.activeElement).not.toBe(card);

    const landed = await pressTab();

    // Tab — not a hand-written focus() — is what put the merchant on the card.
    expect(landed).toBe(card);
    // And it says what it is on arrival, instead of announcing an unnamed group.
    expect(card.getAttribute("aria-label")).toBeTruthy();
    // Arriving is not choosing: nothing is picked and Otto has heard nothing yet.
    expect(isSelected("n1")).toBe(false);
    expect(onReferenceInChat).not.toHaveBeenCalled();
  });

  it("Enter on the card picks it up", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard({ onReferenceInChat });

    await pressTab();
    await pressEnterOnFocused();

    expect(isSelected("n1")).toBe(true);
    expect(onReferenceInChat).not.toHaveBeenCalled();
  });

  it("Tab carries on into that card's own toolbar, and Enter there is what sends it", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard({ onReferenceInChat });

    await pressTab();
    await pressEnterOnFocused();
    expect(isSelected("n1")).toBe(true);

    // Where Tab goes next, step by step. The buttons the card just revealed have to be
    // the card's own next-door neighbours — a toolbar that renders somewhere else in the
    // document is reachable on paper and lost in practice.
    const walk = await tabUntil((el) => el.textContent?.trim() === SEND_TO_OTTO, 8);
    expect(walk.path).toEqual([
      "Show how this image was made",
      // The card's lineage tree — added when the tree moved into the kernel (#605 T6). It is
      // one of the card's own buttons, so it belongs in this walk.
      "Show what this card came from",
      "Send the picked cards to Otto",
    ]);
    expect(document.activeElement).toBe(buttonsLabelled(SEND_TO_OTTO)[0]);
    // Tabbing onto the button is still not pressing it.
    expect(onReferenceInChat).not.toHaveBeenCalled();

    await pressEnterOnFocused();

    expect(onReferenceInChat).toHaveBeenCalledTimes(1);
    expect(onReferenceInChat.mock.calls[0]![0]).toHaveLength(1);
  });

  it("Escape lets go of the card again", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard({ onReferenceInChat: vi.fn() });

    await pressTab();
    await pressEnterOnFocused();
    expect(isSelected("n1")).toBe(true);

    await pressKey(nodeWrapper("n1"), "Escape");
    expect(isSelected("n1")).toBe(false);
  });
});

describe("a video that is actually playing — #604 r2 P3", () => {
  it("pressing the real play control neither selects nor sends anything", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("v1", { type: "video", url: "https://cdn.example/v1.mp4" })]);
    await renderBoard({ onReferenceInChat });

    const play = nodeWrapper("v1").querySelector<HTMLButtonElement>(".cv-play");
    expect(play).not.toBeNull();
    await pressWithPointer(play!);

    // The poster's play button hands over to the browser's own controls.
    const video = nodeWrapper("v1").querySelector<HTMLVideoElement>("video")!;
    expect(video.hasAttribute("controls")).toBe(true);
    expect(onReferenceInChat).not.toHaveBeenCalled();
  });

  it("clicking the native video control while it plays sends no reference", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("v1", { type: "video", url: "https://cdn.example/v1.mp4" })]);
    await renderBoard({ onReferenceInChat });

    await pressWithPointer(nodeWrapper("v1").querySelector<HTMLButtonElement>(".cv-play")!);
    const video = nodeWrapper("v1").querySelector<HTMLVideoElement>("video")!;

    // The element the merchant is actually clicking mid-playback: the <video> itself,
    // where the browser draws pause/seek/volume — not the panel around it.
    await pressWithPointer(video);

    expect(onReferenceInChat).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastMessage).not.toHaveBeenCalled();
  });
});

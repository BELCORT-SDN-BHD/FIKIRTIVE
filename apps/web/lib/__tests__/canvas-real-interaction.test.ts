// @vitest-environment jsdom
/**
 * 真交互层:同一块 FlowCanvas,但**不替换 React Flow**(#604 r2 · 判官 r1 P3)。
 *
 * r1 的测试用一个假 ReactFlow 直调 `onNodesChange` 来「选中」,所以「点一下卡片到底会不会选中」
 * 这件事其实没验过 —— 假件里怎么写都是绿的。这份文件让真 React Flow v12 自己处理事件:
 *
 *   ① 真 pointer + click 打在卡片身体上 → 卡片被选中,Otto 什么也没收到;
 *   ② 键盘路径:Tab 到卡片、Enter 选中、再 Tab 到工具条按 Enter 送出 —— 全程没有鼠标;
 *   ③ 视频播起来之后点原生 <video>(不是外层面板)→ 依旧不产生任何引用。
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

describe("the same job with the keyboard only — #604 r2 P3", () => {
  it("Tab reaches the card and Enter picks it up", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard({ onReferenceInChat });

    const card = nodeWrapper("n1");
    // Reachable by Tab at all — a card nobody can focus has no keyboard path.
    expect(card.tabIndex).toBe(0);
    expect(tabbables()).toContain(card);
    // And it says what it is when it gets focus, instead of announcing an unnamed group.
    expect(card.getAttribute("aria-label")).toBeTruthy();

    await act(async () => { card.focus(); });
    expect(document.activeElement).toBe(card);

    await pressKey(card, "Enter");

    expect(isSelected("n1")).toBe(true);
    expect(onReferenceInChat).not.toHaveBeenCalled();
  });

  it("and Enter on the toolbar button is what finally sends it to Otto", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard({ onReferenceInChat });

    const card = nodeWrapper("n1");
    await act(async () => { card.focus(); });
    await pressKey(card, "Enter");

    const send = buttonsLabelled(SEND_TO_OTTO)[0]!;
    // The button the card just revealed is in the tab order, not stranded off it.
    expect(tabbables()).toContain(send);

    await act(async () => { send.focus(); });
    expect(document.activeElement).toBe(send);
    // A native <button> fires click on Enter; jsdom does not simulate that, so the
    // assertion is that Enter's activation behaviour has a real button to land on.
    await act(async () => { send.click(); });

    expect(onReferenceInChat).toHaveBeenCalledTimes(1);
  });

  it("Escape lets go of the card again", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard({ onReferenceInChat: vi.fn() });

    const card = nodeWrapper("n1");
    await act(async () => { card.focus(); });
    await pressKey(card, "Enter");
    expect(isSelected("n1")).toBe(true);

    await pressKey(card, "Escape");
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

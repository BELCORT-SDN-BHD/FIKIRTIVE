// @vitest-environment jsdom
/**
 * FRONT-A12 —— 画布上「按了没反应」的五处，各自把失败与恢复说出口。
 *
 * 接线总盘点 L1（规格 docs/specs/frontend-baseline.md §5）。五处的共同病根是同一个：动作真的
 * 发出去了，服务端／浏览器真的拒绝了，而拒绝落在 `console.warn`、落在 `void`、或者落在一个
 * 恒不渲染的分支里 —— 屏幕上一个字都没有。商家读到的不是「错了」，是「什么都没发生」，于是
 * 他再按一次，或者以为已经存好了走开。这一份逐处驱动真组件，断言落在**商家读得到的那句话**
 * 与**真的被调用的那个持久化动作**上：
 *
 *   ① Add text 建卡被拒 ⇒ 屏幕上有话（照隔壁 `handleCanvasDrop` 的 `toast.error`），不是 console。
 *   ② 文字卡保存被拒 ⇒ 卡内看得见错误，商家打的字还在，且可重试（重试真的再发一次）。
 *   ③ 图片卡收形 ⇒ 走既有 `moveCanvasNode` 落盘（刷新后不再弹回旧尺寸），失败有话。
 *   ④ 失败卡文案不含「Try again」，且 `offersRefresh:false` 时卡上没有那颗重试键 —— 一句话
 *      叫商家去按一颗不存在的按钮，是这一处的全部病情。
 *   ⑤ 卡内 Info 面板 Copy prompt 被浏览器拒 ⇒ 有可读的错误，不是静静地什么都不说。
 *
 * 付费路径 `useCanvasGen` 全部换成假件：这一份里一个积分也花不掉。React Flow 只有 jsdom 做不了
 * 的 pan/zoom/portal 被替身，`onNodesChange` 与卡片本身都是真的（同 front-a15 的方言）。
 */
import { act, createElement, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FlowProps = {
  nodes: Array<{ id: string; type?: string; selected?: boolean; data: Record<string, unknown>; style?: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
  nodeTypes: Record<string, (props: Record<string, unknown>) => ReactElement | null>;
  onNodesChange: (changes: unknown[]) => void;
  onInit?: (instance: Record<string, unknown>) => void;
};

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
  videoSpecs: vi.fn(),
  fitView: vi.fn(),
  toastError: vi.fn(),
  flow: { current: null as null | FlowProps },
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
vi.mock("@/components/ui/toast", () => ({
  toast: { error: mocks.toastError, success: vi.fn(), message: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/MentionInput", () => ({ MentionInput: () => null }));
vi.mock("@/components/otto/OttoTrace", () => ({ OttoCanvasStatus: () => null }));

// 付费路径换成假件 —— 这一份里没有任何一条断言花得掉钱。
vi.mock("@/components/canvas/useCanvasGen", () => ({
  useCanvasGen: () => ({
    generateImage: vi.fn(),
    animate: vi.fn(),
    generateVideoFromText: vi.fn(),
    quoteCosts: mocks.quoteCosts,
    imageShapes: mocks.imageShapes,
    videoSpecs: mocks.videoSpecs,
    cancelledRef: { current: false },
  }),
  isInFlightPaidGen: (node: { type: string; status?: string; url?: string | null }) =>
    (node.type === "image" || node.type === "video")
    && !node.url
    && (node.status === "pending" || node.status === "timeout"),
  freshCanvasActionId: () => "canvas-action-test",
  loadCanvasActionReceipts: () => [],
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  const FakeReactFlow = (props: FlowProps) => {
    mocks.flow.current = props;
    const { onInit } = props;
    useEffect(() => {
      onInit?.({ fitView: mocks.fitView, zoomIn: vi.fn(), zoomOut: vi.fn() });
    }, [onInit]);
    return createElement(
      "div",
      { "data-testid": "board" },
      props.nodes.map((node) =>
        createElement(
          "div",
          { key: node.id, "data-node": node.id },
          createElement(props.nodeTypes[node.type ?? "image"]!, {
            id: node.id,
            data: node.data,
            selected: !!node.selected,
            type: node.type,
          }),
        ),
      ),
    );
  };
  return {
    ...actual,
    ReactFlow: FakeReactFlow,
    Background: () => null,
    Handle: () => null,
    NodeToolbar: ({ isVisible, className, children }: { isVisible?: boolean; className?: string; children?: unknown }) =>
      isVisible === false ? null : createElement("div", { className }, children as ReactElement),
    NodeResizer: () => null,
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: FlowCanvas } = await import("@/components/canvas/FlowCanvas");
const { FailedBody } = await import("@/components/canvas/nodes/GeneratingBody");
const { NodeLineagePanel } = await import("@/components/canvas/nodes/NodeLineagePanel");
const { terminalCardCopy } = await import("@/lib/canvas-terminal-copy");
const { SAVE_FAILED } = await import("@/lib/save-failed-copy");

/** 服务端对这三个动作真会说的那几句（`lib/canvas-actions.ts` / `lib/auth-guard.ts` 原话）。 */
const SERVER_NODE_GONE = "Node not found.";
const SERVER_NOT_AUTHORIZED = "Not authorized.";
/** 请求根本没拿到回答时，画布说的那一句 —— 从**单一源**取,不再手抄一份
 *  (判官 #1197 P2-3;围栏在 `save-failed-copy-single-source.test.ts`)。 */
const THROWN_SAVE_FAILED = SAVE_FAILED;

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

const textRow = (id: string, text: string) =>
  boardRow(id, { type: "text", text, prompt: null, url: null, generationId: null, w: 240, h: 120 });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const sizedRect = () => ({
  width: 1280, height: 800, top: 0, left: 0, right: 1280, bottom: 800, x: 0, y: 0,
  toJSON: () => ({}),
}) as DOMRect;

beforeEach(() => {
  mocks.boardRead.mockResolvedValue([]);
  mocks.deleteCanvasNode.mockResolvedValue({ ok: true });
  mocks.moveCanvasNode.mockResolvedValue({ ok: true });
  mocks.updateTextNode.mockResolvedValue({ ok: true });
  mocks.quoteCosts.mockResolvedValue({ imageCredits: 8, videoCredits: 80 });
  mocks.imageShapes.mockResolvedValue({ options: ["1:1", "16:9"], defaultAspect: "1:1" });
  mocks.videoSpecs.mockResolvedValue({
    menu: { durations: [5], resolutions: ["720p"], aspectRatios: ["16:9"] },
    t2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "16:9" },
    i2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "adaptive" },
    creditsFor: () => 11,
  });
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(sizedRect);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  mocks.flow.current = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function mount(element: ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(element); });
  await act(async () => { await Promise.resolve(); });
}

async function renderBoard(props: Record<string, unknown> = {}): Promise<void> {
  await mount(createElement(FlowCanvas, { projectId: "p1", skin: "gb" as const, ...props }));
}

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function screenText(): string {
  return (document.body.textContent ?? "").replace(/\s+/gu, " ");
}

function buttonNamed(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
}

/** 真的往 textarea 里打字 —— React 自己的 value setter，跟商家敲键盘走同一条路。 */
function typeInto(area: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 离开输入框 —— React 的 `onBlur` 挂在冒泡的 `focusout` 上，不是 `blur`。 */
function blur(area: HTMLTextAreaElement): void {
  act(() => { area.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
}

function textArea(): HTMLTextAreaElement {
  const area = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Text note']");
  expect(area).toBeTruthy();
  return area!;
}

/** 工具条上的 Add text —— 按可访问名字找，不按位置。 */
function addTextButton(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>("button[aria-label='Add text']");
  expect(found).toBeTruthy();
  return found!;
}

/** 卡内 Info 面板上那颗复制键。复制成功后它改名叫「Prompt copied」，所以两个名字都认。 */
function copyPromptButton(): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((b) => {
    const label = b.getAttribute("aria-label") ?? "";
    return label === "Copy prompt" || label === "Prompt copied";
  });
  expect(found).toBeTruthy();
  return found as HTMLButtonElement;
}

describe("FRONT-A12 ① 建文字卡被拒：屏幕上有话，不是 console", () => {
  it("FRONT-A12: Add text 被服务端拒绝时，商家读到服务端那句原话", async () => {
    mocks.createCanvasNode.mockResolvedValue({ error: SERVER_NOT_AUTHORIZED });
    await renderBoard();

    await act(async () => { addTextButton().click(); });
    await settle();

    expect(mocks.createCanvasNode).toHaveBeenCalled();
    // 病症本身：以前这里只有 console.warn,屏幕零反馈。现在走的是隔壁掉落图片同一条 toast.error。
    expect(mocks.toastError).toHaveBeenCalledWith(SERVER_NOT_AUTHORIZED);
    // 没建成就不能在板上留一张假卡。
    expect(mocks.flow.current!.nodes.some((n) => n.type === "text")).toBe(false);
  });

  it("FRONT-A12: Add text 的请求根本没拿到回答时，也有话说", async () => {
    mocks.createCanvasNode.mockRejectedValue(new Error("network down"));
    await renderBoard();

    await act(async () => { addTextButton().click(); });
    await settle();

    expect(mocks.toastError).toHaveBeenCalledWith(THROWN_SAVE_FAILED);
  });

  it("FRONT-A12: 建成了就安安静静把卡放下，不报错", async () => {
    mocks.createCanvasNode.mockResolvedValue({ id: "t-new", x: 0, y: 0, w: 240, h: 120 });
    await renderBoard();

    await act(async () => { addTextButton().click(); });
    await settle();

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.flow.current!.nodes.some((n) => n.id === "t-new")).toBe(true);
  });
});

describe("FRONT-A12 ② 文字卡保存被拒：卡内看得见，字还在，能重试", () => {
  it("FRONT-A12: 保存被拒时卡内显示服务端原话，商家打的字一个不少", async () => {
    mocks.boardRead.mockResolvedValue([textRow("t1", "old note")]);
    mocks.updateTextNode.mockResolvedValue({ error: SERVER_NODE_GONE });
    await renderBoard();

    const area = textArea();
    typeInto(area, "tomorrow's promo copy");
    blur(area);
    await settle();

    expect(mocks.updateTextNode).toHaveBeenCalledWith("p1", "t1", "tomorrow's promo copy");
    // 商家读得到 —— 而且是在这张卡里，不是板角一个不知道说谁的 toast。
    const alert = document.querySelector("[role='alert']");
    expect(alert?.textContent).toContain(SERVER_NODE_GONE);
    // 存不进去不等于白打 —— 字必须留在框里。
    expect(textArea().value).toBe("tomorrow's promo copy");
  });

  it("FRONT-A12: 卡内 Try again 真的把同一段字再发一次（重试不是空转）", async () => {
    mocks.boardRead.mockResolvedValue([textRow("t1", "old note")]);
    mocks.updateTextNode.mockResolvedValue({ error: SERVER_NODE_GONE });
    await renderBoard();

    const area = textArea();
    typeInto(area, "second attempt");
    blur(area);
    await settle();
    expect(mocks.updateTextNode).toHaveBeenCalledTimes(1);

    mocks.updateTextNode.mockResolvedValue({ ok: true });
    await act(async () => { buttonNamed("Try again")!.click(); });
    await settle();

    // 病症会长这样:失败后 savedRef 停在没存进去的那一版,于是重试当作「已经存过了」直接返回。
    expect(mocks.updateTextNode).toHaveBeenCalledTimes(2);
    expect(mocks.updateTextNode).toHaveBeenLastCalledWith("p1", "t1", "second attempt");
    // 存进去了，错误就收走。
    expect(document.querySelector("[role='alert']")).toBeNull();
    expect(textArea().value).toBe("second attempt");
  });

  it("FRONT-A12: 请求没拿到回答也照样说得出口", async () => {
    mocks.boardRead.mockResolvedValue([textRow("t1", "old note")]);
    mocks.updateTextNode.mockRejectedValue(new Error("network down"));
    await renderBoard();

    const area = textArea();
    typeInto(area, "offline note");
    blur(area);
    await settle();

    expect(document.querySelector("[role='alert']")?.textContent).toContain(THROWN_SAVE_FAILED);
  });

  it("FRONT-A12: 存成功的卡什么都不说", async () => {
    mocks.boardRead.mockResolvedValue([textRow("t1", "old note")]);
    await renderBoard();

    const area = textArea();
    typeInto(area, "saved fine");
    blur(area);
    await settle();

    expect(mocks.updateTextNode).toHaveBeenCalledWith("p1", "t1", "saved fine");
    expect(document.querySelector("[role='alert']")).toBeNull();
  });
});

describe("FRONT-A12 ③ 图片卡收形：新尺寸真的落盘，失败有话", () => {
  /** 卡自己在 `<img onLoad>` 里递上来的那一手真实像素，走的是板子给它的那个 `onMediaSize`。 */
  function reportMediaSize(id: string, size: { width: number; height: number }): void {
    const node = mocks.flow.current!.nodes.find((n) => n.id === id)!;
    const report = node.data.onMediaSize as (s: { width: number; height: number }) => void;
    expect(typeof report).toBe("function");
    act(() => report(size));
  }

  it("FRONT-A12: 收形后走既有 moveCanvasNode 落盘，刷新不会弹回 320×320", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("i1")]);
    await renderBoard();

    reportMediaSize("i1", { width: 1600, height: 900 });
    await settle();

    // 屏幕上收了形……
    const node = mocks.flow.current!.nodes.find((n) => n.id === "i1")!;
    expect(node.style).toMatchObject({ width: 320, height: 180 });
    // ……并且**同一份尺寸**进了持久化动作。以前只改 style,数据库还留着 320×320,刷新就弹回去。
    expect(mocks.moveCanvasNode).toHaveBeenCalledWith("p1", "i1", { x: 0, y: 0, w: 320, h: 180 });
  });

  it("FRONT-A12: 形状没变就不写库（不为一张已经是这个形状的卡多打一次服务端）", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("i1")]);
    await renderBoard();

    reportMediaSize("i1", { width: 320, height: 320 });
    await settle();

    expect(mocks.moveCanvasNode).not.toHaveBeenCalled();
  });

  it("FRONT-A12: 落盘被拒时说服务端那句原话", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("i1")]);
    mocks.moveCanvasNode.mockResolvedValue({ error: SERVER_NODE_GONE });
    await renderBoard();

    reportMediaSize("i1", { width: 1600, height: 900 });
    await settle();

    expect(mocks.toastError).toHaveBeenCalledWith(SERVER_NODE_GONE);
  });

  it("FRONT-A12: 一次会话期内同一个拒绝只说一次，不把板子淹在同一句话里", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("i1"), boardRow("i2"), boardRow("i3")]);
    mocks.moveCanvasNode.mockResolvedValue({ error: SERVER_NOT_AUTHORIZED });
    await renderBoard();

    for (const id of ["i1", "i2", "i3"]) reportMediaSize(id, { width: 1600, height: 900 });
    await settle();

    expect(mocks.moveCanvasNode).toHaveBeenCalledTimes(3);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith(SERVER_NOT_AUTHORIZED);
  });

  it("FRONT-A12: 换了一句新的拒绝就再说一次 —— 收声的是重复，不是「已经说过话了」", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("i1"), boardRow("i2"), boardRow("i3")]);
    mocks.moveCanvasNode.mockResolvedValue({ error: SERVER_NOT_AUTHORIZED });
    await renderBoard();

    reportMediaSize("i1", { width: 1600, height: 900 });
    await settle();
    // 第二张撞上同一句 —— 不重复。
    reportMediaSize("i2", { width: 1600, height: 900 });
    await settle();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);

    // 第三张撞上**另一句** —— 这是商家没读到过的一件新事，必须说。
    // 病症会长这样:一个「已经报过了」的开关把整场会话之后所有失败一并静音 ——
    // 那正是这一票要修的那个缺口，只是往下挪了一层。
    mocks.moveCanvasNode.mockResolvedValue({ error: SERVER_NODE_GONE });
    reportMediaSize("i3", { width: 1600, height: 900 });
    await settle();

    expect(mocks.toastError).toHaveBeenCalledTimes(2);
    expect(mocks.toastError).toHaveBeenLastCalledWith(SERVER_NODE_GONE);
  });
});

describe("FRONT-A12 ④ 失败卡：不叫商家去按一颗不存在的按钮", () => {
  it("FRONT-A12: 失败卡文案不含 Try again，也确实没有重试键", async () => {
    await mount(createElement(FailedBody, { status: "failed" as const, reason: "unexplained" as const, onRefresh: vi.fn() }));

    const text = screenText();
    expect(text).toContain("That didn't finish");
    expect(text).toContain("You weren't charged.");
    // 病症本身：文案叫人 Try again,而这张脸的 offersRefresh 是 false,重试键那一支永远不渲染。
    expect(text).not.toContain("Try again");
    expect(buttonNamed("Check again")).toBeUndefined();
    expect(terminalCardCopy("failed", "unexplained").offersRefresh).toBe(false);
    expect(terminalCardCopy("failed", "unexplained").detail).not.toContain("Try again");
  });

  it("FRONT-A12: 真给得出重试的那几张脸，键还在（这一处只去字，不动别人的出路）", async () => {
    expect(terminalCardCopy("timeout", "unexplained").offersRefresh).toBe(true);
    await mount(createElement(FailedBody, { status: "timeout" as const, reason: "unexplained" as const, onRefresh: vi.fn() }));

    expect(buttonNamed("Check again")).toBeTruthy();
  });
});

describe("FRONT-A12 ⑤ Copy prompt 被拒：说出来", () => {
  const panel = (prompt: string) =>
    createElement(NodeLineagePanel, { lineage: null, prompt, hasSource: false });

  it("FRONT-A12: 剪贴板拒绝时面板上有可读的错误", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await mount(panel("a cup steaming"));

    await act(async () => { copyPromptButton().click(); });
    await settle();

    expect(writeText).toHaveBeenCalledWith("a cup steaming");
    // 病症本身：以前这里只把 copied 放回 false —— 跟「还没按过」长得一模一样。
    expect(document.querySelector("[role='alert']")?.textContent).toContain("Couldn't copy automatically.");
    // 出路已经在屏幕上：提示词本身就印在下面，选中手动复制。
    expect(screenText()).toContain("a cup steaming");
  });

  it("FRONT-A12: 浏览器根本没有剪贴板时同样有话，不是一按无声", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    await mount(panel("a cup steaming"));

    await act(async () => { copyPromptButton().click(); });
    await settle();

    expect(document.querySelector("[role='alert']")?.textContent).toContain("Couldn't copy automatically.");
  });

  it("FRONT-A12: 复制成功时不留错误", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await mount(panel("a cup steaming"));

    await act(async () => { copyPromptButton().click(); });
    await settle();

    expect(document.querySelector("[role='alert']")).toBeNull();
  });
});

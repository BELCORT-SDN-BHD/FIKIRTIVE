// @vitest-environment jsdom
/**
 * FRONT-A15 —— 画布的「选中」只有一份,键盘也读得到它。
 *
 * 走查现场(Codex QA-CRE-002 / QA-CRE-008,2026-09-03,真 Chrome + 生产构建):
 *   · 用选择工具点中一张文字卡,按 Delete、按 Backspace —— 屏幕上什么都不发生。
 *   · Shift 再点第二张,好几张卡同时描着边,但键盘对这一组一样使不上劲。
 *   · 「Fit to screen」摆出来的画有一部分压在固定覆盖层底下(实测一张视频卡 45%),
 *     点它落在 Otto 输入框上 —— 卡没被选中,上一张图的操作条还留在屏幕上。
 *   · 一张失败卡顶着 320×320 的默认正方形站在 320×180 的正常卡旁边,把工作区往覆盖层里顶。
 *
 * 单测当时全绿 —— 因为这几件事都住在**接线**里。所以这一份逐条驱动真 FlowCanvas 与真
 * ImageNode / VideoNode / TextNode(先例:canvas-click-semantics、canvas-flow-lineage-ui):
 * 选中走 React Flow 自己的 `onNodesChange`,按键是真派到 window 上的 `keydown`,
 * 断言落在商家读得到的那句确认文案上。付费路径 useCanvasGen 换成假件,一个积分也花不掉。
 */
import { act, createElement, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canvasDeleteKeyIds } from "@/lib/canvas-selection";
import { canvasFitPadding, CANVAS_FIT_GAP } from "@/lib/canvas-fit-padding";
import { canvasTerminalNodeSize, DEFAULT_CANVAS_MEDIA_NODE_SIDE } from "@/lib/canvas-node-size";

type FlowProps = {
  nodes: Array<{ id: string; type?: string; selected?: boolean; data: Record<string, unknown> }>;
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
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), info: vi.fn() },
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

// React Flow 自己的 pan/zoom/portal jsdom 做不了;只有这几样被替身,卡片是真的。
// `onNodesChange` 是真的那一个 —— 选中走的就是板子自己的那条路。
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
          { key: node.id, "data-node": node.id, "data-selected": node.selected ? "yes" : "no" },
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

const sizedRect = () => ({
  width: 1280, height: 800, top: 0, left: 0, right: 1280, bottom: 800, x: 0, y: 0,
  toJSON: () => ({}),
}) as DOMRect;

beforeEach(() => {
  mocks.boardRead.mockResolvedValue([]);
  mocks.deleteCanvasNode.mockResolvedValue({ ok: true });
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

async function renderBoard(props: Record<string, unknown> = {}): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(FlowCanvas, { projectId: "p1", skin: "gb" as const, ...props }));
  });
  await act(async () => { await Promise.resolve(); });
}

/** 选中走板子自己的那条路,不是测试自己往组件里塞一个 selected。 */
function select(ids: string[]): void {
  act(() => mocks.flow.current!.onNodesChange(ids.map((id) => ({ id, type: "select" as const, selected: true }))));
}
function deselect(ids: string[]): void {
  act(() => mocks.flow.current!.onNodesChange(ids.map((id) => ({ id, type: "select" as const, selected: false }))));
}

/** 真按键,派在 window 上 —— 组件挂的就是 window 的 keydown。 */
function pressKey(key: string, target: EventTarget = document.body): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function screenText(): string {
  return (document.body.textContent ?? "").replace(/\s+/gu, " ");
}

/** 确认框里的那一颗 —— 板上的「N selected」条也有一颗叫 Remove 的按钮,不能点错。 */
function dialogButton(text: string): HTMLButtonElement | undefined {
  const dialog = document.querySelector("[role='alertdialog']");
  return [...(dialog?.querySelectorAll("button") ?? [])].find((b) => (b.textContent ?? "").trim() === text);
}

describe("FRONT-A15 画布选中契约:指针、键盘、工具条读同一份选中", () => {
  it("FRONT-A15: Delete 拿走选中的那张文字卡(走查 QA-CRE-002 第一条)", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("t1", { type: "text", text: "E2E note", url: null, generationId: null })]);
    await renderBoard();
    select(["t1"]);

    pressKey("Delete");

    // 键盘走的是**已有的那条确认路**,不是第二条删除路 —— 商家读到的是同一句话。
    expect(screenText()).toContain("Remove from canvas?");
    await act(async () => { dialogButton("Remove")?.click(); });
    expect(mocks.deleteCanvasNode).toHaveBeenCalledWith("p1", "t1");
  });

  it("FRONT-A15: Backspace 与 Delete 是同一件事", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("t1", { type: "text", text: "E2E note", url: null, generationId: null })]);
    await renderBoard();
    select(["t1"]);

    pressKey("Backspace");

    expect(screenText()).toContain("Remove from canvas?");
  });

  it("FRONT-A15: 什么都没选中时,按 Delete 不弹任何确认框", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();

    pressKey("Delete");

    expect(screenText()).not.toContain("Remove from canvas?");
    expect(mocks.deleteCanvasNode).not.toHaveBeenCalled();
  });

  it("FRONT-A15: 正在输入框里打字时,Backspace 是退格,不是删卡", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();
    select(["n1"]);
    const typing = document.createElement("textarea");
    document.body.appendChild(typing);

    pressKey("Backspace", typing);

    expect(screenText()).not.toContain("Remove from canvas?");
    typing.remove();
  });

  it("FRONT-A15: 选中两张,Delete 一次拿走两张(视觉描边 = 真选中)", async () => {
    mocks.boardRead.mockResolvedValue([
      boardRow("n1"),
      boardRow("v1", { type: "video", url: "https://cdn.example/v1.mp4" }),
    ]);
    await renderBoard();
    select(["n1", "v1"]);

    // 两张都被板子记成选中 —— 描边读的就是这一份。
    expect(container!.querySelector('[data-node="n1"]')!.getAttribute("data-selected")).toBe("yes");
    expect(container!.querySelector('[data-node="v1"]')!.getAttribute("data-selected")).toBe("yes");

    pressKey("Delete");

    expect(screenText()).toContain("Remove 2 cards from canvas?");
    await act(async () => { dialogButton("Remove")?.click(); });
    expect(mocks.deleteCanvasNode).toHaveBeenCalledWith("p1", "n1");
    expect(mocks.deleteCanvasNode).toHaveBeenCalledWith("p1", "v1");
  });

  it("FRONT-A15: 取消选中一张之后,Delete 只拿走还选着的那一张", async () => {
    mocks.boardRead.mockResolvedValue([
      boardRow("n1"),
      boardRow("v1", { type: "video", url: "https://cdn.example/v1.mp4" }),
    ]);
    await renderBoard();
    select(["n1", "v1"]);
    deselect(["v1"]);

    pressKey("Delete");

    expect(screenText()).toContain("Remove from canvas?");
    await act(async () => { dialogButton("Remove")?.click(); });
    expect(mocks.deleteCanvasNode).toHaveBeenCalledWith("p1", "n1");
    expect(mocks.deleteCanvasNode).not.toHaveBeenCalledWith("p1", "v1");
  });

  it("FRONT-A15: 还在生成的付费卡,键盘删也照样先说「删了不退款」", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("g1", { status: "pending", url: null, generationId: null, genJobId: "job-1" })]);
    await renderBoard();
    select(["g1"]);

    pressKey("Delete");

    expect(screenText()).toContain("Still generating — remove anyway?");
  });

  it("FRONT-A15: 视频卡和图片卡拿的是同一份操作契约(视频没有 Animate)", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("v1", { type: "video", url: "https://cdn.example/v1.mp4" })]);
    await renderBoard({ onReferenceInChat: vi.fn() });
    select(["v1"]);

    const bar = container!.querySelector('[aria-label="Video actions"]');
    expect(bar, "选中的视频卡应当有自己的操作条").not.toBeNull();
    const labels = [...bar!.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain("Edit with Otto");
    expect(labels).toContain("Create variations");
    expect(labels).toContain("Download");
    expect(labels).toContain("More actions");
    // 视频本身就是那段动画 —— 已批准夹具里视频卡没有 Animate。
    expect(labels).not.toContain("Animate");
  });
});

describe("FRONT-A15 键盘删除的判定(纯函数)", () => {
  it("FRONT-A15: 只有 Delete / Backspace 算删除键", () => {
    expect(canvasDeleteKeyIds({ key: "Delete", editing: false, dialogOpen: false }, ["a"])).toEqual(["a"]);
    expect(canvasDeleteKeyIds({ key: "Backspace", editing: false, dialogOpen: false }, ["a"])).toEqual(["a"]);
    expect(canvasDeleteKeyIds({ key: "d", editing: false, dialogOpen: false }, ["a"])).toBeNull();
    expect(canvasDeleteKeyIds({ key: "Escape", editing: false, dialogOpen: false }, ["a"])).toBeNull();
  });

  it("FRONT-A15: 打字中、对话框开着、或什么都没选,都不删", () => {
    expect(canvasDeleteKeyIds({ key: "Delete", editing: true, dialogOpen: false }, ["a"])).toBeNull();
    expect(canvasDeleteKeyIds({ key: "Delete", editing: false, dialogOpen: true }, ["a"])).toBeNull();
    expect(canvasDeleteKeyIds({ key: "Delete", editing: false, dialogOpen: false }, [])).toBeNull();
  });
});

describe("FRONT-A15 摆板留白:量出来的安全区,不是对称的百分比", () => {
  const rect = (left: number, top: number, width: number, height: number) => ({
    left, top, width, height, right: left + width, bottom: top + height,
  });
  const board = rect(0, 48, 1440, 852);

  it("FRONT-A15: 没有覆盖层时四边只留一点空隙", () => {
    expect(canvasFitPadding(board, [])).toEqual({
      top: CANVAS_FIT_GAP, right: CANVAS_FIT_GAP, bottom: CANVAS_FIT_GAP, left: CANVAS_FIT_GAP,
    });
  });

  it("FRONT-A15: 左上角那张 Otto 卡算在左边,不是把整条上边抬掉", () => {
    // 走查实测的那一张:x16 y64 280×235。
    const padding = canvasFitPadding(board, [rect(16, 64, 280, 235)]);
    expect(padding.left).toBe(296 + CANVAS_FIT_GAP);
    expect(padding.top).toBe(CANVAS_FIT_GAP);
  });

  it("FRONT-A15: 底部的 Otto 输入框与工具条纵列都让开(走查 QA-CRE-008)", () => {
    // 走查实测:输入框 x480 y676 620×209、工具条纵列 x300 y605 980×50。
    const padding = canvasFitPadding(board, [rect(480, 676, 620, 209), rect(300, 605, 980, 50)]);
    // 让开的是伸得最深的那一个 —— 900-605 = 295。
    expect(padding.bottom).toBe(295 + CANVAS_FIT_GAP);
  });

  it("FRONT-A15: 画板之外的东西不算数", () => {
    expect(canvasFitPadding(board, [rect(2000, 0, 100, 100)])).toEqual({
      top: CANVAS_FIT_GAP, right: CANVAS_FIT_GAP, bottom: CANVAS_FIT_GAP, left: CANVAS_FIT_GAP,
    });
  });

  it("FRONT-A15: 极矮的窗口里,留白不会把画挤成负面积", () => {
    const shortBoard = rect(0, 0, 400, 300);
    const padding = canvasFitPadding(shortBoard, [rect(0, 0, 400, 280)]);
    expect(padding.top + padding.bottom).toBeLessThanOrEqual(300 * 0.8);
    expect(padding.left + padding.right).toBeLessThanOrEqual(400 * 0.8);
  });
});

describe("FRONT-A15 停下来的卡不再顶着默认正方形", () => {
  it("FRONT-A15: 没有画面可量的卡收成正常卡的外形", () => {
    expect(canvasTerminalNodeSize({ w: 320, h: 320 })).toEqual({ w: DEFAULT_CANVAS_MEDIA_NODE_SIDE, h: 180 });
  });

  it("FRONT-A15: 商家自己拖过尺寸的卡不动", () => {
    expect(canvasTerminalNodeSize({ w: 520, h: 640 })).toEqual({ w: 520, h: 640 });
  });
});

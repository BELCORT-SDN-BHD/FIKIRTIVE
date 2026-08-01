// @vitest-environment jsdom
/**
 * 点一下卡片到底该发生什么(#604 · spec #599 D6,体检 Q5=C)。
 *
 * 改前:卡片的整个身体是一颗按钮 —— 点一下就把它塞进 Otto 的输入框当引用;没有 Otto 会话时
 * 点一下弹一句红色错误;已经框选了好几张再点其中一张,一次塞进去好几条。商家「先看看」这个
 * 最普通的动作,后果全是他没要过的。
 *
 * 改后:点 = 选中,零副作用;「送去 Otto」是选中工具条上的一个明确按钮,点它才交出引用,
 * 多选一次交一批;没有会话时给一句诚实的引导,不是错误。
 *
 * 全程驱动真 FlowCanvas + 真 ImageNode / VideoNode(先例:canvas-flow-lineage-ui、
 * northstar-canvas-convergence)—— 三个症状都住在接线里,单测任何一半都会一直是绿的。
 * 付费路径 useCanvasGen 被换成假件,任何一条断言都花不出一个积分。
 */
import { act, createElement, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastMessage: vi.fn(),
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

// React Flow owns pan/zoom/selection, none of which jsdom can do. This stand-in renders every
// node through the SAME nodeTypes map the real board uses, so the cards under test are real.
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  const FakeReactFlow = (props: FlowProps) => {
    mocks.flow.current = props;
    const { onInit } = props;
    useEffect(() => {
      onInit?.({ fitView: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn() });
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
    NodeToolbar: ({ isVisible, children }: { isVisible?: boolean; children?: unknown }) =>
      isVisible === false ? null : createElement("div", null, children as ReactElement),
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

/** The board only draws once it has a size; jsdom reports every element as 0x0. */
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

function select(ids: string[]): void {
  act(() => mocks.flow.current!.onNodesChange(ids.map((id) => ({ id, type: "select" as const, selected: true }))));
}

/** The card's body — the picture itself, which is what a merchant clicks on. */
function cardBody(nodeId: string): HTMLElement {
  const card = container!.querySelector<HTMLElement>(`[data-node="${nodeId}"] .al-panel`);
  expect(card).not.toBeNull();
  return card!;
}

function buttonsLabelled(text: string): HTMLButtonElement[] {
  return [...container!.querySelectorAll("button")].filter((b) => b.textContent === text);
}

const SEND_TO_OTTO = "Send to Otto";

describe("clicking a card just picks it up (#604 · D6)", () => {
  it("hands Otto nothing — browsing costs the merchant no side effects", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard({ onReferenceInChat });

    await act(async () => { cardBody("n1").click(); });

    expect(onReferenceInChat).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("no longer advertises the picture as a button that does something", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1"), boardRow("v1", { type: "video", url: "https://cdn.example/v1.mp4" })]);
    await renderBoard({ onReferenceInChat: vi.fn() });

    for (const id of ["n1", "v1"]) {
      const body = cardBody(id);
      expect(body.getAttribute("role")).toBeNull();
      expect(body.getAttribute("aria-label")).toBeNull();
      expect(body.getAttribute("tabindex")).toBeNull();
    }
  });

  it("says nothing at all when there is no Otto conversation to send to", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();

    await act(async () => { cardBody("n1").click(); });

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastMessage).not.toHaveBeenCalled();
  });

  it("a video card behaves the same — pressing play is not a reference either", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("v1", { type: "video", url: "https://cdn.example/v1.mp4" })]);
    await renderBoard({ onReferenceInChat });

    await act(async () => { cardBody("v1").click(); });

    expect(onReferenceInChat).not.toHaveBeenCalled();
  });

  it("does not turn one click on a picked card into a pile of references", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("n1"), boardRow("n2", { x: 360 })]);
    await renderBoard({ onReferenceInChat });

    select(["n1", "n2"]);
    await act(async () => { cardBody("n1").click(); });

    expect(onReferenceInChat).not.toHaveBeenCalled();
  });
});

describe("sending cards to Otto is its own button (#604 · D6)", () => {
  it("offers it on a picked card, and hands over that one card", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard({ onReferenceInChat });

    // Nothing picked yet — nothing to send.
    expect(buttonsLabelled(SEND_TO_OTTO)).toHaveLength(0);

    select(["n1"]);
    const send = buttonsLabelled(SEND_TO_OTTO);
    expect(send).toHaveLength(1);

    await act(async () => { send[0]!.click(); });

    expect(onReferenceInChat).toHaveBeenCalledTimes(1);
    expect(onReferenceInChat.mock.calls[0]![0]).toEqual([
      { generationId: "gen-n1", src: "https://cdn.example/n1.png", kind: "image", previewKind: "image", label: "Image ref" },
    ]);
  });

  it("hands over the whole picked set in one go, from the batch bar", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([
      boardRow("n1"),
      boardRow("v1", { type: "video", x: 360, url: "https://cdn.example/v1.mp4" }),
    ]);
    await renderBoard({ onReferenceInChat });

    select(["n1", "v1"]);
    const batchBar = container!.querySelector<HTMLElement>('[aria-label="Selected cards"]');
    expect(batchBar).not.toBeNull();
    const send = [...batchBar!.querySelectorAll("button")].find((b) => b.textContent === SEND_TO_OTTO);
    expect(send).toBeDefined();

    await act(async () => { send!.click(); });

    expect(onReferenceInChat).toHaveBeenCalledTimes(1);
    expect(onReferenceInChat.mock.calls[0]![0]).toEqual([
      { generationId: "gen-n1", src: "https://cdn.example/n1.png", kind: "image", previewKind: "image", label: "Image ref" },
      { generationId: "gen-v1", src: "https://cdn.example/v1.mp4", kind: "refVideo", previewKind: "video", label: "Video ref" },
    ]);
  });

  it("guides the merchant instead of scolding them when no conversation is open", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();

    select(["n1"]);
    await act(async () => { buttonsLabelled(SEND_TO_OTTO)[0]!.click(); });

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastMessage).toHaveBeenCalledTimes(1);
    expect(String(mocks.toastMessage.mock.calls[0]![0])).toContain("Otto");
  });
});

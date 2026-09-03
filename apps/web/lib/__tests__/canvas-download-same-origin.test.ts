// @vitest-environment jsdom
/**
 * 登记 2026-09-04 P0-2 —— 画布选中工具条上的「Download N」到底把商家送去哪里。
 *
 * 与资产详情是同一个洞的两个面(另一面见 asset-download-same-origin.test.ts):批量下载临时
 * 造 `<a download>` 再 click,而 `/files/…` 会 302 去 R2 —— 跨源的 `download` 被浏览器忽略,
 * 于是「Download 2」不是存下两个文件,而是把商家导航去最后那个文件的裸地址,人就出了应用。
 *
 * 所以断言不是「点了会造锚点」,而是**造出来的锚点指向同源附件地址**。真 FlowCanvas + 真选中
 * 路径(先例:canvas-click-semantics);付费路径是假件,一个积分也花不出去。
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
  imageShapes: vi.fn(),
  videoSpecs: vi.fn(),
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
vi.mock("@/components/ui/toast", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess, message: mocks.toastMessage },
}));
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/MentionInput", () => ({ MentionInput: () => null }));
vi.mock("@/components/otto/OttoTrace", () => ({ OttoCanvasStatus: () => null }));
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
    NodeToolbar: ({ isVisible, className, children }: { isVisible?: boolean; className?: string; children?: unknown }) =>
      isVisible === false ? null : createElement("div", { className }, children as ReactElement),
    NodeResizer: () => null,
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: FlowCanvas } = await import("@/components/canvas/FlowCanvas");

/** 商家真实看到的那种地址:app-relative 的 `/files/…`,生产上它会 302 去 R2。 */
const mediaUrl = (name: string, ext: string) => `/files/u/org-a/${name.repeat(64).slice(0, 64)}.${ext}`;

const boardRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: "image",
  x: 0,
  y: 0,
  w: 320,
  h: 320,
  text: null,
  prompt: "red sneakers on sand",
  generationId: `gen-${id}`,
  genJobId: null,
  status: "done",
  sourceNodeId: null,
  threadId: null,
  url: mediaUrl("c", "png"),
  mediaWidth: null,
  mediaHeight: null,
  lineage: null,
  ...overrides,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let clicked: string[] = [];

const sizedRect = () => ({
  width: 1280, height: 800, top: 0, left: 0, right: 1280, bottom: 800, x: 0, y: 0,
  toJSON: () => ({}),
}) as DOMRect;

beforeEach(() => {
  clicked = [];
  mocks.boardRead.mockResolvedValue([]);
  mocks.quoteCosts.mockResolvedValue({ imageCredits: 8, videoCredits: 80 });
  mocks.imageShapes.mockResolvedValue({ options: ["1:1", "9:16"], defaultAspect: "1:1" });
  mocks.videoSpecs.mockResolvedValue({
    menu: { durations: [5], resolutions: ["720p"], aspectRatios: ["16:9", "adaptive"] },
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
  // 下载那一下是**导航**,jsdom 不实现;拦住 click 就拿到了浏览器真正会去的那个地址。
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.getAttribute("href") ?? "");
  });
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

/** 「N selected」那条批量工具条上的 Download —— 按名字取,不靠 DOM 顺序碰运气。 */
function batchDownloadButton(): HTMLButtonElement {
  const bar = container!.querySelector<HTMLElement>('[role="toolbar"][aria-label="Selected cards"]');
  expect(bar, "选中多张时应该出现批量工具条").not.toBeNull();
  const found = [...bar!.querySelectorAll("button")]
    .find((b) => b.textContent?.trim().startsWith("Download"));
  expect(found, "批量工具条上应该有「Download」").toBeDefined();
  return found!;
}

/** 卡片自己那颗 Download(前端基线⑨ 的卡片操作条)。 */
function cardDownloadButton(nodeId: string): HTMLButtonElement {
  const found = container!.querySelector<HTMLButtonElement>(
    `[data-node="${nodeId}"] button[aria-label="Download"]`,
  );
  expect(found, "卡片上应该有「Download」").not.toBeNull();
  return found!;
}

describe("登记 2026-09-04 P0-2:画布批量下载走同源附件地址", () => {
  it("登记 2026-09-04 P0-2:选中两张按 Download,两条 href 都是同源 /files/…?download=1", async () => {
    mocks.boardRead.mockResolvedValue([
      boardRow("n1"),
      boardRow("v1", { type: "video", url: mediaUrl("d", "mp4"), prompt: "a cup steaming" }),
    ]);
    await renderBoard();
    select(["n1", "v1"]);

    await act(async () => { batchDownloadButton().click(); });

    expect(clicked).toHaveLength(2);
    for (const href of clicked) {
      expect(href.startsWith("/files/")).toBe(true); // 同源,download 属性才算数
      expect(new URL(href, "http://app.test").searchParams.get("download")).toBe("1");
    }
    // 名字仍由 canvas-selection 那一个函数出,同源改写没把它弄丢。
    const names = clicked.map((href) => new URL(href, "http://app.test").searchParams.get("name"));
    expect(names).toEqual(["red-sneakers-on-sand-1.png", "a-cup-steaming-2.mp4"]);
  });

  // 工具条只在选中多于一张时出现(B6),所以这一条也得选两张 —— 它比上一条更硬:
  // 逐字对整条地址,改回裸 `/files/…` 就立刻红。
  it("登记 2026-09-04 P0-2:一条 href 都不是会 302 去 R2 的裸地址", async () => {
    mocks.boardRead.mockResolvedValue([
      boardRow("n1"),
      boardRow("n2", { url: mediaUrl("e", "png"), prompt: "a cup steaming" }),
    ]);
    await renderBoard();
    select(["n1", "n2"]);

    await act(async () => { batchDownloadButton().click(); });

    expect(clicked).toEqual([
      `${mediaUrl("c", "png")}?download=1&name=red-sneakers-on-sand-1.png`,
      `${mediaUrl("e", "png")}?download=1&name=a-cup-steaming-2.png`,
    ]);
  });

  // 前端基线⑨ 给卡片加了自己那颗 Download,它走的是板子同一个 `downloadSelection` ——
  // 这条守的就是「同一条路」这件事:单张存下来的地址与批量那条同形,一样是同源附件。
  it("登记 2026-09-04 P0-2:卡片自己那颗 Download 走同一条同源路", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();
    select(["n1"]);

    await act(async () => { cardDownloadButton("n1").click(); });

    expect(clicked).toEqual([`${mediaUrl("c", "png")}?download=1&name=red-sneakers-on-sand-1.png`]);
  });
});

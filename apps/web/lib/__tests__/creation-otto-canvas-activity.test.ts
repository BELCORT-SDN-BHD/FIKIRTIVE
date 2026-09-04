// @vitest-environment jsdom
/**
 * CREATE-A1 —— Otto 那边一批准，画板就知道；批准之后画板上真的多出一张生成中的卡。
 *
 * 触发：2026-09-04 staging 走查 P0-1。缺的那一句话就在这一份测试里：
 * `NorthstarCanvasWorkspace` 是唯一同时挂着 `FlowCanvas` 与 Otto 覆盖层的地方，从前它把余额
 * 接上了，把「这条对话有付费生成在跑」漏了 —— 于是商家付完钱，画板一无所知。
 *
 * 这里驱动的是**真的** `NorthstarCanvasWorkspace` 与**真的** `FlowCanvas`（含真的 ImageNode）。
 * 只有画板读与付费函数是把手，所以这个文件花不出一个 credit、够不着任何供应商。
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
  generateImage: vi.fn(),
  animate: vi.fn(),
  generateVideoFromText: vi.fn(),
  getMyAccount: vi.fn(),
  /** Otto 覆盖层的把手：真的那一块要整条 useChat 与流，这里只需要它那一句回调。 */
  overlay: { current: null as null | { onGenerationActivityChange: (active: boolean) => void } },
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
vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/components/ui/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/otto/OttoTrace", () => ({ OttoCanvasStatus: () => null }));
vi.mock("@/components/MentionInput", () => ({ MentionInput: () => null }));
vi.mock("@/components/canvas/CanvasOttoOverlay", () => ({
  CanvasOttoOverlay: (props: { onGenerationActivityChange: (active: boolean) => void }) => {
    mocks.overlay.current = props;
    return null;
  },
}));

vi.mock("@/components/canvas/useCanvasGen", () => ({
  useCanvasGen: () => ({
    generateImage: mocks.generateImage,
    animate: mocks.animate,
    generateVideoFromText: mocks.generateVideoFromText,
    quoteCosts: mocks.quoteCosts,
    imageShapes: mocks.imageShapes,
    videoSpecs: mocks.videoSpecs,
    cancelledRef: { current: false },
  }),
  isInFlightPaidGen: (node: { type: string; status?: string; url?: string | null }) =>
    (node.type === "image" || node.type === "video")
    && !node.url
    && (node.status === "pending" || node.status === "queued" || node.status === "timeout"),
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
          { key: node.id, "data-node": node.id, "data-status": String(node.data.status ?? "") },
          createElement(props.nodeTypes[node.type ?? "image"]!, {
            id: node.id,
            data: node.data,
            selected: false,
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

const { NorthstarCanvasWorkspace } = await import("@/components/canvas/NorthstarCanvasWorkspace");

const THREAD_ID = "thr-kaya";

/** 服务端桥为一个在飞的付费任务放下的那张卡（真库里的形状，见 result-lands 那一份测试）。 */
const generatingRow = {
  id: "node-1", type: "image", x: 80, y: 80, w: 320, h: 320,
  text: null, prompt: "a pandan kaya jar", generationId: null, genJobId: "job-1",
  status: "queued", threadId: THREAD_ID, url: null,
  mediaWidth: null, mediaHeight: null, lineage: null,
};
const deliveredRow = {
  ...generatingRow,
  generationId: "gen-1", status: "done", url: "https://cdn.example/kaya.png",
};

const runtimeContext = {
  projects: [{ id: "p1", name: "Kaya jar" }],
  threads: [],
  activeProjectId: "p1",
  activeThreadId: THREAD_ID,
  initialBalance: 73,
  initialBalanceUsd: 7.3,
  activeThread: {
    id: THREAD_ID, projectId: "p1", title: "Kaya jar ad", status: "idle",
    messages: [], hasOlderMessages: false,
  },
  pendingFirst: null,
} as unknown as Parameters<typeof NorthstarCanvasWorkspace>[0]["runtimeContext"];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const sizedRect = () => ({
  width: 1280, height: 800, top: 0, left: 0, right: 1280, bottom: 800, x: 0, y: 0,
  toJSON: () => ({}),
}) as DOMRect;

beforeEach(() => {
  mocks.boardRead.mockResolvedValue([]);
  mocks.quoteCosts.mockResolvedValue({ imageCredits: 1, videoCredits: 11 });
  mocks.imageShapes.mockResolvedValue({ options: ["1:1"], defaultAspect: "1:1" });
  mocks.videoSpecs.mockResolvedValue({
    menu: { durations: [5], resolutions: ["720p"], aspectRatios: ["16:9"] },
    t2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "16:9" },
    i2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "adaptive" },
    creditsFor: () => 11,
  });
  mocks.getMyAccount.mockResolvedValue({ balance: 72, balanceUsd: 7.2 });
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
  mocks.overlay.current = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderWorkspace(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(NorthstarCanvasWorkspace, { runtimeContext, entities: [] }));
  });
  await act(async () => { await Promise.resolve(); });
}

/** Otto 那边按下了确认（或者那一次生成结束了）。 */
async function ottoGenerationActive(active: boolean): Promise<void> {
  expect(mocks.overlay.current, "the workspace must hand Otto a way to report generation activity").not.toBeNull();
  await act(async () => { mocks.overlay.current!.onGenerationActivityChange(active); });
  await act(async () => { await Promise.resolve(); });
}

describe("CREATE-A1 · 确认那一刻画板就知道（走查 P0-1）", () => {
  it("CREATE-A1 · Otto 报出「有付费生成在跑」之后画板立刻重读自己", async () => {
    await renderWorkspace();
    const readsBefore = mocks.boardRead.mock.calls.length;

    mocks.boardRead.mockResolvedValue([generatingRow]);
    await ottoGenerationActive(true);

    // 走查里这一次重读从来没发生过 —— 画板要等到 F5 才知道有东西。
    expect(mocks.boardRead.mock.calls.length).toBeGreaterThan(readsBefore);
  });

  it("CREATE-A1 · 重读之后画板上就有一张生成中的卡，不是一片空白", async () => {
    await renderWorkspace();
    mocks.boardRead.mockResolvedValue([generatingRow]);
    await ottoGenerationActive(true);

    expect(mocks.flow.current!.nodes).toHaveLength(1);
    expect(mocks.flow.current!.nodes[0]).toMatchObject({ id: "node-1", type: "image" });
    expect(mocks.flow.current!.nodes[0].data.status).toBe("queued");
    expect(mocks.flow.current!.nodes[0].data.url).toBeUndefined();
    // 卡面画的是生成中，不是一块空白或一张失败卡。
    expect(container!.textContent).toMatch(/Generating|queue/i);
  });

  it("CREATE-A1 · 生成结束后画板再读一次，同一张卡换成结果", async () => {
    await renderWorkspace();
    mocks.boardRead.mockResolvedValue([generatingRow]);
    await ottoGenerationActive(true);

    mocks.boardRead.mockResolvedValue([deliveredRow]);
    await ottoGenerationActive(false);

    expect(mocks.flow.current!.nodes).toHaveLength(1);
    expect(mocks.flow.current!.nodes[0].id).toBe("node-1");
    expect(mocks.flow.current!.nodes[0].data.status).toBe("done");
    expect(mocks.flow.current!.nodes[0].data.url).toBe("https://cdn.example/kaya.png");
  });

  it("CREATE-A1 · 生成期间画板持续重读，不赌批准那一瞬间的时序", async () => {
    vi.useFakeTimers();
    try {
      await renderWorkspace();
      mocks.boardRead.mockResolvedValue([]);
      await ottoGenerationActive(true);
      const afterFlip = mocks.boardRead.mock.calls.length;

      // 服务端的桥有可能在批准那一读还看不到刚建好的任务；只读一次就是赌那一次时序，
      // 赌输就是商家盯着空白画板等到刷新。
      await act(async () => { await vi.advanceTimersByTimeAsync(5100); });

      expect(mocks.boardRead.mock.calls.length).toBeGreaterThan(afterFlip);
    } finally {
      vi.useRealTimers();
    }
  });
});

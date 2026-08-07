// @vitest-environment jsdom
/**
 * The canvas board, driven the way a merchant drives it (round-1 review P1-2 · P2-1).
 *
 * Both defects here are seams between two halves that each worked:
 *
 *   P1-2 — the browser poll knows when a card is FINISHED; the server knows what it COST, when
 *     it was made and with what. Nothing joined them: the only thing that re-read the board was
 *     the in-flight poller, and finishing is exactly what switches that poller off. So the card
 *     a merchant had just watched appear opened an Info panel reading "No generation record for
 *     this card" — and stayed that way until something unrelated reloaded the board.
 *
 *   P2-1 — that same reload replaced every card with the server's copy, and a server row
 *     carries no selection. Picking several cards and waiting one beat silently emptied the
 *     selection out from under the merchant.
 *
 * These are driven end to end (real FlowCanvas, real ImageNode, real lineage panel) because
 * both bugs live in the wiring, not in any one function: unit-testing either half would have
 * stayed green throughout.
 */
import { act, createElement, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasNodeLineage } from "@/lib/canvas-lineage";

type FlowProps = {
  nodes: Array<{ id: string; type?: string; selected?: boolean; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
  nodeTypes: Record<string, (props: Record<string, unknown>) => ReactElement | null>;
  onNodesChange: (changes: unknown[]) => void;
  onInit?: (instance: Record<string, unknown>) => void;
};

type NewNode = {
  id: string;
  type: "image" | "video";
  pos: { x: number; y: number; w: number; h: number };
  status: string;
  prompt: string;
  madeFromNodeId?: string;
};

const mocks = vi.hoisted(() => ({
  listCanvasNodes: vi.fn(),
  boardRead: vi.fn(),
  createCanvasNode: vi.fn(),
  moveCanvasNode: vi.fn(),
  deleteCanvasNode: vi.fn(),
  updateTextNode: vi.fn(),
  uploadReference: vi.fn(),
  quoteCosts: vi.fn(),
  imageShapes: vi.fn(),
  videoSpecs: vi.fn(),
  onNewNode: { current: null as null | ((node: NewNode) => void) },
  onResolve: { current: null as null | ((id: string, url: string | null, status: string, generationId?: string) => void) },
  onBatchSettled: { current: null as null | (() => void) },
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
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/MentionInput", () => ({ MentionInput: () => null }));
vi.mock("@/components/otto/OttoTrace", () => ({ OttoCanvasStatus: () => null }));

// The hook owns the paid path; this test drives the CANVAS, so the hook is replaced by a handle
// on the callbacks it would invoke. Nothing here can start a generation. The two pure helpers
// FlowCanvas also imports from it are restated (they have their own tests next door).
vi.mock("@/components/canvas/useCanvasGen", () => ({
  useCanvasGen: (
    _projectId: string,
    onNode: (node: NewNode) => void,
    onResolve: (id: string, url: string | null, status: string, generationId?: string) => void,
    _activeThreadId?: string | null,
    _onError?: unknown,
    _onBalanceRefresh?: unknown,
    _onProgress?: unknown,
    onBatchSettled?: () => void,
  ) => {
    mocks.onNewNode.current = onNode;
    mocks.onResolve.current = onResolve;
    mocks.onBatchSettled.current = onBatchSettled ?? null;
    return {
      generateImage: vi.fn(),
      animate: vi.fn(),
      generateVideoFromText: vi.fn(),
      quoteCosts: mocks.quoteCosts,
      // #643 T2: 形状菜单来自服务端解析，测试替身也必须给得出，否则选择器渲染不出来。
      imageShapes: mocks.imageShapes,
      videoSpecs: mocks.videoSpecs,
      cancelledRef: { current: false },
    };
  },
  isInFlightPaidGen: (node: { type: string; status?: string; url?: string | null }) =>
    (node.type === "image" || node.type === "video")
    && !node.url
    && (node.status === "pending" || node.status === "timeout"),
  freshCanvasActionId: () => "canvas-action-test",
  loadCanvasActionReceipts: () => [],
}));

// React Flow owns pan/zoom/selection, none of which jsdom can do. This stand-in renders each
// node through the SAME nodeTypes map the real board uses, so the card components under test
// are the real ones, and hands the test the props FlowCanvas passed down.
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

const LINEAGE: CanvasNodeLineage = {
  madeAtLabel: "Jul 30, 2:15 PM",
  settings: { durationSeconds: null, resolution: "2048x2048", aspectRatio: "1:1" },
  costCredits: 8,
  batchSize: 1,
  batchPosition: 1,
};

const pendingRow = (id: string) => ({
  id, type: "image", x: 0, y: 0, w: 320, h: 320, text: null,
  prompt: "a cup steaming", generationId: null, genJobId: "job-1", status: "pending",
  batchIndex: null, batchSize: null, layoutAnchorNodeId: null, madeFromNodeId: null,
  threadId: null, url: null, mediaWidth: null, mediaHeight: null,
  lineage: null,
});

const settledRow = (id: string, index = 0) => ({
  ...pendingRow(id),
  x: index * 340,
  generationId: `gen-${index + 1}`,
  status: "done",
  url: `https://cdn.example/${index + 1}.png`,
  lineage: LINEAGE,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** The board only draws once it has a size; jsdom reports every element as 0x0. */
const sizedRect = () => ({
  width: 1280, height: 800, top: 0, left: 0, right: 1280, bottom: 800, x: 0, y: 0,
  toJSON: () => ({}),
}) as DOMRect;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.boardRead.mockResolvedValue([]);
  mocks.quoteCosts.mockResolvedValue({ imageCredits: 8, videoCredits: 80 });
  mocks.imageShapes.mockResolvedValue({ options: ["1:1", "9:16", "16:9", "4:3", "3:4", "3:2", "2:3", "21:9"], defaultAspect: "1:1" });
  mocks.videoSpecs.mockResolvedValue({
    menu: { durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutions: ["720p", "480p"], aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"] },
    t2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "16:9" },
    i2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "adaptive" },
    creditsFor: ({ seconds, resolution }: { seconds: number; resolution: string }) =>
      Math.ceil((seconds * (resolution === "480p" ? 11 : 22)) / 10),
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
  mocks.onNewNode.current = null;
  mocks.onResolve.current = null;
  mocks.onBatchSettled.current = null;
  mocks.flow.current = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function renderBoard(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(FlowCanvas, { projectId: "p1", skin: "gb" as const }));
  });
  await act(async () => { await Promise.resolve(); });
}

/** Let the coalescing window elapse and every read it triggers settle. */
async function settleBoard(ms = 700): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}

function select(ids: string[]): void {
  const changes = ids.map((id) => ({ id, type: "select" as const, selected: true }));
  act(() => mocks.flow.current!.onNodesChange(changes));
}

function infoButtons(): HTMLButtonElement[] {
  return [...container!.querySelectorAll("button")].filter((b) => b.textContent === "Info");
}

describe("a card that finishes in front of the merchant (review P1-2)", () => {
  it("carries its record as soon as the poll says done — no second visit needed", async () => {
    mocks.boardRead.mockResolvedValue([pendingRow("n1")]);
    await renderBoard();
    expect(mocks.boardRead).toHaveBeenCalledTimes(1);

    // The server now has everything about this card; the browser has only just found out it
    // finished. Nothing else is going to ask for the board.
    mocks.boardRead.mockResolvedValue([settledRow("n1")]);
    await act(async () => {
      mocks.onResolve.current!("n1", "https://cdn.example/1.png", "done", "gen-1");
      mocks.onBatchSettled.current!();
    });
    await settleBoard();

    expect(mocks.boardRead).toHaveBeenCalledTimes(2);

    select(["n1"]);
    await act(async () => { infoButtons()[0]!.click(); });

    const panel = container!.textContent ?? "";
    expect(panel).toContain("Jul 30, 2:15 PM");
    expect(panel).toContain("8 credits");
    expect(panel).not.toContain("No generation record for this card");
  });

  it("reads the board once for a whole batch, however slowly the cards land", async () => {
    mocks.boardRead.mockResolvedValue([pendingRow("n1")]);
    await renderBoard();
    mocks.boardRead.mockResolvedValue([settledRow("n1"), settledRow("n2", 1)]);

    // Four siblings are placed one at a time, each behind its own server round trip. Real trips
    // are slower than the coalescing window, so a per-card trigger restarted its timer too late
    // to coalesce anything and read the whole board once per card (r3 review P2-1).
    await act(async () => {
      for (const [index, id] of ["n1", "n2", "n3", "n4"].entries()) {
        mocks.onResolve.current!(id, `https://cdn.example/${index + 1}.png`, "done", `gen-${index + 1}`);
        vi.advanceTimersByTime(700);
        await Promise.resolve();
      }
    });
    await act(async () => { await Promise.resolve(); });

    // Cards landing is not what asks for the record — the BATCH being finished is.
    expect(mocks.boardRead).toHaveBeenCalledTimes(1);

    await act(async () => { mocks.onBatchSettled.current!(); });
    await settleBoard();

    expect(mocks.boardRead).toHaveBeenCalledTimes(2);
  });

  it("does not chase a card that failed — there is no record to show", async () => {
    mocks.boardRead.mockResolvedValue([pendingRow("n1")]);
    await renderBoard();

    await act(async () => { mocks.onResolve.current!("n1", null, "failed"); });
    await settleBoard();

    expect(mocks.boardRead).toHaveBeenCalledTimes(1);
  });
});

/**
 * The board is read from two places at once — a batch finishing, and the 5-second in-flight
 * poller — and neither waited for the other. Server reads do not come back in the order they
 * were sent, so a read that LEFT before a card settled could land after it and describe the
 * board as it was BEFORE: a finished card back to "generating", a card's record back to
 * "No generation record for this card" (r3 review P2-1).
 */
describe("two board reads racing each other (review P2-1 · r3)", () => {
  type Deferred = { promise: Promise<unknown>; settle: (rows: unknown) => void };
  const deferred = (): Deferred => {
    let settle!: (rows: unknown) => void;
    const promise = new Promise<unknown>((resolve) => { settle = resolve; });
    return { promise, settle };
  };

  it("keeps the newer answer when the older one comes back last", async () => {
    // One card still generating, so the in-flight poller is running.
    mocks.boardRead.mockResolvedValue([pendingRow("n1")]);
    await renderBoard();

    const older = deferred();
    const newer = deferred();
    mocks.boardRead.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    expect(mocks.boardRead).toHaveBeenCalledTimes(3);

    // The newer read answers first, with the finished card and its record. The older read
    // answers afterwards, still carrying the row from before the record was written.
    await act(async () => { newer.settle([settledRow("n1")]); await Promise.resolve(); });
    await act(async () => { older.settle([{ ...settledRow("n1"), lineage: null }]); await Promise.resolve(); });
    await settleBoard();

    select(["n1"]);
    await act(async () => { infoButtons()[0]!.click(); });

    const panel = container!.textContent ?? "";
    expect(panel).toContain("Jul 30, 2:15 PM");
    expect(panel).not.toContain("No generation record for this card");
  });
});

/**
 * The lines between cards (review P2-2 · r3 · #603 T4).
 *
 * Standing beside something and coming out of it are two facts in two columns now, so a batch
 * sibling has nothing a line could be drawn from — with or without a traceability record.
 */
describe("lines between cards when a record is missing (review P2-2 · r3)", () => {
  it("draws no parentage for a batch, whatever the record lookup returned", async () => {
    mocks.boardRead.mockResolvedValue([
      settledRow("anchor"),
      { ...settledRow("sib", 1), layoutAnchorNodeId: "anchor", lineage: null },
    ]);
    await renderBoard();

    expect(mocks.flow.current!.edges).toEqual([]);
  });

  it("draws no line from a card this browser has only just put down", async () => {
    // #547 B4 drew this line the moment the press was accepted, from the request's own
    // "source node". That is the browser vouching for a fact only the paid job can settle —
    // the row the server just wrote carries no source at all, and the job may resolve to none
    // (#605 r1 judge P1-1). The queued card is on the board; the line waits for the read.
    mocks.boardRead.mockResolvedValue([settledRow("src")]);
    await renderBoard();

    await act(async () => {
      mocks.onNewNode.current!({
        id: "vid",
        type: "video",
        pos: { x: 400, y: 0, w: 320, h: 320 },
        status: "pending",
        prompt: "make it move",
        madeFromNodeId: "src",
      });
    });

    expect(mocks.flow.current!.nodes.map((node) => node.id)).toContain("vid");
    expect(mocks.flow.current!.edges).toEqual([]);

    // The board read settles it, and the line appears — from the server's own column.
    mocks.boardRead.mockResolvedValue([
      settledRow("src"),
      { ...settledRow("vid", 1), type: "video", madeFromNodeId: "src" },
    ]);
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    await settleBoard();

    expect(mocks.flow.current!.edges.map((edge) => [edge.source, edge.target])).toEqual([["src", "vid"]]);
  });
});

describe("a board reload under the merchant's hands (review P2-1)", () => {
  it("keeps every card they had selected selected", async () => {
    mocks.boardRead.mockResolvedValue([settledRow("n1"), settledRow("n2", 1)]);
    await renderBoard();

    select(["n1", "n2"]);
    expect(mocks.flow.current!.nodes.filter((n) => n.selected).map((n) => n.id)).toEqual(["n1", "n2"]);

    // A job finishing re-reads the board; so does the in-flight poller, on a timer.
    await act(async () => {
      mocks.onResolve.current!("n1", "https://cdn.example/1.png", "done", "gen-1");
      mocks.onBatchSettled.current!();
    });
    await settleBoard();

    expect(mocks.boardRead).toHaveBeenCalledTimes(2);
    expect(mocks.flow.current!.nodes.filter((n) => n.selected).map((n) => n.id)).toEqual(["n1", "n2"]);
    // And the selection is still usable — the batch bar counts the same two cards.
    expect(container!.textContent).toContain("2 selected");
  });
});

/**
 * 同批组框(#603 T4 · spec #599 D5 验收④)。
 *
 * 一次生成出来的几张,画布上应当读作「同一批的兄弟」——一个框,不是一条家谱。框的名字念的是
 * 商家**买了几张**(落盘的 batchSize),不是现在还剩几张;删掉两张,框照旧写「Batch of 4」。
 */
describe("the frame around one paid press", () => {
  const batchRow = (id: string, index: number, size: number) => ({
    ...settledRow(id, index),
    genJobId: "job-batch",
    batchIndex: index,
    batchSize: size,
    layoutAnchorNodeId: index === 0 ? null : "b0",
  });

  it("draws one frame around the cards of a batch, named for what was bought", async () => {
    mocks.boardRead.mockResolvedValue([
      batchRow("b0", 0, 4), batchRow("b1", 1, 4), batchRow("b2", 2, 4), batchRow("b3", 3, 4),
    ]);
    await renderBoard();

    const frames = mocks.flow.current!.nodes.filter((node) => node.type === "batchFrame");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.data.label).toBe("Batch of 4");
    // Same batch is a frame; made from is a line. This board has no parentage at all.
    expect(mocks.flow.current!.edges).toEqual([]);
  });

  it("still says 'Batch of 4' when only two of the four are left", async () => {
    mocks.boardRead.mockResolvedValue([batchRow("b0", 0, 4), batchRow("b2", 2, 4)]);
    await renderBoard();

    const frames = mocks.flow.current!.nodes.filter((node) => node.type === "batchFrame");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.data.label).toBe("Batch of 4");
  });

  it("draws no frame around a card that was the only thing its press made", async () => {
    mocks.boardRead.mockResolvedValue([{ ...settledRow("solo"), batchIndex: 0, batchSize: 1 }]);
    await renderBoard();

    expect(mocks.flow.current!.nodes.filter((node) => node.type === "batchFrame")).toEqual([]);
  });
});

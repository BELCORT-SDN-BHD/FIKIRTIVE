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
  edges: Array<{ id: string }>;
  nodeTypes: Record<string, (props: Record<string, unknown>) => ReactElement | null>;
  onNodesChange: (changes: unknown[]) => void;
  onInit?: (instance: Record<string, unknown>) => void;
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
  onResolve: { current: null as null | ((id: string, url: string | null, status: string, generationId?: string) => void) },
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
    _onNode: unknown,
    onResolve: (id: string, url: string | null, status: string, generationId?: string) => void,
  ) => {
    mocks.onResolve.current = onResolve;
    return {
      generateImage: vi.fn(),
      animate: vi.fn(),
      generateVideoFromText: vi.fn(),
      quoteCosts: mocks.quoteCosts,
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
  madeFromSource: false,
};

const pendingRow = (id: string) => ({
  id, type: "image", x: 0, y: 0, w: 320, h: 320, text: null,
  prompt: "a cup steaming", generationId: null, genJobId: "job-1", status: "pending",
  sourceNodeId: null, threadId: null, url: null, mediaWidth: null, mediaHeight: null,
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
  mocks.onResolve.current = null;
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

  it("reads the board once for a whole batch, not once per card", async () => {
    mocks.boardRead.mockResolvedValue([pendingRow("n1")]);
    await renderBoard();
    mocks.boardRead.mockResolvedValue([settledRow("n1"), settledRow("n2", 1)]);

    // Four siblings land one after another as the browser places them.
    await act(async () => {
      for (const [index, id] of ["n1", "n2", "n3", "n4"].entries()) {
        mocks.onResolve.current!(id, `https://cdn.example/${index + 1}.png`, "done", `gen-${index + 1}`);
        vi.advanceTimersByTime(120);
      }
    });
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

describe("a board reload under the merchant's hands (review P2-1)", () => {
  it("keeps every card they had selected selected", async () => {
    mocks.boardRead.mockResolvedValue([settledRow("n1"), settledRow("n2", 1)]);
    await renderBoard();

    select(["n1", "n2"]);
    expect(mocks.flow.current!.nodes.filter((n) => n.selected).map((n) => n.id)).toEqual(["n1", "n2"]);

    // Anything finishing re-reads the board; so does the in-flight poller, on a timer.
    await act(async () => {
      mocks.onResolve.current!("n1", "https://cdn.example/1.png", "done", "gen-1");
    });
    await settleBoard();

    expect(mocks.boardRead).toHaveBeenCalledTimes(2);
    expect(mocks.flow.current!.nodes.filter((n) => n.selected).map((n) => n.id)).toEqual(["n1", "n2"]);
    // And the selection is still usable — the batch bar counts the same two cards.
    expect(container!.textContent).toContain("2 selected");
  });
});

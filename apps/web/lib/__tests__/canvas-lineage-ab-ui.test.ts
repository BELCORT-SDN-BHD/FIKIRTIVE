// @vitest-environment jsdom
/**
 * 血缘树与 A/B 对比,在真画布上(#605 T6 · spec #599 D8)。
 *
 * 北极星最漂亮的两件家具原本长在手搓板上,底下垫的是假数据:兄弟卡被写成母子,于是树上
 * 画出一条没发生过的派生线,「同源可比」那道闸对图片批次形同虚设。T4 把事实落了盘之后,
 * 这里把家具搬进唯一那块画布,并且只准它读落盘的四列:
 * `madeFromNodeId` / `genJobId` / `batchIndex` / `batchSize`。
 *
 * 断言的都是商家眼睛看得见的东西:树上写了谁、Compare 按钮在不在、并排时左边是不是 A、
 * 读不出来的时候是不是老老实实说「暂不可用」。付费路径 useCanvasGen 换成假件,
 * 任何一条断言都花不出一个积分。
 *
 * 先红后绿:改前六条全红(内核根本没有树、没有 Compare、读失败静默吞掉),红证存 PR。
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
  createCanvasNode: vi.fn(),
  moveCanvasNode: vi.fn(),
  deleteCanvasNode: vi.fn(),
  updateTextNode: vi.fn(),
  listCanvasNodes: vi.fn(),
  uploadReference: vi.fn(),
  quoteCosts: vi.fn(),
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

// The paid path is a handle here; nothing in this file can start a generation.
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
    && (node.status === "pending" || node.status === "queued"),
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

/** A settled card, exactly as an owner-scoped board read hands it over. */
function row(over: {
  id: string;
  type?: "image" | "video";
  x?: number;
  y?: number;
  prompt?: string;
  genJobId?: string | null;
  batchIndex?: number | null;
  batchSize?: number | null;
  layoutAnchorNodeId?: string | null;
  madeFromNodeId?: string | null;
}) {
  return {
    id: over.id,
    type: over.type ?? "image",
    x: over.x ?? 0,
    y: over.y ?? 0,
    w: 320,
    h: 320,
    text: null,
    prompt: over.prompt ?? `prompt ${over.id}`,
    generationId: `gen-${over.id}`,
    genJobId: over.genJobId === undefined ? "job-solo" : over.genJobId,
    status: "done",
    batchIndex: over.batchIndex ?? null,
    batchSize: over.batchSize ?? null,
    layoutAnchorNodeId: over.layoutAnchorNodeId ?? null,
    madeFromNodeId: over.madeFromNodeId ?? null,
    threadId: null,
    url: `https://cdn.example/${over.id}.png`,
    mediaWidth: 1024,
    mediaHeight: 1024,
    origin: null,
    lineage: null,
  };
}

const batchRow = (id: string, index: number, size: number, over: Record<string, unknown> = {}) =>
  ({ ...row({ id, genJobId: "job-batch", batchIndex: index, batchSize: size, x: index * 340 }), ...over });

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

function select(ids: string[]): void {
  act(() => mocks.flow.current!.onNodesChange(
    ids.map((id) => ({ id, type: "select" as const, selected: true })),
  ));
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => { button.click(); });
}

/** Open the lineage tree for a single card, the way a merchant does: pick it, press Lineage. */
async function openLineageFor(id: string): Promise<HTMLElement> {
  select([id]);
  await click(buttonNamed("Lineage")!);
  const panel = container!.querySelector<HTMLElement>('[aria-label="Lineage"]');
  if (!panel) throw new Error("no lineage panel on screen");
  return panel;
}

/** Every card the tree names, in the order it names them. */
function treeRowIds(panel: HTMLElement): string[] {
  return [...panel.querySelectorAll<HTMLElement>("[data-lineage-row]")]
    .map((el) => el.getAttribute("data-lineage-row") ?? "");
}

describe("the lineage tree reads the four recorded columns and nothing else", () => {
  it("shows the real chain for a card that was made from another card", async () => {
    mocks.boardRead.mockResolvedValue([
      row({ id: "src", prompt: "a cup of kopi on marble" }),
      row({ id: "vid", type: "video", genJobId: "job-2", madeFromNodeId: "src", prompt: "make it move" }),
    ]);
    await renderBoard();

    const panel = await openLineageFor("vid");
    expect(treeRowIds(panel)).toEqual(["src", "vid"]);
    expect(panel.textContent).toContain("a cup of kopi on marble");
    expect(panel.textContent).not.toContain("Lineage unavailable");
  });

  it("calls a batch a batch — four siblings, no mother and no daughters", async () => {
    mocks.boardRead.mockResolvedValue([
      batchRow("b0", 0, 4), batchRow("b1", 1, 4), batchRow("b2", 2, 4), batchRow("b3", 3, 4),
    ]);
    await renderBoard();

    const panel = await openLineageFor("b0");
    expect(panel.textContent).toContain("Batch of 4");
    expect(panel.textContent).toContain("1 of 4");
    expect(panel.textContent).toContain("4 of 4");
    // Standing beside something is not coming out of it: the tree claims no parentage at all.
    expect(panel.textContent).toContain("No source recorded");
    expect(treeRowIds(panel)).toEqual(["b0", "b0", "b1", "b2", "b3"]);
  });

  it("keeps the recorded order after the merchant drags the cards around", async () => {
    mocks.boardRead.mockResolvedValue([
      batchRow("p0", 0, 2, { x: 40, y: 40 }),
      batchRow("p1", 1, 2, { x: 40, y: 400 }),
    ]);
    await renderBoard();
    const before = treeRowIds(await openLineageFor("p0"));

    // The merchant drags the lower card above the upper one; the board read brings the new
    // coordinates back. Coordinates place cards — they never say which card this is.
    mocks.boardRead.mockResolvedValue([
      batchRow("p0", 0, 2, { x: 40, y: 400 }),
      batchRow("p1", 1, 2, { x: 40, y: 40 }),
    ]);
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    const panel = container!.querySelector<HTMLElement>('[aria-label="Lineage"]')!;
    expect(treeRowIds(panel)).toEqual(before);
    expect(panel.textContent).toContain("A");
    expect(panel.textContent).toContain("B");
  });

  it("says the source is not on this board instead of inventing one", async () => {
    mocks.boardRead.mockResolvedValue([
      row({ id: "orphan", madeFromNodeId: "someone-elses-card" }),
    ]);
    await renderBoard();

    const panel = await openLineageFor("orphan");
    expect(panel.textContent).toContain("Source is not on this board");
    expect(treeRowIds(panel)).toEqual(["orphan"]);
    expect(panel.textContent).not.toContain("someone-elses-card");
  });
});

/**
 * 读不出来就说读不出来(#605 验收③,沿用 fail-closed 先例)。
 *
 * 板读失败时静默吞掉,树会继续照着上一份快照讲故事——商家看到的是一份可能已经不成立的
 * 关系图,而且没有任何提示。诚实的做法是:树自己说「暂不可用」。
 */
describe("when the board's history cannot be read", () => {
  /** A card still being made keeps the board's own poller running, which is what re-reads the
   *  board while the merchant is looking at it. */
  const stillGenerating = () => ({
    ...row({ id: "wip", genJobId: "job-wip" }),
    status: "pending",
    generationId: null,
    url: null,
  });

  it("says the lineage is unavailable rather than showing relationships it cannot confirm", async () => {
    mocks.boardRead.mockResolvedValue([
      row({ id: "src" }),
      row({ id: "vid", type: "video", genJobId: "job-2", madeFromNodeId: "src" }),
      stillGenerating(),
    ]);
    await renderBoard();
    const panel = await openLineageFor("vid");
    expect(treeRowIds(panel)).toEqual(["src", "vid"]);

    mocks.boardRead.mockResolvedValue({ error: "Project not found." });
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    const failed = container!.querySelector<HTMLElement>('[aria-label="Lineage"]')!;
    expect(failed.textContent).toContain("Lineage unavailable");
    expect(treeRowIds(failed)).toEqual([]);
    // The cards themselves are paid work and stay exactly where they were.
    expect(mocks.flow.current!.nodes.some((node) => node.id === "vid")).toBe(true);
  });

  it("says the same when the read throws instead of answering", async () => {
    mocks.boardRead.mockResolvedValue([row({ id: "src" }), stillGenerating()]);
    await renderBoard();
    const panel = await openLineageFor("src");
    expect(panel.textContent).not.toContain("Lineage unavailable");

    mocks.boardRead.mockRejectedValue(new Error("network down"));
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(container!.querySelector<HTMLElement>('[aria-label="Lineage"]')!.textContent)
      .toContain("Lineage unavailable");
  });

  it("comes back as soon as the board can be read again", async () => {
    mocks.boardRead.mockResolvedValue([row({ id: "src" }), stillGenerating()]);
    await renderBoard();
    await openLineageFor("src");

    mocks.boardRead.mockResolvedValue({ error: "Project not found." });
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(container!.querySelector<HTMLElement>('[aria-label="Lineage"]')!.textContent)
      .toContain("Lineage unavailable");

    mocks.boardRead.mockResolvedValue([row({ id: "src" }), stillGenerating()]);
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    const panel = container!.querySelector<HTMLElement>('[aria-label="Lineage"]')!;
    expect(panel.textContent).not.toContain("Lineage unavailable");
    expect(treeRowIds(panel)).toEqual(["src"]);
  });
});

/**
 * A/B 对比只对真同批开放(#605 验收②)。
 *
 * 假边时代任意两张兄弟卡都判「同源可比」,一批四张里随便挑两张都能并排,商家看到的
 * A/B 是画布替他编的。现在闸只认落盘事实。
 */
describe("the A/B letter a card wears", () => {
  /** The letter on a card right now, or null when it wears none. */
  function letterOn(id: string): string | null {
    const card = container!.querySelector<HTMLElement>(`[data-node="${id}"]`)!;
    const badges = [...card.querySelectorAll("span")]
      .map((span) => span.textContent?.trim() ?? "")
      .filter((text) => text === "A" || text === "B");
    return badges[0] ?? null;
  }

  it("keeps A on A and B on B after the two cards swap places", async () => {
    mocks.boardRead.mockResolvedValue([
      batchRow("p0", 0, 2, { x: 40, y: 40 }),
      batchRow("p1", 1, 2, { x: 40, y: 400 }),
      { ...row({ id: "wip", genJobId: "job-wip" }), status: "pending", generationId: null, url: null },
    ]);
    await renderBoard();
    expect(letterOn("p0")).toBe("A");
    expect(letterOn("p1")).toBe("B");

    // The merchant drags B above A; the board read brings the new coordinates back.
    mocks.boardRead.mockResolvedValue([
      batchRow("p0", 0, 2, { x: 40, y: 400 }),
      batchRow("p1", 1, 2, { x: 40, y: 40 }),
      { ...row({ id: "wip", genJobId: "job-wip" }), status: "pending", generationId: null, url: null },
    ]);
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(letterOn("p0")).toBe("A");
    expect(letterOn("p1")).toBe("B");
  });

  it("gives the survivors of a batch of four no letter — they were never an A and a B", async () => {
    mocks.boardRead.mockResolvedValue([batchRow("b0", 0, 4), batchRow("b2", 2, 4)]);
    await renderBoard();

    expect(letterOn("b0")).toBeNull();
    expect(letterOn("b2")).toBeNull();
  });
});

describe("side-by-side compare", () => {
  it("stays locked for two survivors of a batch of four", async () => {
    mocks.boardRead.mockResolvedValue([batchRow("b0", 0, 4), batchRow("b2", 2, 4)]);
    await renderBoard();

    select(["b0", "b2"]);
    expect(container!.textContent).toContain("2 selected");
    expect(buttonNamed("Compare")).toBeUndefined();
  });

  it("opens for the two cards of a press that really made two", async () => {
    mocks.boardRead.mockResolvedValue([batchRow("p0", 0, 2), batchRow("p1", 1, 2)]);
    await renderBoard();

    select(["p0", "p1"]);
    await click(buttonNamed("Compare")!);

    const dialog = container!.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Comparing A and B");
    const sides = [...dialog.querySelectorAll<HTMLElement>("[data-compare-side]")];
    expect(sides.map((side) => side.getAttribute("data-compare-side"))).toEqual(["p0", "p1"]);
    expect(sides.map((side) => side.textContent?.includes("A") || side.textContent?.includes("B")))
      .toEqual([true, true]);
  });

  it("puts the recorded A on the left even when the merchant picked B first", async () => {
    mocks.boardRead.mockResolvedValue([
      batchRow("p0", 0, 2, { x: 400 }),
      batchRow("p1", 1, 2, { x: 0 }),
    ]);
    await renderBoard();

    select(["p1", "p0"]);
    await click(buttonNamed("Compare")!);

    const sides = [...container!.querySelectorAll<HTMLElement>("[data-compare-side]")];
    expect(sides.map((side) => side.getAttribute("data-compare-side"))).toEqual(["p0", "p1"]);
  });

  it("also opens for a card and the card it was really made from", async () => {
    mocks.boardRead.mockResolvedValue([
      row({ id: "src" }),
      row({ id: "kid", genJobId: "job-2", madeFromNodeId: "src" }),
    ]);
    await renderBoard();

    select(["kid", "src"]);
    await click(buttonNamed("Compare")!);

    const dialog = container!.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Comparing a card with what it made");
  });

  it("never opens for a card paired with itself or with three others", async () => {
    mocks.boardRead.mockResolvedValue([
      batchRow("p0", 0, 2), batchRow("p1", 1, 2), row({ id: "other", genJobId: "job-x" }),
    ]);
    await renderBoard();

    select(["p0", "p1", "other"]);
    expect(container!.textContent).toContain("3 selected");
    expect(buttonNamed("Compare")).toBeUndefined();
  });
});

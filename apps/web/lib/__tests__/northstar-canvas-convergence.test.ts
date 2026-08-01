// @vitest-environment jsdom
/**
 * 北极星 Canvas 页 = 北极星的皮 + 修真内核的芯(#600 · spec #599 D1/D2)。
 *
 * 这里只测商家看得见的结果,不测内部函数被谁调用:
 *   1. 该页不再引用手搓板 —— 受控 Entry 与路由文件里再没有那条 import(红:改前两处都有)。
 *   2. 商家落地看到的就是内核画的板 —— 板子由内核读、内核画,卡片是真的 ImageNode。
 *   3. 北极星规格还在 —— credits 常显、缩放控件、嵌入式 Otto 输入(@ 引用)第一眼就在。
 *   4. 内核的行为整套跟着过来了 —— 多选批量条、落位不压卡、邻近落位挨着来源卡。
 *
 * 全程没有真实生成:付费路径 useCanvasGen 被替换成一个把回调交出来的假件,任何一条断言都
 * 花不出一个积分。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_CARD_GAP } from "@/lib/canvas-batch-layout";

type FlowProps = {
  nodes: Array<{ id: string; type?: string; selected?: boolean; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
  nodeTypes: Record<string, (props: Record<string, unknown>) => ReactElement | null>;
  onNodesChange: (changes: unknown[]) => void;
  onInit?: (instance: Record<string, unknown>) => void;
};

type SpawnRect = { x: number; y: number; w: number; h: number };

const mocks = vi.hoisted(() => ({
  boardRead: vi.fn(),
  listCanvasNodes: vi.fn(),
  createCanvasNode: vi.fn(),
  moveCanvasNode: vi.fn(),
  deleteCanvasNode: vi.fn(),
  updateTextNode: vi.fn(),
  uploadReference: vi.fn(),
  getMyAccount: vi.fn(),
  quoteCosts: vi.fn(),
  generateImage: vi.fn(),
  mentionChange: { current: null as null | ((text: string, ids: string[], variantSel: Record<string, string>) => void) },
  mentionSubmit: { current: null as null | (() => void) },
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
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/otto/OttoTrace", () => ({ OttoCanvasStatus: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: unknown }) =>
    createElement("a", { href }, children as ReactElement),
}));

// The prompt box is a rich editor jsdom cannot drive. This stand-in keeps its CONTRACT —
// a placeholder the merchant reads, text changes reported upward, and a submit — so the
// board's own generate wiring is what runs.
vi.mock("@/components/MentionInput", () => ({
  MentionInput: ({
    placeholder,
    onChange,
    onSubmit,
  }: {
    placeholder?: string;
    onChange: (text: string, ids: string[], variantSel: Record<string, string>) => void;
    onSubmit: () => void;
  }) => {
    mocks.mentionChange.current = onChange;
    mocks.mentionSubmit.current = onSubmit;
    return createElement("textarea", {
      "data-testid": "canvas-prompt",
      placeholder,
      readOnly: true,
    });
  },
}));

// The paid path, replaced by a handle. Nothing in this file can start a generation.
vi.mock("@/components/canvas/useCanvasGen", () => ({
  useCanvasGen: () => ({
    generateImage: mocks.generateImage,
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
    NodeToolbar: ({ isVisible, children }: { isVisible?: boolean; children?: unknown }) =>
      isVisible === false ? null : createElement("div", null, children as ReactElement),
    NodeResizer: () => null,
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { NorthstarCanvasWorkspace } = await import("@/components/canvas/NorthstarCanvasWorkspace");

// `new URL(..., import.meta.url)` is rewritten by Vite's asset handling, so the web root is
// resolved from the file path instead.
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = (relativePath: string): string => readFileSync(resolve(WEB_ROOT, relativePath), "utf8");

const RUNTIME_CONTEXT = {
  projects: [
    { id: "p1", name: "Kedai Kopi" },
    { id: "p2", name: "Raya Campaign" },
  ],
  threads: [
    { id: "t1", projectId: "p1", title: "Morning shots", updatedAt: "2026-08-01T00:00:00.000Z", pinnedAt: null },
  ],
  activeProjectId: "p1",
  activeThreadId: "t1",
  initialBalance: 1240,
};

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
  mocks.generateImage.mockResolvedValue(true);
  mocks.getMyAccount.mockResolvedValue({ balance: 1240 });
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
  mocks.mentionChange.current = null;
  mocks.mentionSubmit.current = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderPage(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(NorthstarCanvasWorkspace, { runtimeContext: RUNTIME_CONTEXT }));
  });
  await act(async () => { await Promise.resolve(); });
}

function buttonLabelled(label: string): HTMLButtonElement | undefined {
  return [...container!.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label);
}

function select(ids: string[]): void {
  act(() => mocks.flow.current!.onNodesChange(ids.map((id) => ({ id, type: "select" as const, selected: true }))));
}

/**
 * 手搓板退场(#600 验收①)。
 *
 * 改前:受控 Entry 直接 import 并渲染 `components/northstar/create/canvas-page`。这条断言
 * 在改前是红的,也是「合体真的发生了」唯一不能靠外观蒙混的证据。手搓板文件本身留在树里
 * (D7 · T7 才退役),所以只断言「这条路上没人再引用它」。
 */
describe("the hand-rolled board no longer renders on this page", () => {
  const HANDMADE_BOARD = "northstar/create/canvas-page";

  it("is not imported by the controlled entry", () => {
    expect(source("components/canvas/ImmersiveCanvasEntry.tsx")).not.toContain(HANDMADE_BOARD);
  });

  it("is not imported by the route file either", () => {
    expect(source("app/northstar-immersive/create/canvas/page.tsx")).not.toContain(HANDMADE_BOARD);
  });

  it("is not reached through the new workspace", () => {
    expect(source("components/canvas/NorthstarCanvasWorkspace.tsx")).not.toContain(HANDMADE_BOARD);
  });
});

describe("what the merchant lands on", () => {
  it("is the mature kernel's board, read from the project", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1"), boardRow("n2", { x: 360 })]);
    await renderPage();

    expect(mocks.boardRead).toHaveBeenCalledWith("p1");
    expect(mocks.flow.current!.nodes.map((node) => node.id)).toEqual(["n1", "n2"]);
    // Real cards, not placeholders: a picked card offers the kernel's own Info action.
    select(["n1"]);
    expect([...container!.querySelectorAll("button")].filter((b) => b.textContent === "Info")).toHaveLength(1);
  });

  it("keeps the north-star chrome: credits always on screen, plus where they are", async () => {
    await renderPage();

    const text = container!.textContent ?? "";
    expect(text).toContain("1,240 credits");
    expect(text).toContain("Kedai Kopi · Morning shots");
  });

  it("keeps the zoom controls", async () => {
    await renderPage();

    expect(buttonLabelled("Zoom in")).toBeDefined();
    expect(buttonLabelled("Zoom out")).toBeDefined();
    expect(buttonLabelled("Fit to screen")).toBeDefined();
    expect(container!.querySelector('[aria-label="Canvas tools"]')).not.toBeNull();
  });

  it("keeps the embedded prompt box visible on arrival, with @ references", async () => {
    await renderPage();

    const composer = container!.querySelector<HTMLTextAreaElement>('[data-testid="canvas-prompt"]');
    expect(composer).not.toBeNull();
    expect(composer!.placeholder).toContain("@");
  });
});

describe("the kernel's behaviour came along with it", () => {
  it("offers the batch bar when several cards are picked", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1"), boardRow("n2", { x: 360 })]);
    await renderPage();

    select(["n1", "n2"]);

    expect(container!.textContent).toContain("2 selected");
  });

  it("never lands a new card on top of one already paid for", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderPage();

    await act(async () => { mocks.mentionChange.current!("a bowl of laksa", [], {}); });
    await act(async () => { mocks.mentionSubmit.current!(); });

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    const rect = mocks.generateImage.mock.calls[0]![1] as SpawnRect;
    const overlaps = rect.x < 320 && rect.x + rect.w > 0 && rect.y < 320 && rect.y + rect.h > 0;
    expect(overlaps).toBe(false);
  });

  it("puts a card made FROM another one beside it, not across the board", async () => {
    mocks.boardRead.mockResolvedValue([
      boardRow("far", { x: 1600, y: 1600 }),
      boardRow("near-origin"),
    ]);
    await renderPage();

    const anchor = mocks.flow.current!.nodes.find((node) => node.id === "far")!;
    await act(async () => {
      (anchor.data.onEvolve as (id: string, text: string) => void)("far", "same cup, warmer light");
    });

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    const rect = mocks.generateImage.mock.calls[0]![1] as SpawnRect;
    const reach = 320 + CANVAS_CARD_GAP;
    expect(Math.abs(rect.x - 1600)).toBeLessThanOrEqual(reach);
    expect(Math.abs(rect.y - 1600)).toBeLessThanOrEqual(reach);
  });
});

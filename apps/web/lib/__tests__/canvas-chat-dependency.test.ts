// @vitest-environment jsdom
/**
 * #548 — one board, one answer about whether an Otto conversation is needed.
 *
 * The walkthrough opened the canvas with no conversation and got three different behaviours out
 * of the same board: `Generate image` and `Make a video` charged and delivered; `Use as reference`
 * and `Evolve this image` answered with a red error ("Open an Otto chat first."); the Video tool
 * in the bottom bar did nothing at all — no composer, no note, no console line. Three shapes of
 * the same fact, and not one of them offered before the merchant pressed anything.
 *
 * The root was that "does this need a chat?" had no single answer. It has one now:
 *
 *   · NO paid canvas action needs a conversation. A generation started from the board attaches to
 *     the project with `threadId: null` — image, video from a prompt, video from a picture, and
 *     another take of a picture, all of them.
 *   · The Video tool is not a dead key: it opens its own video composer, exactly as the image
 *     tool opens its own.
 *   · Handing cards to Otto is the ONE action that still needs a conversation, because a
 *     reference has nowhere to go without one — and the control now SAYS so before it is
 *     pressed, in the same sentence it says afterwards.
 *
 * Everything is driven through the real FlowCanvas with the real ImageNode / VideoNode. Only the
 * paid functions are handles, so no assertion in this file can spend a credit or reach a provider.
 */
import { act, createElement, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_OTTO_CHAT_REQUIRED } from "@/lib/canvas-chat-reference";

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
vi.mock("@/components/otto/OttoTrace", () => ({ OttoCanvasStatus: () => null }));
vi.mock("@/components/MentionInput", () => ({
  MentionInput: ({ onChange }: { onChange?: (t: string, ids: string[], vsel: Record<string, string>) => void }) =>
    createElement("textarea", {
      "data-testid": "mention",
      onChange: (e: { target: { value: string } }) => onChange?.(e.target.value, [], {}),
    }),
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

const boardRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: "image",
  x: 80,
  y: 80,
  w: 320,
  h: 320,
  text: null,
  prompt: "a cup steaming",
  generationId: `gen-${id}`,
  genJobId: `job-${id}`,
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
  mocks.quoteCosts.mockResolvedValue({ imageCredits: 8, videoCredits: 80 });
  mocks.imageShapes.mockResolvedValue({ options: ["1:1", "9:16", "16:9"], defaultAspect: "1:1" });
  mocks.videoSpecs.mockResolvedValue({
    menu: { durations: [5, 10], resolutions: ["720p", "480p"], aspectRatios: ["16:9", "9:16", "adaptive"] },
    t2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "16:9" },
    i2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "adaptive" },
    creditsFor: () => 11,
  });
  mocks.generateImage.mockResolvedValue(true);
  mocks.animate.mockResolvedValue(true);
  mocks.generateVideoFromText.mockResolvedValue(true);
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

/** A board with NO conversation open — `onReferenceInChat` is what OttoView withholds then. */
async function renderBoard(props: Record<string, unknown> = {}): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(FlowCanvas, {
      projectId: "p1", skin: "gb" as const, defaultComposerOpen: true, ...props,
    }));
  });
  await act(async () => { await Promise.resolve(); });
}

function select(ids: string[]): void {
  act(() => mocks.flow.current!.onNodesChange(ids.map((id) => ({ id, type: "select" as const, selected: true }))));
}

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
  descriptor?.set?.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonsLabelled(text: string): HTMLButtonElement[] {
  return [...container!.querySelectorAll("button")].filter((b) => b.textContent === text);
}

function toolbarButton(ariaLabel: string): HTMLButtonElement {
  const found = container!.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);
  expect(found, `the bottom tool bar should carry a "${ariaLabel}" tool`).not.toBeNull();
  return found!;
}

/** Dialogs render into a portal, so they are read off the document, not the container. */
function dialogText(): string {
  return document.body.textContent ?? "";
}

function evolveBar(nodeId: string): HTMLInputElement {
  const found = container!.querySelector<HTMLInputElement>(
    `[data-node="${nodeId}"] input[aria-label="Edit this image's prompt and make a new image"]`,
  );
  expect(found, "a picked image should carry its own prompt bar").not.toBeNull();
  return found!;
}

describe("#548 — with no Otto conversation open, every paid canvas action still works", () => {
  it("opens the video composer from the bottom Video tool — it is not a dead key", async () => {
    await renderBoard();

    await act(async () => { toolbarButton("Video").click(); });
    await act(async () => { await Promise.resolve(); });

    expect(dialogText()).toContain("Make a video from a prompt");
    // Opening a composer is not a spend, and it is not a failure either.
    expect(mocks.generateVideoFromText).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("makes an image from the composer, with no thread and no refusal", async () => {
    await renderBoard();

    const composer = container!.querySelector<HTMLTextAreaElement>('[data-testid="mention"]')!;
    await act(async () => { typeInto(composer, "a cup steaming"); });
    await act(async () => {
      container!.querySelector<HTMLFormElement>("form.al-promptbar")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("makes another take of a picked image, with no thread and no refusal", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { buttonsLabelled("Create variations")[0]!.click(); });

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("offers the video confirm from a picked image, with no thread and no refusal", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { buttonsLabelled("Animate")[0]!.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(dialogText()).toContain("Make a video");
    // Founder rule: video always asks before it charges. Opening the dialog spends nothing.
    expect(mocks.animate).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});

describe("#548 — the one action that does need a conversation says so before the press", () => {
  it("puts the reason on the control itself while no conversation is open", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    expect(buttonsLabelled("Edit with Otto")[0]!.title).toBe(CANVAS_OTTO_CHAT_REQUIRED);
  });

  it("says the same sentence if it is pressed anyway — a next step, never a red error", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { buttonsLabelled("Edit with Otto")[0]!.click(); });

    expect(mocks.toastMessage).toHaveBeenCalledWith(CANVAS_OTTO_CHAT_REQUIRED);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("says what it does — and does it — once a conversation is open", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard({ onReferenceInChat, activeThreadId: "t1" });
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    const button = buttonsLabelled("Edit with Otto")[0]!;
    expect(button.title).not.toBe(CANVAS_OTTO_CHAT_REQUIRED);
    expect(button.title).toContain("Otto");

    await act(async () => { button.click(); });

    expect(onReferenceInChat).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});

describe("#548 — a refused take never throws away what the merchant typed", () => {
  it("keeps the edited prompt in the bar when the generation is not accepted", async () => {
    mocks.generateImage.mockResolvedValue(false);
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    const bar = evolveBar("n1");
    await act(async () => { typeInto(bar, "same cup, warmer light"); });
    await act(async () => {
      bar.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => { await Promise.resolve(); });

    expect(evolveBar("n1").value).toBe("same cup, warmer light");
  });
});

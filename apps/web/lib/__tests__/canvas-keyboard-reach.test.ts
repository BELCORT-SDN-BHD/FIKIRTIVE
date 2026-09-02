// @vitest-environment jsdom
/**
 * #549 — every paid card on the board can be reached and picked, one at a time, without a mouse.
 *
 * The walkthrough's second symptom: a video landed exactly on top of a paid image, and pressing
 * Enter selected the image UNDERNEATH — the merchant's eye was on one card and the keyboard was
 * on another. Two things have to hold for that to be impossible, and they are proved in two
 * different places because only one of them can honestly be proved here:
 *
 *   1. No new card is ever written on top of a card that is already there. That is geometry
 *      against a real database, and it lives in canvas-overlap-placement.test.ts.
 *   2. The board offers each card to the keyboard SEPARATELY, and Enter picks the card the focus
 *      is actually on — never a different one. That is this file.
 *
 * jsdom ships no layout engine, so nothing here can measure that two cards do not overlap; it is
 * not claimed. What is driven is the real FlowCanvas with the real React Flow, the real Tab order
 * and the real Enter activation — the same keyboard surface the walkthrough campaign signed off,
 * on the exact board shape (image · image · video) that failed.
 *
 * The paid path is replaced by a handle: no assertion in this file can spend a credit.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: FlowCanvas } = await import("@/components/canvas/FlowCanvas");

/** The board the walkthrough had when Enter picked the wrong card: two images and a video. */
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

const PAID_BOARD = [
  boardRow("img1"),
  boardRow("img2", { x: 420 }),
  boardRow("vid1", { x: 760, type: "video", url: "https://cdn.example/vid1.mp4" }),
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** jsdom reports every element as 0×0; React Flow refuses to mount a zero-sized board. */
const sizedRect = () => ({
  width: 1280, height: 800, top: 0, left: 0, right: 1280, bottom: 800, x: 0, y: 0,
  toJSON: () => ({}),
}) as DOMRect;

beforeEach(() => {
  mocks.boardRead.mockResolvedValue(PAID_BOARD);
  mocks.quoteCosts.mockResolvedValue({ imageCredits: 8, videoCredits: 80 });
  mocks.imageShapes.mockResolvedValue({ options: ["1:1", "9:16"], defaultAspect: "1:1" });
  mocks.videoSpecs.mockResolvedValue({
    menu: { durations: [5], resolutions: ["720p"], aspectRatios: ["16:9"] },
    t2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "16:9" },
    i2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "adaptive" },
    creditsFor: () => 8,
  });
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("DOMMatrixReadOnly", class {
    m22 = 1;
    constructor(_transform?: string) {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(sizedRect);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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

function nodeWrapper(nodeId: string): HTMLElement {
  const el = container!.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`);
  expect(el, `React Flow rendered no wrapper for ${nodeId}`).not.toBeNull();
  return el!;
}

function isSelected(nodeId: string): boolean {
  return nodeWrapper(nodeId).classList.contains("selected");
}

/** Everything a merchant can reach with Tab, in document order. */
function tabbables(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>("[tabindex], button, a[href], input, video[controls]")]
    .filter((el) => el.getAttribute("tabindex") !== "-1" && !(el as HTMLButtonElement).disabled);
}

/**
 * A real Tab press. jsdom delivers key events but ships no focus-navigation engine and runs no
 * browser default action, so this sends the real keydown (the app may swallow it) and, only when
 * nothing did, performs the one step the browser itself would: focus the next tabbable element in
 * document order. Same split `@testing-library/user-event`'s `tab()` uses. What the assertions
 * check is therefore the app's own tab run, not the helper's move.
 */
async function pressTab(): Promise<HTMLElement | null> {
  const from = (document.activeElement as HTMLElement | null) ?? document.body;
  let defaultAllowed = true;
  await act(async () => {
    defaultAllowed = from.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
  });
  if (defaultAllowed) {
    const order = tabbables();
    const next = order[order.indexOf(from) + 1] ?? order[0] ?? null;
    await act(async () => { next?.focus(); });
  }
  const landed = document.activeElement as HTMLElement | null;
  await act(async () => {
    (landed ?? from).dispatchEvent(new KeyboardEvent("keyup", { key: "Tab", bubbles: true, cancelable: true }));
  });
  return landed;
}

/** A real Enter press on whatever has focus, plus the browser's own activation step for buttons. */
async function pressEnterOnFocused(): Promise<void> {
  const el = document.activeElement as HTMLElement | null;
  expect(el, "nothing has focus — Enter has nowhere to land").not.toBeNull();
  let defaultAllowed = true;
  await act(async () => {
    defaultAllowed = el!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  if (defaultAllowed && el instanceof HTMLButtonElement) {
    await act(async () => { el.click(); });
  }
  await act(async () => {
    el!.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true }));
  });
}

/** Tab forward until the card with this id has focus. Fails loudly if it is never offered. */
async function tabToCard(nodeId: string, limit = 40): Promise<void> {
  const path: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    const el = await pressTab();
    path.push(el?.getAttribute("data-id") ?? el?.getAttribute("aria-label") ?? "(other)");
    if (el?.getAttribute("data-id") === nodeId) return;
  }
  throw new Error(`Tab never offered card ${nodeId} in ${limit} presses; it went: ${path.join(" → ")}`);
}

describe("#549 — a paid card is never out of the keyboard's reach", () => {
  it("offers every card on the board to Tab, one card per stop", async () => {
    await renderBoard();

    const offered = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const el = await pressTab();
      const id = el?.getAttribute("data-id");
      if (id) offered.add(id);
      if (offered.size === PAID_BOARD.length) break;
    }

    expect([...offered].sort()).toEqual(["img1", "img2", "vid1"]);
  });

  it("picks the card the keyboard is actually on — never one of its neighbours", async () => {
    await renderBoard();

    for (const target of ["img1", "img2", "vid1"]) {
      await act(async () => { (document.activeElement as HTMLElement | null)?.blur(); });
      await tabToCard(target);
      await pressEnterOnFocused();

      expect(isSelected(target), `Enter on ${target} did not pick it`).toBe(true);
      for (const other of ["img1", "img2", "vid1"].filter((id) => id !== target)) {
        expect(isSelected(other), `Enter on ${target} also picked ${other}`).toBe(false);
      }
    }
  });

  it("reaches the video's own toolbar from the video, with no mouse anywhere", async () => {
    await renderBoard();

    await tabToCard("vid1");
    await pressEnterOnFocused();
    expect(isSelected("vid1")).toBe(true);

    // The card's own actions come next in the tab run — a picked card is an actionable card.
    let reached: string | null = null;
    for (let i = 0; i < 12; i += 1) {
      const el = await pressTab();
      const label = el?.getAttribute("aria-label") ?? el?.textContent?.trim() ?? "";
      if (label.length > 0 && el?.tagName === "BUTTON") { reached = label; break; }
    }

    expect(reached, "the picked video offered the keyboard no action at all").not.toBeNull();
  });
});

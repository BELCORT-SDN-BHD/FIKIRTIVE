// @vitest-environment jsdom
/**
 * 批次身份不再靠猜(#603 T4 · spec #599 D5,体检根 4·A)。
 *
 * 两个病都是「事实明明在服务端手上,却没写下来,读的时候临时从商家会改的东西里推回来」:
 *
 *   ① A/B 标签由坐标推。客户端把同一批的卡按「先比 y 坐标、再比 x 坐标」重排,序号就是排名。
 *      商家把 B 拖到 A 上面 → 新坐标写库 → 同步循环拉回 → 序号重算 → 两个角标当场互换。
 *      商家截图跟同事说「我选 A」,同事打开看到的 A 是另一张。
 *   ② 批大小由「现在还剩几张」数出来。一批 4 张删掉 2 张,剩下的 2 张凭空长出 A/B 角标并解锁
 *      「Compare」—— 商家从来没做过 A/B 对照。
 *
 * 这里全程驱动真页面(真 CanvasPage + 真 useImmersiveCanvasRuntime + 真同步循环),断言的是
 * 商家眼睛看得见的东西:卡上的字母、工具条上有没有 Compare。付费路径 useCanvasGen 换成假件,
 * 任何一条断言都花不出一个积分。
 *
 * 先红后绿:改前 ① 拉回后角标互换、② 两张幸存卡长出 A/B 并出现 Compare;红证原始输出存 PR。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  boardRead: vi.fn(),
  moveCanvasNode: vi.fn(),
  deleteCanvasNode: vi.fn(),
  getMyAccount: vi.fn(),
  quoteCosts: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/otto-canvas-bridge", () => ({ syncOttoCanvasNodes: mocks.boardRead }));
vi.mock("@/lib/canvas-actions", () => ({
  moveCanvasNode: mocks.moveCanvasNode,
  deleteCanvasNode: mocks.deleteCanvasNode,
}));
vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/components/MentionInput", () => ({ MentionInput: () => null }));
vi.mock("@/components/otto/OttoAvatar", () => ({ OttoAvatar: () => null }));

// The paid path, replaced by a handle. Nothing in this file can start a generation.
vi.mock("@/components/canvas/useCanvasGen", () => ({
  useCanvasGen: () => ({
    generateImage: vi.fn(),
    animate: vi.fn(),
    generateVideoFromText: vi.fn(),
    quoteCosts: mocks.quoteCosts,
    cancelledRef: { current: false },
  }),
  isInFlightPaidGen: () => false,
  freshCanvasActionId: () => "canvas-action-test",
  loadCanvasActionReceipts: () => [],
  clearCanvasActionReceipt: () => undefined,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no matchMedia; the north-star shell asks it for the reduced-motion preference.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
}
if (typeof PointerEvent === "undefined") {
  (globalThis as { PointerEvent?: unknown }).PointerEvent = MouseEvent;
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;

const { CanvasPage } = await import("@/components/northstar/create/canvas-page");
const { CANVAS_SYNC_INTERVAL_MS } = await import("@/components/canvas/immersive-canvas-runtime");

const RUNTIME_CONTEXT = {
  activeProjectId: "p1",
  activeThreadId: null,
  projects: [{ id: "p1", name: "Shop" }],
  threads: [],
  entities: [],
  initialBalance: 500,
} as unknown as Parameters<typeof CanvasPage>[0]["runtimeContext"];

/**
 * One card of a settled batch, exactly as a board read returns it.
 *
 * `batchIndex` / `batchSize` are the PERSISTED facts — what the server wrote when it settled the
 * paid job. `x` / `y` only place the card.
 */
function batchCard(over: {
  id: string;
  batchIndex: number;
  batchSize: number;
  x: number;
  y: number;
}) {
  return {
    id: over.id,
    type: "image",
    x: over.x,
    y: over.y,
    w: 224,
    h: 224,
    text: null,
    prompt: "a cup of kopi on marble",
    generationId: `gen-${over.id}`,
    genJobId: "job-1",
    status: "done",
    batchIndex: over.batchIndex,
    batchSize: over.batchSize,
    layoutAnchorNodeId: over.batchIndex === 0 ? null : "card-a",
    madeFromNodeId: null,
    threadId: null,
    url: `https://cdn.example/${over.id}.png`,
    mediaWidth: 1024,
    mediaHeight: 1024,
    origin: null,
    lineage: null,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderBoard() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(CanvasPage, { runtimeContext: RUNTIME_CONTEXT }));
  });
  await act(async () => { await Promise.resolve(); });
}

/** Every card on the board, keyed by the addressable name the merchant reads (Image 1, Image 2). */
function cards(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>('[role="group"][aria-label]')]
    .filter((el) => /^Image \d/u.test(el.getAttribute("aria-label") ?? ""));
}

function cardById(id: string): HTMLElement {
  const card = cards().find((el) => el.querySelector(`img[src*="${id}"]`));
  if (!card) throw new Error(`no card on the board for ${id}`);
  return card;
}

/** The A/B letter this card wears right now, or null when it wears none. */
function letterOn(id: string): string | null {
  const badges = [...cardById(id).querySelectorAll("span")]
    .map((span) => span.textContent?.trim() ?? "")
    .filter((text) => text === "A" || text === "B");
  return badges[0] ?? null;
}

function selectCard(id: string, add = false): void {
  const card = cardById(id);
  act(() => {
    card.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, shiftKey: add,
    }));
  });
}

function compareButton(): HTMLElement | undefined {
  return [...container!.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "Compare");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMyAccount.mockResolvedValue({ balance: 500 });
  mocks.quoteCosts.mockResolvedValue({ imageCredits: 12, videoCredits: 40 });
  mocks.moveCanvasNode.mockResolvedValue({ ok: true });
  mocks.deleteCanvasNode.mockResolvedValue({ ok: true });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.useRealTimers();
});

describe("A/B labels after the merchant rearranges the board (#603 验收②)", () => {
  it("keeps A on A and B on B when the two cards swap places", async () => {
    const above = batchCard({ id: "card-a", batchIndex: 0, batchSize: 2, x: 40, y: 40 });
    const below = batchCard({ id: "card-b", batchIndex: 1, batchSize: 2, x: 40, y: 320 });
    mocks.boardRead.mockResolvedValue([above, below]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderBoard();

    expect(letterOn("card-a")).toBe("A");
    expect(letterOn("card-b")).toBe("B");

    // The merchant drags the lower card above the upper one. A drag's only durable effect is a
    // new position, which is written to the row…
    const dragged = cardById("card-b");
    act(() => {
      dragged.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 400 }));
      dragged.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 100, clientY: 60 }));
      dragged.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 100, clientY: 60 }));
    });
    expect(mocks.moveCanvasNode).toHaveBeenCalled();

    // …and the board's own sync loop brings that new position back a few seconds later. THIS is
    // the step that used to flip both badges: the coordinates were re-sorted and the ranking
    // became the batch position.
    mocks.boardRead.mockResolvedValue([
      { ...above, y: 320 },
      { ...below, y: 40 },
    ]);
    await act(async () => { await vi.advanceTimersByTimeAsync(CANVAS_SYNC_INTERVAL_MS + 50); });

    expect(letterOn("card-a")).toBe("A");
    expect(letterOn("card-b")).toBe("B");
  });
});

describe("what is left of a batch after the merchant deletes some (#603 验收③)", () => {
  /** A press of four. The merchant removed two; a board read never returns tombstones, so what
   *  comes back is two cards that still carry the batch they were born into: positions 0 and 2
   *  of FOUR. */
  const twoOfFour = () => [
    batchCard({ id: "card-a", batchIndex: 0, batchSize: 4, x: 40, y: 40 }),
    batchCard({ id: "card-c", batchIndex: 2, batchSize: 4, x: 300, y: 40 }),
  ];

  it("gives the survivors no A/B badge — they were never an A and a B", async () => {
    mocks.boardRead.mockResolvedValue(twoOfFour());
    await renderBoard();

    expect(letterOn("card-a")).toBeNull();
    expect(letterOn("card-c")).toBeNull();
  });

  it("keeps Compare locked for them", async () => {
    mocks.boardRead.mockResolvedValue(twoOfFour());
    await renderBoard();

    selectCard("card-a");
    selectCard("card-c", true);
    expect(container!.textContent).toContain("2 selected");
    expect(compareButton()).toBeUndefined();
  });

  it("still offers Compare for the two cards of a batch that really was a pair", async () => {
    mocks.boardRead.mockResolvedValue([
      batchCard({ id: "card-a", batchIndex: 0, batchSize: 2, x: 40, y: 40 }),
      batchCard({ id: "card-b", batchIndex: 1, batchSize: 2, x: 300, y: 40 }),
    ]);
    await renderBoard();

    selectCard("card-a");
    selectCard("card-b", true);
    expect(compareButton()).toBeDefined();
  });
});

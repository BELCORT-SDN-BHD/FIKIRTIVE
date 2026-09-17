// @vitest-environment jsdom
/**
 * R3-F28 —— 付完钱、卡已经在板上了，服务端把**同一张卡**再答一次，画布不许把它摆成两张。
 *
 * 走查现场（staging build `c0d25917`，2026-09-17，付费旅程 worker 复现两次）：商家在第二个
 * 标签页按了一张第一个标签页已经批准过的确认卡（幂等闸正确地没有新建 GenJob、没有新账本行），
 * 以及在画布卡工具条上确认「Create variations」之后，画布当场翻出它的错误边界
 * （`app/create/canvas/error.tsx`「This canvas didn't open」，console `Minified React error #185`）。
 *
 * ## 病根（这一份钉住的那一条）
 *
 * 付费动作被**重放**时，服务端照设计答的是**已经存在的那一行**：`placeCanvasJobNode`
 * （`lib/canvas-node-placement.ts:120`）在任务锁里先找已写的行，找到就原样返回它 —— 幂等，
 * 一分钱不多扣，一张卡不多建。而画布这一侧
 * （`components/canvas/FlowCanvas.tsx` 的 `onNewNode`）从前是无条件 `[...ns, 新卡]`：
 * 于是板子自己那份清单里出现了**两条同 id 的记录**。
 *
 * React Flow 的查找表按 id 去重，所以屏幕上仍然只有一张图 —— 但凡是**数**这份清单的东西
 * 全部翻倍，而那些数字就是商家看到的界面：
 *   ① 点一下那唯一一张卡，工具条（Edit with Otto · Create variations · Animate · Download · ⋯）
 *      整条消失，底部换成多选条「2 selected / Download 2」；
 *   ② 同批框（`canvasBatchGroups`）在一张卡外面画出「Batch of 2」—— 商家没买过的一批；
 *   ③ 在飞付费卡的计数把同一个任务算两次（`canvasJobActive` / `hasInFlightPaidNode`）。
 *
 * 所以判据在 id 上：板上已经有这张卡，就一个字都不动它 —— 它比这次摆放来得早，可能已经
 * 带着板读带回来的结算记录，而这次摆放只知道「一个任务被接受了」，永远不会更新。
 *
 * ## 这一份**没有**证成的事（如实登记）
 *
 * jsdom 里复现不出 React #185 本身。原因是环境而非产品：`act()` 里 React 的嵌套更新计数器
 * 不会跳闸（本地实证：一个故意写坏的 effect 循环在 vitest 里不是抛 #185，而是把 worker 跑成
 * JS heap out of memory）。下面钉的是这条路径上**能当场演示**的那半：重放之后板上还是一张卡，
 * 界面不再报两张。
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
  generateImage: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastMessage: vi.fn(),
  captured: {} as {
    onNode?: (node: Record<string, unknown>) => void;
    onResolve?: (id: string, url: string | null, status: string, generationId?: string) => void;
  },
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

// 付费那条路换成把手：这个文件里的任何一条断言都花不出一个 credit。`onNode` / `onResolve` 是
// `useCanvasGen` 交给画板的**真**回调，这里只把它们接出来，好按服务端重放的时序去按。
vi.mock("@/components/canvas/useCanvasGen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/canvas/useCanvasGen")>();
  return {
    ...actual,
    useCanvasGen: (
      _projectId: string,
      onNode: (node: Record<string, unknown>) => void,
      onResolve: (id: string, url: string | null, status: string, generationId?: string) => void,
    ) => {
      mocks.captured.onNode = onNode;
      mocks.captured.onResolve = onResolve;
      return {
        generateImage: mocks.generateImage,
        animate: vi.fn(),
        generateVideoFromText: vi.fn(),
        quoteCosts: mocks.quoteCosts,
        imageShapes: mocks.imageShapes,
        videoSpecs: mocks.videoSpecs,
        cancelledRef: { current: false },
      };
    },
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
  threadId: "t1",
  url: `https://cdn.example/${id}.png`,
  mediaWidth: null,
  mediaHeight: null,
  lineage: null,
  ...overrides,
});

/** 服务端重放同一个已接受的任务时，`createCanvasNode` 交回来的那一份（同一行、同一个 id）。 */
const replayedPlacement = (id: string, genJobId: string) => ({
  id,
  type: "image" as const,
  pos: { x: 0, y: 0, w: 320, h: 320 },
  status: "queued",
  prompt: "a cup steaming",
  genJobId,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** jsdom 把每个元素都量成 0×0；React Flow 不肯在零尺寸的板上挂载。 */
const sizedRect = () => ({
  width: 1280, height: 800, top: 0, left: 0, right: 1280, bottom: 800, x: 0, y: 0,
  toJSON: () => ({}),
}) as DOMRect;

beforeEach(() => {
  mocks.boardRead.mockResolvedValue([]);
  mocks.quoteCosts.mockResolvedValue({ imageCredits: 8, videoCredits: 80 });
  mocks.imageShapes.mockResolvedValue({ options: ["1:1"], defaultAspect: "1:1", fineDetail: null });
  mocks.videoSpecs.mockResolvedValue({
    menu: { durations: [5], resolutions: ["720p"], aspectRatios: ["16:9", "adaptive"] },
    t2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "16:9" },
    i2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "adaptive" },
    creditsFor: () => 11,
    elementReferences: true,
  });
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("DOMMatrixReadOnly", class {
    m22 = 1;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(sizedRect);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  mocks.captured.onNode = undefined;
  mocks.captured.onResolve = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderBoard(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(FlowCanvas, {
      projectId: "p1",
      skin: "gb" as const,
      activeThreadId: "t1",
    }));
  });
  await act(async () => { await Promise.resolve(); });
}

function cardBody(nodeId: string): HTMLElement {
  const el = container!.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"] .al-panel`);
  expect(el, `React Flow rendered no card for ${nodeId}`).not.toBeNull();
  return el!;
}

/** 真的一下点击 —— React Flow v12 听的是这串 pointer 事件，选中判定就长在里面。 */
async function pressCard(nodeId: string): Promise<void> {
  const el = cardBody(nodeId);
  await act(async () => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    await Promise.resolve();
  });
}

/** 屏幕上此刻能按到的控件（工具条与底部那条都在内）。 */
function controlLabels(): string[] {
  return [...document.querySelectorAll("button")]
    .map((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim())
    .filter(Boolean);
}

function batchFrameCount(): number {
  return container!.querySelectorAll('[data-id^="batch-frame"]').length;
}

describe("R3-F28 · 服务端重放同一张卡，板上还是一张", () => {
  it("重放之后点那张卡，读到的是「一张卡的工具条」，不是「2 selected」", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1", { genJobId: "job1" })]);
    await renderBoard();

    // 第二个标签页按下已经批准过的那张确认卡：服务端幂等地答回**同一行**。
    await act(async () => {
      mocks.captured.onNode?.(replayedPlacement("n1", "job1"));
      await Promise.resolve();
    });

    await pressCard("n1");
    const labels = controlLabels();
    // 一张卡被选中 ⇒ 卡自己的工具条在，多选条不在。
    expect(labels).toContain("Create variations");
    expect(labels.some((label) => label.startsWith("Download 2"))).toBe(false);
    expect(labels).not.toContain("Clear");
  });

  it("重放不会凭空画出一批「Batch of 2」", async () => {
    mocks.boardRead.mockResolvedValue([
      boardRow("n0", { genJobId: "job0" }),
      boardRow("n1", { x: 340, genJobId: "job1", madeFromNodeId: "n0", batchIndex: 0, batchSize: 2 }),
    ]);
    await renderBoard();
    expect(batchFrameCount()).toBe(0);

    await act(async () => {
      mocks.captured.onNode?.(replayedPlacement("n1", "job1"));
      await Promise.resolve();
    });

    expect(batchFrameCount()).toBe(0);
    expect(container!.textContent).not.toContain("Batch of 2");
  });

  it("重放之后这张卡照旧按得动 Animate（工具条与它记着的 generationId 都还在）", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1", { genJobId: "job1" })]);
    await renderBoard();

    await act(async () => {
      mocks.captured.onNode?.(replayedPlacement("n1", "job1"));
      await Promise.resolve();
    });

    await pressCard("n1");
    // Animate 读的是 `nodeDataRef` 里那张卡的 generationId：抹掉了就会弹
    // "This image is not ready for video yet."，而这张卡明明已经出好了。
    const animate = [...document.querySelectorAll("button")]
      .find((b) => (b.getAttribute("aria-label") ?? "") === "Animate");
    expect(animate, "no Animate control on the picked card").toBeTruthy();
    await act(async () => {
      animate!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      await Promise.resolve();
    });
    expect(mocks.toastError).not.toHaveBeenCalledWith("This image is not ready for video yet.");
  });

  it("真的新卡照旧摆得上去（守卫没有把正常那条路一起关掉）", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1", { genJobId: "job1" })]);
    await renderBoard();

    await act(async () => {
      mocks.captured.onNode?.({ ...replayedPlacement("n2", "job2"), pos: { x: 340, y: 0, w: 320, h: 320 } });
      await Promise.resolve();
    });

    expect(container!.querySelector('.react-flow__node[data-id="n2"]')).not.toBeNull();
  });
});

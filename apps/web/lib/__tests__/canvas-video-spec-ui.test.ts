// @vitest-environment jsdom
/**
 * #645 T4 —— 画布上「这条片子是什么规格」，从界面一路到付费请求。
 *
 * 镜像 #643 T2 的图片形状那一套，因为病是同一种：界面上写着一件事，发出去的是另一件。
 * 视频比图片多一层危险 —— **规格会改价**：10 秒的片子是 5 秒的两倍钱。所以这里除了断言
 * 「显示的形状 = 发出去的形状」，还必须断言「显示的价格 = 预扣的价格」。
 *
 * 全程驱动**真** FlowCanvas，只把付费函数换成假件。一个积分都花不出去。
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
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastMessage: vi.fn(),
  flow: { current: null as null | FlowProps },
  actionSeq: { current: 0 },
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
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess, message: mocks.toastMessage },
}));
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/otto/OttoTrace", () => ({ OttoCanvasStatus: () => null }));
// 真输入框换成一个受控的小替身：composer 的提交路径需要一段真 prompt 才走得下去。
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
  // 每铸一个动作身份就换一个号，且「上一个动作还悬着」——于是「同一个动作的重试」与
  // 「另一个动作」在断言里区分得开（这正是形状要不要进材料的那条判据）。
  freshCanvasActionId: () => `canvas-action-${++mocks.actionSeq.current}`,
  loadCanvasActionReceipts: () => [{ actionId: `canvas-action-${mocks.actionSeq.current}` }],
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

/** 服务端解析的八格菜单（default-first）—— 与 GEN_IMAGE_MODEL_OPTIONS 同序。 */
const MENU = ["1:1", "9:16", "16:9", "4:3", "3:4", "3:2", "2:3", "21:9"];

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
  mocks.imageShapes.mockResolvedValue({ options: MENU, defaultAspect: "1:1" });
  mocks.videoSpecs.mockResolvedValue({
    menu: { durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutions: ["720p", "480p"], aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"] },
    t2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "16:9" },
    i2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "adaptive" },
    creditsFor: ({ seconds, resolution }: { seconds: number; resolution: string }) =>
      Math.ceil((seconds * (resolution === "480p" ? 11 : 22)) / 10),
  });
  mocks.generateImage.mockResolvedValue(true);
  mocks.animate.mockResolvedValue(true);
  mocks.generateVideoFromText.mockResolvedValue(true);
  mocks.actionSeq.current = 0;
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

async function pick(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** React 会覆写 value 的 setter 来记录「上一次的值」，直接赋值会让它以为什么都没变而吞掉
 *  这次输入。走原型上的原生 setter 才是真的「商家打了几个字」。 */
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
  descriptor?.set?.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 服务端解析的视频规格菜单 —— 与 GEN_VIDEO_MODEL_OPTIONS["seedance-2-fast"] 同序。 */
const DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const RESOLUTIONS = ["720p", "480p"];
const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"];

/** Founder 已裁的按秒表（同 packages/core 的 video-tiers.test.ts）。 */
const FOUNDER_CREDITS: Record<string, number> = {
  "720p:4": 9, "720p:5": 11, "720p:6": 14, "720p:7": 16, "720p:8": 18, "720p:9": 20,
  "720p:10": 22, "720p:11": 25, "720p:12": 27, "720p:13": 29, "720p:14": 31, "720p:15": 33,
  "480p:4": 5, "480p:5": 6, "480p:6": 7, "480p:7": 8, "480p:8": 9, "480p:9": 10,
  "480p:10": 11, "480p:11": 13, "480p:12": 14, "480p:13": 15, "480p:14": 16, "480p:15": 17,
};

function specSelect(label: "Length" | "Quality" | "Shape"): HTMLSelectElement {
  const found = document.querySelector<HTMLSelectElement>(`select[aria-label="${label.toLowerCase()} of the video"]`)
    ?? document.querySelector<HTMLSelectElement>(`select[aria-label="${label} of the video"]`);
  expect(found, `规格选择器「${label}」应该在屏幕上`).not.toBeNull();
  return found!;
}

/** 对话框渲染在 portal 里，所以从 document 取而不是 container。 */
function dialogText(): string {
  return document.body.textContent ?? "";
}

async function openT2v(): Promise<void> {
  const button = container!.querySelector<HTMLButtonElement>('button[aria-label="Video"]');
  expect(button, "底部工具条应该有出片按钮").not.toBeNull();
  await act(async () => { button!.click(); });
  await act(async () => { await Promise.resolve(); });
}

describe("#645 T4 画布出片：规格从界面一路到付费请求", () => {
  it("规格菜单来自服务端解析的那一份 —— 界面一格都不写死", async () => {
    await renderBoard();
    await openT2v();
    expect([...specSelect("Length").options].map((o) => o.value)).toEqual(DURATIONS.map(String));
    expect([...specSelect("Quality").options].map((o) => o.value)).toEqual(RESOLUTIONS);
    expect([...specSelect("Shape").options].map((o) => o.value)).toEqual(ASPECTS);
  });

  it("t2v 默认档 = 720p / 5 秒 / 16:9,与扩容前逐字一致", async () => {
    await renderBoard();
    await openT2v();
    expect(specSelect("Length").value).toBe("5");
    expect(specSelect("Quality").value).toBe("720p");
    expect(specSelect("Shape").value).toBe("16:9");
  });

  it("adaptive 在卡面如实显示为 Adaptive —— 绝不冒充某个具体比例", async () => {
    await renderBoard();
    await openT2v();
    const shape = specSelect("Shape");
    const adaptiveOption = [...shape.options].find((o) => o.value === "adaptive")!;
    expect(adaptiveOption.textContent).toBe("Adaptive");
    // 菜单上不许出现一个「adaptive 就是 16:9」之类的谎。
    expect(adaptiveOption.textContent).not.toMatch(/\d+:\d+/);
  });

  it("价格跟着商家选中的那一档走 —— 换成 10 秒,卡面价格当场变成 22 credits", async () => {
    await renderBoard();
    await openT2v();
    expect(dialogText()).toContain("11 credits"); // 默认档 720p/5s
    await pick(specSelect("Length"), "10");
    expect(dialogText()).toContain("22 credits");
    await pick(specSelect("Quality"), "480p");
    expect(dialogText()).toContain("11 credits");
  });

  it("屏幕上那一档就是发出去的那一档(时长/清晰度/形状三项都带上)", async () => {
    await renderBoard();
    await openT2v();
    await pick(specSelect("Length"), "12");
    await pick(specSelect("Quality"), "480p");
    await pick(specSelect("Shape"), "9:16");
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    typeInto(textarea, "a cup steaming");
    await act(async () => { await Promise.resolve(); });
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => (b.textContent ?? "").includes("Make video"));
    await act(async () => { confirm!.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(mocks.generateVideoFromText).toHaveBeenCalledTimes(1);
    const options = mocks.generateVideoFromText.mock.calls[0]![4] as { spec?: unknown };
    expect(options.spec).toEqual({ seconds: 12, resolution: "480p", aspectRatio: "9:16" });
  });

  it("Founder 已裁的全表:每一档在卡面上报的价 = 那张表上的数", async () => {
    await renderBoard();
    await openT2v();
    for (const resolution of RESOLUTIONS) {
      await pick(specSelect("Quality"), resolution);
      for (const seconds of DURATIONS) {
        await pick(specSelect("Length"), String(seconds));
        const expected = FOUNDER_CREDITS[`${resolution}:${seconds}`]!;
        expect(dialogText(), `${seconds}s ${resolution} 卡面价格`).toContain(`${expected} credits`);
      }
    }
  });
});

describe("#645 T4 画布 Animate(带首帧):形状默认跟着首帧走", () => {
  /** 打开某张图片卡的「Make video」确认框。 */
  async function openAnimate(nodeId: string): Promise<void> {
    const button = [...container!.querySelectorAll<HTMLButtonElement>(`[data-node="${nodeId}"] button`)]
      .find((b) => (b.textContent ?? "").trim() === "Make video") ?? null;
    expect(button, "图片卡上应该有 Make video").not.toBeNull();
    await act(async () => { button!.click(); });
    await act(async () => { await Promise.resolve(); });
  }

  it("i2v 默认形状 = Adaptive —— 引擎跟着首帧走,不替商家改画幅", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();
    select(["n1"]);
    await openAnimate("n1");
    expect(specSelect("Shape").value).toBe("adaptive");
    // 长度/清晰度两条路一致,只有形状分开处理。
    expect(specSelect("Length").value).toBe("5");
    expect(specSelect("Quality").value).toBe("720p");
  });

  it("屏幕上那一档就是发出去的那一档,价格也跟着走", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();
    select(["n1"]);
    await openAnimate("n1");
    await pick(specSelect("Length"), "8");
    await pick(specSelect("Quality"), "480p");
    expect(dialogText()).toContain("9 credits"); // 480p 8s = ceil(8.8) = 9

    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => (b.textContent ?? "").trim() === "Make video" && !b.closest("[data-node]"));
    await act(async () => { confirm!.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(mocks.animate).toHaveBeenCalledTimes(1);
    const options = mocks.animate.mock.calls[0]![6] as { spec?: unknown };
    expect(options.spec).toEqual({ seconds: 8, resolution: "480p", aspectRatio: "adaptive" });
  });
});

// ---------------------------------------------------------------------------
// #645 T4(判官 r1 P2-2)—— Adaptive 的提示文案按场景分立
// ---------------------------------------------------------------------------
//
// Adaptive 在两条路上是**两件事**:没有源图(t2v)时引擎按描述智能挑一个比例;
// 有源图(Animate)时跟着源图就近。原来两处共用一句「follows the source image」——
// 在 t2v 的框里那句话是错的:那个框明说了「no source image needed」。
describe("#645 T4:Adaptive 的说明按场景说准", () => {
  function shapeTitle(): string {
    const el = document.querySelector('select[aria-label="Shape of the video"]');
    expect(el, "形状选择器应该在屏幕上").not.toBeNull();
    return el!.getAttribute("title") ?? "";
  }

  async function openAnimateOn(nodeId: string): Promise<void> {
    const button = [...container!.querySelectorAll<HTMLButtonElement>(`[data-node="${nodeId}"] button`)]
      .find((b) => (b.textContent ?? "").trim() === "Make video") ?? null;
    expect(button, "图片卡上应该有 Make video").not.toBeNull();
    await act(async () => { button!.click(); });
    await act(async () => { await Promise.resolve(); });
  }

  it("t2v(没有源图)⇒ 说的是「按你的描述挑一个形状」,不许提源图", async () => {
    await renderBoard();
    await openT2v();
    const title = shapeTitle();
    expect(title).toContain("Adaptive picks a shape to suit your description");
    expect(title.toLowerCase()).not.toContain("source image");
  });

  it("Animate(有源图)⇒ 说的是「跟着你的源图」", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();
    select(["n1"]);
    await openAnimateOn("n1");
    expect(shapeTitle()).toContain("Adaptive keeps the shape of your source image");
  });

  it("两句文案确实不同 —— 不是同一句话到处贴", async () => {
    await renderBoard();
    await openT2v();
    const t2v = shapeTitle();
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();
    select(["n1"]);
    await openAnimateOn("n1");
    expect(shapeTitle()).not.toBe(t2v);
  });
});

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
vi.mock("@/components/ui/toast", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess, message: mocks.toastMessage },
}));
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/otto/OttoTrace", () => ({ OttoCanvasStatus: () => null }));
// 真输入框换成一个受控的小替身：composer 的提交路径需要一段真 prompt 才走得下去。
// #785：替身也认 `@id` —— 真的 MentionInput 把 @ 出来的元素当第二个回调参数交出去，
// 出片框里那一组元素是要真的进引擎的，所以替身必须能表达它，否则那条路测不到。
vi.mock("@/components/MentionInput", () => ({
  MentionInput: ({
    onChange,
    disabled,
  }: {
    onChange?: (t: string, ids: string[], vsel: Record<string, string>) => void;
    disabled?: boolean;
  }) =>
    createElement("textarea", {
      "data-testid": "mention",
      disabled,
      onChange: (e: { target: { value: string } }) =>
        onChange?.(e.target.value, [...e.target.value.matchAll(/@([\w-]+)/g)].map((m) => m[1]!), {}),
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
const { videoShapeHint } = await import("@/components/gen/VideoSpecPicker");

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
    // #785：服务端解析的「@元素这一趟真的会进引擎吗」。现役路(生产)为 true。
    elementReferences: true,
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
      projectId: "p1", skin: "gb" as const, ...props,
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

/** 服务端解析的视频规格菜单 —— 与 GEN_VIDEO_MODEL_OPTIONS["seedance-2-mini"] 同序。 */
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

  it("t2v 请求还在接受时，确认键立即显示进度，并锁住提示词与规格", async () => {
    let finish: ((accepted: boolean) => void) | undefined;
    mocks.generateVideoFromText.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    await renderBoard();
    await openT2v();
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="mention"]')!;
    typeInto(textarea, "a cup steaming in morning light");
    await act(async () => { await Promise.resolve(); });
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => (button.textContent ?? "").trim() === "Make video")!;

    await act(async () => { confirm.click(); });

    expect(confirm.disabled).toBe(true);
    expect(confirm.textContent).toContain("Starting video…");
    expect(confirm.querySelector('[aria-label="Loading"]')).not.toBeNull();
    expect(textarea.disabled).toBe(true);
    expect([specSelect("Length"), specSelect("Quality"), specSelect("Shape")]
      .every((select) => select.disabled)).toBe(true);
    const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => (button.textContent ?? "").trim() === "Cancel")!;
    expect(cancel.disabled).toBe(true);

    await act(async () => {
      finish?.(true);
      await Promise.resolve();
    });
  });

  // -------------------------------------------------------------------------
  // #785 —— 出片框现在也能 @ 元素,而 @ 到的元素**真的进引擎**(worker 把它们的参考照
  // 发成 reference_image 部件)。所以这里守两件事:
  //   ① 屏幕上 @ 的那一组,就是发出去的那一组(与规格同一条「说的=做的」);
  //   ② @ 换了人 ⇒ 换一个动作身份 —— @ 了产品之后再 @ 代言人不是同一个动作的重试,
  //      把它当重试会让商家按下的第二次授权被吞掉。
  // -------------------------------------------------------------------------
  it("#785: 出片框 @ 到的元素跟着付费请求一起走", async () => {
    await renderBoard();
    await openT2v();
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    typeInto(textarea, "our @prod-1 held by @face-2 on a beach");
    await act(async () => { await Promise.resolve(); });
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => (b.textContent ?? "").includes("Make video"));
    await act(async () => { confirm!.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(mocks.generateVideoFromText).toHaveBeenCalledTimes(1);
    const options = mocks.generateVideoFromText.mock.calls[0]![4] as { entityIds?: string[] };
    expect(options.entityIds).toEqual(["prod-1", "face-2"]);
  });

  it("#785: 换了 @ 的元素 ⇒ 换一个动作身份(不是同一个动作的重试)", async () => {
    await renderBoard();
    await openT2v();
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const confirm = () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => (b.textContent ?? "").includes("Make video"))!;

    typeInto(textarea, "our @prod-1 on a beach");
    await act(async () => { await Promise.resolve(); });
    await act(async () => { confirm().click(); });
    await act(async () => { await Promise.resolve(); });

    // 第二次:重新开框(与商家真实的第二次操作一致),只把 @ 的人换掉,提示词其余不变。
    await openT2v();
    const textarea2 = document.querySelector<HTMLTextAreaElement>("textarea")!;
    typeInto(textarea2, "our @face-2 on a beach");
    await act(async () => { await Promise.resolve(); });
    await act(async () => { confirm().click(); });
    await act(async () => { await Promise.resolve(); });

    expect(mocks.generateVideoFromText).toHaveBeenCalledTimes(2);
    const first = mocks.generateVideoFromText.mock.calls[0]![2] as string;
    const second = mocks.generateVideoFromText.mock.calls[1]![2] as string;
    expect(second).not.toBe(first);
  });

  // -------------------------------------------------------------------------
  // 判官 r2 P1-a —— 那句 “Type @ to bring your products and people into the clip” 是一句
  // **承诺**。执行层收不了元素照的那条路上,它就是替一件做不到的事许诺:商家照着它去 @,
  // 付了钱,拿回一支跟他的产品毫无关系的片子。所以承诺跟着服务端解析的那个事实走。
  // -------------------------------------------------------------------------
  const T2V_PROMISE = "Type @ to bring your products and people into the clip";

  it("#785: 执行层真收元素照 ⇒ 出片框才说那句 @ 的承诺", async () => {
    await renderBoard();
    await openT2v();
    expect(document.body.textContent).toContain(T2V_PROMISE);
    expect(document.querySelector<HTMLTextAreaElement>("textarea")).not.toBeNull();
  });

  it("#785: 执行层收不了元素照 ⇒ 出片框一个字都不提 @(不替它许诺)", async () => {
    mocks.videoSpecs.mockResolvedValue({
      menu: { durations: DURATIONS, resolutions: RESOLUTIONS, aspectRatios: ASPECTS },
      t2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "16:9" },
      i2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "adaptive" },
      creditsFor: () => 11,
      elementReferences: false,
    });
    await renderBoard();
    await openT2v();
    expect(document.body.textContent).not.toContain(T2V_PROMISE);
    // 出片这件事本身照旧做得了 —— 少的只有那句承诺。
    expect(document.body.textContent).toContain("Describe the video you want");
  });

  it("#785: 规格菜单根本没取到 ⇒ 同样不许说那句承诺(没确认的事不许说)", async () => {
    mocks.videoSpecs.mockRejectedValue(new Error("menu unavailable"));
    await renderBoard();
    await openT2v();
    expect(document.body.textContent).not.toContain(T2V_PROMISE);
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
  /** 打开某张图片卡的「Animate」确认框。 */
  async function openAnimate(nodeId: string): Promise<void> {
    const button = [...container!.querySelectorAll<HTMLButtonElement>(`[data-node="${nodeId}"] button`)]
      .find((b) => (b.textContent ?? "").trim() === "Animate") ?? null;
    expect(button, "图片卡上应该有 Animate").not.toBeNull();
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

  it("i2v 请求还在接受时，确认键显示进度，并锁住动作与规格", async () => {
    let finish: ((accepted: boolean) => void) | undefined;
    mocks.animate.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();
    select(["n1"]);
    await openAnimate("n1");
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => (button.textContent ?? "").trim() === "Make video" && !button.closest("[data-node]"))!;

    await act(async () => { confirm.click(); });

    expect(confirm.disabled).toBe(true);
    expect(confirm.textContent).toContain("Starting video…");
    expect(confirm.querySelector('[aria-label="Loading"]')).not.toBeNull();
    expect([specSelect("Length"), specSelect("Quality"), specSelect("Shape")]
      .every((select) => select.disabled)).toBe(true);
    const motionButtons = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Camera motion"] button')];
    expect(motionButtons).toHaveLength(3);
    expect(motionButtons.every((button) => button.disabled)).toBe(true);

    await act(async () => {
      finish?.(true);
      await Promise.resolve();
    });
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
      .find((b) => (b.textContent ?? "").trim() === "Animate") ?? null;
    expect(button, "图片卡上应该有 Animate").not.toBeNull();
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

  it("两句文案确实不同,且都不提引擎名 —— 不是同一句话到处贴", async () => {
    // 这一条断在纯函数上:两个 DOM 用例已经证明了各自的框拿到哪一句,这里证明那两句
    // 本身确实是两句话(共用一句正是判官抓到的那个缺陷)。
    const withImage = videoShapeHint(true);
    const withoutImage = videoShapeHint(false);
    expect(withImage).not.toBe(withoutImage);
    expect(withoutImage.toLowerCase()).not.toContain("source image");
    for (const copy of [withImage, withoutImage]) {
      expect(copy.toLowerCase()).not.toMatch(/seedance|byteplus|fal\.|veo|kling/);
    }
  });
});

// ---------------------------------------------------------------------------
// CREATE-A3(§8.2 批 II,2026-09-04,触发＝Codex QA-CRE-001)—— 画布两条视频路的声音开关
// ---------------------------------------------------------------------------
//
// 阶段一(PR #1133)只在资产详情 Animate 那条路开了这一格,画布两条路当时把 audio 整个
// 丢掉(`clampVideoSpec` 只重建三格、`useCanvasGen.ts` 的请求体也只展开那三格),所以判官
// 当时裁定「不展示死开关」—— 一个能拨、收钱、无效的假控件比没有开关更贵。
//
// Codex 的只读走查(QA-CRE-001,真浏览器,job 01M1MBH5W162TQZ745K4PSN6VP)证实了后果:
// 画布出片框只有时长/清晰度/形状三格,商家在提示词里写「完全静音」照样拿回一条带 AAC
// 音轨的 MP4。批 II 把 clamp 与两处请求体收口之后,这个 describe 从「不许有」翻成
// 「必须有,而且拨了真的算数」—— 围栏的另一半(源码级)在 video-audio-toggle.test.ts,
// 提交路那一半在 canvas-video-audio-submit.test.ts。
describe("CREATE-A3:画布两条视频路的声音开关", () => {
  function soundSwitch(): Element | null {
    return document.querySelector('[role="switch"][aria-label="Sound"]');
  }

  async function openAnimateOn(nodeId: string): Promise<void> {
    const button = [...container!.querySelectorAll<HTMLButtonElement>(`[data-node="${nodeId}"] button`)]
      .find((b) => (b.textContent ?? "").trim() === "Animate") ?? null;
    expect(button, "图片卡上应该有 Animate").not.toBeNull();
    await act(async () => { button!.click(); });
    await act(async () => { await Promise.resolve(); });
  }

  function confirmButton(): HTMLButtonElement {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => (b.textContent ?? "").trim() === "Make video" && !b.closest("[data-node]"));
    expect(found, "弹窗上应该有「Make video」").toBeDefined();
    return found!;
  }

  async function toggleSound(): Promise<void> {
    const toggle = soundSwitch();
    expect(toggle, "规格选择器上应该有声音开关").not.toBeNull();
    await act(async () => { (toggle as HTMLElement).click(); });
    await act(async () => { await Promise.resolve(); });
  }

  async function typePrompt(text: string): Promise<void> {
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="mention"]')!;
    typeInto(textarea, text);
    await act(async () => { await Promise.resolve(); });
  }

  it("CREATE-A3:t2v 弹窗有声音开关,默认开,并在屏幕上写明它不影响报价", async () => {
    await renderBoard();
    await openT2v();
    expect(specSelect("Length"), "会改价的三格照常在").not.toBeNull();
    expect(soundSwitch(), "画布 t2v 已接线,必须有声音开关").not.toBeNull();
    expect(soundSwitch()!.getAttribute("aria-checked"), "默认开").toBe("true");
    // 「界面明示」= 这句话真的在屏幕上,不是只藏在悬浮态里。
    expect(dialogText()).toContain("Sound doesn't change the price");
  });

  it("CREATE-A3:Animate 弹窗有声音开关,默认开", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();
    select(["n1"]);
    await openAnimateOn("n1");
    expect(specSelect("Shape")).not.toBeNull();
    expect(soundSwitch(), "画布 Animate 已接线,必须有声音开关").not.toBeNull();
    expect(soundSwitch()!.getAttribute("aria-checked")).toBe("true");
    expect(dialogText()).toContain("Sound doesn't change the price");
  });

  it("CREATE-A3:t2v 关掉声音 ⇒ 付费调用带 spec.audio=false(与另三格并存)", async () => {
    await renderBoard();
    await openT2v();
    await pick(specSelect("Length"), "12");
    await pick(specSelect("Quality"), "480p");
    await toggleSound();
    expect(soundSwitch()!.getAttribute("aria-checked")).toBe("false");
    await typePrompt("a cup steaming");
    await act(async () => { confirmButton().click(); });
    await act(async () => { await Promise.resolve(); });

    expect(mocks.generateVideoFromText).toHaveBeenCalledTimes(1);
    const options = mocks.generateVideoFromText.mock.calls[0]![4] as { spec?: Record<string, unknown> };
    expect(options.spec).toEqual({ seconds: 12, resolution: "480p", aspectRatio: "16:9", audio: false });
  });

  it("CREATE-A3:Animate 关掉声音 ⇒ 付费调用带 spec.audio=false", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();
    select(["n1"]);
    await openAnimateOn("n1");
    await toggleSound();
    await act(async () => { confirmButton().click(); });
    await act(async () => { await Promise.resolve(); });

    expect(mocks.animate).toHaveBeenCalledTimes(1);
    const options = mocks.animate.mock.calls[0]![6] as { spec?: Record<string, unknown> };
    expect(options.spec).toEqual({ seconds: 5, resolution: "720p", aspectRatio: "adaptive", audio: false });
  });

  it("CREATE-A3:没碰过开关 ⇒ 规格里一格 audio 都不出现(与接线之前逐字一样)", async () => {
    await renderBoard();
    await openT2v();
    await typePrompt("a cup steaming");
    await act(async () => { confirmButton().click(); });
    await act(async () => { await Promise.resolve(); });

    const options = mocks.generateVideoFromText.mock.calls[0]![4] as { spec?: Record<string, unknown> };
    expect(options.spec).toEqual({ seconds: 5, resolution: "720p", aspectRatio: "16:9" });
    expect(Object.hasOwn(options.spec!, "audio"), "没拨过就不该出现这一格").toBe(false);
  });

  it("CREATE-A3:拨开关时卡面报价一格不动 —— 价目表的键里根本没有声音", async () => {
    await renderBoard();
    await openT2v();
    expect(dialogText()).toContain("11 credits"); // 默认档 720p/5s
    await toggleSound();
    expect(dialogText(), "关掉声音不该改动屏幕上那个价").toContain("11 credits");
    await toggleSound();
    expect(dialogText()).toContain("11 credits");
    // 会改价的那一格照常改价 —— 两件事互不干扰。
    await pick(specSelect("Length"), "10");
    expect(dialogText()).toContain("22 credits");
  });

  // 幂等键这一条:画布的动作身份由 material JSON 决定(`FlowCanvas.tsx` 的 videoActionRef),
  // 而服务端的幂等键 = `canvasActionKey(actionId)`。所以「声音进材料」= 「开与关是两个意图、
  // 两个键」。用**没被受理**的提交来断,是为了把「材料没变 ⇒ 同一个身份」也一并钉住:受理
  // 之后身份本来就该换,那样断不出声音有没有进材料。
  it("CREATE-A3:材料没变 ⇒ 同一个动作身份;只把声音拨掉 ⇒ 换身份、换幂等键", async () => {
    const { canvasActionKey } = await import("../batch-idempotency");
    // 没被受理(outcome 未知那一族)⇒ 身份保留,下一次点击是**同一个动作的重试**。
    mocks.generateVideoFromText.mockResolvedValue(false);
    await renderBoard();
    await openT2v();
    await typePrompt("a cup steaming");

    await act(async () => { confirmButton().click(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { confirmButton().click(); });
    await act(async () => { await Promise.resolve(); });

    const first = mocks.generateVideoFromText.mock.calls[0]![2] as string;
    const retry = mocks.generateVideoFromText.mock.calls[1]![2] as string;
    expect(retry, "什么都没改的第二次点击 = 同一个动作的重试").toBe(first);

    // 只拨声音,别的一格不动。
    await toggleSound();
    await act(async () => { confirmButton().click(); });
    await act(async () => { await Promise.resolve(); });

    const soundOff = mocks.generateVideoFromText.mock.calls[2]![2] as string;
    expect(soundOff, "只把声音拨掉 ⇒ 另一个意图 ⇒ 另一个动作身份").not.toBe(first);
    expect(canvasActionKey(soundOff).key).not.toBe(canvasActionKey(first).key);
    expect((mocks.generateVideoFromText.mock.calls[2]![4] as { spec?: Record<string, unknown> }).spec)
      .toMatchObject({ audio: false });
  });
});

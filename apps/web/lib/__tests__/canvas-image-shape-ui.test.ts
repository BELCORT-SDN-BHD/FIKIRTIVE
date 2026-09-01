// @vitest-environment jsdom
/**
 * #643 T2 —— 画布上「这次出图是什么形状」，从界面一路到付费请求。
 *
 * 三个入口住在同一块板子上，而它们的病也是同一种：界面上写着一件事，发出去的是另一件。
 * 所以这里全程驱动**真** FlowCanvas + 真 ImageNode，只把付费函数换成假件 —— 断言看的是
 * 「界面显示了什么」与「真的会发出去什么」两头，中间任何一段接线断掉都会红。
 *
 * 一个积分都花不出去：`generateImage` 是 vi.fn()。
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
      onChange: (e: { target: { value: string } }) => onChange?.(e.target.value, [], {}),
    }),
}));

vi.mock("@/components/canvas/useCanvasGen", () => ({
  useCanvasGen: () => ({
    generateImage: mocks.generateImage,
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

/** 一张卡自己记着的形状，就是板子读回来的 lineage.settings.aspectRatio。 */
const lineageWithShape = (aspectRatio: string | null) => ({
  madeAtLabel: "Today, 10:00",
  settings: { durationSeconds: null, resolution: null, aspectRatio },
  costCredits: 8,
  batchSize: 1,
  batchPosition: null,
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

function shapePickers(): HTMLSelectElement[] {
  return [...container!.querySelectorAll<HTMLSelectElement>("select")]
    .filter((s) => (s.getAttribute("aria-label") ?? "").includes("Shape"));
}

/** 卡上的形状选择器（卡自己的那一条 bar 里）。 */
function cardShapePicker(nodeId: string): HTMLSelectElement {
  const found = container!.querySelector<HTMLSelectElement>(
    `[data-node="${nodeId}"] select[aria-label*="Shape"]`,
  );
  expect(found, "这张卡应该有一个形状选择器").not.toBeNull();
  return found!;
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

async function typePrompt(text: string): Promise<void> {
  const input = container!.querySelector<HTMLTextAreaElement>('[data-testid="mention"]');
  expect(input, "composer 应该有输入框").not.toBeNull();
  await act(async () => { typeInto(input!, text); });
}

/** 按下 Generate —— 走 composer 表单自己的提交路径。 */
async function submitComposer(): Promise<void> {
  const form = container!.querySelector<HTMLFormElement>("form.al-promptbar");
  expect(form, "composer 应该是一个表单").not.toBeNull();
  await act(async () => {
    form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => { await Promise.resolve(); });
}

function buttonsLabelled(text: string): HTMLButtonElement[] {
  return [...container!.querySelectorAll("button")].filter((b) => b.textContent === text);
}

// ---------------------------------------------------------------------------
// 入口①：画布文字出图（t2i）
// ---------------------------------------------------------------------------
describe("画布 t2i：形状在花钱之前就看得见、改得动", () => {
  it("菜单就是服务端给的那份，一格不多一格不少（界面不写死任何形状）", async () => {
    await renderBoard();
    const picker = shapePickers()[0];
    expect(picker, "输入条上应该有形状选择器").toBeDefined();
    expect([...picker!.options].map((o) => o.value)).toEqual(MENU);
  });

  it("默认选中的是服务端说的默认形状（1:1）—— 界面自己不编默认值", async () => {
    await renderBoard();
    expect(shapePickers()[0]!.value).toBe("1:1");
  });

  it("商家选了 9:16 ⇒ 付费请求里逐字带着 9:16（显示的 = 发出去的）", async () => {
    await renderBoard();
    await pick(shapePickers()[0]!, "9:16");
    await typePrompt("a poster for the weekend sale");
    await submitComposer();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    const options = mocks.generateImage.mock.calls[0]![5] as { aspectRatio?: string };
    expect(options.aspectRatio).toBe("9:16");
  });

  it("没动选择器 ⇒ 请求里带的是默认方图（今日行为不变）", async () => {
    await renderBoard();
    await typePrompt("a poster");
    await submitComposer();

    const options = mocks.generateImage.mock.calls[0]![5] as { aspectRatio?: string };
    expect(options.aspectRatio).toBe("1:1");
  });

  it("请求还在接受时，按钮立即说明正在启动，并锁住这次付费内容", async () => {
    let finish: ((accepted: boolean) => void) | undefined;
    mocks.generateImage.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    await renderBoard();

    const twoImages = container!.querySelector<HTMLButtonElement>('button[aria-label="Make 2 images"]');
    expect(twoImages).not.toBeNull();
    await act(async () => { twoImages!.click(); });
    await typePrompt("a two-image weekend campaign");

    const form = container!.querySelector<HTMLFormElement>("form.al-promptbar")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const pendingButton = [...form.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => (button.textContent ?? "").includes("Starting…"));
    expect(pendingButton).toBeDefined();
    expect(pendingButton!.disabled).toBe(true);
    expect(pendingButton!.querySelector('[aria-label="Loading"]')).not.toBeNull();
    expect(form.querySelector<HTMLTextAreaElement>('[data-testid="mention"]')!.disabled).toBe(true);
    expect(form.querySelector<HTMLSelectElement>('select[aria-label="Shape of the image"]')!.disabled).toBe(true);
    expect(form.querySelector<HTMLInputElement>('#canvas-coherent-set')!.disabled).toBe(true);
    expect([...form.querySelectorAll<HTMLButtonElement>('button[aria-label^="Make "]')]
      .every((button) => button.disabled)).toBe(true);

    await act(async () => {
      finish?.(true);
      await Promise.resolve();
    });
  });

  it("菜单读不到（服务端没答上来）⇒ 不渲染选择器，也不发一个界面自己编的形状", async () => {
    mocks.imageShapes.mockRejectedValue(new Error("nope"));
    await renderBoard();
    expect(shapePickers()).toHaveLength(0);

    await typePrompt("a poster");
    await submitComposer();
    const options = mocks.generateImage.mock.calls[0]![5] as { aspectRatio?: string };
    expect(options.aspectRatio).toBeUndefined();
  });

  it("换形状是**另一个**付费动作 —— 不是同一个动作的重试", async () => {
    // 结果未知（没被接受）时动作身份被保留，重按同一件事 = 同一个动作的重试；
    // 换了形状就必须是新的动作身份，否则商家的第二次按压会被幂等成第一次那一单，
    // 拿回一张他没要的形状。
    mocks.generateImage.mockResolvedValue(false);
    await renderBoard();

    await typePrompt("a poster");
    await submitComposer();
    const first = (mocks.generateImage.mock.calls[0]![5] as { actionId: string }).actionId;

    // 一模一样地再按一次 ⇒ 同一个动作。
    await submitComposer();
    const retry = (mocks.generateImage.mock.calls[1]![5] as { actionId: string }).actionId;
    expect(retry, "同样的文字 + 同样的形状 = 同一个动作的重试").toBe(first);

    // 只换形状 ⇒ 另一个动作。
    await pick(shapePickers()[0]!, "21:9");
    await submitComposer();
    const reshaped = mocks.generateImage.mock.calls[2]![5] as { actionId: string; aspectRatio?: string };
    expect(reshaped.aspectRatio).toBe("21:9");
    expect(reshaped.actionId, "换了形状就是另一个动作").not.toBe(first);
  });
});

// ---------------------------------------------------------------------------
// 入口②：改这张图 / 再来一张（带底图）
// ---------------------------------------------------------------------------
describe("画布「改这张图 / 再来一张」：默认继承这张卡的形状", () => {
  it("卡上显示的是它自己记着的形状（不是输入条的默认值）", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1", { lineage: lineageWithShape("9:16") })]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    expect(cardShapePicker("n1").value).toBe("9:16");
  });

  it("「再来一张」交付的就是卡上显示的那一格 —— 形状不被悄悄改掉", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1", { lineage: lineageWithShape("9:16") })]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { buttonsLabelled("More like this")[0]!.click(); });

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    const options = mocks.generateImage.mock.calls[0]![5] as { aspectRatio?: string; sourceGenerationId?: string };
    expect(options.aspectRatio).toBe("9:16");
    expect(options.sourceGenerationId).toBe("gen-n1");
  });

  it("「再来一张」还在接受时，只在这个按钮显示进度，并锁住同一张卡的付费内容", async () => {
    let finish: ((accepted: boolean) => void) | undefined;
    mocks.generateImage.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    mocks.boardRead.mockResolvedValue([boardRow("n1", { lineage: lineageWithShape("9:16") })]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    const variant = buttonsLabelled("More like this")[0]!;
    await act(async () => { variant.click(); });

    expect(variant.disabled).toBe(true);
    expect(variant.textContent).toContain("Starting…");
    expect(variant.querySelector('[aria-label="Loading"]')).not.toBeNull();
    expect(cardShapePicker("n1").disabled).toBe(true);
    const remakeInput = container!.querySelector<HTMLInputElement>(
      '[data-node="n1"] input[aria-label="Edit this image\'s prompt and make a new image"]',
    )!;
    expect(remakeInput.disabled).toBe(true);
    expect(remakeInput.closest("form")!.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);

    await act(async () => {
      finish?.(true);
      await Promise.resolve();
    });
  });

  it("商家在卡上换了形状 ⇒ 换的那一格才是交付的形状", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1", { lineage: lineageWithShape("9:16") })]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    await pick(cardShapePicker("n1"), "16:9");
    await act(async () => { buttonsLabelled("More like this")[0]!.click(); });

    const options = mocks.generateImage.mock.calls[0]![5] as { aspectRatio?: string };
    expect(options.aspectRatio).toBe("16:9");
  });

  it("改了词再送 ⇒ 同样带着卡上显示的那一格", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1", { lineage: lineageWithShape("4:3") })]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    const bar = container!.querySelector<HTMLInputElement>(
      `[data-node="n1"] input[aria-label="Edit this image's prompt and make a new image"]`,
    );
    expect(bar).not.toBeNull();
    await act(async () => { typeInto(bar!, "same cup, warmer light"); });
    await act(async () => {
      bar!.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const options = mocks.generateImage.mock.calls[0]![5] as { aspectRatio?: string };
    expect(options.aspectRatio).toBe("4:3");
  });

  it("编辑后重做只让送出箭头显示进度，不把旁边的「再来一张」冒充成发起者", async () => {
    let finish: ((accepted: boolean) => void) | undefined;
    mocks.generateImage.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    mocks.boardRead.mockResolvedValue([boardRow("n1", { lineage: lineageWithShape("4:3") })]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    const bar = container!.querySelector<HTMLInputElement>(
      '[data-node="n1"] input[aria-label="Edit this image\'s prompt and make a new image"]',
    )!;
    await act(async () => { typeInto(bar, "same cup, warmer light"); });
    await act(async () => {
      bar.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const submit = bar.closest("form")!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.getAttribute("aria-label")).toBe("Starting a new image");
    expect(submit.disabled).toBe(true);
    expect(submit.querySelector('[aria-label="Loading"]')).not.toBeNull();
    const variant = [...container!.querySelectorAll<HTMLButtonElement>('[data-node="n1"] button')]
      .find((button) => (button.textContent ?? "").includes("More like this"))!;
    expect(variant.disabled).toBe(true);
    expect(variant.textContent).toContain("More like this");
    expect(variant.textContent).not.toContain("Starting…");

    await act(async () => {
      finish?.(true);
      await Promise.resolve();
    });
  });

  it("老图（没有形状记录）⇒ 显示并交付默认方图 —— 那正是它们当年真的形状", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1", { lineage: lineageWithShape(null) })]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    expect(cardShapePicker("n1").value).toBe("1:1");
    await act(async () => { buttonsLabelled("More like this")[0]!.click(); });
    const options = mocks.generateImage.mock.calls[0]![5] as { aspectRatio?: string };
    expect(options.aspectRatio).toBe("1:1");
  });

  it("同一张卡上的两个按钮不许交付两种形状（「再来一张」与 bar 的送出同口径）", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1", { lineage: lineageWithShape("1:1") })]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    await pick(cardShapePicker("n1"), "2:3");
    await act(async () => { buttonsLabelled("More like this")[0]!.click(); });
    const viaButton = (mocks.generateImage.mock.calls[0]![5] as { aspectRatio?: string }).aspectRatio;

    const bar = container!.querySelector<HTMLInputElement>(
      `[data-node="n1"] input[aria-label="Edit this image's prompt and make a new image"]`,
    )!;
    await act(async () => { typeInto(bar, "another take"); });
    await act(async () => {
      bar.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const viaBar = (mocks.generateImage.mock.calls[1]![5] as { aspectRatio?: string }).aspectRatio;

    expect(viaButton).toBe("2:3");
    expect(viaBar).toBe("2:3");
  });
});

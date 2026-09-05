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
      projectId: "p1", skin: "gb" as const, ...props,
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

/**
 * 「Create variations」第一下只开确认卡（QA-CRE-FE9-001 / Founder 2026-09-04 07:05 裁决），
 * 所以形状这条链现在要按两下才走到付费请求：先开卡，再按卡上那颗 `Generate · N credits`。
 * 这颗键是**唯一**的付费入口，本文件的每条形状断言都从它后面读。
 */
function confirmVariantButton(): HTMLButtonElement {
  // 弹窗走 portal，落在 document.body 上，不在 container 里。
  const found = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    .find((b) => b.textContent?.startsWith("Generate · "));
  expect(found, "变体确认卡上没有 `Generate · N credits`").not.toBeUndefined();
  return found as HTMLButtonElement;
}

function buttonsLabelled(text: string): HTMLButtonElement[] {
  return [...container!.querySelectorAll("button")].filter((b) => b.textContent === text);
}

describe("画布「再来一张」：默认继承这张卡的形状", () => {
  it("卡上不再有第二个输入条、也不再有第二个形状选择器（Founder 2026-09-03 裁决①）", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1", { lineage: lineageWithShape("9:16") })]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    // 「改写提示词再出一张」这条路整条退场：改写走卡上的 Edit with Otto（Founder 2026-09-03
    // 裁决①）。已批准的设计里，被选中的卡下方没有第二个输入条，卡上也没有形状选择器。
    expect(
      container!.querySelectorAll('[data-node="n1"] input'),
      "卡上还留着一个输入条",
    ).toHaveLength(0);
    expect(
      container!.querySelector('[data-node="n1"] select[aria-label*="Shape"]'),
      "卡上还留着第二个形状选择器",
    ).toBeNull();
    // 能力没丢：改写从此走这颗键，卡交给 Otto 接着改。
    expect(buttonsLabelled("Edit with Otto").length).toBeGreaterThanOrEqual(1);
  });

  it("「再来一张」交付的就是这张卡自己记着的那一格 —— 形状不被悄悄改掉", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1", { lineage: lineageWithShape("9:16") })]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { buttonsLabelled("Create variations")[0]!.click(); });
    // 第一下只开确认卡 —— 这里还没有任何付费请求。
    expect(mocks.generateImage).not.toHaveBeenCalled();
    await act(async () => { confirmVariantButton().click(); });

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    const options = mocks.generateImage.mock.calls[0]![5] as { aspectRatio?: string; sourceGenerationId?: string };
    expect(options.aspectRatio).toBe("9:16");
    expect(options.sourceGenerationId).toBe("gen-n1");
  });

  it("「再来一张」还在接受时，就在这颗按钮上显示进度，并锁住这张卡的付费动作", async () => {
    let finish: ((accepted: boolean) => void) | undefined;
    mocks.generateImage.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    mocks.boardRead.mockResolvedValue([boardRow("n1", { lineage: lineageWithShape("9:16") })]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    const variant = buttonsLabelled("Create variations")[0]!;
    await act(async () => { variant.click(); });
    // 确认卡开着的时候这颗键还没被锁 —— 它还没花钱。锁是「按了 Generate」之后的事。
    expect(variant.disabled).toBe(false);
    await act(async () => { confirmVariantButton().click(); });

    expect(variant.disabled).toBe(true);
    // 图标键:进度就是图标位上的转圈(设计基线把文字收进 sr-only),不再有「Starting…」字样。
    expect(variant.querySelector('[aria-label="Loading"]')).not.toBeNull();

    await act(async () => {
      finish?.(true);
      await Promise.resolve();
    });
  });

  it("老图（没有形状记录）⇒ 交付默认方图 —— 那正是它们当年真的形状", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1", { lineage: lineageWithShape(null) })]);
    await renderBoard();
    select(["n1"]);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { buttonsLabelled("Create variations")[0]!.click(); });
    await act(async () => { confirmVariantButton().click(); });
    const options = mocks.generateImage.mock.calls[0]![5] as { aspectRatio?: string };
    expect(options.aspectRatio).toBe("1:1");
  });
});

// ---------------------------------------------------------------------------
// ENGINE-A3(otto-engine.md §7.2⑦)—— 这里从前还有两组断言，随直出 composer 一起退役。
//
//   ① 「画布 t2i:形状在花钱之前就看得见、改得动」(#643 T2 的 composer 那一半)
//   ② 「CREATE-A6 画布出图:「精修」这一格能力在花钱之前就看得见、勾得动」
//
// 两组测的都是**直出 composer 上的控件**(张数 / 形状 / 精修 / 成组)。⑦段把那个 composer
// 与工具条上的 Generate 按钮一并撤下 —— 画布只留 Otto 对话那一个输入,出图的数量、形状与
// 档位改由对话谈定、写进 Otto 的确认卡。被测对象没有了,断言就不能留:留下来只会变成对着
// 一段不存在的界面空转的绿灯。
//
// **两件事没有跟着消失,各自另有归属**:
//   · CREATE-A6 的**冻结验收**判的是服务端那一句(「请求未定价的 pro SKU ⇒ 拒绝生成、$0」),
//     它的真身在 `creation-routing-ledger.test.ts`(含「勾了精修却按默认档报价 ⇒ 花钱之前拒、
//     ledger 零新增行」),本段一个字没动。
//   · 「再来一张」继承这张卡自己记着的形状 —— 下面那一组断言,是画布上仅存的形状链路,
//     它走的是确认卡,不是直出。
//
// **一个缺口,已在 otto-engine.md §5 登记**:精修(pro 档)今天在 `packages/otto/` 里没有任何
// 参数位,所以 composer 退役之后,商家侧暂时没有别的地方勾得到它。要不要给 Otto 的确认卡补
// 这一格,由 Founder 定 —— 不是本段能自行决定的事。
// ---------------------------------------------------------------------------

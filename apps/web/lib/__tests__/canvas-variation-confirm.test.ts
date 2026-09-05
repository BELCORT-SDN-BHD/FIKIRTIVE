// @vitest-environment jsdom
/**
 * canvas-variation-confirm —— 画布「Create variations」的**第一下**，从界面一路到付费入口。
 *
 * 规格：`docs/specs/creation-engine.md` 验收 **CREATE-A1**（花钱前先见确认、画布路径的判定
 * 落在确认卡片上）与 `docs/specs/frontend-baseline.md` 验收 **FRONT-A15**（画布控件与设计
 * 夹具一致）。设计权威是
 * `apps/web/design-system/patterns/canvas/stitch-image-video-parity-spec.md`：
 *   · `:149` variation journey ＝ `Select image → Variations → … → confirmation → variants`；
 *   · §5「Paid generation confirmation」＝ 要生成的东西／数量／比例／材料／exact credits，
 *     primary CTA `Generate · N credits`，secondary `Cancel`。
 *
 * 触发＝Codex 只读走查 **QA-CRE-FE9-001**（P0）：`Create variations` 一击即建付费 job 并
 * reserve 1 credit，只有 hover title 提过价钱。Founder 2026-09-04 07:05 裁决：第一下只开
 * 确认，按 `Generate · N credits` 才预留。
 *
 * 这个文件驱动**真** FlowCanvas ＋ 真 ImageNode，只把 `useCanvasGen` 换成假件 ——
 * `generateImage` 是这块板子上**唯一**能建 GenJob／落 CreditLedger 的入口（它就是
 * `startCanvasGen` 那条路），所以「零调用」在这里等价于「零新增行」；账本那一头由真库件
 * `canvas-variation-confirm-ledger.test.ts` 另证。一个积分都花不出去：全是 vi.fn()。
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
vi.mock("@/components/MentionInput", () => ({
  MentionInput: ({ onChange, disabled }: {
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
    animate: mocks.animate,
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
  // 每铸一个动作身份换一个号 —— 「同一动作的重试」与「另一个动作」在断言里分得开。
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

const MENU = ["1:1", "9:16", "16:9", "4:3", "3:4", "3:2", "2:3", "21:9"];

const boardRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: "image",
  x: 0,
  y: 0,
  w: 320,
  h: 320,
  text: null,
  prompt: "a cup steaming on a rattan mat",
  generationId: `gen-${id}`,
  genJobId: `job-${id}`,
  status: "done",
  sourceNodeId: null,
  threadId: null,
  url: `https://cdn.example/${id}.png`,
  mediaWidth: null,
  mediaHeight: null,
  lineage: {
    madeAtLabel: "Today, 10:00",
    settings: { durationSeconds: null, resolution: null, aspectRatio: "9:16" },
    costCredits: 8,
    batchSize: 1,
    batchPosition: null,
  },
  ...overrides,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const sizedRect = () => ({
  width: 1280, height: 800, top: 0, left: 0, right: 1280, bottom: 800, x: 0, y: 0,
  toJSON: () => ({}),
}) as DOMRect;

beforeEach(() => {
  mocks.boardRead.mockResolvedValue([boardRow("n1")]);
  mocks.quoteCosts.mockResolvedValue({ imageCredits: 8, videoCredits: 80 });
  mocks.imageShapes.mockResolvedValue({ options: MENU, defaultAspect: "1:1" });
  mocks.videoSpecs.mockResolvedValue({
    menu: { durations: [5, 12], resolutions: ["720p", "480p"], aspectRatios: ["16:9", "9:16", "1:1", "adaptive"] },
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

async function renderBoard(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(FlowCanvas, {
      projectId: "p1", skin: "gb" as const,
    }));
  });
  await act(async () => { await Promise.resolve(); });
}

function select(ids: string[]): void {
  act(() => mocks.flow.current!.onNodesChange(ids.map((id) => ({ id, type: "select" as const, selected: true }))));
}

function buttonsLabelled(text: string): HTMLButtonElement[] {
  return [...container!.querySelectorAll("button")].filter((b) => b.textContent === text);
}

/** 卡上那颗「Create variations」—— 商家的第一下。 */
async function pressCreateVariations(): Promise<void> {
  const key = buttonsLabelled("Create variations")[0];
  expect(key, "选中的卡上应该有「Create variations」").not.toBeUndefined();
  await act(async () => { key!.click(); });
}

/** 弹窗走 portal，落在 document.body 上，不在 container 里 —— 所以从文档读。 */
function dialogButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
}

/** 确认卡上那颗 primary CTA —— 唯一的付费入口。 */
function confirmButton(): HTMLButtonElement | undefined {
  return dialogButtons().find((b) => b.textContent?.startsWith("Generate · "));
}

function dialogText(): string {
  return [...document.querySelectorAll('[role="dialog"]')].map((d) => d.textContent ?? "").join(" ");
}

/** 一张选中的、做完了的图片卡。 */
async function boardWithPickedImage(): Promise<void> {
  await renderBoard();
  select(["n1"]);
  await act(async () => { await Promise.resolve(); });
}

describe("CREATE-A1 / FRONT-A15 —— 变体的第一下只开确认卡，不花钱", () => {
  it("CREATE-A1: 第一下点「Create variations」只开确认，付费入口零调用（GenJob 与 CreditLedger 零新增行）", async () => {
    await boardWithPickedImage();

    await pressCreateVariations();

    // 确认卡在，而这块板子上唯一能建 job／落账本的那个入口一次都没被叫到。
    expect(dialogText()).toContain("Make another one like this?");
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("CREATE-A1: 按 Cancel 之后仍然零调用（GenJob 与 CreditLedger 零新增行），确认卡关掉", async () => {
    await boardWithPickedImage();
    await pressCreateVariations();

    const cancel = dialogButtons().find((b) => b.textContent === "Cancel");
    expect(cancel, "确认卡上应该有 Cancel").not.toBeUndefined();
    await act(async () => { cancel!.click(); });

    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(confirmButton(), "取消之后确认卡不该还在").toBeUndefined();
  });

  it("CREATE-A1: 按 `Generate · N credits` 才发一次付费请求 —— 恰好一组，材料就是卡上那张图与它自己的形状", async () => {
    await boardWithPickedImage();
    await pressCreateVariations();

    await act(async () => { confirmButton()!.click(); });

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    const [prompt, , entityIds, , count, options] = mocks.generateImage.mock.calls[0]! as [
      string, unknown, string[], unknown, number,
      { actionId?: string; sourceGenerationId?: string; sourceNodeId?: string; aspectRatio?: string },
    ];
    expect(prompt).toBe("a cup steaming on a rattan mat");
    expect(entityIds).toEqual([]);
    expect(count).toBe(1);
    expect(options.sourceGenerationId).toBe("gen-n1");
    expect(options.sourceNodeId).toBe("n1");
    // 裁决①之后的形状口径没变：卡自己记着的那一格。
    expect(options.aspectRatio).toBe("9:16");
    expect(options.actionId, "付费请求必须带一个稳定的动作身份").toBeTruthy();
  });

  it("CREATE-A1: 连按两下 `Generate · N credits` 也只有一组 —— 复用直出那条路已有的幂等边界", async () => {
    let finish: ((accepted: boolean) => void) | undefined;
    mocks.generateImage.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    await boardWithPickedImage();
    await pressCreateVariations();

    const confirm = confirmButton()!;
    // 两下之间不放行任何一个 tick —— 这正是真的双击。
    await act(async () => { confirm.click(); confirm.click(); });

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    // 设计权威 §5:「Confirmation 只能提交一次;提交后变成 receipt/status,不继续保留可重复
    // 付款按钮」—— 所以 `Generate · N credits` 这颗键此刻已经不在了,位置上是一句状态。
    expect(confirmButton(), "提交后不该还留着一颗可重复付款的按钮").toBeUndefined();
    const starting = dialogButtons().find((b) => b.textContent?.includes("Starting"));
    expect(starting?.disabled).toBe(true);

    await act(async () => { finish?.(true); await Promise.resolve(); });
    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
  });

  it("FRONT-A15: 确认卡照设计权威说话 —— 数量、比例、材料、准确 credits 与 `Generate · N credits`", async () => {
    await boardWithPickedImage();
    await pressCreateVariations();

    const text = dialogText();
    // 准确 credits：服务端报价 8 ⇒ 卡上写 8 credits，CTA 也写 8 credits。
    expect(text).toContain("8 credits");
    expect(text).toContain("No charge until you confirm");
    // 数量、比例、要送去的材料。
    expect(text).toContain("Images");
    expect(text).toContain("Shape");
    expect(text).toContain("9:16");
    expect(text).toContain("a cup steaming on a rattan mat");
    // primary CTA 与 secondary action。
    expect(confirmButton()?.textContent).toBe("Generate · 8 credits");
    expect(dialogButtons().some((b) => b.textContent === "Cancel")).toBe(true);
    // 来源缩略图就是这张卡自己的图。
    expect(
      [...document.querySelectorAll<HTMLImageElement>('[role="dialog"] img')]
        .some((img) => img.src === "https://cdn.example/n1.png"),
      "确认卡上应该有来源缩略图",
    ).toBe(true);
  });

  it("FRONT-A15: 卡上那个数只有服务端报价一个来源 —— 组件里零价格字面量", async () => {
    mocks.quoteCosts.mockResolvedValue({ imageCredits: 3, videoCredits: 80 });
    await boardWithPickedImage();
    await pressCreateVariations();

    // 报价换一个数，卡与 CTA 一起跟着换：界面一分钱都不自己算。
    expect(confirmButton()?.textContent).toBe("Generate · 3 credits");
    expect(dialogText()).toContain("3 credits");
  });

  it("CREATE-A1: 报不出价就不给按 —— 拿不到准确 credits 时没有可付款的按钮", async () => {
    mocks.quoteCosts.mockResolvedValue(null);
    await boardWithPickedImage();
    await pressCreateVariations();

    expect(dialogText()).toContain("Make another one like this?");
    expect(confirmButton(), "报不出价时不该出现 `Generate · N credits`").toBeUndefined();
    const checking = dialogButtons().find((b) => b.textContent?.includes("Checking cost"));
    expect(checking?.disabled).toBe(true);
    expect(mocks.generateImage).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
/**
 * 点一下卡片到底该发生什么(#604 · spec #599 D6,体检 Q5=C)。
 *
 * 改前:卡片的整个身体是一颗按钮 —— 点一下就把它塞进 Otto 的输入框当引用;没有 Otto 会话时
 * 点一下弹一句红色错误;已经框选了好几张再点其中一张,一次塞进去好几条。商家「先看看」这个
 * 最普通的动作,后果全是他没要过的。
 *
 * 改后:点 = 选中,零副作用;「送去 Otto」是选中工具条上的一个明确按钮,点它才交出引用,
 * 多选一次交一批;没有会话时给一句诚实的引导,不是错误。
 *
 * 全程驱动真 FlowCanvas + 真 ImageNode / VideoNode(先例:canvas-flow-lineage-ui、
 * northstar-canvas-convergence)—— 三个症状都住在接线里,单测任何一半都会一直是绿的。
 * 付费路径 useCanvasGen 被换成假件,任何一条断言都花不出一个积分。
 */
import { act, createElement, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_OTTO_DOCK_VAR, canvasOttoDockPx } from "@/lib/canvas-otto-dock";

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
vi.mock("@/components/MentionInput", () => ({ MentionInput: () => null }));
vi.mock("@/components/otto/OttoTrace", () => ({ OttoCanvasStatus: () => null }));

// The paid path, replaced by a handle. Nothing in this file can start a generation.
vi.mock("@/components/canvas/useCanvasGen", () => ({
  useCanvasGen: () => ({
    generateImage: vi.fn(),
    animate: vi.fn(),
    generateVideoFromText: vi.fn(),
    quoteCosts: mocks.quoteCosts,
    // #643 T2: 形状菜单来自服务端解析，测试替身也必须给得出，否则选择器渲染不出来。
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
  mocks.imageShapes.mockResolvedValue({ options: ["1:1", "9:16", "16:9", "4:3", "3:4", "3:2", "2:3", "21:9"], defaultAspect: "1:1" });
  mocks.videoSpecs.mockResolvedValue({
    menu: { durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutions: ["720p", "480p"], aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"] },
    t2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "16:9" },
    i2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "adaptive" },
    creditsFor: ({ seconds, resolution }: { seconds: number; resolution: string }) =>
      Math.ceil((seconds * (resolution === "480p" ? 11 : 22)) / 10),
  });
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
    root!.render(createElement(FlowCanvas, { projectId: "p1", skin: "gb" as const, ...props }));
  });
  await act(async () => { await Promise.resolve(); });
}

function select(ids: string[]): void {
  act(() => mocks.flow.current!.onNodesChange(ids.map((id) => ({ id, type: "select" as const, selected: true }))));
}

function deselect(ids: string[]): void {
  act(() => mocks.flow.current!.onNodesChange(ids.map((id) => ({ id, type: "select" as const, selected: false }))));
}

/** The card's body — the picture itself, which is what a merchant clicks on. */
function cardBody(nodeId: string): HTMLElement {
  const card = container!.querySelector<HTMLElement>(`[data-node="${nodeId}"] .al-panel`);
  expect(card).not.toBeNull();
  return card!;
}

function buttonsLabelled(text: string): HTMLButtonElement[] {
  return [...container!.querySelectorAll("button")].filter((b) => b.textContent === text);
}

/** 批量条上的那颗(FlowCanvas 的「N selected」条),本段没有改名。 */
const SEND_TO_OTTO = "Send to Otto";
/** 卡上自己的那颗。已批准的 canvas pattern 把它叫 Edit with Otto —— 与批量条不是同一颗键。 */
const EDIT_WITH_OTTO = "Edit with Otto";

describe("clicking a card just picks it up (#604 · D6)", () => {
  it("hands Otto nothing — browsing costs the merchant no side effects", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard({ onReferenceInChat });

    await act(async () => { cardBody("n1").click(); });

    expect(onReferenceInChat).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("no longer advertises the picture as a button that does something", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1"), boardRow("v1", { type: "video", url: "https://cdn.example/v1.mp4" })]);
    await renderBoard({ onReferenceInChat: vi.fn() });

    for (const id of ["n1", "v1"]) {
      const body = cardBody(id);
      expect(body.getAttribute("role")).toBeNull();
      expect(body.getAttribute("aria-label")).toBeNull();
      expect(body.getAttribute("tabindex")).toBeNull();
    }
  });

  it("says nothing at all when there is no Otto conversation to send to", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();

    await act(async () => { cardBody("n1").click(); });

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastMessage).not.toHaveBeenCalled();
  });

  it("a video card behaves the same — pressing play is not a reference either", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("v1", { type: "video", url: "https://cdn.example/v1.mp4" })]);
    await renderBoard({ onReferenceInChat });

    await act(async () => { cardBody("v1").click(); });

    expect(onReferenceInChat).not.toHaveBeenCalled();
  });

  it("does not turn one click on a picked card into a pile of references", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("n1"), boardRow("n2", { x: 360 })]);
    await renderBoard({ onReferenceInChat });

    select(["n1", "n2"]);
    await act(async () => { cardBody("n1").click(); });

    expect(onReferenceInChat).not.toHaveBeenCalled();
  });
});

describe("sending cards to Otto is its own button (#604 · D6)", () => {
  it("offers it on a picked card, and hands over that one card", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard({ onReferenceInChat });

    // Nothing picked yet — nothing to send.
    expect(buttonsLabelled(EDIT_WITH_OTTO)).toHaveLength(0);

    select(["n1"]);
    const send = buttonsLabelled(EDIT_WITH_OTTO);
    expect(send).toHaveLength(1);

    await act(async () => { send[0]!.click(); });

    expect(onReferenceInChat).toHaveBeenCalledTimes(1);
    expect(onReferenceInChat.mock.calls[0]![0]).toEqual([
      { generationId: "gen-n1", src: "https://cdn.example/n1.png", kind: "image", previewKind: "image", label: "Image ref" },
    ]);
  });

  it("hands over the whole picked set in one go, from the batch bar", async () => {
    const onReferenceInChat = vi.fn();
    mocks.boardRead.mockResolvedValue([
      boardRow("n1"),
      boardRow("v1", { type: "video", x: 360, url: "https://cdn.example/v1.mp4" }),
    ]);
    await renderBoard({ onReferenceInChat });

    select(["n1", "v1"]);
    const batchBar = container!.querySelector<HTMLElement>('[aria-label="Selected cards"]');
    expect(batchBar).not.toBeNull();
    const send = [...batchBar!.querySelectorAll("button")].find((b) => b.textContent === SEND_TO_OTTO);
    expect(send).toBeDefined();

    await act(async () => { send!.click(); });

    expect(onReferenceInChat).toHaveBeenCalledTimes(1);
    expect(onReferenceInChat.mock.calls[0]![0]).toEqual([
      { generationId: "gen-n1", src: "https://cdn.example/n1.png", kind: "image", previewKind: "image", label: "Image ref" },
      { generationId: "gen-v1", src: "https://cdn.example/v1.mp4", kind: "refVideo", previewKind: "video", label: "Video ref" },
    ]);
  });

  it("guides the merchant instead of scolding them when no conversation is open", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();

    select(["n1"]);
    await act(async () => { buttonsLabelled(EDIT_WITH_OTTO)[0]!.click(); });

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastMessage).toHaveBeenCalledTimes(1);
    expect(String(mocks.toastMessage.mock.calls[0]![0])).toContain("Otto");
  });
});

/**
 * 判官 r1 P2①:多选时那条「2 selected」的条压在画布工具条上,右侧的缩放/适配/手型/框选点不到。
 * 两者原来共用同一个 `bottom: 20px`,靠 z-index 分胜负 —— 谁更宽谁就盖住谁。
 *
 * jsdom 没有排版引擎,量不出矩形,所以这里验的是「为什么不可能再压上」:两条都是同一根纵向
 * 栈里的兄弟行,浏览器按正常流一上一下排,宽度、换行、z-index 都改变不了这一点。真几何断言
 * (两矩形不相交)在走查里对真浏览器做,读数写进证据。
 */
describe("the bars along the bottom stay out of each other's way (#604 r2 P2①)", () => {
  it("gives the multi-card bar its own row above the tools instead of the same slot", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1"), boardRow("n2", { x: 360 })]);
    await renderBoard({ onReferenceInChat: vi.fn() });

    select(["n1", "n2"]);
    const batchBar = container!.querySelector<HTMLElement>('[aria-label="Selected cards"]');
    const tools = container!.querySelector<HTMLElement>('[aria-label="Canvas tools"]');
    expect(batchBar).not.toBeNull();
    expect(tools).not.toBeNull();

    // Same parent, and that parent is the bottom column.
    const stack = tools!.parentElement!;
    expect(stack.className).toContain("cv-bottom-stack");
    expect(batchBar!.parentElement).toBe(stack);
    // Order in the column: the selection bar sits above the tool row.
    const rows = [...stack.children];
    expect(rows.indexOf(batchBar!)).toBeLessThan(rows.indexOf(tools!));
    // And neither one pins itself to the board's bottom edge any more, so neither can
    // be dragged back on top of the other by a wider label or a higher z-index.
    expect(batchBar!.style.position).toBe("");
    expect(batchBar!.style.bottom).toBe("");
    expect(batchBar!.style.zIndex).toBe("");
  });

  it("keeps the composer in the same column, so three open bars still cannot overlap", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1"), boardRow("n2", { x: 360 })]);
    await renderBoard({ onReferenceInChat: vi.fn() });

    select(["n1", "n2"]);
    // The tool row's image button opens the prompt composer.
    const openComposer = container!.querySelector<HTMLButtonElement>('button[aria-label="Generate image"]');
    expect(openComposer).not.toBeNull();
    await act(async () => { openComposer!.click(); });

    const stack = container!.querySelector<HTMLElement>(".cv-bottom-stack")!;
    const composer = stack.querySelector<HTMLElement>(".cv-composer-pop");
    expect(composer).not.toBeNull();
    expect(composer!.parentElement).toBe(stack);
    expect(composer!.style.position).toBe("");
    expect(stack.children).toHaveLength(3);
  });

  /**
   * 判官 r2 P2:同一根纵列在短视口(手机横屏、分屏、矮笔电)会长得比画布还高,而画布
   * `overflow:hidden`,顶上的 composer 就被裁掉且滚不回来。真浏览器实测 844×390:纵列
   * 要 347px、画布只有 338px,composer 顶部越界 29px。
   *
   * 这条**不是几何断言** —— jsdom 没有排版引擎,量不出任何矩形。它只是一道防删护栏:
   * 确认样式表里那两条规则还在(纵列有高度上限、工具行是唯一不让位的一行)。修好之后的
   * 真几何读数在走查证据里,`docs/evidence/t5/05|06-short-viewport-*.png` 是同视口对比。
   */
  it("caps the column's height in the stylesheet, and keeps the tool row the one row that never gives way", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // cwd is apps/web (vitest's config root) — same route better-auth-sender.test.ts uses.
    // `import.meta.url` is not a file URL under the jsdom environment.
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    const stackRule = css.slice(css.indexOf(".gb .cv-bottom-stack {"));
    expect(stackRule).toContain(`max-height: calc(100% - 40px - var(${CANVAS_OTTO_DOCK_VAR}, 0px))`);
    expect(css).toContain(".gb .cv-bottom-stack > .cv-toolbar { flex: 0 0 auto; }");
    expect(css).toMatch(
      /\.gb \.cv-bottom-stack > \.cv-composer-pop,\s*\.gb \.cv-bottom-stack > \.cv-batchbar \{[^}]*flex: 0 1 auto;[^}]*overflow-y: auto;/,
    );
  });

  /**
   * FRONT-A14 · 2026-09-03 走查 D1:第四样东西也在抢那个角落 —— Otto 覆盖层的输入框
   * (`absolute inset-0` 的兄弟层,z-index 30,`bottom-4`)。它那条 block-end 附加栏自己可点,
   * 于是八颗工具按钮中心的 `elementFromPoint()` 全部返回那条附加栏(1280×800 / 1440×900 /
   * 1440×1024 / 1920×1080 四个视口实测)。
   *
   * 同上一条:jsdom 量不出矩形,这里只守规则还在。真几何读数由 e2e 旅程
   * `e2e/journeys/14-canvas-toolbar-reachable.spec.ts` 在真浏览器里逐颗按钮断言。
   */
  it("lifts the column above the Otto composer by a measured height, not a guessed offset", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    const stackRule = css.slice(css.indexOf(".gb .cv-bottom-stack {"));
    // 让位高度是量出来的那一个变量;没人写它时回落 0px,没有 Otto 覆盖层的画布版式不变。
    expect(stackRule).toContain(`bottom: calc(20px + var(${CANVAS_OTTO_DOCK_VAR}, 0px))`);
  });

  /**
   * 创作带的两个数字(`left: 300px` / `right: 160px`)来自已批准的画布 pattern
   * (`design-system/patterns/canvas/CanvasReference.tsx` 的 `bottom-4 left-[300px] right-[160px]`),
   * 而且**只声明一次**:Otto 输入框与画布创作列共读同一条规则。各抄一份,就是两者重新错开、
   * 重新盖住对方的那条路。
   */
  it("declares the approved creation band once, and both things in it read that one rule", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    expect(css).toMatch(
      /\.gb \.cv-bottom-stack,\s*\.gb \.cv-creation-band \{\s*left: 300px;\s*right: 160px;\s*\}/,
    );
  });

  /**
   * 画布自己的控件放在 pattern 给它们的两个位置:右侧竖轨(交互模式)与右下缩放簇。
   * Founder 2026-09-03 令:生产界面严格按 UIUX 设计走,位置不自创。
   */
  it("puts the board's own controls where the approved pattern puts them", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    const rail = css.slice(css.indexOf(".gb .cv-mode-rail {"));
    expect(rail.slice(0, rail.indexOf("}"))).toContain("right: 16px;");
    expect(rail.slice(0, rail.indexOf("}"))).toContain("top: 50%;");
    expect(rail.slice(0, rail.indexOf("}"))).toContain("flex-direction: column;");
    const zoom = css.slice(css.indexOf(".gb .cv-zoom-cluster {"));
    expect(zoom.slice(0, zoom.indexOf("}"))).toContain("right: 16px;");
    expect(zoom.slice(0, zoom.indexOf("}"))).toContain("bottom: 16px;");
  });

  /** 三个控件组各自有名字,而且都不在同一根纵列里 —— 缩放与模式已经离开被盖住的那一行。 */
  it("splits the chrome into the creation row, the mode rail and the zoom cluster", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderBoard();

    const creation = container!.querySelector<HTMLElement>('[aria-label="Canvas tools"]')!;
    const rail = container!.querySelector<HTMLElement>('[aria-label="Canvas interaction mode"]')!;
    const zoom = container!.querySelector<HTMLElement>('[aria-label="Canvas zoom"]')!;
    expect(creation).not.toBeNull();
    expect(rail).not.toBeNull();
    expect(zoom).not.toBeNull();

    const stack = container!.querySelector<HTMLElement>(".cv-bottom-stack")!;
    expect(stack.contains(creation)).toBe(true);
    expect(stack.contains(rail)).toBe(false);
    expect(stack.contains(zoom)).toBe(false);
    expect(rail.className).toContain("cv-mode-rail");
    expect(zoom.className).toContain("cv-zoom-cluster");
    // 三个直接创作工具留在创作带里;缩放与模式一个都不在。
    const creationLabels = [...creation.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(creationLabels).toEqual(["Generate image", "Video", "Add text"]);
  });

  /**
   * 让位高度的算术只有这一份(`lib/canvas-otto-dock.ts`):画布底边到 Otto 输入框顶边,
   * 所以 `bottom-4` 那 16px 内缩和输入框自己的高度一起算进去。
   */
  it("measures from the board's bottom edge to the composer's top edge, and never goes negative", () => {
    expect(canvasOttoDockPx({ bottom: 900 }, { top: 676 })).toBe(224);
    // 输入框被推到画布底边以下:该让的高度是 0,不是把工具条推出画布(推出去=又点不到)。
    expect(canvasOttoDockPx({ bottom: 400 }, { top: 460 })).toBe(0);
  });
});

/**
 * 判官 r1 P2②:多选相邻两卡时,两张卡各自的工具条重叠在一起,商家分不清按钮属于哪张卡 ——
 * 而且每颗「Send to Otto」按下去交的都是整个选中集,不是那一张。
 *
 * 现在的规矩只有一条:卡片自己的工具条只在「只选中它一张」时出现;选了好几张,批量条就是
 * 唯一的操作台。相邻卡的工具条因此不可能再重叠。
 */
describe("with several cards picked, only the batch bar acts on them (#604 r2 P2②)", () => {
  it("takes the per-card toolbars off the board, so neighbours cannot overlap", async () => {
    mocks.boardRead.mockResolvedValue([
      boardRow("n1"),
      boardRow("n2", { x: 360 }),
      boardRow("v1", { type: "video", x: 720, url: "https://cdn.example/v1.mp4" }),
    ]);
    await renderBoard({ onReferenceInChat: vi.fn() });

    select(["n1", "n2", "v1"]);

    expect(container!.querySelectorAll(".cv-node-toolbar")).toHaveLength(0);
    const send = buttonsLabelled(SEND_TO_OTTO);
    expect(send).toHaveLength(1);
    expect(send[0]!.closest('[aria-label="Selected cards"]')).not.toBeNull();
  });

  it("hands the card its own toolbar back the moment it is the only one picked", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1"), boardRow("n2", { x: 360 })]);
    await renderBoard({ onReferenceInChat: vi.fn() });

    select(["n1", "n2"]);
    expect(container!.querySelectorAll(".cv-node-toolbar")).toHaveLength(0);

    deselect(["n2"]);
    const toolbars = container!.querySelectorAll(".cv-node-toolbar");
    expect(toolbars).toHaveLength(1);
    expect(toolbars[0]!.closest("[data-node]")!.getAttribute("data-node")).toBe("n1");
    expect(buttonsLabelled(EDIT_WITH_OTTO)).toHaveLength(1);
  });
});

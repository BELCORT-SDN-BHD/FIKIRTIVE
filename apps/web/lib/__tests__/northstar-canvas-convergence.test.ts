// @vitest-environment jsdom
/**
 * 北极星 Canvas 页 = 北极星的皮 + 修真内核的芯(#600 · spec #599 D1/D2)。
 *
 * 这里只测商家看得见的结果,不测内部函数被谁调用 —— 唯一的例外是租户口径:实体只能按认证
 * 身份读,这条必须盯住调用参数本身。
 *   1. 该页不再引用手搓板 —— 受控 Entry 里再没有那条 import。基线 10111895 只有这一处引用
 *      (Entry 第 4 行),所以只有这一条在改前是红的;路由文件与新壳那两条是防回归守卫 ——
 *      基线的路由文件本来就没引用过,新壳是本次新增,它们从来不曾变红。
 *   2. 商家落地看到的就是内核画的板 —— 板子由内核读、内核画,卡片是真的 ImageNode。
 *   3. 北极星规格还在 —— credits 常显、缩放控件、嵌入式 Otto 输入(@ 引用)第一眼就在。
 *   4. 内核的行为整套跟着过来了 —— 多选批量条、落位不压卡、邻近落位挨着来源卡。
 *   5. @ 引用接的是商家自己的东西 —— 受控 Entry 按认证身份读实体、经 toEntityDTO 交给壳,
 *      输入框真收到它;挑中之后这条 id 跟着提交走进付费路径的入参(照样一个积分都不花)。
 *
 * 全程没有真实生成:付费路径 useCanvasGen 被替换成一个把回调交出来的假件,任何一条断言都
 * 花不出一个积分。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_CARD_GAP } from "@/lib/canvas-batch-layout";

type FlowProps = {
  nodes: Array<{ id: string; type?: string; selected?: boolean; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
  nodeTypes: Record<string, (props: Record<string, unknown>) => ReactElement | null>;
  onNodesChange: (changes: unknown[]) => void;
  onInit?: (instance: Record<string, unknown>) => void;
};

type SpawnRect = { x: number; y: number; w: number; h: number };

const mocks = vi.hoisted(() => ({
  boardRead: vi.fn(),
  listCanvasNodes: vi.fn(),
  createCanvasNode: vi.fn(),
  moveCanvasNode: vi.fn(),
  deleteCanvasNode: vi.fn(),
  updateTextNode: vi.fn(),
  uploadReference: vi.fn(),
  getMyAccount: vi.fn(),
  quoteCosts: vi.fn(),
  imageShapes: vi.fn(),
  videoSpecs: vi.fn(),
  generateImage: vi.fn(),
  generateVideoFromText: vi.fn(),
  // The controlled entry's own dependencies — the @ reference chain starts at the session,
  // so this file drives the real entry instead of hand-feeding the workspace a prop.
  getOrCreateDefaultProject: vi.fn(),
  getProjects: vi.fn(),
  getCoworkThreads: vi.fn(),
  getCoworkThreadPage: vi.fn(),
  resolveCoworkResultUrls: vi.fn(),
  getCanvasConversationHandoff: vi.fn(),
  getEntities: vi.fn(),
  requireOwner: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  mentionEntities: { current: null as null | readonly { id: string; name: string }[] },
  mentionChange: { current: null as null | ((text: string, ids: string[], variantSel: Record<string, string>) => void) },
  mentionSubmit: { current: null as null | (() => void) },
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
vi.mock("@/lib/actions", () => ({
  uploadReference: mocks.uploadReference,
  getOrCreateDefaultProject: mocks.getOrCreateDefaultProject,
}));
vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mocks.requireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
// Only the DB reads are replaced. `@/lib/dto` stays REAL, so the entity the prompt box
// receives has to be the genuine toEntityDTO product — a raw row slipping through fails.
vi.mock("@/lib/data", () => ({
  getCoworkThreadPage: mocks.getCoworkThreadPage,
  getCoworkThreads: mocks.getCoworkThreads,
  getEntities: mocks.getEntities,
  getProjects: mocks.getProjects,
  resolveCoworkResultUrls: mocks.resolveCoworkResultUrls,
}));
vi.mock("@/lib/canvas-entry-actions", () => ({
  getCanvasConversationHandoff: mocks.getCanvasConversationHandoff,
}));
vi.mock("@/components/canvas/CanvasOttoOverlay", () => ({
  CanvasOttoOverlay: () => createElement("div", { "data-testid": "canvas-otto-overlay" }, "Otto canvas conversation"),
}));
vi.mock("@/components/ui/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/otto/OttoTrace", () => ({ OttoCanvasStatus: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: unknown }) =>
    createElement("a", { href }, children as ReactElement),
}));

// The prompt box is a rich editor jsdom cannot drive. This stand-in keeps its CONTRACT —
// a placeholder the merchant reads, the merchant's own things offered behind @, text changes
// reported upward, and a submit — so the board's own generate wiring is what runs.
//
// The @ options are rendered FROM the `entities` prop, never from a fixture inside the
// stand-in: hand it nothing and there is nothing to pick, which is exactly what a broken
// entity wiring produces.
vi.mock("@/components/MentionInput", () => ({
  MentionInput: ({
    entities,
    placeholder,
    onChange,
    onSubmit,
  }: {
    entities: readonly { id: string; name: string }[];
    placeholder?: string;
    onChange: (text: string, ids: string[], variantSel: Record<string, string>) => void;
    onSubmit: () => void;
  }) => {
    mocks.mentionEntities.current = entities;
    mocks.mentionChange.current = onChange;
    mocks.mentionSubmit.current = onSubmit;
    return createElement(
      "div",
      null,
      createElement("textarea", {
        key: "prompt",
        "data-testid": "canvas-prompt",
        placeholder,
        readOnly: true,
      }),
      ...(entities ?? []).map((entity) =>
        createElement(
          "button",
          {
            key: entity.id,
            type: "button",
            "data-testid": "canvas-mention-option",
            onClick: () => onChange(`@${entity.name} on a marble counter`, [entity.id], {}),
          },
          entity.name,
        ),
      ),
    );
  },
}));

// The paid path, replaced by a handle. Nothing in this file can start a generation.
vi.mock("@/components/canvas/useCanvasGen", () => ({
  useCanvasGen: () => ({
    generateImage: mocks.generateImage,
    animate: vi.fn(),
    generateVideoFromText: mocks.generateVideoFromText,
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
          { key: node.id, "data-node": node.id },
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
    NodeToolbar: ({ isVisible, children }: { isVisible?: boolean; children?: unknown }) =>
      isVisible === false ? null : createElement("div", null, children as ReactElement),
    NodeResizer: () => null,
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { NorthstarCanvasWorkspace } = await import("@/components/canvas/NorthstarCanvasWorkspace");
const { ImmersiveCanvasEntry } = await import("@/components/canvas/ImmersiveCanvasEntry");
const { toEntityDTO } = await import("@/lib/dto");

// `new URL(..., import.meta.url)` is rewritten by Vite's asset handling, so the web root is
// resolved from the file path instead.
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = (relativePath: string): string => readFileSync(resolve(WEB_ROOT, relativePath), "utf8");

const RUNTIME_CONTEXT = {
  projects: [
    { id: "p1", name: "Kedai Kopi" },
    { id: "p2", name: "Raya Campaign" },
  ],
  threads: [
    { id: "t1", projectId: "p1", title: "Morning shots", updatedAt: "2026-08-01T00:00:00.000Z", pinnedAt: null },
  ],
  activeProjectId: "p1",
  activeThreadId: "t1",
  initialBalance: 1240,
  initialBalanceUsd: 124,
  activeThread: {
    id: "t1",
    projectId: "p1",
    title: "Morning shots",
    updatedAt: "2026-08-01T00:00:00.000Z",
    pinnedAt: null,
    messages: [],
  },
  pendingFirst: null,
};

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
  mocks.generateImage.mockResolvedValue(true);
  mocks.generateVideoFromText.mockResolvedValue(true);
  mocks.getMyAccount.mockResolvedValue({ balance: 1240, balanceUsd: 124 });
  mocks.requireOwner.mockResolvedValue({ email: "owner@example.com", ownerId: "owner-1" });
  mocks.getOrCreateDefaultProject.mockResolvedValue({ id: "p1" });
  mocks.getProjects.mockResolvedValue([{ id: "p1", name: "Kedai Kopi" }]);
  mocks.getCoworkThreads.mockResolvedValue([]);
  mocks.getCoworkThreadPage.mockResolvedValue(null);
  mocks.resolveCoworkResultUrls.mockResolvedValue(new Map());
  mocks.getCanvasConversationHandoff.mockResolvedValue(null);
  mocks.getEntities.mockResolvedValue([]);
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
  mocks.mentionEntities.current = null;
  mocks.mentionChange.current = null;
  mocks.mentionSubmit.current = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderElement(element: ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(element); });
  await act(async () => { await Promise.resolve(); });
}

async function renderPage(): Promise<void> {
  await renderElement(createElement(NorthstarCanvasWorkspace, { runtimeContext: RUNTIME_CONTEXT }));
}

function buttonLabelled(label: string): HTMLButtonElement | undefined {
  return [...container!.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label);
}

function select(ids: string[]): void {
  act(() => mocks.flow.current!.onNodesChange(ids.map((id) => ({ id, type: "select" as const, selected: true }))));
}

/**
 * ENGINE-A3(otto-engine.md §7.2⑦)之后画布上**没有**直出的图片输入框了 —— 这里从前是
 * `openImageComposer()`(按工具行的图片键掀开 composer)。板上仍然带着一个 `MentionInput`
 * 的地方只剩视频那一个:工具行的 Video 键开出的出片确认框(「No charge until you confirm」)。
 * 「@ 引用商家自己的东西真的接到了内核」这条链路照旧从这里读,只是读的是视频那一扇门。
 */
function openVideoComposer(): void {
  const button = buttonLabelled("Video");
  if (!button) throw new Error("Video tool not found");
  act(() => button.click());
}

/** 出片确认框上那颗真正的付费键。 */
function makeVideoButton(): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    .find((b) => b.textContent === "Make video");
  if (!found) throw new Error("Make video button not found");
  return found;
}

/**
 * 手搓板退场(#600 验收① → #606 T7 收尾)。
 *
 * 改前:受控 Entry 直接 import 并渲染 `components/northstar/create/canvas-page`。第一条断言
 * 在改前是红的,也是「合体真的发生了」唯一不能靠外观蒙混的证据。后两条从来不曾变红,是
 * 防回归守卫:路由文件在基线里就没引用过手搓板,新壳则是本次才出现的文件。
 *
 * T7 把手搓板整个文件从树里删掉,所以断言从「这条路上没人再引用它」升级为「它不存在了」——
 * 第二块画布实现无处可回来。同一条也守住它的运行时 `immersive-canvas-runtime`。
 */
describe("the hand-rolled board no longer renders on this page", () => {
  const HANDMADE_BOARD = "northstar/create/canvas-page";

  it("is not imported by the controlled entry", () => {
    expect(source("components/canvas/ImmersiveCanvasEntry.tsx")).not.toContain(HANDMADE_BOARD);
  });

  it("is not imported by the route file either", () => {
    expect(source("app/create/canvas/page.tsx")).not.toContain(HANDMADE_BOARD);
  });

  it("is not reached through the new workspace", () => {
    expect(source("components/canvas/NorthstarCanvasWorkspace.tsx")).not.toContain(HANDMADE_BOARD);
  });

  it("is gone from the tree, along with the runtime that only it used", () => {
    expect(existsSync(resolve(WEB_ROOT, "components/northstar/create/canvas-page.tsx"))).toBe(false);
    expect(existsSync(resolve(WEB_ROOT, "components/canvas/immersive-canvas-runtime.ts"))).toBe(false);
  });
});

describe("what the merchant lands on", () => {
  it("is the mature kernel's board, read from the project", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1"), boardRow("n2", { x: 360 })]);
    await renderPage();

    expect(mocks.boardRead).toHaveBeenCalledWith("p1");
    expect(mocks.flow.current!.nodes.map((node) => node.id)).toEqual(["n1", "n2"]);
    // Real cards, not placeholders: a picked card offers the kernel's own action bar. Since the
    // canvas was aligned to the approved pattern the record ("how this was made") lives inside
    // that bar's ⋯ menu rather than on a button of its own, so the ⋯ is what proves the bar.
    select(["n1"]);
    expect(container!.querySelectorAll('button[aria-label="More actions"]')).toHaveLength(1);
  });

  it("keeps the minimal Canvas chrome: back to Create, Canvas name and credits", async () => {
    await renderPage();

    const text = container!.textContent ?? "";
    expect(text).toContain("1,240 credits");
    expect(text).toContain("Create");
    expect(text).toContain("Kedai Kopi");
    expect(container!.querySelector('[data-testid="canvas-otto-overlay"]')).not.toBeNull();
    expect(container!.querySelector('[data-slot="breadcrumb"]')).toBeNull();
    expect(container!.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });

  it("keeps the zoom controls", async () => {
    await renderPage();

    expect(buttonLabelled("Zoom in")).toBeDefined();
    expect(buttonLabelled("Zoom out")).toBeDefined();
    expect(buttonLabelled("Fit to screen")).toBeDefined();
    expect(container!.querySelector('[aria-label="Canvas tools"]')).not.toBeNull();
  });

  it("ENGINE-A3 — 画布只留 Otto 那一个输入:直出的图片工具与它的输入框都不在了", async () => {
    await renderPage();

    // Otto 覆盖层(这份文件里是替身)是画布上唯一的输入。
    expect(container!.querySelector('[data-testid="canvas-otto-overlay"]')).not.toBeNull();
    // 直出那条路的三件东西一件都不剩:工具行的键、它掀开的输入框、以及那颗 Generate。
    expect(buttonLabelled("Generate image")).toBeUndefined();
    expect(container!.querySelector('[data-testid="canvas-prompt"]')).toBeNull();
    expect(
      [...container!.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Generate"),
    ).toBe(false);
    expect(mocks.generateImage).not.toHaveBeenCalled();
  });
});

describe("the kernel's behaviour came along with it", () => {
  it("offers the batch bar when several cards are picked", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1"), boardRow("n2", { x: 360 })]);
    await renderPage();

    select(["n1", "n2"]);

    expect(container!.textContent).toContain("2 selected");
  });

  it("never lands a new card on top of one already paid for", async () => {
    mocks.boardRead.mockResolvedValue([boardRow("n1")]);
    await renderPage();
    // 落位规则(`spawnRect`)是内核共用的一条,ENGINE-A3 退役直出 composer 之后,板上仍然
    // 自己发起新卡的那条路是出片框 —— 走的是同一个 `spawnRect`,所以这条断言一格没弱。
    openVideoComposer();
    await act(async () => { mocks.mentionChange.current!("a bowl of laksa steaming", [], {}); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { makeVideoButton().click(); });

    expect(mocks.generateVideoFromText).toHaveBeenCalledTimes(1);
    const rect = mocks.generateVideoFromText.mock.calls[0]![1] as SpawnRect;
    const overlaps = rect.x < 320 && rect.x + rect.w > 0 && rect.y < 320 && rect.y + rect.h > 0;
    expect(overlaps).toBe(false);
  });

  it("puts a card made FROM another one beside it, not across the board", async () => {
    mocks.boardRead.mockResolvedValue([
      boardRow("far", { x: 1600, y: 1600 }),
      boardRow("near-origin"),
    ]);
    await renderPage();
    await act(async () => { await Promise.resolve(); });

    // 「再来一张」是卡上唯一那条「从这张卡再生一张」的付费路（卡下方那条改写输入条按
    // Founder 2026-09-03 裁决①退场，改写改走 Edit with Otto）。落点规则是同一条。
    const anchor = mocks.flow.current!.nodes.find((node) => node.id === "far")!;
    await act(async () => {
      (anchor.data.onVariant as (id: string, aspect?: string) => void)("far");
    });
    // QA-CRE-FE9-001（Founder 2026-09-04 07:05 裁决）：第一下只开确认卡，付费在卡上那颗
    // `Generate · N credits`。落点规则一格没变，只是要多按这一下才走到付费请求。
    expect(mocks.generateImage).not.toHaveBeenCalled();
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((b) => b.textContent?.startsWith("Generate · "))!;
    expect(confirm, "变体确认卡上没有 `Generate · N credits`").not.toBeUndefined();
    await act(async () => { confirm.click(); });

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    const rect = mocks.generateImage.mock.calls[0]![1] as SpawnRect;
    const reach = 320 + CANVAS_CARD_GAP;
    expect(Math.abs(rect.x - 1600)).toBeLessThanOrEqual(reach);
    expect(Math.abs(rect.y - 1600)).toBeLessThanOrEqual(reach);
  });
});

/**
 * 「@ 引用商家自己的东西」是真接上的(#600 验收③的牙)。
 *
 * 一整条链路一次走完:受控 Entry 按认证身份读实体 → toEntityDTO → 壳的 entities 属性 →
 * 内核 → 输入框。任何一环断掉都在这里变红 —— 光有 placeholder 里的「@」蒙混不过去。
 */
describe("@ references reach the merchant's own things", () => {
  // toEntityDTO 的入参是 Prisma include 出来的整行;这里只给它真正读到的字段。
  const entityRow = {
    id: "e-mug",
    type: "PRODUCT",
    name: "Signature mug",
    aliases: ["the mug"],
    notes: "matte white, no logo",
    negativeConstraints: "",
    referenceImages: [],
    baseAssetId: null,
    variants: [],
    _count: { shotRefs: 0 },
  } as unknown as Parameters<typeof toEntityDTO>[0];

  it("reads them for the signed-in owner alone, converts them, and hands them to the prompt box", async () => {
    mocks.getEntities.mockResolvedValue([entityRow]);

    // A forged owner in the URL must change nothing — the read is keyed by the session.
    const element = await ImmersiveCanvasEntry({
      searchParams: Promise.resolve({ owner: "owner-2", ownerId: "owner-2" }),
    });
    expect(mocks.redirect).not.toHaveBeenCalled();

    // ① 租户口径:实体只按认证身份读,一次,且参数不来自客户端。
    expect(mocks.getEntities).toHaveBeenCalledTimes(1);
    expect(mocks.getEntities).toHaveBeenCalledWith("owner-1");

    // ② 交给壳的是 toEntityDTO 的产物,不是原始行(dto 模块没被替身,所以这是真产物)。
    const expected = toEntityDTO(entityRow);
    expect(element.props.entities).toEqual([expected]);
    expect(element.props.entities[0]).not.toBe(entityRow);

    // ③ 输入框真收到它 —— 直接渲染 Entry 交出来的那棵树,中间没人补货。
    await renderElement(element);
    openVideoComposer();
    expect(mocks.mentionEntities.current).toEqual([expected]);
  });

  it("lets the merchant pick one, and the pick rides along into the generate call", async () => {
    mocks.getEntities.mockResolvedValue([entityRow]);

    await renderElement(await ImmersiveCanvasEntry({ searchParams: Promise.resolve({}) }));
    openVideoComposer();

    // 出片框走 portal,落在 document.body 上,不在 container 里。
    const option = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="canvas-mention-option"]')]
      .find((button) => button.textContent === "Signature mug");
    expect(option).toBeDefined();

    await act(async () => { option!.click(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { makeVideoButton().click(); });

    // 仍然是替身在收钱路的入参 —— 断言只看「这条 id 有没有跟着走」,一个积分都不花。
    expect(mocks.generateVideoFromText).toHaveBeenCalledTimes(1);
    expect(mocks.generateVideoFromText.mock.calls[0]![4]).toMatchObject({ entityIds: ["e-mug"] });
  });

  it("offers nothing to pick when the merchant has saved nothing", async () => {
    mocks.getEntities.mockResolvedValue([]);

    await renderElement(await ImmersiveCanvasEntry({ searchParams: Promise.resolve({}) }));
    openVideoComposer();

    expect(mocks.mentionEntities.current).toEqual([]);
    expect(document.querySelectorAll('[data-testid="canvas-mention-option"]')).toHaveLength(0);
  });
});

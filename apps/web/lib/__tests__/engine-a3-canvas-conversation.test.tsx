// @vitest-environment jsdom
/**
 * ENGINE-A3 —— 画布输入即对话（docs/specs/otto-engine.md 验收表第三行 · S2 §7.2⑦）。
 *
 * 验收原话:「商家在画布输入框发消息 ⇒ 得到 Otto 对话回复(非直接生成);花钱动作仍走卡片确认」。
 * 所以这份文件钉三件事,一件都不靠读源码:
 *
 *   ① **画布上一个直接花钱的控件都没有** —— 真挂 `NorthstarCanvasWorkspace`(内含真
 *      `FlowCanvas` 与真 Otto 覆盖层),把板面上**所有**按钮的可及名整套读出来比集合。
 *      集合比对是有牙的那一种:多长出一颗没人写过断言的键、或把某颗改了名,这条当场红
 *      (先例与病根见 `front-a15-design-parity.test.ts` 判官 #1194 P1-2 —— 源码正则扫不出
 *      真插进去的按钮)。⑦段之前这张板上有两颗直出的付费键:工具条的 `Generate image`
 *      与它掀开的 composer 里那颗 `Generate`(按下即扣钱,图片没有确认框)。
 *   ② **送出去的那一句开的是一条 Otto 对话** —— 走 `OttoFrontDoor` 既有的开新线程与
 *      `pendingFirst` 交接,线程来源明写 `canvas`;不新增任何幂等键(那三把仍在服务端,
 *      §7.4)。
 *   ③ **花钱仍然长在对话的卡片上** —— 一条 GEN_CARD 渲染出来就是那张确认卡,主键写着
 *      `Generate · N credits`,而且卡上同时说着「Otto only makes this after you approve」。
 *      同屏还有三条常驻价目披露(§7.4 一级 + §7.6 处置一)。
 *
 * 一个 credit 都花不出去:付费函数、服务器动作与流式传输全是替身。
 */
import { act, createElement, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThreadDTO } from "@/lib/types";

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
  getMyAccount: vi.fn(),
  quoteCosts: vi.fn(),
  imageShapes: vi.fn(),
  videoSpecs: vi.fn(),
  generateImage: vi.fn(),
  animate: vi.fn(),
  generateVideoFromText: vi.fn(),
  startStreamedThread: vi.fn(),
  ottoTurn: vi.fn(),
  searchReferences: vi.fn(),
  getCoworkThreadClient: vi.fn(),
  sendMessage: vi.fn(),
  chat: {
    status: "ready" as "ready" | "submitted" | "streaming" | "error",
    messages: [] as Array<Record<string, unknown>>,
  },
  flow: { current: null as null | FlowProps },
}));

// ── 板面自己的服务器动作(全是 "use server" + Prisma,一个都不真跑)────────────────
vi.mock("@/lib/canvas-actions", () => ({
  listCanvasNodes: mocks.listCanvasNodes,
  createCanvasNode: mocks.createCanvasNode,
  moveCanvasNode: mocks.moveCanvasNode,
  deleteCanvasNode: mocks.deleteCanvasNode,
  updateTextNode: mocks.updateTextNode,
}));
vi.mock("@/lib/otto-canvas-bridge", () => ({ syncOttoCanvasNodes: mocks.boardRead }));
vi.mock("@/lib/actions", () => ({ uploadReference: mocks.uploadReference }));
vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: mocks.getCoworkThreadClient }));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: vi.fn() }));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: vi.fn() }));
vi.mock("@/lib/reference-search-actions", () => ({ searchReferencesAction: mocks.searchReferences }));
vi.mock("@/lib/otto-start-thread", () => ({ startStreamedThread: mocks.startStreamedThread }));
vi.mock("@/lib/otto-client-actions", () => ({ ottoTurn: mocks.ottoTurn }));
vi.mock("@/components/ui/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/otto/OttoTrace", () => ({
  OttoCanvasStatus: () => null,
  OttoTrace: () => null,
}));

// 付费路径:只把够得着钱的四个把手换掉,其余(落位、报价换算、动作身份)全走真的。
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
  isInFlightPaidGen: () => false,
  freshCanvasActionId: () => "canvas-action-engine-a3",
  loadCanvasActionReceipts: () => [],
}));

// 流式那一层:真的要整条 SSE,这里只交出它的状态与 sendMessage。
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: mocks.chat.messages,
    setMessages: vi.fn(),
    sendMessage: mocks.sendMessage,
    status: mocks.chat.status,
    error: null,
  }),
}));
vi.mock("ai", () => ({
  DefaultChatTransport: class { constructor(_opts: unknown) { void _opts; } },
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
          { key: node.id, "data-node": node.id },
          createElement(props.nodeTypes[node.type ?? "image"]!, {
            id: node.id,
            data: node.data,
            selected: node.selected === true,
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

const { NorthstarCanvasWorkspace } = await import("@/components/canvas/NorthstarCanvasWorkspace");
const { OttoChatStream } = await import("@/components/otto/OttoChatStream");
const { CONVERSATION_COST_HINT } = await import("@/components/otto/ConversationCostHint");
const { SEARCH_COST_HINT } = await import("@/components/otto/SearchCostHint");
const { UNDERSTANDING_COST_HINT } = await import("@/components/otto/UnderstandingCostHint");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const sizedRect = () => ({
  width: 1280, height: 800, top: 0, left: 0, right: 1280, bottom: 800, x: 0, y: 0,
  toJSON: () => ({}),
}) as DOMRect;

const runtimeContext = {
  projects: [{ id: "p1", name: "Kedai Kopi" }],
  threads: [],
  activeProjectId: "p1",
  activeThreadId: null,
  initialBalance: 120,
  initialBalanceUsd: 12,
  activeThread: null,
  pendingFirst: null,
} as unknown as Parameters<typeof NorthstarCanvasWorkspace>[0]["runtimeContext"];

beforeEach(() => {
  mocks.boardRead.mockResolvedValue([]);
  mocks.listCanvasNodes.mockResolvedValue([]);
  mocks.quoteCosts.mockResolvedValue({ imageCredits: 1, videoCredits: 11 });
  mocks.imageShapes.mockResolvedValue({ options: ["1:1"], defaultAspect: "1:1", fineDetail: null });
  mocks.videoSpecs.mockResolvedValue({
    menu: { durations: [5], resolutions: ["720p"], aspectRatios: ["16:9"] },
    t2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "16:9" },
    i2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "adaptive" },
    creditsFor: () => 11,
  });
  mocks.getMyAccount.mockResolvedValue({ balance: 120, balanceUsd: 12 });
  mocks.searchReferences.mockResolvedValue({ items: [] });
  mocks.chat.status = "ready";
  mocks.chat.messages = [];
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

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(element); });
  await act(async () => { await Promise.resolve(); });
  return container;
}

/** 板面上此刻**每一个**可按的东西的可及名 —— 集合比对读的就是这一份。 */
function controlNames(scope: ParentNode): string[] {
  return [...scope.querySelectorAll<HTMLElement>('button, a, input, textarea, [role="button"]')]
    .map((el) => (
      el.getAttribute("aria-label")
      ?? el.getAttribute("title")
      ?? (el.textContent ?? "").trim()
    ))
    .filter((name) => name.length > 0)
    .sort();
}

// ---------------------------------------------------------------------------
// ① 画布上没有任何直接花钱的控件
// ---------------------------------------------------------------------------
describe("ENGINE-A3 画布上找不到任何直接花钱的控件", () => {
  it("ENGINE-A3 板面控件整套读出来比集合 —— 直出 composer 与工具条 Generate 都不在里面", async () => {
    const dom = await render(
      createElement(NorthstarCanvasWorkspace, { runtimeContext, entities: [] }),
    );

    // 这是**全集**,不是「含有」:多长出一颗没人写过断言的键,或改掉其中一颗的名字,这条当场红。
    expect(controlNames(dom)).toEqual([
      "Add text",                     // 白板便签,零花费
      "Create",                       // 回上一页
      "Describe what you want to make", // Otto 那一个输入框 —— 画布上仅存的输入
      "Fit to screen",
      "Hand tool",
      "Select tool",
      "Send",                         // 送给 Otto —— 开对话,不开生成
      "Video",                        // 开出片**确认框**(「No charge until you confirm」)
      "Zoom in",
      "Zoom out",
    ]);
  });

  it("ENGINE-A3 直出那条路的三件东西一件都不剩,一分钱也发不出去", async () => {
    const dom = await render(
      createElement(NorthstarCanvasWorkspace, { runtimeContext, entities: [] }),
    );

    expect(dom.querySelector("form.al-promptbar"), "直出 composer 的表单还在").toBeNull();
    expect(dom.querySelector(".cv-composer-pop"), "直出 composer 的容器还在").toBeNull();
    expect(
      dom.querySelector('button[aria-label="Generate image"]'),
      "工具条上的 Generate 键还在",
    ).toBeNull();
    // 没有任何一颗键的字面就是「Generate」——「Generate · N credits」长在对话的卡片上,
    // 不在板面上;那是两回事,所以这里比的是**逐字相等**。
    expect(
      [...dom.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Generate"),
    ).toHaveLength(0);
    // 板面上按不出任何一次付费请求。
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(mocks.generateVideoFromText).not.toHaveBeenCalled();
    expect(mocks.animate).not.toHaveBeenCalled();
  });

  it("ENGINE-A3 画布上唯一的输入框下面常驻两条价目小字 —— 第一句话之前就读得到", async () => {
    const dom = await render(
      createElement(NorthstarCanvasWorkspace, { runtimeContext, entities: [] }),
    );

    // §7.4 一级(对话轮)+ §7.6 处置一:先确认、而这一程对话本身按用量计费。
    expect(dom.textContent).toContain(CONVERSATION_COST_HINT);
    // 搜索那一条(MONEY-A10)在画布 composer 上是⑦段的新写点 —— 从前它只挂在对话面板里。
    expect(dom.textContent).toContain(SEARCH_COST_HINT);
    // 数值禁字面量:这两句里的数都是现算的,所以断言读的是导出的那一份字符串本身。
    expect(CONVERSATION_COST_HINT).toMatch(/checks with you/);
    expect(CONVERSATION_COST_HINT).toMatch(/charged for what it uses/);
  });
});

// ---------------------------------------------------------------------------
// ② 送出去的那一句开的是一条 Otto 对话(surface = canvas)
// ---------------------------------------------------------------------------
describe("ENGINE-A3 画布输入框送出 = 开一条 Otto 对话", () => {
  it("ENGINE-A3 送出走既有的开新线程与 pendingFirst 交接,线程来源写 canvas", async () => {
    mocks.startStreamedThread.mockResolvedValue({
      thread: {
        id: "thr-1", projectId: "p1", title: "A kaya jar ad",
        updatedAt: new Date().toISOString(), messages: [],
      },
      pending: { text: "make me a poster for the kaya jar" },
    });

    const dom = await render(
      createElement(NorthstarCanvasWorkspace, { runtimeContext, entities: [] }),
    );

    const box = dom.querySelector<HTMLTextAreaElement>("#otto-front-door-input")
      ?? dom.querySelector<HTMLTextAreaElement>("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(box),
      "value",
    )?.set;
    await act(async () => {
      setter?.call(box, "make me a poster for the kaya jar");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...dom.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent?.trim() === "Send")!;
    expect(send, "画布输入框旁边没有送出键").toBeDefined();
    await act(async () => { send.click(); });
    await act(async () => { await Promise.resolve(); });

    // 得到的是**一条对话**,不是一次生成。
    expect(mocks.startStreamedThread).toHaveBeenCalledTimes(1);
    expect(mocks.startStreamedThread.mock.calls[0]![0]).toMatchObject({
      projectId: "p1",
      text: "make me a poster for the kaya jar",
      // FRONT-A14 / §7.2⑦:这一扇门开出来的一定是画布对话,来源明写,不靠服务端兜底默认值。
      surface: "canvas",
    });
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(mocks.generateVideoFromText).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ③ 花钱动作仍走对话上的确认卡
// ---------------------------------------------------------------------------
describe("ENGINE-A3 花钱动作仍走对话的确认卡", () => {
  const thread: ChatThreadDTO = {
    id: "thr-1",
    projectId: "p1",
    title: "Kaya jar ad",
    updatedAt: new Date().toISOString(),
    messages: [],
  } as unknown as ChatThreadDTO;

  function mountStream(): ReactElement {
    return createElement(OttoChatStream, {
      layout: "canvas" as const,
      projectId: "p1",
      entities: [],
      thread,
      balanceUsd: 12,
      onRefresh: async () => {},
      onThreadUpdate: () => {},
    });
  }

  it("ENGINE-A3 一条 GEN_CARD 渲染出来就是确认卡:主键写着 Generate · N credits,而且明说要先批准", async () => {
    mocks.chat.messages = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "make me a poster for the kaya jar" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Here's what I'd make — confirm and I'll start." }],
      },
      {
        id: "card-1",
        role: "assistant",
        parts: [],
        metadata: {
          kind: "GEN_CARD",
          durableId: "card-1",
          genJobId: null,
          // 服务端真写下的那份形状(与 `creation-otto-canvas-seam.test.tsx` 同一份)。
          payload: {
            kind: "image",
            structuredPrompt: "a pandan kaya jar on a marble counter",
            estimatedCredits: 1,
            specChips: ["1:1", "Brand and product photo"],
            params: { count: 1, aspectRatio: "1:1" },
          },
        },
      },
    ];

    const dom = await render(mountStream());

    // 对话回复本身先到 —— 「非直接生成」这半句的证据。
    expect(dom.textContent).toContain("Here's what I'd make");
    // 花钱那一下长在卡片上,而且卡片自己说了「先批准才做」。
    const approve = [...dom.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent?.startsWith("Generate · "));
    expect(approve, "确认卡上没有 `Generate · N credits`").toBeDefined();
    expect(dom.textContent).toContain("Otto only makes this after you approve.");
  });

  it("ENGINE-A3 对话 composer 下方三条价目披露常驻,一条都不许改成按需披露", async () => {
    const dom = await render(mountStream());

    expect(dom.textContent).toContain(UNDERSTANDING_COST_HINT);
    expect(dom.textContent).toContain(SEARCH_COST_HINT);
    expect(dom.textContent).toContain(CONVERSATION_COST_HINT);
  });
});

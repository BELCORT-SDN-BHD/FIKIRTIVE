// @vitest-environment jsdom
/**
 * FSE-005 —— 画布终态与对话不实时同步（staging E2E Round 1，2026-09-08；Founder 当日裁「现在修」）。
 *
 * 走查录到的那一刻：画布上直接按 Create variations，失败的节点已经出现在板上，而左边那张
 * 「Current turn」还写着上一轮的 Done、Conversation 计数一动不动；按 F5 才变 Failed。
 *
 * 病根是**一句话的方向只通了一半**。规格 §5 2026-09-04「P0-1」行①把「Otto 那边有付费生成在
 * 跑」接上了画板（`OttoChatStream` → `NorthstarCanvasWorkspace` → `FlowCanvas` 的 `activity`），
 * 反方向没人说：画布节点级付费动作那张 GEN_CARD 是服务端在钱事务里写的
 * （`lib/canvas-thread-log.ts`），本地 `messages` 里没有；而对话那扇观察窗的开关
 * （`OttoChatStream.tsx` 的 `hasWorkingJob`，判据在 `lib/otto-inject-helpers.ts`）恰恰要求
 * **本地已经有一张带 genJobId 的 GEN_CARD** 才启动 —— 于是「要 refetch 才有的东西」被
 * 「有了才 refetch」挡在门外，只有整页刷新能打破这个圈。
 *
 * 这里钉的就是那一句话的另一半，按 Founder 的口径逐条：两入口（画布直接动作、Otto 批准）×
 * 四态（成功／失败／退款／断网）都在**不刷新**的前提下收敛，节点、聊天、余额一起重读。
 * 验收编号沿用 CREATE-A1（画布路径的判定落在 Otto 确认卡片上；§5 2026-09-04「P0-1」同一条）。
 *
 * 钱：这个文件一分钱都花不出去 —— 付费函数、账户读、画板读、`useChat` 全是把手。
 */
import { act, createElement, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessageDTO, ChatThreadDTO } from "@/lib/types";

type FlowProps = {
  nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
  nodeTypes: Record<string, (props: Record<string, unknown>) => ReactElement | null>;
  onNodesChange: (changes: unknown[]) => void;
  onInit?: (instance: Record<string, unknown>) => void;
};

const mocks = vi.hoisted(() => ({
  getCoworkThreadClient: vi.fn(),
  sendMessage: vi.fn(),
  chat: {
    seed: [] as Array<Record<string, unknown>>,
    current: [] as Array<Record<string, unknown>>,
  },
  // —— 画布壳那一半用的把手（与 creation-otto-canvas-activity.test.ts 同一套）——
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
  getMyAccount: vi.fn(),
  overlay: { current: null as null | Record<string, unknown> },
  flow: { current: null as null | FlowProps },
}));

// `useChat` 是替身，但它是**有状态**的替身：轮询把合并结果写回去之后列表真的会变，
// 所以「不刷新就收敛」这句话在这里是可证的，不是靠断言一次调用糊过去。
vi.mock("@ai-sdk/react", async () => {
  const { useState } = await import("react");
  return {
    useChat: () => {
      const [messages, setMessages] = useState(() => mocks.chat.seed);
      mocks.chat.current = messages;
      return {
        messages,
        setMessages,
        sendMessage: mocks.sendMessage,
        status: "ready" as const,
        error: null,
      };
    },
  };
});
vi.mock("ai", () => ({ DefaultChatTransport: class { constructor(_opts: unknown) { void _opts; } } }));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: mocks.getCoworkThreadClient }));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: vi.fn() }));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: vi.fn() }));

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
vi.mock("@/components/ui/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/otto/OttoTrace", () => ({ OttoCanvasStatus: () => null }));
vi.mock("@/components/MentionInput", () => ({ MentionInput: () => null }));
vi.mock("@/components/canvas/CanvasOttoOverlay", () => ({
  CanvasOttoOverlay: (props: Record<string, unknown>) => {
    mocks.overlay.current = props;
    return null;
  },
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
    && (node.status === "pending" || node.status === "queued" || node.status === "timeout"),
  freshCanvasActionId: () => "canvas-action-test",
  loadCanvasActionReceipts: () => [],
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  const FakeReactFlow = (props: FlowProps) => {
    mocks.flow.current = props;
    const { onInit } = props;
    useEffect(() => {
      onInit?.({ fitView: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn() });
    }, [onInit]);
    return createElement("div", { "data-testid": "board" });
  };
  return {
    ...actual,
    ReactFlow: FakeReactFlow,
    Background: () => null,
    Handle: () => null,
    NodeToolbar: () => null,
    NodeResizer: () => null,
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { OttoChatStream } = await import("@/components/otto/OttoChatStream");
const { NorthstarCanvasWorkspace } = await import("@/components/canvas/NorthstarCanvasWorkspace");

const THREAD_ID = "thr-fse005";
const JOB_ID = "job-variation-1";

let seq = 0;
function durable(m: Partial<ChatMessageDTO> & Pick<ChatMessageDTO, "id" | "role" | "kind">): ChatMessageDTO {
  seq += 1;
  return {
    seq,
    text: "",
    payload: null,
    genJobId: null,
    createdAt: new Date(1_700_000_000_000 + seq).toISOString(),
    ...m,
  };
}

function thread(messages: ChatMessageDTO[]): ChatThreadDTO {
  return {
    id: THREAD_ID,
    projectId: "p1",
    title: "Kaya jar",
    updatedAt: new Date().toISOString(),
    messages,
  };
}

/** 服务端在钱事务里为一次画布节点级付费动作写下的那两行（`lib/canvas-thread-log.ts`）。 */
function canvasActionPair(): ChatMessageDTO[] {
  return [
    durable({
      id: "msg-canvas-request",
      role: "USER",
      kind: "TEXT",
      text: "Make another like this: a pandan kaya jar",
    }),
    durable({
      id: "card-canvas",
      role: "AGENT",
      kind: "GEN_CARD",
      genJobId: JOB_ID,
      payload: {
        kind: "image",
        structuredPrompt: "a pandan kaya jar",
        entityIds: [],
        variantSel: {},
        specChips: ["1 image", "1:1"],
        estimatedCredits: 1,
        canvasAction: "makeAnother",
        params: { count: 1, aspectRatio: "1:1" },
      },
    }),
  ];
}

/** Otto 批准那条路上，本地列表里**已经有**的那张卡（走查里这一条从来是通的）。 */
function ottoCardMessage() {
  return {
    id: "card-otto",
    role: "assistant" as const,
    parts: [{ type: "text", text: "📋 plan card" }],
    metadata: { durableId: "card-otto", kind: "GEN_CARD", payload: null, genJobId: JOB_ID },
  };
}

function ottoCardDurable(): ChatMessageDTO {
  return durable({
    id: "card-otto",
    role: "AGENT",
    kind: "GEN_CARD",
    genJobId: JOB_ID,
    payload: {
      kind: "image",
      structuredPrompt: "a pandan kaya jar",
      entityIds: [],
      variantSel: {},
      specChips: ["1 image"],
      estimatedCredits: 1,
      params: { count: 1 },
    },
  });
}

const TERMINALS = {
  成功: () => durable({
    id: "res-done",
    role: "AGENT",
    kind: "GEN_RESULT",
    genJobId: JOB_ID,
    payload: { kind: "image", urls: ["https://cdn.example/kaya.png"], generationIds: ["gen-1"], costCredits: 1 },
  }),
  失败: () => durable({
    id: "res-failed",
    role: "AGENT",
    kind: "TURN_ERROR",
    genJobId: JOB_ID,
    text: "Otto hit a snag — please ask again.",
    payload: { errorId: "OTTO-1", error: { kind: "error", text: "Otto hit a snag — please ask again." } },
  }),
  退款: () => durable({
    id: "res-refunded",
    role: "AGENT",
    kind: "TURN_ERROR",
    genJobId: JOB_ID,
    text: "That didn't work — your credits are back.",
    payload: { errorId: "OTTO-2", error: { kind: "error", text: "That didn't work — your credits are back." } },
  }),
} as const;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const sizedRect = () => ({
  width: 1280, height: 800, top: 0, left: 0, right: 1280, bottom: 800, x: 0, y: 0,
  toJSON: () => ({}),
}) as DOMRect;

beforeEach(() => {
  seq = 0;
  mocks.chat.seed = [];
  mocks.chat.current = [];
  mocks.getCoworkThreadClient.mockReset();
  mocks.boardRead.mockResolvedValue([]);
  mocks.quoteCosts.mockResolvedValue({ imageCredits: 1, videoCredits: 11 });
  mocks.imageShapes.mockResolvedValue({ options: ["1:1"], defaultAspect: "1:1" });
  mocks.videoSpecs.mockResolvedValue({
    menu: { durations: [5], resolutions: ["720p"], aspectRatios: ["16:9"] },
    t2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "16:9" },
    i2vDefault: { seconds: 5, resolution: "720p", aspectRatio: "adaptive" },
    creditsFor: () => 11,
  });
  mocks.getMyAccount.mockResolvedValue({ balance: 72, balanceUsd: 7.2 });
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
  mocks.overlay.current = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** 真的 `OttoChatStream`（画布形态）。`canvasJobActive` 就是那句一直没人说的话。 */
async function renderChat(opts: {
  canvasJobActive?: boolean;
  seed?: Array<Record<string, unknown>>;
  durableThread: ChatThreadDTO;
  onBalanceRefresh?: () => void;
}): Promise<(next: boolean) => Promise<void>> {
  mocks.chat.seed = opts.seed ?? [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const render = (canvasJobActive: boolean) =>
    createElement(OttoChatStream, {
      layout: "canvas" as const,
      projectId: "p1",
      entities: [],
      thread: { ...opts.durableThread, messages: [] },
      balanceUsd: 7.3,
      onRefresh: async () => {},
      onThreadUpdate: () => {},
      onBalanceRefresh: opts.onBalanceRefresh,
      canvasJobActive,
    } as never) as ReactElement;
  await act(async () => { root!.render(render(opts.canvasJobActive ?? false)); });
  await act(async () => { await Promise.resolve(); });
  return async (next: boolean) => {
    await act(async () => { root!.render(render(next)); });
    await act(async () => { await Promise.resolve(); });
  };
}

const durableIds = () => mocks.chat.current.map((m) => (m.metadata as { durableId?: string } | undefined)?.durableId);

describe("FSE-005 · 画布直接动作那条路：终态在对话里自己收敛（CREATE-A1）", () => {
  for (const [state, terminalOf] of Object.entries(TERMINALS)) {
    it(`FSE-005 / CREATE-A1 · 画布直接动作 ${state}：不刷新，对话就拿到卡与终态`, async () => {
      const pair = canvasActionPair();
      mocks.getCoworkThreadClient.mockResolvedValue(thread(pair));
      const balanceReads: number[] = [];
      const setActive = await renderChat({
        durableThread: thread(pair),
        onBalanceRefresh: () => balanceReads.push(1),
      });

      // 走查那一刻：本地列表是空的，观察窗从来没开过。
      expect(mocks.getCoworkThreadClient).not.toHaveBeenCalled();

      // 画布上按下去 —— 板上多了一张在飞的付费卡，这就是那句一直没人说的话。
      await setActive(true);
      expect(
        mocks.getCoworkThreadClient,
        "画布动作一开跑，对话必须立刻回库里读一次（不能等本地先有卡）",
      ).toHaveBeenCalled();
      // 服务端在钱事务里写的那两行都进了对话：商家的请求句 + 那张已批准的卡。
      expect(durableIds()).toContain("card-canvas");
      expect(durableIds()).toContain("msg-canvas-request");

      // 终态落库（成功／失败／退款各一种形状），节点那边随之收工。
      const terminal = terminalOf();
      mocks.getCoworkThreadClient.mockResolvedValue(thread([...pair, terminal]));
      await setActive(false);

      expect(durableIds(), `${state} 的终态必须在不刷新的前提下出现在对话里`).toContain(terminal.id);
      expect(balanceReads.length, "终态落地要连带重读余额").toBeGreaterThan(0);
    });
  }

  it("FSE-005 / CREATE-A1 · 断网：这一次读失败不熄火，网回来同一扇窗自己收敛", async () => {
    vi.useFakeTimers();
    const pair = canvasActionPair();
    mocks.getCoworkThreadClient.mockRejectedValueOnce(new Error("offline"));
    mocks.getCoworkThreadClient.mockResolvedValue(thread([...pair, TERMINALS.成功()]));
    const setActive = await renderChat({ durableThread: thread(pair) });

    await setActive(true);
    // 第一次读断在网上 —— 列表还是空的，但这扇窗**没有**关掉。
    expect(durableIds()).not.toContain("card-canvas");

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(durableIds(), "网回来之后同一扇窗自己把终态读回来，不该要整页刷新").toContain("res-done");
  });
});

describe("FSE-005 · Otto 批准那条路：同一扇窗，同样的四态（CREATE-A1）", () => {
  for (const [state, terminalOf] of Object.entries(TERMINALS)) {
    it(`FSE-005 / CREATE-A1 · Otto 批准 ${state}：终态自己落进对话`, async () => {
      vi.useFakeTimers();
      const card = ottoCardDurable();
      const terminal = terminalOf();
      mocks.getCoworkThreadClient.mockResolvedValue(thread([card, terminal]));
      const balanceReads: number[] = [];
      await renderChat({
        seed: [ottoCardMessage()],
        durableThread: thread([card]),
        onBalanceRefresh: () => balanceReads.push(1),
      });

      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

      expect(durableIds()).toContain(terminal.id);
      expect(balanceReads.length).toBeGreaterThan(0);
    });
  }
});

describe("FSE-005 · 合并那一步：画布回执的请求句补得进来，别人的话补不进来（CREATE-A1）", () => {
  it("FSE-005 / CREATE-A1 · 画布回执卡的那一行请求句补进对话，第二次轮询不叠第二遍", async () => {
    const { mergeDurableIntoLive } = await import("@/components/otto/approval-chain");
    const fresh = thread(canvasActionPair());

    const merged = mergeDurableIntoLive([], fresh);
    expect(merged.filter((m) => m.metadata?.durableId === "msg-canvas-request")).toHaveLength(1);
    expect(merged.find((m) => m.metadata?.durableId === "msg-canvas-request")?.parts).toEqual([
      { type: "text", text: "Make another like this: a pandan kaya jar" },
    ]);
    // 幂等：同一份库再合一次，原样返回（引用相等）。
    expect(mergeDurableIntoLive(merged, fresh)).toBe(merged);
  });

  it("FSE-005 / CREATE-A1 · 一次轮询同时读到请求句＋卡＋终态时，合并后仍按库里的先后排 —— 终态不会被挤到商家那句话前面", async () => {
    const { mergeDurableIntoLive } = await import("@/components/otto/approval-chain");
    const { latestTurnTerminal } = await import("@/lib/otto-canvas-turn");
    // 断网那一格正是这个形状：第一次读被拒，直播列表还空着，下一格一次把三行都读回来。
    const fresh = thread([...canvasActionPair(), TERMINALS.失败()]);

    const merged = mergeDurableIntoLive([], fresh);
    expect(
      merged.map((m) => m.metadata?.durableId),
      "补进来的几行按 durable seq 排，否则 currentTurnStartIndex 会落在数组末尾",
    ).toEqual(["msg-canvas-request", "card-canvas", "res-failed"]);
    // 后果就在这一行：顺序倒了，这一轮扫不到任何终局，卡回落成绿色的 Ready。
    expect(latestTurnTerminal(merged)?.outcome, "这一轮的终局必须读得到").toBe("failed");
  });

  it("FSE-005 / CREATE-A1 · 商家自己打字那一条永远不补 —— 判据是卡上的画布回执，不是「像不像」", async () => {
    const { mergeDurableIntoLive } = await import("@/components/otto/approval-chain");
    // 直播路：商家打字 → Otto 铸卡。那张卡没有 `canvasAction`（`gen-actions.ts` 把带这一格的
    // 卡挡在对话付费入口之外），所以这条 USER 消息不会被捞进来叠成第二句。
    const fresh = thread([
      durable({ id: "msg-typed", role: "USER", kind: "TEXT", text: "make it 1080p" }),
      ottoCardDurable(),
    ]);
    const merged = mergeDurableIntoLive([], fresh);
    expect(merged.some((m) => m.metadata?.durableId === "msg-typed")).toBe(false);
  });
});

describe("FSE-005 · 画板把「这条对话有画布动作在跑」告诉对话（CREATE-A1）", () => {
  const runtimeContext = {
    projects: [{ id: "p1", name: "Kaya jar" }],
    threads: [],
    activeProjectId: "p1",
    activeThreadId: THREAD_ID,
    initialBalance: 73,
    initialBalanceUsd: 7.3,
    activeThread: {
      id: THREAD_ID, projectId: "p1", title: "Kaya jar ad", status: "idle",
      messages: [], hasOlderMessages: false,
    },
    pendingFirst: null,
  } as unknown as Parameters<typeof NorthstarCanvasWorkspace>[0]["runtimeContext"];

  const inFlightRow = {
    id: "node-1", type: "image", x: 80, y: 80, w: 320, h: 320,
    text: null, prompt: "a pandan kaya jar", generationId: null, genJobId: JOB_ID,
    status: "queued", threadId: THREAD_ID, url: null,
    mediaWidth: null, mediaHeight: null, lineage: null,
  };
  const deliveredRow = {
    ...inFlightRow, generationId: "gen-1", status: "done", url: "https://cdn.example/kaya.png",
  };

  async function renderWorkspace(): Promise<void> {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(NorthstarCanvasWorkspace, { runtimeContext, entities: [] }));
    });
    await act(async () => { await Promise.resolve(); });
  }

  it("FSE-005 / CREATE-A1 · 板上有在飞的付费卡时，对话侧收到「有画布动作在跑」", async () => {
    mocks.boardRead.mockResolvedValue([inFlightRow]);
    await renderWorkspace();

    expect(mocks.overlay.current, "壳必须把这句话交给对话").not.toBeNull();
    expect(mocks.overlay.current!.canvasJobActive).toBe(true);
  });

  it("FSE-005 / CREATE-A1 · 卡换成产出之后这句话归位，不会永远说「还在跑」", async () => {
    mocks.boardRead.mockResolvedValue([deliveredRow]);
    await renderWorkspace();

    expect(mocks.overlay.current!.canvasJobActive).toBe(false);
  });
});

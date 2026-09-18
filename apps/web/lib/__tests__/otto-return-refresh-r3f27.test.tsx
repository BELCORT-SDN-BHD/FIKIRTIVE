// @vitest-environment jsdom
/**
 * R3-F27 —— 商家离开这一页再回来的那一下,进行中的那张卡要当场更新,不等下一格轮询。
 *
 * 规格:`docs/specs/frontend-baseline.md` §5 的 2026-09-18 登记行
 * (Founder 2026-09-18 裁(对谈):修)。现场:
 * `docs/audits/fullstack-staging-2026-09-14/findings-catalog.md` R3-F27 ——
 * 批完一单视频、去 `/library` 看一眼、按浏览器返回回到首页,面板里那张「进行中」的卡
 * 停在离开前那一眼上。
 *
 * 这个文件钉三件事,全在真的 `OttoChatStream` 上(`useChat` 与那条取数是替身,钱路一个
 * 把手都碰不到):
 *
 *  ① **切回前台就读一次**(`visibilitychange` → `visible`)。
 *  ② **bfcache 摊开也读一次**(`pageshow` 且 `persisted`)—— 那一拍连计时器都是冻住的,
 *     不主动读就只能等下一格;慢档一格是 60 秒。
 *  ③ **两条反向**:首次加载那一声 `pageshow`(`persisted` 为 false)不读 —— 那一拍没有
 *     「回来」可言;这一条对话已经全是终态(没有在跑的活)时也不读 —— 看不见的那一页读
 *     回来的东西没有人在看,不为它多发一次已认证请求。
 *
 * 红→绿:修之前三处监听一条都不存在,①②两条各读到 0 次调用。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  getCoworkThreadClient: vi.fn(),
  chat: {
    status: "ready" as const,
    messages: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: mocks.chat.messages,
    setMessages: vi.fn(),
    sendMessage: mocks.sendMessage,
    status: mocks.chat.status,
    error: null,
  }),
}));
vi.mock("ai", () => ({ DefaultChatTransport: class { constructor(_opts: unknown) { void _opts; } } }));
vi.mock("@/lib/cowork-fetch", () => ({
  getCoworkThreadClient: (...args: unknown[]) => mocks.getCoworkThreadClient(...args),
}));
vi.mock("@/components/otto/plan-approval", () => ({ runPlanApproval: vi.fn() }));
vi.mock("@/lib/reference-search-actions", () => ({
  searchReferencesAction: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: vi.fn() }));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: vi.fn() }));
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(),
  ottoTurn: vi.fn(),
  ottoUpdateGenCardOptions: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));

const { OttoChatStream } = await import("@/components/otto/OttoChatStream");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const THREAD_ID = "thread-r3f27";
const JOB_ID = "job_video_1";

/** 一张已经批准、钱已经花出去、结果还没回来的卡 —— `hasWorkingJob` 为真的最小现场。 */
const workingCard = () => ({
  id: "card_1",
  role: "assistant",
  metadata: { kind: "GEN_CARD", durableId: "card_1", genJobId: JOB_ID, payload: null },
  parts: [{ type: "text", text: "plan card" }],
});

/** 同一张卡,但结果已经落地 —— 这条对话没有在跑的活了。 */
const settledResult = () => ({
  id: "result_1",
  role: "assistant",
  metadata: { kind: "GEN_RESULT", durableId: "result_1", genJobId: JOB_ID },
  parts: [{ type: "text", text: "done" }],
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

const element = (): ReactElement =>
  createElement(OttoChatStream, {
    projectId: "project-1",
    entities: [],
    thread: {
      id: THREAD_ID,
      projectId: "project-1",
      title: "Untitled",
      updatedAt: new Date().toISOString(),
      messages: [],
    },
    balanceUsd: 40,
    onRefresh: async () => {},
    onThreadUpdate: () => {},
  }) as ReactElement;

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element()));
}

/** 切走再切回来 —— 商家换了个标签页,回头看看跑得怎么样。 */
async function returnToForeground(): Promise<void> {
  setVisibility("hidden");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  setVisibility("visible");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
}

/** 按浏览器返回、这一页从 bfcache 里被摊开的那一声。 */
async function pageShow(persisted: boolean): Promise<void> {
  await act(async () => {
    const event = new Event("pageshow") as Event & { persisted?: boolean };
    Object.defineProperty(event, "persisted", { value: persisted });
    window.dispatchEvent(event);
  });
}

beforeEach(() => {
  setVisibility("visible");
  mocks.chat.messages = [workingCard()];
  mocks.getCoworkThreadClient.mockResolvedValue(null);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe("R3-F27 回到这一页就读一次进行中的那张卡", () => {
  it("R3-F27 — 切回前台时立刻读一次,不等下一格轮询", async () => {
    await mount();
    expect(mocks.getCoworkThreadClient).not.toHaveBeenCalled();

    await returnToForeground();

    expect(mocks.getCoworkThreadClient).toHaveBeenCalledWith(THREAD_ID);
  });

  it("R3-F27 — 整页从 bfcache 摊开(pageshow persisted)也立刻读一次", async () => {
    await mount();
    expect(mocks.getCoworkThreadClient).not.toHaveBeenCalled();

    await pageShow(true);

    expect(mocks.getCoworkThreadClient).toHaveBeenCalledWith(THREAD_ID);
  });

  it("R3-F27 — 首次加载那一声 pageshow(persisted 为 false)不读", async () => {
    await mount();

    await pageShow(false);

    expect(mocks.getCoworkThreadClient).not.toHaveBeenCalled();
  });

  it("R3-F27 — 这条对话已经全是终态时,回到前台不再多发一次请求", async () => {
    mocks.chat.messages = [workingCard(), settledResult()];
    await mount();

    await returnToForeground();
    await pageShow(true);

    expect(mocks.getCoworkThreadClient).not.toHaveBeenCalled();
  });
});

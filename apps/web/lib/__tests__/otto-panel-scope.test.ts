// @vitest-environment jsdom
/**
 * otto-panel-scope.test.ts —— 侧栏 Otto 的**范围**:它续哪一条对话,以及它有没有说清
 * 这一条属于谁。
 *
 * 规格:`docs/specs/frontend-baseline.md` §5(FRONT-A14 那一行)。
 * 触发:Codex 全 beta 审计 **P1-010** —— 商家从 /billing 展开侧栏 Otto,面板摊开的是一条
 * 画布对话「Professional Male Model Image」,而面板上一个字都没写这段对话属于别处。
 *
 * 两半各钉一组:
 *   ① **不该被自动摊开**。判据在 `lib/otto-panel-seed.ts`(那一层的单测在
 *      `otto-panel-seed.test.ts`);这个文件钉的是**挂起来之后**的结果 —— 面板从一个
 *      非画布路由打开时,画布对话不进会话体,面板画的是新对话态。
 *   ② **说清这一条属于谁**。头部那一行范围标签:面板自己的对话写
 *      `Workspace · <页面名>`,画布对话写 `Canvas · <画布名>`;会话列表里画布那几条带
 *      `Canvas` 来源标签。
 *
 * 措辞纪律(判官 r1 [P2],至今成立):标签只写**位置**,不写 Otto 读得到什么 —— 服务端
 * 没有任何读者会因为这一页是哪一页而改变这一轮的上下文。所以这里也反向钉一条:面板不许
 * 再出现「On this page:」那种写法,也不许出现「停止使用本页作为上下文」那颗叉。
 */
import { act, createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHELL_ROUTES } from "@fikirtive/core/navigation";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => SHELL_ROUTES.billing),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })),
}));

/** 面板体的取数。真实现要 Postgres;这里只需要「面板拿到什么就画什么」。 */
const loadOttoPanelSeed = vi.fn();
vi.mock("@/lib/otto-panel-seed", () => ({
  loadOttoPanelSeed: (...args: unknown[]) => loadOttoPanelSeed(...args),
}));

/** 会话那一侧的服务端动作 —— 这个文件一次都不会走到它们,挡住是为了不把 Prisma 拖进来。 */
vi.mock("@/lib/otto-client-actions", () => ({
  ottoTurn: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  deleteCoworkThread: vi.fn(),
  renameCoworkThread: vi.fn(),
  setCoworkThreadPinned: vi.fn(),
}));
vi.mock("@/lib/actions", () => ({
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  setProjectPinned: vi.fn(),
}));
/** 点开一条**还没带消息**的对话时,面板会用它把那一条整份取回来(`selectThread`)。
 *  判官 P1-1 的现场就在这一步:取回来的那一份少了 `surface`,就把列表里本来正确的行顶掉。 */
const getCoworkThreadClient = vi.fn();
vi.mock("@/lib/cowork-fetch", () => ({
  getCoworkThreadClient: (...args: unknown[]) => getCoworkThreadClient(...args),
}));
vi.mock("@/lib/account-actions", () => ({
  getMyAccount: vi.fn().mockResolvedValue({ error: "not mocked in this test" }),
}));

/** 会话流本体不是这个文件的题目 —— 换成一块认得出来的牌子,免得把整条流式链拖进 jsdom。 */
vi.mock("@/components/otto/OttoChatStream", () => ({
  OttoChatStream: ({ thread }: { thread: { id: string; title: string } }) =>
    createElement("div", { "data-test-chat-stream": thread.id }, thread.title),
}));

// Radix 的 DropdownMenu(列表里项目行的「…」菜单)在 jsdom 里要这三样才活得起来。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { OttoPanelHost } = await import("@/components/otto/panel/OttoPanelHost");
// 面板体是 `React.lazy` 分包的。先把那个模块取进 registry,`React.lazy` 的 promise 才会
// 在一两拍内落地 —— 否则等的是模块解析本身,拍数变成机器速度的函数。
await import("@/components/otto/panel/OttoPanelConversation");
const { defaultOttoPanelState, setPanelOpen, writeOttoPanelState } =
  await import("@/components/otto/panel/panel-state");

const VIEWPORT = { width: 1440, height: 900 };
const OWNER_PROJECT = "proj_default";
const CANVAS_PROJECT = "canvas_9f1c";

/** 面板自己开的那一条。 */
const PANEL_THREAD = {
  id: "thr_panel",
  projectId: OWNER_PROJECT,
  title: "Top up my credits",
  updatedAt: "2026-08-20T12:00:00.000Z",
  pinnedAt: null,
  surface: "panel",
  messages: [],
};

/** P1-010 现场那一条 —— 画布开的,而且比面板那一条更近。 */
const CANVAS_THREAD = {
  id: "thr_canvas",
  projectId: CANVAS_PROJECT,
  title: "Professional Male Model Image",
  updatedAt: "2026-08-21T09:00:00.000Z",
  pinnedAt: null,
  surface: "canvas",
  messages: [],
};

/** 这一票之前写的那一批 —— 列在,但从来没有人写过它。 */
const LEGACY_THREAD = {
  id: "thr_legacy",
  projectId: OWNER_PROJECT,
  title: "Something from before",
  updatedAt: "2026-08-19T09:00:00.000Z",
  pinnedAt: null,
  surface: null,
  messages: [],
};

function seedWith(over: { threads?: unknown[]; activeThreadId?: string | null }) {
  return {
    projectId: OWNER_PROJECT,
    entities: [],
    projects: [
      { id: OWNER_PROJECT, name: "Default project", pinnedAt: null },
      { id: CANVAS_PROJECT, name: "Kaya jar ad", pinnedAt: null },
    ],
    threads: over.threads ?? [PANEL_THREAD, CANVAS_THREAD],
    activeThreadId: over.activeThreadId ?? null,
    balanceUsd: 5,
    userName: "Tester",
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: VIEWPORT.width, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: VIEWPORT.height, writable: true, configurable: true });
  window.localStorage.clear();
  // 面板默认收起(FRONT-A14 / #1168)。这个文件测的是「打开之后」,所以统一按「商家上次
  // 留着开着」起步,而不是靠深链强开 —— 深链会改变种子的 select,那是另一条分支。
  writeOttoPanelState(setPanelOpen(defaultOttoPanelState(VIEWPORT), true));
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
  vi.clearAllMocks();
});

/** 面板体是懒加载的,要多等几拍:import() → Suspense 提交 → 里面那次取数。 */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 4; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  await settle();
  return container;
}

/** 从某一页展开面板。`location` 就是 `OttoPanelMount` 交给 Host 的那个字符串。 */
async function openPanelOn(location: string): Promise<HTMLDivElement> {
  // `children` 走 createElement 的第三个参数(eslint react/no-children-prop)。Host 的 props
  // 把 children 标成必填,所以这里把它当成 children 可选的组件用 —— 第三个参数会覆盖它。
  const Host = OttoPanelHost as FunctionComponent<{ location: string; children?: ReactNode }>;
  return mount(createElement(Host, { location }, createElement("main", null, "page")));
}

/** 点开一条历史对话:开历史 → 点那一行 → 等取数落地。 */
async function openFromHistory(el: HTMLDivElement, threadId: string): Promise<void> {
  await act(async () => {
    el.querySelector<HTMLElement>('[aria-label="Conversation history"]')?.click();
  });
  await settle();
  await act(async () => {
    el.querySelector<HTMLElement>(`[data-otto-thread-list-thread="${threadId}"]`)?.click();
  });
  await settle();
}

describe("FRONT-A14 侧栏 Otto 的范围(Codex 全 beta 审计 P1-010)", () => {
  it("FRONT-A14 — opening the panel on Billing does not load an unrelated canvas conversation", async () => {
    loadOttoPanelSeed.mockResolvedValue(seedWith({ activeThreadId: null }));

    const el = await openPanelOn(SHELL_ROUTES.billing);

    // 画布那一条一次都没有进会话体 —— 这就是 P1-010 报的那一幕。
    expect(el.querySelector(`[data-test-chat-stream="${CANVAS_THREAD.id}"]`)).toBeNull();
    expect(el.querySelector("[data-test-chat-stream]")).toBeNull();
    // 面板画的是新对话态(前门),不是一段商家没有在这里开过的上下文。
    expect(el.querySelector('[data-otto-panel-conversation="ready"]')).not.toBeNull();
  });

  it("FRONT-A14 — the header names the canvas when a canvas conversation is the one open", async () => {
    loadOttoPanelSeed.mockResolvedValue(seedWith({ activeThreadId: CANVAS_THREAD.id }));

    const el = await openPanelOn(SHELL_ROUTES.billing);

    // 这是商家在面板上读不到的那件事实:你现在接着聊的这一段属于别处。
    expect(el.querySelector("[data-otto-panel-context]")!.textContent).toContain("Canvas · Kaya jar ad");
  });

  it("FRONT-A14 — a workspace conversation gets no header strip: it would only repeat what is on screen", async () => {
    // 判官 P2-4:「Workspace · Billing & credits」是真话,但商家就在那一页上、面板就是他
    // 刚点开的那一块 —— 它不带新信息,却占掉 320px 面板里的一整行,而且不在已批准的设计里。
    loadOttoPanelSeed.mockResolvedValue(seedWith({ activeThreadId: PANEL_THREAD.id }));

    const el = await openPanelOn(SHELL_ROUTES.billing);

    expect(el.querySelector("[data-otto-panel-context]")).toBeNull();
    expect(el.textContent).not.toContain("Workspace ·");
  });

  it("FRONT-A14 — a conversation with no recorded origin is never labelled Canvas", async () => {
    // 判官 P2-1:老行来路无法回溯。把它标成 Canvas 是替一件查不出来的事作证 —— 商家会
    // 以为自己在一块画布里,而我们并不知道。徽章与头部都不出现。
    loadOttoPanelSeed.mockResolvedValue(
      seedWith({ threads: [LEGACY_THREAD], activeThreadId: LEGACY_THREAD.id }),
    );

    const el = await openPanelOn(SHELL_ROUTES.billing);

    expect(el.querySelector("[data-otto-panel-context]")).toBeNull();
    expect(el.textContent).not.toContain("Canvas");
  });

  it("FRONT-A14 — the panel never claims Otto can read the page it is open on", async () => {
    loadOttoPanelSeed.mockResolvedValue(seedWith({ activeThreadId: null }));

    const el = await openPanelOn(SHELL_ROUTES.billing);

    // 判官 r1 [P2]:这两句话今天都不成立,所以面板一句都不许说。
    expect(el.textContent).not.toContain("On this page");
    expect(el.querySelector('[aria-label="Stop using this page as context"]')).toBeNull();
    expect(el.querySelector("[data-otto-panel-context-attached]")).toBeNull();
  });

  it("FRONT-A14 — the conversation history marks which conversations belong to a canvas", async () => {
    loadOttoPanelSeed.mockResolvedValue(seedWith({ activeThreadId: null }));

    const el = await openPanelOn(SHELL_ROUTES.billing);
    await act(async () => {
      el.querySelector<HTMLElement>('[aria-label="Conversation history"]')?.click();
    });
    await settle();

    const canvasRow = el.querySelector(`[data-otto-thread-list-thread="${CANVAS_THREAD.id}"]`);
    const panelRow = el.querySelector(`[data-otto-thread-list-thread="${PANEL_THREAD.id}"]`);
    expect(canvasRow).not.toBeNull();
    expect(panelRow).not.toBeNull();
    expect(canvasRow!.querySelector('[data-otto-thread-source="canvas"]')).not.toBeNull();
    expect(panelRow!.querySelector('[data-otto-thread-source="canvas"]')).toBeNull();
  });

  it("FRONT-A14 — clicking a workspace conversation open does not relabel it as a canvas", async () => {
    // 判官 P1-1(真现象):点开一条**面板自己的**对话,面板会把它整份取回来顶替列表里
    // 那一行。取回来的那一份少了 `surface`,商家点一下,他自己的工作区对话当场被标成
    // Canvas —— 头部长出「Canvas · …」、列表长出徽章。产品自己改口。
    //
    // 这里让取数返回**生产读路真正会返回的那一份**(`getCoworkThreadPage` 现在带 surface,
    // 由 `otto-thread-surface.test.ts` 对着真库钉),再看顶替之后界面说了什么。
    loadOttoPanelSeed.mockResolvedValue(
      seedWith({ threads: [PANEL_THREAD, CANVAS_THREAD], activeThreadId: null }),
    );
    getCoworkThreadClient.mockResolvedValue({
      ...PANEL_THREAD,
      messages: [{ id: "m1", role: "USER", kind: "TEXT", seq: 1, text: "hi", createdAt: "2026-08-20T12:00:00.000Z" }],
    });

    const el = await openPanelOn(SHELL_ROUTES.billing);
    await openFromHistory(el, PANEL_THREAD.id);

    expect(getCoworkThreadClient).toHaveBeenCalledWith(PANEL_THREAD.id);
    expect(el.querySelector("[data-otto-panel-context]")).toBeNull();
    expect(el.textContent).not.toContain("Canvas");
  });

  it("FRONT-A14 — clicking a canvas conversation open names the canvas it belongs to", async () => {
    loadOttoPanelSeed.mockResolvedValue(
      seedWith({ threads: [PANEL_THREAD, CANVAS_THREAD], activeThreadId: null }),
    );
    getCoworkThreadClient.mockResolvedValue({
      ...CANVAS_THREAD,
      messages: [{ id: "m1", role: "USER", kind: "TEXT", seq: 1, text: "hi", createdAt: "2026-08-21T09:00:00.000Z" }],
    });

    const el = await openPanelOn(SHELL_ROUTES.billing);
    await openFromHistory(el, CANVAS_THREAD.id);

    expect(el.querySelector("[data-otto-panel-context]")!.textContent).toContain("Canvas · Kaya jar ad");
  });

  it("FRONT-A14 — the history badges only the conversations known to be a canvas, never the unknown ones", async () => {
    // 判官 P2-1:徽章是一句**说出口**的话,只对确知的那几条说。
    loadOttoPanelSeed.mockResolvedValue(
      seedWith({ threads: [PANEL_THREAD, CANVAS_THREAD, LEGACY_THREAD], activeThreadId: null }),
    );

    const el = await openPanelOn(SHELL_ROUTES.billing);
    await act(async () => {
      el.querySelector<HTMLElement>('[aria-label="Conversation history"]')?.click();
    });
    await settle();

    const badged = [...el.querySelectorAll('[data-otto-thread-source="canvas"]')];
    expect(badged).toHaveLength(1);
    const legacyRow = el.querySelector(`[data-otto-thread-list-thread="${LEGACY_THREAD.id}"]`);
    expect(legacyRow).not.toBeNull();
    expect(legacyRow!.querySelector('[data-otto-thread-source="canvas"]')).toBeNull();
  });
});

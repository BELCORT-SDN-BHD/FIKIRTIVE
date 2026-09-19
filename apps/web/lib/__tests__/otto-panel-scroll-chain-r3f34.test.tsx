// @vitest-environment jsdom
/**
 * R3-F34 —— 面板收到一条长回答之后,滚轮必须还能滚,回复框必须还看得见。
 *
 * 规格:`docs/specs/frontend-baseline.md` §5 的 2026-09-19 登记行。现场:
 * `docs/audits/fullstack-staging-2026-09-14/findings-catalog.md` R3-F34 ——
 * staging `bd5877c3` 实测:一条 4,870 字的回答之后,`textarea[aria-label="Reply to Otto"]`
 * 落在可视区下面 6,982px,而滚轮在整块面板里**一格都不动**(滚轮事件到得了、没有人
 * preventDefault、`el.scrollTop=200` 赋得进去,同一份输入在一个对照 div 上滚得动)。
 *
 * 病根是**高度链断在体那一层**:`[data-otto-panel-body]` 从前只有 `min-h-0 flex-1
 * overflow-y-auto`,少了 `flex flex-col`,于是它是 `display:block`;它的子层
 * `[data-otto-panel-conversation-wrap]` 写着的 `flex-1 min-h-0` 在块级父亲底下是一句空话,
 * 高度改由内容决定(实测 1582px vs 体的 600px),整条会话列连同输入框一起长到体外面。
 * 链一断,`MessageScrollerViewport` 的 `size-full`(height:100%)对着内容撑出来的父亲解析,
 * `clientHeight === scrollHeight` 恒成立 —— 它还是滚动容器、还带着 `overscroll-contain`,
 * 却零行程,Chrome 把滚轮咬在它身上不往上传。
 *
 * jsdom 没有排版,所以这个文件**不测像素**,它钉的是那条像素依赖的结构合同:
 * 从会话视口一路数到体,每一层都必须是**有界的一列 flex**。这正是走查那天断掉的那一环 ——
 * 把 `flex flex-col` 从体上撤掉,下面第一条当场红。
 * 真的量像素那一半在 `e2e/journeys/31-otto-panel-scroll.spec.ts`(真浏览器、真滚轮)。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { OTTO_PANEL_STORAGE_KEY } from "@/components/otto/panel/panel-state";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/billing"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })),
}));

vi.mock("@/lib/account-actions", () => ({
  getMyAccount: vi.fn().mockResolvedValue({ error: "not mocked in this test" }),
}));

const loadOttoPanelSeed = vi.fn();
vi.mock("@/lib/otto-panel-seed", () => ({ loadOttoPanelSeed: () => loadOttoPanelSeed() }));

vi.mock("@/lib/otto-client-actions", () => ({
  ottoTurn: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  deleteCoworkThread: vi.fn(),
  renameCoworkThread: vi.fn(),
  setCoworkThreadPinned: vi.fn(),
}));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: vi.fn() }));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: vi.fn() }));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: vi.fn() }));

// 这个文件只看结构,不看流式:把会话回合钉成静止的一份,免得把整条流式链拖进 jsdom
// (同一处理法见 `otto-chat-stream-transport-error.test.ts`)。
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    setMessages: vi.fn(),
    sendMessage: vi.fn(),
    status: "ready",
    error: null,
  }),
}));
vi.mock("ai", () => ({
  DefaultChatTransport: class { constructor(_opts: unknown) { void _opts; } },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { MerchantShellContent } = await import("@/components/global-navigation");
// 会话体走 `React.lazy` 分包,先取进 registry,`mount()` 那两拍 microtask 才等得到落地的
// 结果(同一处理法见 `otto-panel-context-chips.test.ts`)。
await import("@/components/otto/panel/OttoPanelConversation");

/** 商家手上那条**已经在聊**的对话 —— 有它,面板画的才是会话流(不是前门)。 */
const ACTIVE_THREAD = {
  id: "t_open",
  projectId: "p_raya",
  title: "Instagram plan",
  updatedAt: new Date("2026-09-19T02:00:00.000Z").toISOString(),
  messages: [
    {
      id: "m1",
      role: "USER" as const,
      kind: "TEXT" as const,
      seq: 1,
      text: "How should I plan a month of posts?",
      payload: null,
      genJobId: null,
      createdAt: new Date("2026-09-19T02:00:00.000Z").toISOString(),
    },
  ],
};

const SEED = {
  projectId: "p_raya",
  entities: [],
  projects: [{ id: "p_raya", name: "Raya campaign", pinnedAt: null }],
  threads: [ACTIVE_THREAD],
  activeThreadId: ACTIVE_THREAD.id,
  balanceUsd: 12,
  userName: "Aisyah",
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperty(window, "innerWidth", { value: 1440, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 900, writable: true, configurable: true });
  window.localStorage.clear();
  // 面板默认收起(FRONT-A14),这里按「商家上次留着开着」起步。
  window.localStorage.setItem(
    OTTO_PANEL_STORAGE_KEY,
    JSON.stringify({ mode: "docked", open: true, width: 360 }),
  );
  loadOttoPanelSeed.mockResolvedValue(SEED);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
  vi.clearAllMocks();
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return container;
}

function shell(pathname: string) {
  return createElement(
    MerchantShellContent,
    { pathname, signOutAction: async () => {} },
    createElement("div", { "data-page": "" }, "Page"),
  );
}

/** 这一层是不是一个**列**方向的 flex 容器(类名或内联 display 都算 —— 会话列那一层的
 *  display 是内联写的,见 `OttoPanelHost.tsx` 的 `historyOpen` 开关)。 */
function isFlexColumn(el: HTMLElement): boolean {
  const flex = el.classList.contains("flex") || el.style.display === "flex";
  return flex && el.classList.contains("flex-col");
}

/** 这一层是不是一个**可以被父亲压到比内容矮**的 flex 项。`min-h-0` 少一格,
 *  它就会被内容顶开;`flex-1` 少一格,它就不去占父亲剩下的高度。 */
function isBoundedFlexItem(el: HTMLElement): boolean {
  return el.classList.contains("min-h-0") && el.classList.contains("flex-1");
}

function describeEl(el: HTMLElement): string {
  const attrs = [...el.attributes]
    .filter((a) => a.name.startsWith("data-"))
    .map((a) => (a.value ? `${a.name}="${a.value}"` : a.name));
  return `<${el.tagName.toLowerCase()} ${attrs.join(" ")} class="${el.className}">`;
}

describe("R3-F34 结构合同(jsdom;编号是本文件自己的 ①–④,不是规格验收表的 (i)–(v))", () => {
  it("R3-F34 结构合同 ① — 会话视口到面板体之间,每一层都是有界的一列 flex(链断哪一层就报哪一层)", async () => {
    const el = await mount(shell(SHELL_ROUTES.billing));
    const body = el.querySelector<HTMLElement>("[data-otto-panel-body]")!;
    const viewport = body.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]');
    expect(viewport, "面板体里应当有一个会话视口(没有就是这份样本没画出会话流)").not.toBeNull();

    // 从视口的父亲一路数到体(含体):这条链上任何一层退回 display:block 或丢掉
    // `min-h-0`/`flex-1`,视口的 height:100% 就会对着一个由内容撑出来的父亲解析,
    // clientHeight 追上 scrollHeight,滚动行程归零。
    const chain: HTMLElement[] = [];
    for (let node = viewport!.parentElement; node; node = node.parentElement) {
      chain.push(node as HTMLElement);
      if (node === body) break;
    }
    expect(chain.at(-1), "这条链必须一路数得到面板体").toBe(body);

    const broken = chain.filter((node) => !isFlexColumn(node) || !isBoundedFlexItem(node));
    expect(
      broken.map(describeEl),
      "这几层把高度链断掉了 —— 它们必须同时是一列 flex(flex + flex-col)且有界(min-h-0 + flex-1)",
    ).toEqual([]);
  });

  it("R3-F34 结构合同 ② — 回复框在被滚动的那一段**外面**:视口滚它不动,它跟着面板钉在下面(＝规格验收 (ii) 的结构那一半)", async () => {
    const el = await mount(shell(SHELL_ROUTES.billing));
    const body = el.querySelector<HTMLElement>("[data-otto-panel-body]")!;
    const viewport = body.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')!;
    const composer = body.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply to Otto"]');

    expect(composer, "面板体里应当有那个回复框").not.toBeNull();
    // 在体里(它属于面板),但**不在**被滚动的那一段里 —— 会话再长也推不走它。
    expect(body.contains(composer!)).toBe(true);
    expect(viewport.contains(composer!)).toBe(false);
    // 反过来:会话正文必须在视口里,不然就是滚了个空壳。
    const log = body.querySelector<HTMLElement>('[role="log"]')!;
    expect(viewport.contains(log)).toBe(true);
  });

  it("R3-F34 结构合同 ③ — 会话开着的时候,体里面只有会话视口这一个滚动容器(体自己零行程)", async () => {
    const el = await mount(shell(SHELL_ROUTES.billing));
    const body = el.querySelector<HTMLElement>("[data-otto-panel-body]")!;

    // 只数**体的后代**,不数体自己:体的 `overflow-y-auto` 是有意留着的(历史列表靠它滚,
    // 见 ④),而会话开着时体的内容正好等于体高、零行程,所以它不是那个「会抢滚轮」的东西。
    // 真正要钉的是:被滚的那一段里,`overflow-y-auto`/`overflow-auto` 只许有视口一个 ——
    // 多一个就是「滚轮咬在谁身上」这类问题的温床。
    const scrollers = [...body.querySelectorAll<HTMLElement>("*")].filter(
      (node) => node.classList.contains("overflow-y-auto") || node.classList.contains("overflow-auto"),
    );
    expect(scrollers.map(describeEl)).toEqual([
      describeEl(body.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')!),
    ]);
  });

  it("R3-F34 结构合同 ④ — 历史列表这位旧住客没被改坏:它自己不管滚动,仍然靠体滚", async () => {
    const el = await mount(shell(SHELL_ROUTES.billing));
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Conversation history"]')!.click();
    });

    const body = el.querySelector<HTMLElement>("[data-otto-panel-body]")!;
    const wrap = el.querySelector<HTMLElement>("[data-otto-panel-conversation-wrap]")!;
    const list = body.querySelector<HTMLElement>("[data-otto-thread-list]")!;

    // 两者互斥:列表出现的那一刻会话列是 display:none —— 所以任何一刻都只有一个能滚的东西。
    expect(wrap.style.display).toBe("none");
    // 列表自己没有 overflow,它滚的是体 —— 所以体的 `overflow-y-auto` 不能撤。
    expect(body.classList.contains("overflow-y-auto")).toBe(true);
    expect(list.classList.contains("overflow-y-auto")).toBe(false);
    // `shrink-0` 是**写明的意图**,不是修掉了一个当场能演示的 bug:体今天是一列 flex,
    // 而这份列表 `overflow: visible`、没写 `min-height`,CSS 的自动最小尺寸本来就不让它被
    // 压到比内容矮 —— 写出来是为了不把「它不会被压扁」这件事挂在那条隐式规则上(将来谁给它
    // 加一句 `min-h-0` 或 `overflow`,那条隐式规则就没了)。这一条钉的是这份意图还在。
    expect(list.classList.contains("shrink-0")).toBe(true);
  });
});

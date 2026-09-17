// @vitest-environment jsdom
/**
 * R3-F28 守卫 —— 画布交给对话的那几个回调**不许每渲染一次就换一个**。
 *
 * 为什么这条要有围栏。对话那一侧把它们当 effect 依赖用，而那两个 effect 都会回头改这一层的
 * state：`components/otto/OttoChatStream.tsx:1439`（把「这条对话有没有付费任务在跑」报回画板，
 * `onGenerationActivityChange` 在依赖表里）与 `:1139`（消化画板刚递过去的引用，
 * `onComposerReferencesConsumed` 在依赖表里）。依赖每次渲染都换一个 ⇒ effect 每次渲染都重跑
 * ⇒ 每次都回头 setState —— 这正是 React 自己那句 "Maximum update depth exceeded ... one of
 * the dependencies changes on every render"（生产构建里就是 `Minified React error #185`，
 * 2026-09-17 走查两次都是它）所指的形状。
 *
 * 旧写法四个回调全部写在 JSX 里（每渲染一次都是新函数），而 `refreshBalance` 与
 * 「消化引用」那一格每次都**新建一个对象／数组**，哪怕数字与清单一个字没变 —— 于是一次结算
 * 能让这整块面（画布 ＋ 对话）来回重渲十几次，把上面那两个 effect 一次次重新上膛。
 *
 * 这一份钉的是不变量本身，不是某一次崩溃：身份稳定 ＋ 空写入不换身份。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMyAccount: vi.fn(),
  seen: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: vi.fn() }));
// 画板本体不参与这道围栏（它有自己那几份），这里只要它交出来的那两条线。
vi.mock("@/components/canvas/FlowCanvas", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.seen.push({ surface: "canvas", ...props });
    return null;
  },
}));
vi.mock("@/components/canvas/CanvasOttoOverlay", () => ({
  CanvasOttoOverlay: (props: Record<string, unknown>) => {
    mocks.seen.push({ surface: "otto", ...props });
    return null;
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { NorthstarCanvasWorkspace } = await import("@/components/canvas/NorthstarCanvasWorkspace");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const thread = () => ({
  id: "t1",
  projectId: "p1",
  title: "Untitled",
  updatedAt: new Date().toISOString(),
  messages: [],
});

function ottoProps(): Array<Record<string, unknown>> {
  return mocks.seen.filter((p) => p.surface === "otto");
}

function canvasProps(): Array<Record<string, unknown>> {
  return mocks.seen.filter((p) => p.surface === "canvas");
}

beforeEach(() => {
  mocks.seen = [];
  mocks.getMyAccount.mockResolvedValue({ balance: 100, balanceUsd: 10 });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function renderWorkspace(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(NorthstarCanvasWorkspace, {
      runtimeContext: {
        projects: [{ id: "p1", name: "Canvas" }],
        threads: [{ id: "t1", projectId: "p1", title: "Untitled", updatedAt: new Date().toISOString(), pinnedAt: null }],
        activeProjectId: "p1",
        activeThreadId: "t1",
        initialBalance: 100,
        initialBalanceUsd: 10,
        activeThread: thread() as never,
        pendingFirst: null,
      },
      entities: [],
    }));
  });
  await act(async () => { await Promise.resolve(); });
}

describe("R3-F28 · 画布→对话的接缝回调身份稳定", () => {
  it("画板报一次「有付费任务在跑」之后，交给对话的三个回调还是同一个函数", async () => {
    await renderWorkspace();
    const before = ottoProps().at(-1)!;

    // 画板翻牌：`onCanvasJobActivityChange` 是画板每次判定都会叫的那一句。
    await act(async () => {
      (canvasProps().at(-1)!.onCanvasJobActivityChange as (v: boolean) => void)(true);
      await Promise.resolve();
    });
    const after = ottoProps().at(-1)!;

    expect(after).not.toBe(before); // 真的重渲了 —— 下面三条才有意义
    expect(after.onGenerationActivityChange).toBe(before.onGenerationActivityChange);
    expect(after.onComposerReferencesConsumed).toBe(before.onComposerReferencesConsumed);
    expect(after.onPendingFirstSent).toBe(before.onPendingFirstSent);
  });

  it("余额没变的一次重读不改 state：对话那一侧不因此重渲一遍", async () => {
    await renderWorkspace();
    const refresh = canvasProps().at(-1)!.onBalanceRefresh as () => Promise<void>;

    await act(async () => { await refresh(); });
    const renders = ottoProps().length;

    // 同一个数字再读两次 —— 一次结算里这条路会被叫好几遍（预扣、每次轮询收尾、结算）。
    await act(async () => { await refresh(); });
    await act(async () => { await refresh(); });

    expect(ottoProps().length).toBe(renders);
  });

  it("数字真的变了照旧上屏（守卫没有把正常那条路一起关掉）", async () => {
    await renderWorkspace();
    const refresh = canvasProps().at(-1)!.onBalanceRefresh as () => Promise<void>;
    mocks.getMyAccount.mockResolvedValue({ balance: 92, balanceUsd: 9.2 });

    await act(async () => { await refresh(); });

    expect(container!.textContent).toContain("92 credits");
    expect(ottoProps().at(-1)!.balanceUsd).toBe(9.2);
  });

  it("消化一批根本不在清单里的引用 id，引用清单不换身份", async () => {
    await renderWorkspace();
    const consumed = ottoProps().at(-1)!.onComposerReferencesConsumed as (ids: string[]) => void;
    const before = ottoProps().at(-1)!.composerReferences;

    await act(async () => {
      consumed(["not-on-this-list"]);
      await Promise.resolve();
    });

    expect(ottoProps().at(-1)!.composerReferences).toBe(before);
  });
});

// @vitest-environment jsdom
/**
 * FRONT-A10 —— 两个输入口把 `@` 到的类型化引用**真的**送上行。
 *
 * 判官第二轮 P1-1:C2 写的那一半有三处承重接线,上一轮一处都没有真围栏 —— 服务端那一行
 * (`app/api/otto/stream/route.ts` 的 `referenceRefs`,现由 `otto-stream-route.test.ts` 钉住)
 * 与这里这两处:**画布对话的 composer**、**侧栏面板开出来的第一句话**。删掉任一处,全仓照旧
 * 全绿:选择器自己的单元测试只证明 `referencesForSend` 算得对,证明不了有人把它交给 transport。
 *
 * 所以这份文件挂的是**真组件**:真 `OttoChatStream`(真 `useReferencePicker`、真
 * `ReferencePickerMenu`)、真 `OttoPanelConversation`。只有两样是替身:`useChat`(把
 * `sendMessage` 的入参录下来,替代一条真 SSE)与那几个会真的打服务器的动作。一分钱都花不出去。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThreadDTO } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  searchReferencesAction: vi.fn(),
  getMyAccount: vi.fn(),
  getCoworkThreadClient: vi.fn(),
  /** `DefaultChatTransport` 的构造入参 —— `prepareSendMessagesRequest` 就住在里面。 */
  transportOptions: null as null | {
    prepareSendMessagesRequest: (args: { messages: unknown[]; body?: Record<string, unknown> }) => {
      body: Record<string, unknown>;
    };
  },
  chat: { status: "ready" as "ready" | "submitted" | "streaming" | "error", messages: [] as unknown[] },
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
vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(options: unknown) {
      mocks.transportOptions = options as typeof mocks.transportOptions;
    }
  },
}));
vi.mock("@/lib/reference-search-actions", () => ({ searchReferencesAction: mocks.searchReferencesAction }));
vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: mocks.getCoworkThreadClient }));
vi.mock("@/lib/actions", () => ({ uploadReference: vi.fn() }));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: vi.fn() }));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/otto/OttoTrace", () => ({ OttoCanvasStatus: () => null, OttoTrace: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback) => { callback(0); return 0; };

const { OttoChatStream } = await import("@/components/otto/OttoChatStream");
const { OttoPanelConversation } = await import("@/components/otto/panel/OttoPanelConversation");

/** 商家 `@` 得到的那一行 —— 类型化 ID 的线形是 `"<type>:<id>"`。 */
const PRODUCT_ROW = {
  type: "product" as const,
  id: "ent_kopi",
  name: "Kopi cendol tin",
  source: "Product · Otto IQ",
  thumbUrl: null,
};
const PRODUCT_REF = `product:${PRODUCT_ROW.id}`;

const thread: ChatThreadDTO = {
  id: "thr_panel_1",
  projectId: "prj_1",
  title: "Raya launch",
  updatedAt: new Date().toISOString(),
  messages: [],
} as unknown as ChatThreadDTO;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.chat.status = "ready";
  mocks.chat.messages = [];
  mocks.transportOptions = null;
  mocks.sendMessage.mockReset();
  mocks.searchReferencesAction.mockReset();
  mocks.searchReferencesAction.mockResolvedValue({ items: [PRODUCT_ROW], nextCursor: null });
  mocks.getMyAccount.mockResolvedValue({ balance: 120, balanceUsd: 12 });
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function render(element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(element); });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

function composer() {
  return document.getElementById("otto-composer") as HTMLTextAreaElement;
}

/** 一次真的键入 + 让选择器的防抖与那次搜索都落地。 */
async function typeInComposer(value: string) {
  const el = composer();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, value);
    el.setSelectionRange(value.length, value.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

async function press(key: string) {
  await act(async () => {
    composer().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

/** 上一次 `sendMessage` 带的 body —— transport 之前那一层,composer 交出去的就是它。 */
function lastSentBody(): Record<string, unknown> {
  const call = mocks.sendMessage.mock.calls.at(-1);
  return ((call?.[1] as { body?: Record<string, unknown> } | undefined)?.body ?? {}) as Record<string, unknown>;
}

function streamProps(extra: Record<string, unknown> = {}) {
  return {
    layout: "canvas" as const,
    projectId: "prj_1",
    entities: [],
    thread,
    balanceUsd: 12,
    onRefresh: async () => {},
    onThreadUpdate: () => {},
    ...extra,
  };
}

describe("FRONT-A10 —— 画布对话的 composer 把 `@` 到的引用送上行", () => {
  it("FRONT-A10 canvas composer sends the typed references it picked", async () => {
    await render(createElement(OttoChatStream, streamProps()));

    // 真的打一个 `@`,真的从菜单里选中那一行,再真的按 Enter 送出。
    await typeInComposer("@kopi");
    const row = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent?.includes(PRODUCT_ROW.name));
    expect(row, "`@` 菜单里没有那一行 —— 这条测试后面的话就都不算数").toBeDefined();
    await act(async () => {
      row!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    await press("Enter");

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    // 这一格就是承重的那一处:删掉它,商家 `@` 完照样发得出去,而这条消息永远不知道提到了谁。
    expect(lastSentBody().references).toEqual([PRODUCT_REF]);
    // 实体那一格(生成条件)是另一条路,两条并存、不互相取代。
    expect(lastSentBody().entityIds).toEqual([PRODUCT_ROW.id]);
  });

  it("FRONT-A10 一件都没 @ 的一轮不发这一格(空表不当成「有引用」上行)", async () => {
    await render(createElement(OttoChatStream, streamProps()));

    await typeInComposer("just talk to me");
    await press("Enter");

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(lastSentBody().references).toBeUndefined();
  });

  it("FRONT-A10 transport 那一层把 references 原样交给 /api/otto/stream 的 body", async () => {
    await render(createElement(OttoChatStream, streamProps()));

    const prepared = mocks.transportOptions!.prepareSendMessagesRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
      body: { projectId: "prj_1", threadId: thread.id, references: [PRODUCT_REF] },
    });

    expect(prepared.body.references).toEqual([PRODUCT_REF]);
    // 没有引用的一轮不许凭空多出一个空表 —— 服务端的 zod 是 `.strict()`,多一格空表是噪音。
    const bare = mocks.transportOptions!.prepareSendMessagesRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
      body: { projectId: "prj_1", threadId: thread.id },
    });
    expect(bare.body.references).toBeUndefined();
  });
});

describe("FRONT-A10 —— 侧栏面板开出来的第一句话也带着引用", () => {
  /**
   * 面板的前门建完空会话,把第一句话交给 `OttoChatStream` 自动发出去。`OttoPanelConversation`
   * 是那次交接的中转:少写 `references: pendingFirst.references` 这一格,面板里开的每一条对话
   * 从第一句起就没有引用可回链 —— 而画布那一侧完全正常,商家只会觉得「侧栏的记不住」。
   */
  it("FRONT-A10 panel hands the first message's references to the stream, which sends them", async () => {
    await render(
      createElement(OttoPanelConversation, {
        state: {
          status: "ready",
          seed: { projectId: "prj_1", balanceUsd: 12, entities: [], userName: "Ari" },
          threads: [thread],
          activeThreadId: thread.id,
          pendingFirst: {
            threadId: thread.id,
            text: "@Kopi cendol tin for Raya",
            entityIds: [PRODUCT_ROW.id],
            references: [PRODUCT_REF],
          },
        },
        onThreadStarted: vi.fn(),
        onStreamStart: vi.fn(),
        onThreadUpdate: vi.fn(),
        onActiveThreadChange: vi.fn(),
        onPendingFirstSent: vi.fn(),
      } as never),
    );

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(lastSentBody().references).toEqual([PRODUCT_REF]);
    expect(lastSentBody().entityIds).toEqual([PRODUCT_ROW.id]);
  });
});

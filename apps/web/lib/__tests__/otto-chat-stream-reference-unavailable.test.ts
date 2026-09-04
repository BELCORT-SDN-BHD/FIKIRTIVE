// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 判官 P1-1(PR #1177)—— 商家侧那半条修法的行为测试。
 *
 * 路由在 SSE 打开之前就整轮拒绝(一件挂上来的参考取不到),商家手上剩下的是一个普通 400。
 * 这里钉死三件事,它们此前只有代码没有测试:
 *   ① 只有 `referenceUnavailableSentence` 认得出的那两句才准上屏 —— 代理的 HTML 错误页、
 *      堆栈、内部串一律走界面自己的诚实兜底句;
 *   ② 这一轮的草稿回到输入框 —— 否则商家要把整段话重打一遍;
 *   ③ 附件芯片回到输入框,而且它的 blob 预览**还没被撤销** —— revoke 的时机被从「送出那一刻」
 *      挪到了「知道服务端收下了」那一刻,漏一条路径,放回去的就是一张已撤销的黑图。
 *
 * 挂法与 mock 形状照抄同目录的 `otto-chat-stream-transport-error.test.ts`(#949 A2)。
 */
const { chatState, sendMessageMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
  chatState: {
    status: "ready" as "ready" | "submitted" | "streaming" | "error",
    error: null as Error | null,
    messages: [] as Array<{
      id: string;
      role: "user" | "assistant";
      parts: Array<{ type: "text"; text: string }>;
    }>,
  },
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chatState.messages,
    setMessages: vi.fn(),
    sendMessage: sendMessageMock,
    status: chatState.status,
    error: chatState.error,
  }),
}));
vi.mock("ai", () => ({
  DefaultChatTransport: class { constructor(_opts: unknown) { void _opts; } },
}));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: vi.fn() }));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: vi.fn() }));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: vi.fn() }));

import { referenceUnavailableMessage } from "@fikirtive/core/gen-failure";
import { OttoChatStream } from "@/components/otto/OttoChatStream";
import type { OttoComposerReference } from "@/lib/canvas-chat-reference";
import type { ChatThreadDTO } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 路由真正回给客户端的那一句 —— 从单一源读,不在测试里再抄一份。 */
const REFUSAL_SENTENCE = referenceUnavailableMessage("notFound");
/** `DefaultChatTransport` 把 400 的 body 原样塞进 `Error.message`,body 是这个信封。 */
const refusalBody = (sentence: string) => JSON.stringify({ error: sentence });

const DRAFT = "Put her in the new hoodie, same lighting.";
const REF_BLOB_SRC = "blob:http://localhost/otto-ref-1";

/** 画布交上来的引用。identity 稳定,免得组件的 handoff effect 在重渲染时把它再塞一次回来 ——
 *  芯片回到输入框必须是「扣在手里的那一份被放回去了」,不能是 handoff 帮的忙。 */
const COMPOSER_REFERENCES: OttoComposerReference[] = [{
  requestId: "req-1",
  generationId: "gen-ref-1",
  src: REF_BLOB_SRC,
  kind: "image",
  previewKind: "image",
  label: "Image ref",
}];
const onComposerReferencesConsumed = vi.fn();

const emptyThread: ChatThreadDTO = {
  id: "thread-1",
  projectId: "project-1",
  title: "Untitled",
  updatedAt: new Date().toISOString(),
  messages: [],
};

const element = (): ReactElement => createElement(OttoChatStream, {
  projectId: "project-1",
  entities: [],
  thread: emptyThread,
  balanceUsd: 10,
  onRefresh: async () => {},
  onThreadUpdate: () => {},
  composerReferences: COMPOSER_REFERENCES,
  onComposerReferencesConsumed,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let originalRevoke: typeof URL.revokeObjectURL;

beforeEach(() => {
  chatState.status = "ready";
  chatState.error = null;
  chatState.messages = [];
  sendMessageMock.mockReset();
  onComposerReferencesConsumed.mockReset();
  originalRevoke = URL.revokeObjectURL;
  revokeObjectURL = vi.fn();
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  URL.revokeObjectURL = originalRevoke;
  vi.clearAllMocks();
});

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element()));
  return container;
}

function composerOf(dom: HTMLDivElement): HTMLTextAreaElement {
  const composer = dom.querySelector<HTMLTextAreaElement>("#otto-composer");
  if (!composer) throw new Error("composer not mounted");
  return composer;
}

/** 打字 + Enter 送出这一轮(与既有测试同一条路径)。 */
async function sendTurn(dom: HTMLDivElement, draft: string): Promise<void> {
  const composer = composerOf(dom);
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(composer, draft);
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

/** 服务端用一个普通 400 把整轮退回来,body 就是 `body`。 */
async function refuseTurn(body: string): Promise<void> {
  chatState.status = "error";
  chatState.error = new Error(body);
  await act(async () => { root!.render(element()); });
  // 放回去的三个 setState 走 `queueMicrotask`(与卡上那个计时器同一条写法),多刷一拍。
  await act(async () => { await Promise.resolve(); });
}

/** 附件条里那一件芯片(按它自己的移除按钮认)。 */
function chipRemoveButton(dom: HTMLDivElement): Element | null {
  return dom.querySelector('[aria-label="Remove Image ref"]');
}

describe("OttoChatStream —— 参考取不到时整轮被退回(判官 P1-1)", () => {
  it("CREATE-A2 认得出的那一句:上屏、草稿回到输入框、附件芯片回来且预览没被撤销", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const dom = await mount();

    // 送出前:芯片在,草稿在。
    expect(chipRemoveButton(dom)).not.toBeNull();
    await sendTurn(dom, DRAFT);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    // 送出后输入框先清空 —— 这正是「不放回去就得重打一遍」的那一刻。
    expect(composerOf(dom).value).toBe("");
    expect(chipRemoveButton(dom)).toBeNull();

    await refuseTurn(refusalBody(REFUSAL_SENTENCE));

    // ① 那一句以人话上屏(既有的附件错误位;`status === "error"` 的通用兜底条同时也在,
    //    是 #949 A2 既有形状,这里不去钉它)。
    expect(dom.textContent).toContain(REFUSAL_SENTENCE);
    // ② 草稿原样回到输入框。
    expect(composerOf(dom).value).toBe(DRAFT);
    // ③ 要移掉的那一件就在附件条里,而且它的 blob 预览一次都没被撤销 —— 放回去的是真图。
    expect(chipRemoveButton(dom)).not.toBeNull();
    expect(dom.querySelector<HTMLImageElement>('img[alt="Attached reference"]')?.getAttribute("src"))
      .toBe(REF_BLOB_SRC);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    // ④ 这一轮没有留下一条 USER 消息 —— 对话区里没有商家那句话的气泡,它只在输入框里
    //    (durable 侧的「不建对话、不落 USER 消息」由 `otto-stream-route.test.ts` 的真路由测试钉)。
    expect(dom.querySelector('[data-slot="bubble"][data-variant="default"]')).toBeNull();
    expect(dom.querySelector('[data-slot="message-scroller-content"]')?.textContent)
      .not.toContain(DRAFT);

    consoleError.mockRestore();
  });

  it("CREATE-A2 fileMissing 那一句同样认得出,走同一条放回去的路", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fileMissing = referenceUnavailableMessage("fileMissing");
    const dom = await mount();
    await sendTurn(dom, DRAFT);
    await refuseTurn(refusalBody(fileMissing));

    expect(dom.textContent).toContain(fileMissing);
    expect(composerOf(dom).value).toBe(DRAFT);
    expect(chipRemoveButton(dom)).not.toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("CREATE-A2 不是我方文案(代理的 HTML 错误页):那段 HTML 不上屏,走既有的通用错误路", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const proxyPage = "<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>";
    const dom = await mount();
    await sendTurn(dom, DRAFT);
    await refuseTurn(proxyPage);

    // 商家看到的是界面自己的诚实兜底句,不是代理写的那一页。
    expect(dom.textContent).not.toContain("502 Bad Gateway");
    expect(dom.textContent).not.toContain("<html");
    expect(dom.textContent).toContain("Otto hit a snag — please try again.");
    // 不是「取不到参考」,就不放回去:草稿与芯片不复原,扣着的 blob 预览在这一刻释放。
    expect(composerOf(dom).value).toBe("");
    expect(chipRemoveButton(dom)).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith(REF_BLOB_SRC);
    // 原始文本只进 console,不进屏幕(#949 A2 的纪律)。
    expect(consoleError).toHaveBeenCalledWith("[OttoChatStream] transport error:", chatState.error);

    consoleError.mockRestore();
  });

  it("CREATE-A2 差一个字的仿句也不放行:不上屏,当作普通传输错误收场", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    // 尾巴上被挂了一个 id —— 白名单是精确匹配,正是为了挡住这一类。
    const nearMiss = `${REFUSAL_SENTENCE} (ref_01H8XYZ)`;
    const dom = await mount();
    await sendTurn(dom, DRAFT);
    await refuseTurn(refusalBody(nearMiss));

    expect(dom.textContent).not.toContain("ref_01H8XYZ");
    expect(dom.textContent).toContain("Otto hit a snag — please try again.");
    expect(composerOf(dom).value).toBe("");
    expect(revokeObjectURL).toHaveBeenCalledWith(REF_BLOB_SRC);

    consoleError.mockRestore();
  });
});

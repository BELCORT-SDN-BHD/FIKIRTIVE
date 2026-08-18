// @vitest-environment jsdom
/**
 * otto-brand-chat-recovery.test.ts — BUG 6 的第二层:Brand & products 的聊天记录只活在
 * 组件 state 里,而这个视图从服务端拿不到任何会话(OttoView 只给它 memory/records/projectId)。
 * 所以任何一次卸载 —— 刷新、切项目、切会话 —— 都同时丢掉记录和「刚才那条会话是哪条」的指针,
 * 商家的下一句话会另开一条新会话,前面说过的话再也回不来。
 *
 * 修法(最小且诚实):只把会话 ID 按项目记在 sessionStorage,消息本身仍由服务端做权威 ——
 * 重挂时用同一个 getCoworkThreadClient 把记录读回来。
 *
 * 这里断言的是行为:真的挂一次、真的发一句、真的卸载再挂一次,看屏幕上还在不在,
 * 以及下一句话有没有回到同一条会话。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ottoTurnMock, getThreadMock, server } = vi.hoisted(() => ({
  ottoTurnMock: vi.fn(),
  getThreadMock: vi.fn(),
  server: { messages: [] as Array<{ role: string; text: string }> },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/otto",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/otto-client-actions", () => ({ ottoTurn: ottoTurnMock }));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: getThreadMock }));
vi.mock("@/lib/memory-actions", () => ({
  addMemory: vi.fn(), updateMemory: vi.fn(), deleteMemory: vi.fn(),
  listMyMemory: vi.fn(async () => []),
}));
vi.mock("@/lib/brand-record-actions", () => ({
  saveBrandRecord: vi.fn(), deleteBrandRecord: vi.fn(), restoreBrandRecord: vi.fn(),
  listMyBrandRecords: vi.fn(async () => []),
}));
vi.mock("@/lib/product-ingest-actions", () => ({ ingestProductFromUrl: vi.fn() }));
vi.mock("@/components/otto/stuff/StuffLibrary", () => ({ StuffLibrary: () => null }));

const { OttoMemory } = await import("@/components/otto/OttoMemory");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
  server.messages = [];
  getThreadMock.mockImplementation(async (id: string) =>
    id === "thread_brand" ? { id, messages: server.messages } : null);
  ottoTurnMock.mockImplementation(async ({ text }: { text: string }) => {
    server.messages = [...server.messages, { role: "USER", text }, { role: "AGENT", text: "Saved that." }];
    return { threadId: "thread_brand", status: "done" };
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function mount(projectId = "proj_1"): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(
    createElement(OttoMemory, { initialMemory: [], initialRecords: [], projectId }),
  ));
  return container;
}

async function unmount() {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
}

async function say(dom: HTMLDivElement, text: string) {
  const box = dom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Tell Otto about your brand"]')!;
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const send = [...dom.querySelectorAll("button")].find((b) => b.textContent?.includes("Send"))!;
  await act(async () => send.click());
}

describe("BUG 6 — the brand conversation survives a remount", () => {
  it("brings the transcript back after the tree is remounted", async () => {
    const first = await mount();
    await say(first, "We sell hand-poured candles.");
    expect(first.textContent).toContain("We sell hand-poured candles.");
    expect(first.textContent).toContain("Saved that.");

    await unmount(); // whatever caused it — reload, project switch, a background revalidate

    const second = await mount();
    expect(second.textContent).toContain("We sell hand-poured candles."); // the regression: gone
    expect(second.textContent).toContain("Saved that.");
  });

  it("keeps replying into the SAME conversation instead of opening a second one", async () => {
    const first = await mount();
    await say(first, "We sell hand-poured candles.");
    await unmount();

    const second = await mount();
    await say(second, "Our customers are gift buyers.");

    expect(ottoTurnMock).toHaveBeenLastCalledWith(expect.objectContaining({ threadId: "thread_brand" }));
  });

  it("remembers per project — another project's brand chat is not shown here", async () => {
    const first = await mount("proj_1");
    await say(first, "We sell hand-poured candles.");
    await unmount();

    const other = await mount("proj_2");

    expect(other.textContent).not.toContain("We sell hand-poured candles.");
  });

  it("drops the pointer when the conversation is really gone (deleted), and starts a fresh one", async () => {
    const first = await mount();
    await say(first, "We sell hand-poured candles.");
    await unmount();

    getThreadMock.mockResolvedValue(null); // deleted from the conversation rail
    const second = await mount();
    expect(second.textContent).not.toContain("We sell hand-poured candles.");

    getThreadMock.mockImplementation(async (id: string) => ({ id, messages: server.messages }));
    await say(second, "Starting over.");
    expect(ottoTurnMock).toHaveBeenLastCalledWith(expect.not.objectContaining({ threadId: expect.anything() }));
  });
});

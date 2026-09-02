// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #949 A2 — a bare useChat transport failure (network drop, parse failure) used to
// render `error.message` verbatim ("Failed to fetch" and the like) straight into the
// chat. That's developer-facing text, not something a merchant can act on. The fix:
// always show the fixed friendly copy and push the raw message to console.error only.
const { chatState, sendMessageMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
  chatState: {
    status: "error" as "ready" | "error",
    error: new Error("Failed to fetch") as Error | null,
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
// Real DefaultChatTransport is still constructed once (in OttoChatStream's chatInit
// state initializer) even with useChat mocked — harmless, but stub it so the real "ai"
// package's fetch/stream machinery is never in play for this render-only test.
vi.mock("ai", () => ({
  DefaultChatTransport: class { constructor(_opts: unknown) { void _opts; } },
}));
// Server-action modules ("use server" + Prisma) this component only calls from
// handlers/effects, never at mount — stub so importing them doesn't need a live DB.
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: vi.fn() }));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: vi.fn() }));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: vi.fn() }));

import { OttoChatStream } from "@/components/otto/OttoChatStream";
import type { ChatThreadDTO } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  chatState.status = "error";
  chatState.error = new Error("Failed to fetch");
  chatState.messages = [];
  sendMessageMock.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

const emptyThread: ChatThreadDTO = {
  id: "thread-1",
  projectId: "project-1",
  title: "Untitled",
  updatedAt: new Date().toISOString(),
  messages: [],
};

describe("OttoChatStream transport error (#949 A2)", () => {
  it("shows the friendly fallback, never the raw error.message, and logs the raw error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const dom = await render(
      createElement(OttoChatStream, {
        projectId: "project-1",
        entities: [],
        thread: emptyThread,
        balanceUsd: 0,
        onRefresh: async () => {},
        onThreadUpdate: () => {},
      }),
    );

    expect(dom.textContent).toContain("Otto hit a snag — please try again.");
    expect(dom.textContent).not.toContain("Failed to fetch");
    expect(consoleError).toHaveBeenCalledWith(
      "[OttoChatStream] transport error:",
      chatState.error,
    );

    consoleError.mockRestore();
  });

  it("renders the shared main-and-panel transcript through shadcn chat primitives", async () => {
    chatState.status = "ready";
    chatState.error = null;
    chatState.messages = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Plan a launch." }] },
      { id: "otto-1", role: "assistant", parts: [{ type: "text", text: "Let's build the brief." }] },
    ];

    const dom = await render(
      createElement(OttoChatStream, {
        projectId: "project-1",
        entities: [],
        thread: emptyThread,
        balanceUsd: 0,
        onRefresh: async () => {},
        onThreadUpdate: () => {},
      }),
    );

    expect(dom.querySelector('[data-slot="message-scroller"]')).not.toBeNull();
    expect(dom.querySelectorAll(
      '[data-slot="message-scroller-content"] > [data-slot="message-scroller-item"]',
    )).toHaveLength(2);
    expect(dom.querySelector('[data-slot="bubble"][data-variant="default"]')?.textContent)
      .toContain("Plan a launch.");
    expect(dom.querySelector('[data-slot="bubble"][data-variant="outline"]')?.textContent)
      .toContain("Let's build the brief.");
    expect(dom.querySelector('[role="log"]')?.getAttribute("aria-label"))
      .toBe("Conversation with Otto");
  });

  it("uses Enter to send and synchronously locks a repeated submit", async () => {
    chatState.status = "ready";
    chatState.error = null;
    const dom = await render(
      createElement(OttoChatStream, {
        projectId: "project-1",
        entities: [],
        thread: emptyThread,
        balanceUsd: 0,
        onRefresh: async () => {},
        onThreadUpdate: () => {},
      }),
    );
    const composer = dom.querySelector<HTMLTextAreaElement>('#otto-composer')!;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(composer, "Plan a launch.");
      composer.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    });
    expect(sendMessageMock).not.toHaveBeenCalled();

    await act(async () => {
      composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });
});

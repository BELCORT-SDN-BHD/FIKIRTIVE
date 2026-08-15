// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// #949 A2 — a bare useChat transport failure (network drop, parse failure) used to
// render `error.message` verbatim ("Failed to fetch" and the like) straight into the
// chat. That's developer-facing text, not something a merchant can act on. The fix:
// always show the fixed friendly copy and push the raw message to console.error only.
const { chatState } = vi.hoisted(() => ({
  chatState: {
    status: "error" as const,
    error: new Error("Failed to fetch"),
  },
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    setMessages: vi.fn(),
    sendMessage: vi.fn(),
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
// use-stick-to-bottom relies on ResizeObserver, which jsdom doesn't implement.
vi.mock("use-stick-to-bottom", () => ({
  useStickToBottom: () => ({
    scrollRef: { current: null },
    contentRef: { current: null },
    isAtBottom: true,
    scrollToBottom: vi.fn(),
  }),
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
});

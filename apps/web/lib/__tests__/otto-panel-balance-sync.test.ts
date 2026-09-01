import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => ({ props: null as null | { onBalanceRefresh?: () => void } }));

vi.mock("@/components/otto/OttoChatStream", () => ({
  OttoChatStream: (props: { onBalanceRefresh?: () => void }) => {
    capture.props = props;
    return createElement("div", { "data-chat-stream": "" });
  },
}));
vi.mock("@/components/otto/OttoFrontDoor", () => ({
  OttoFrontDoor: () => createElement("div", { "data-front-door": "" }),
}));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: vi.fn() }));

import { OttoPanelConversation } from "@/components/otto/panel/OttoPanelConversation";
import { subscribeBalanceRefresh } from "@/lib/balance-refresh";

describe("the global Otto panel keeps the navigation balance fresh", () => {
  it("publishes the shared balance signal when the active stream reports a settled spend", () => {
    const thread = {
      id: "thread-1",
      projectId: "project-1",
      title: "Raya launch",
    };

    renderToStaticMarkup(
      createElement(OttoPanelConversation, {
        state: {
          status: "ready",
          seed: {
            projectId: "project-1",
            balanceUsd: 10,
            entities: [],
            userName: "Ari",
          },
          threads: [thread],
          activeThreadId: thread.id,
          pendingFirst: null,
        } as never,
        onThreadStarted: vi.fn(),
        onStreamStart: vi.fn(),
        onThreadUpdate: vi.fn(),
        onActiveThreadChange: vi.fn(),
        onPendingFirstSent: vi.fn(),
      }),
    );

    expect(capture.props?.onBalanceRefresh).toBeTypeOf("function");
    const listener = vi.fn();
    const unsubscribe = subscribeBalanceRefresh(listener);
    capture.props?.onBalanceRefresh?.();
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

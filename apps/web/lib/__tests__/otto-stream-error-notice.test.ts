import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OttoStreamErrorNotice } from "@/components/otto/OttoStreamErrorNotice";
import { persistedStreamErrorOf } from "@/lib/otto-status-helpers";
import { threadToUiMessages } from "@/lib/otto-ui-messages";
import type { ChatThreadDTO } from "@/lib/types";

function renderNotice(
  error: { kind: "insufficient_credits" | "error"; text: string },
  retryDraft?: string,
): string {
  return renderToStaticMarkup(createElement(OttoStreamErrorNotice, {
    error,
    retryDraft,
    onRetry: retryDraft ? vi.fn() : undefined,
  }));
}

describe("OttoStreamErrorNotice", () => {
  it("renders the first-turn insufficient-credits notice with the server copy and top-up guidance", () => {
    const markup = renderNotice({
      kind: "insufficient_credits",
      text: "You're out of credits.",
    });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("You&#x27;re out of credits.");
    expect(markup).toContain('href="/billing"');
    expect(markup).toContain("Top up");
  });

  it("rehydrates the user message and honest failure after a remount", () => {
    const thread: ChatThreadDTO = {
      id: "thread_1",
      projectId: "project_1",
      title: "Launch post",
      updatedAt: "2026-07-23T00:00:00.000Z",
      messages: [
        {
          id: "user_1",
          role: "USER",
          kind: "TEXT",
          seq: 1,
          text: "Make a launch post",
          payload: null,
          genJobId: null,
          createdAt: "2026-07-23T00:00:00.000Z",
        },
        {
          id: "error_1",
          role: "AGENT",
          kind: "TURN_ERROR",
          seq: 2,
          text: "You're out of credits.",
          payload: {
            kind: "stream_run_error",
            userMessageId: "user_1",
            error: { kind: "insufficient_credits", text: "You're out of credits." },
          },
          genJobId: null,
          createdAt: "2026-07-23T00:00:01.000Z",
        },
      ],
    };

    const rehydrated = threadToUiMessages(thread);
    const durableError = persistedStreamErrorOf(
      rehydrated[1].metadata?.payload,
      "fallback must not replace server copy",
    );

    expect(rehydrated[0]).toMatchObject({
      role: "user",
      parts: [{ type: "text", text: "Make a launch post" }],
    });
    expect(durableError).toEqual({
      kind: "insufficient_credits",
      text: "You're out of credits.",
    });
    expect(renderNotice(durableError)).toContain("Top up");
  });

  it("keeps the existing generic reply failure presentation and retry action", () => {
    const markup = renderNotice(
      { kind: "error", text: "Otto hit a snag - please try again." },
      "Try another post",
    );

    expect(markup).toContain("Otto hit a snag - please try again.");
    expect(markup).toContain("Edit and retry");
    expect(markup).not.toContain("Top up");
  });
});

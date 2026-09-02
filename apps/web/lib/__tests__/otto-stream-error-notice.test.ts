import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/storage", () => ({
  storage: { url: () => "https://example.test/asset" },
  kindOf: () => "image",
}));

import { OttoStreamErrorNotice } from "@/components/otto/OttoStreamErrorNotice";
import { toChatMessageDTO } from "@/lib/dto";
import { persistedStreamErrorOf } from "@/lib/otto-status-helpers";
import { threadToUiMessages } from "@/lib/otto-ui-messages";
import type { OttoErrorData } from "@/lib/otto-stream-bridge";
import type { ChatThreadDTO } from "@/lib/types";

function renderNotice(
  error: OttoErrorData,
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
    const createdAt = new Date("2026-07-23T00:00:00.000Z");
    const userMessage = toChatMessageDTO({
      id: "user_1",
      role: "USER",
      kind: "TEXT",
      seq: 1,
      text: "Make a launch post",
      payload: null,
      genJobId: null,
      createdAt,
    } as never, new Map());
    const failureMessage = toChatMessageDTO({
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
      createdAt,
    } as never, new Map());
    const thread: ChatThreadDTO = {
      id: "thread_1",
      projectId: "project_1",
      title: "Launch post",
      updatedAt: "2026-07-23T00:00:00.000Z",
      messages: [userMessage, failureMessage],
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
    const markup = renderNotice(durableError);
    expect(markup).toContain('href="/billing"');
    expect(markup).toContain("Top up");
  });

  // #524 — the spend cap is a real refusal now, so its notice must point at the limit the
  // merchant can actually move. A Top-up link here would send them to buy credits they
  // already have, for an action their own setting stopped.
  it("points a spend-cap refusal at Settings, never at Billing", () => {
    const markup = renderNotice({
      kind: "spend_cap",
      text: "Paused by your spend cap — this needs 11 credits and your cap is 5 credits per action. Raise the cap in Billing & credits to run it.",
    });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Paused by your spend cap");
    // W2-11:落地地址从旧壳的 /otto?view=account 换成真路由 SHELL_ROUTES.preferences(/settings)。
    expect(markup).toContain('href="/settings"');
    expect(markup).toContain("Open settings");
    expect(markup).not.toContain("Top up");
    expect(markup).not.toContain('href="/billing"');
  });

  // The durable TURN_ERROR row must carry the spend-cap kind through a reload, or a refresh
  // silently downgrades the refusal to a generic error and the exit disappears.
  it("rehydrates a persisted spend-cap refusal with its own kind", () => {
    const createdAt = new Date("2026-08-11T00:00:00.000Z");
    const failureMessage = toChatMessageDTO({
      id: "error_2",
      role: "AGENT",
      kind: "TURN_ERROR",
      seq: 2,
      text: "Paused by your spend cap.",
      payload: {
        kind: "stream_run_error",
        userMessageId: "user_1",
        error: { kind: "spend_cap", text: "Paused by your spend cap." },
      },
      genJobId: null,
      createdAt,
    } as never, new Map());
    const thread: ChatThreadDTO = {
      id: "thread_2",
      projectId: "project_1",
      title: "Launch post",
      updatedAt: "2026-08-11T00:00:00.000Z",
      messages: [failureMessage],
    };

    const durableError = persistedStreamErrorOf(
      threadToUiMessages(thread)[0].metadata?.payload,
      "fallback must not replace server copy",
    );

    expect(durableError).toEqual({ kind: "spend_cap", text: "Paused by your spend cap." });
    // W2-11:落地地址从旧壳的 /otto?view=account 换成真路由 SHELL_ROUTES.preferences(/settings)。
    expect(renderNotice(durableError)).toContain('href="/settings"');
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

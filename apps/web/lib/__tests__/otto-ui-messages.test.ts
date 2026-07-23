/**
 * otto-ui-messages.test.ts — unit tests for the PURE threadToUiMessages mapper
 * (the seed for OttoChatStream's useChat). The mapper has no React / @ai-sdk/react
 * dependency at runtime (type-only `ai` import), so it runs in the node harness.
 *
 * NOTE: apps/web has NO React component test harness (vitest environment is "node",
 * no jsdom/@testing-library/react). So the brief's "render smoke" is covered here
 * at the mapper level: assert both a USER and an AGENT TEXT message map to the
 * expected role + text part, and that non-TEXT durable kinds become a placeholder
 * that carries metadata for Task 5.
 */
import { describe, it, expect } from "vitest";
import { threadToUiMessages } from "@/lib/otto-ui-messages";
import type { ChatThreadDTO, ChatMessageDTO } from "@/lib/types";

function msg(over: Partial<ChatMessageDTO> & Pick<ChatMessageDTO, "id" | "role" | "kind">): ChatMessageDTO {
  return {
    seq: 1,
    text: "",
    payload: null,
    genJobId: null,
    createdAt: "2026-06-25T00:00:00.000Z",
    ...over,
  };
}

function thread(messages: ChatMessageDTO[]): ChatThreadDTO {
  return { id: "thr_1", projectId: "proj_1", title: "Test thread", updatedAt: "2026-06-25T00:00:00.000Z", messages };
}

describe("threadToUiMessages", () => {
  it("maps a USER and an AGENT TEXT message to role + single text part", () => {
    const out = threadToUiMessages(
      thread([
        msg({ id: "m1", role: "USER", kind: "TEXT", seq: 1, text: "make me an ad" }),
        msg({ id: "m2", role: "AGENT", kind: "TEXT", seq: 2, text: "Sure — here's a plan." }),
      ]),
    );

    expect(out).toHaveLength(2);
    expect(out[0].role).toBe("user");
    expect(out[0].parts).toEqual([{ type: "text", text: "make me an ad" }]);
    expect(out[1].role).toBe("assistant");
    expect(out[1].parts).toEqual([{ type: "text", text: "Sure — here's a plan." }]);
    // durable id reused as the UIMessage id
    expect(out[0].id).toBe("m1");
    expect(out[1].id).toBe("m2");
  });

  it("renders a visible placeholder for non-TEXT kinds and carries Task-5 metadata", () => {
    const out = threadToUiMessages(
      thread([
        msg({ id: "c1", role: "AGENT", kind: "GEN_CARD", payload: { kind: "image" }, genJobId: "job_9" }),
        msg({ id: "r1", role: "AGENT", kind: "GEN_RESULT", payload: { urls: ["u"] }, genJobId: "job_9" }),
      ]),
    );

    // placeholder text is visible (so reload doesn't silently drop history)
    expect(out[0].parts).toEqual([{ type: "text", text: "📋 plan card" }]);
    expect(out[1].parts).toEqual([{ type: "text", text: "🖼 result" }]);

    // metadata carries kind / payload / genJobId for Task 5 to swap in the real widget
    expect(out[0].metadata).toEqual({
      durableId: "c1",
      kind: "GEN_CARD",
      payload: { kind: "image" },
      genJobId: "job_9",
    });
    expect(out[1].metadata?.kind).toBe("GEN_RESULT");
  });

  it("uses the durable user-facing copy for DENIAL / TURN_ERROR", () => {
    const out = threadToUiMessages(
      thread([
        msg({ id: "d1", role: "AGENT", kind: "DENIAL", text: "I can't help with that." }),
        msg({
          id: "e1",
          role: "AGENT",
          kind: "TURN_ERROR",
          text: "You're out of credits.",
          payload: {
            kind: "stream_run_error",
            userMessageId: "u1",
            error: { kind: "insufficient_credits", text: "You're out of credits." },
          },
        }),
      ]),
    );
    expect(out[0].parts).toEqual([{ type: "text", text: "I can't help with that." }]);
    expect(out[1].parts).toEqual([{ type: "text", text: "You're out of credits." }]);
    expect(out[1].metadata?.payload).toEqual({
      kind: "stream_run_error",
      userMessageId: "u1",
      error: { kind: "insufficient_credits", text: "You're out of credits." },
    });
  });
});

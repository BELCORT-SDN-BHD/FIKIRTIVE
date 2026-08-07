import { beforeEach, describe, expect, it, vi } from "vitest";

const chatMessageFindFirst = vi.fn();
const chatMessageCreate = vi.fn();
const newId = vi.fn();

vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatMessage: {
      findFirst: chatMessageFindFirst,
      create: chatMessageCreate,
    },
  },
}));

vi.mock("@fikirtive/core", () => ({
  newId,
}));

const { persistStreamTurnError, streamTurnErrorId, streamTurnErrorText } = await import("../otto-stream-errors");

beforeEach(() => {
  chatMessageFindFirst.mockReset();
  chatMessageCreate.mockReset();
  newId.mockReset();
  newId.mockReturnValue("01JTEST000000000ABCDEF12");
});

describe("streamTurnErrorId", () => {
  it("builds a short support-safe reference id", () => {
    expect(streamTurnErrorId()).toBe("OTTO-ABCDEF12");
  });
});

describe("persistStreamTurnError", () => {
  it("writes a tenant-scoped durable TURN_ERROR after the latest message seq", async () => {
    chatMessageFindFirst.mockResolvedValue({ seq: 9 });

    await persistStreamTurnError({
      ownerId: "org_1",
      threadId: "thread_1",
      seqAfterUser: 4,
      userMessageId: "msg_user",
      refId: "otto-stream:msg_user",
      errorId: "OTTO-ERR12345",
      error: {
        kind: "error",
        text: streamTurnErrorText("OTTO-ERR12345"),
      },
    });

    expect(chatMessageFindFirst).toHaveBeenCalledWith({
      where: { threadId: "thread_1", ownerId: "org_1" },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    expect(chatMessageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "01JTEST000000000ABCDEF12",
        threadId: "thread_1",
        ownerId: "org_1",
        role: "AGENT",
        kind: "TURN_ERROR",
        seq: 10,
        text: "Otto hit a snag — please try again. Reference: OTTO-ERR12345",
        payload: {
          errorId: "OTTO-ERR12345",
          refId: "otto-stream:msg_user",
          userMessageId: "msg_user",
          kind: "stream_run_error",
          error: {
            kind: "error",
            text: "Otto hit a snag — please try again. Reference: OTTO-ERR12345",
          },
        },
      }),
    });
  });

  it("persists the exact insufficient-credits kind and text without inventing an error id", async () => {
    chatMessageFindFirst.mockResolvedValue({ seq: 1 });

    await persistStreamTurnError({
      ownerId: "org_1",
      threadId: "thread_1",
      seqAfterUser: 1,
      userMessageId: "msg_user",
      refId: "otto-stream:msg_user",
      error: {
        kind: "insufficient_credits",
        text: "You're out of credits.",
      },
    });

    expect(chatMessageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: "AGENT",
        kind: "TURN_ERROR",
        seq: 2,
        text: "You're out of credits.",
        payload: {
          refId: "otto-stream:msg_user",
          userMessageId: "msg_user",
          kind: "stream_run_error",
          error: {
            kind: "insufficient_credits",
            text: "You're out of credits.",
          },
        },
      }),
    });
  });
});

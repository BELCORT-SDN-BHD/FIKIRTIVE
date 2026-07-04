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
      text: streamTurnErrorText("OTTO-ERR12345"),
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
        text: "Otto hit a snag - please try again. Reference: OTTO-ERR12345",
        payload: {
          errorId: "OTTO-ERR12345",
          refId: "otto-stream:msg_user",
          userMessageId: "msg_user",
          kind: "stream_run_error",
        },
      }),
    });
  });
});

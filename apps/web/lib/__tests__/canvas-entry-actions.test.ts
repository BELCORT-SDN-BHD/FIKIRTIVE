import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  revalidatePath: vi.fn(),
  projectFindFirst: vi.fn(),
  projectCreate: vi.fn(),
  threadFindFirst: vi.fn(),
  threadCreate: vi.fn(),
  eventFindFirst: vi.fn(),
  eventCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mocks.requireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: mocks.projectFindFirst, create: mocks.projectCreate },
    chatThread: { findFirst: mocks.threadFindFirst, create: mocks.threadCreate },
    actionEvent: { findFirst: mocks.eventFindFirst, create: mocks.eventCreate },
    $transaction: mocks.transaction,
  },
}));

const { createCanvasConversation, getCanvasConversationHandoff } = await import("@/lib/canvas-entry-actions");

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const PROJECT_ID = `canvas_${REQUEST_ID}`;
const THREAD_ID = `thread_${REQUEST_ID}`;
const HANDOFF_ID = `handoff_${REQUEST_ID}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwner.mockResolvedValue({ ownerId: "owner-1", email: "owner@example.test" });
  mocks.projectFindFirst.mockResolvedValue(null);
  mocks.threadFindFirst.mockResolvedValue(null);
  mocks.eventFindFirst.mockResolvedValue(null);
  mocks.projectCreate.mockResolvedValue({ id: PROJECT_ID });
  mocks.threadCreate.mockResolvedValue({ id: THREAD_ID });
  mocks.eventCreate.mockResolvedValue({ id: HANDOFF_ID });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({
    project: { findFirst: mocks.projectFindFirst, create: mocks.projectCreate },
    chatThread: { findFirst: mocks.threadFindFirst, create: mocks.threadCreate },
    actionEvent: { findFirst: mocks.eventFindFirst, create: mocks.eventCreate },
  }));
});

describe("createCanvasConversation", () => {
  it("atomically creates one Canvas, one empty Conversation and one durable handoff", async () => {
    const result = await createCanvasConversation({
      prompt: "  Make four Raya product photos  ",
      requestId: REQUEST_ID,
    });

    expect(result).toEqual({ projectId: PROJECT_ID, threadId: THREAD_ID, handoffId: HANDOFF_ID });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.projectCreate).toHaveBeenCalledWith({
      data: { id: PROJECT_ID, ownerId: "owner-1", name: "Make four Raya product photos" },
      select: { id: true },
    });
    expect(mocks.threadCreate).toHaveBeenCalledWith({
      data: { id: THREAD_ID, ownerId: "owner-1", projectId: PROJECT_ID, title: "Make four Raya product photos" },
      select: { id: true },
    });
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: {
        id: HANDOFF_ID,
        ownerId: "owner-1",
        projectId: PROJECT_ID,
        type: "canvas.create-handoff",
        payload: { prompt: "Make four Raya product photos", threadId: THREAD_ID },
      },
    });
  });

  it("returns the same owned handoff on a retry instead of creating a second Canvas", async () => {
    mocks.eventFindFirst.mockResolvedValue({
      id: HANDOFF_ID,
      projectId: PROJECT_ID,
      payload: { prompt: "Make four Raya product photos", threadId: THREAD_ID },
    });
    mocks.projectFindFirst.mockResolvedValue({ id: PROJECT_ID });
    mocks.threadFindFirst.mockResolvedValue({ id: THREAD_ID });

    await expect(createCanvasConversation({
      prompt: "Make four Raya product photos",
      requestId: REQUEST_ID,
    })).resolves.toEqual({ projectId: PROJECT_ID, threadId: THREAD_ID, handoffId: HANDOFF_ID });

    expect(mocks.projectCreate).not.toHaveBeenCalled();
    expect(mocks.threadCreate).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it("refuses blank prompts and malformed request identities before writing", async () => {
    await expect(createCanvasConversation({ prompt: "   ", requestId: REQUEST_ID })).resolves.toEqual({
      error: "Describe what you want to create.",
    });
    await expect(createCanvasConversation({ prompt: "A poster", requestId: "not-a-uuid" })).resolves.toEqual({
      error: "Couldn't start that Canvas — please try again.",
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("getCanvasConversationHandoff", () => {
  it("returns a prompt only when the handoff, Canvas and Conversation all belong together", async () => {
    mocks.eventFindFirst.mockResolvedValue({
      id: HANDOFF_ID,
      projectId: PROJECT_ID,
      payload: { prompt: "Make four Raya product photos", threadId: THREAD_ID },
    });

    await expect(getCanvasConversationHandoff({
      ownerId: "owner-1",
      handoffId: HANDOFF_ID,
      projectId: PROJECT_ID,
      threadId: THREAD_ID,
    })).resolves.toEqual({ prompt: "Make four Raya product photos" });

    expect(mocks.eventFindFirst).toHaveBeenCalledWith({
      where: {
        id: HANDOFF_ID,
        ownerId: "owner-1",
        projectId: PROJECT_ID,
        type: "canvas.create-handoff",
      },
      select: { payload: true },
    });
  });

  it("fails closed when the durable payload points at another Conversation", async () => {
    mocks.eventFindFirst.mockResolvedValue({
      payload: { prompt: "A poster", threadId: "thread-other" },
    });

    await expect(getCanvasConversationHandoff({
      ownerId: "owner-1",
      handoffId: HANDOFF_ID,
      projectId: PROJECT_ID,
      threadId: THREAD_ID,
    })).resolves.toBeNull();
  });
});

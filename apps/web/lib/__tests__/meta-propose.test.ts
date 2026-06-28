import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFetchOwnerAdObjects,
  mockFindUnique,
  mockFindFirst,
  mockCreate,
  mockNewId,
  mockMaybeAutoRun,
} = vi.hoisted(() => ({
  mockFetchOwnerAdObjects: vi.fn(),
  mockFindUnique: vi.fn(),
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
  mockNewId: vi.fn(() => "card-1"),
  mockMaybeAutoRun: vi.fn(),
}));

vi.mock("../meta-objects", () => ({ fetchOwnerAdObjects: mockFetchOwnerAdObjects }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    metaConnection: { findUnique: mockFindUnique },
    chatMessage: { findFirst: mockFindFirst, create: mockCreate },
  },
}));
vi.mock("@fikirtive/core", () => ({ newId: mockNewId }));
vi.mock("../meta-write-actions", () => ({ maybeAutoRun: mockMaybeAutoRun }));

import { proposeMetaActionForOwner } from "../meta-propose";

const adObjects = [
  {
    id: "s1",
    level: "adset",
    name: "Set 1",
    status: "ACTIVE",
    dailyBudgetMinor: 1000,
    currency: "USD",
    accountId: "act_1",
  },
];

const pauseInput = {
  planTitle: "Pause test",
  steps: [{ op: "pause" as const, targetId: "s1", intent: {} }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFindFirst.mockResolvedValue(null); // no prior messages → seq starts at 1
  mockCreate.mockResolvedValue({});
  mockNewId.mockReturnValue("card-1");
  mockMaybeAutoRun.mockResolvedValue({ ran: false });
});

describe("proposeMetaActionForOwner", () => {
  it("passes through notConnected when fetchOwnerAdObjects returns it", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ notConnected: true });
    const res = await proposeMetaActionForOwner("org1", "thread1", pauseInput);
    expect(res).toEqual({ notConnected: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("passes through needsReconnect when fetchOwnerAdObjects returns it", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ needsReconnect: true });
    const res = await proposeMetaActionForOwner("org1", "thread1", pauseInput);
    expect(res).toEqual({ needsReconnect: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns unknownTargets and does NOT persist a card when a target id is not owned", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: adObjects });
    mockFindUnique.mockResolvedValue({ adsAutonomy: "ASK" });
    const res = await proposeMetaActionForOwner("org1", "thread1", {
      planTitle: "Bad plan",
      steps: [{ op: "pause" as const, targetId: "UNKNOWN", intent: {} }],
    });
    expect(res).toEqual({ unknownTargets: ["UNKNOWN"] });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("persists ONE ACTION_CARD with server-built payload and returns { cardId, autoEligible }", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: adObjects });
    mockFindUnique.mockResolvedValue({ adsAutonomy: "ASK" });
    mockFindFirst.mockResolvedValue({ seq: 5 });
    const res = await proposeMetaActionForOwner("org1", "thread1", pauseInput);
    expect(res).toEqual({ cardId: "card-1", autoEligible: false });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.kind).toBe("ACTION_CARD");
    expect(data.role).toBe("AGENT");
    expect(data.seq).toBe(6);
    expect(data.threadId).toBe("thread1");
    expect(data.ownerId).toBe("org1");
    // payload must have server-built approval + steps (LLM cannot set these)
    expect(data.payload.approval).toBeDefined();
    expect(data.payload.steps).toBeDefined();
    expect(data.payload.steps[0].moneyClass).toBe("safe");
  });

  it("autoEligible is true in AUTO mode when all steps are safe", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: adObjects });
    mockFindUnique.mockResolvedValue({ adsAutonomy: "AUTO" });
    const res = await proposeMetaActionForOwner("org1", "thread1", pauseInput);
    expect(res).toMatchObject({ cardId: "card-1", autoEligible: true });
  });

  it("defaults to ASK when MetaConnection row missing adsAutonomy", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: adObjects });
    mockFindUnique.mockResolvedValue(null); // no connection row
    const res = await proposeMetaActionForOwner("org1", "thread1", pauseInput);
    // ASK mode + safe step → autoEligible false
    expect(res).toMatchObject({ cardId: "card-1", autoEligible: false });
  });

  it("maybeAutoRun throw degrades to autoRan:false — proposal still resolves, never rejects", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: adObjects });
    // AUTO mode + safe step → autoEligible true → maybeAutoRun will be called
    mockFindUnique.mockResolvedValue({ adsAutonomy: "AUTO" });
    // Simulate kill-switch or transient error inside maybeAutoRun
    mockMaybeAutoRun.mockRejectedValue(new Error("KILL_SWITCH: ads writes are paused for this org"));

    // Must resolve, not reject
    const res = await proposeMetaActionForOwner("org1", "thread1", pauseInput);

    // Card was persisted (card still created)
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // Result resolves with the card (autoRan:false degraded state)
    expect(res).toMatchObject({ cardId: "card-1", autoEligible: true, autoRan: false });
  });

  it("maybeAutoRun ran:true is passed through when it succeeds", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: adObjects });
    mockFindUnique.mockResolvedValue({ adsAutonomy: "AUTO" });
    mockMaybeAutoRun.mockResolvedValue({ ran: true, ok: true, state: "done", results: [] });

    const res = await proposeMetaActionForOwner("org1", "thread1", pauseInput);
    expect(res).toMatchObject({ cardId: "card-1", autoEligible: true, autoRan: true });
  });
});

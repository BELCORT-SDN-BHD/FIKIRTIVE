import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFetchOwnerAdObjects,
  mockFindUnique,
  mockFindFirst,
  mockCreate,
  mockUpdate,
  mockNewId,
  mockMaybeAutoRun,
} = vi.hoisted(() => ({
  mockFetchOwnerAdObjects: vi.fn(),
  mockFindUnique: vi.fn(),
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockNewId: vi.fn(() => "card-1"),
  mockMaybeAutoRun: vi.fn(),
}));

vi.mock("../meta-objects", () => ({ fetchOwnerAdObjects: mockFetchOwnerAdObjects }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    metaConnection: { findUnique: mockFindUnique },
    chatMessage: { findFirst: mockFindFirst, create: mockCreate, update: mockUpdate },
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
  // an AD-level object (no dailyBudgetMinor — ads don't carry a daily budget)
  {
    id: "a1",
    level: "ad",
    name: "Ad 1",
    status: "ACTIVE",
    currency: "USD",
    accountId: "act_1",
  },
  // a campaign on a LIFETIME budget (no dailyBudgetMinor)
  {
    id: "c1",
    level: "campaign",
    name: "Lifetime Camp",
    status: "ACTIVE",
    lifetimeBudgetMinor: 50000,
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
  mockUpdate.mockResolvedValue({});
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

  // ── FIX A: set_budget money-safety — reject (not clamp) an unbudgeted/invalid set_budget ──
  it("set_budget with EMPTY intent (no dailyBudgetMinor) → invalidSteps, no card persisted", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: adObjects });
    mockFindUnique.mockResolvedValue({ adsAutonomy: "AUTO" });
    const res = await proposeMetaActionForOwner("org1", "thread1", {
      planTitle: "Zero out the budget",
      steps: [{ op: "set_budget" as const, targetId: "s1", intent: {} }],
    });
    expect(res).toMatchObject({ invalidSteps: [{ targetId: "s1" }] });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("set_budget with a ZERO/negative amount → invalidSteps, no card persisted", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: adObjects });
    mockFindUnique.mockResolvedValue({ adsAutonomy: "ASK" });
    const res = await proposeMetaActionForOwner("org1", "thread1", {
      planTitle: "Zero",
      steps: [{ op: "set_budget" as const, targetId: "s1", intent: { dailyBudgetMinor: 0 } }],
    });
    expect("invalidSteps" in res).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("set_budget on an AD-level object (no daily budget) → invalidSteps, no card persisted", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: adObjects });
    mockFindUnique.mockResolvedValue({ adsAutonomy: "ASK" });
    const res = await proposeMetaActionForOwner("org1", "thread1", {
      planTitle: "Budget an ad",
      steps: [{ op: "set_budget" as const, targetId: "a1", intent: { dailyBudgetMinor: 2000 } }],
    });
    expect(res).toMatchObject({ invalidSteps: [{ targetId: "a1" }] });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("set_budget on a LIFETIME-budget object (no daily budget) → invalidSteps, no card persisted", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: adObjects });
    mockFindUnique.mockResolvedValue({ adsAutonomy: "ASK" });
    const res = await proposeMetaActionForOwner("org1", "thread1", {
      planTitle: "Budget a lifetime campaign",
      steps: [{ op: "set_budget" as const, targetId: "c1", intent: { dailyBudgetMinor: 2000 } }],
    });
    expect(res).toMatchObject({ invalidSteps: [{ targetId: "c1" }] });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("set_budget WITH a positive amount on a daily-budget adset → valid, card IS persisted", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: adObjects });
    mockFindUnique.mockResolvedValue({ adsAutonomy: "ASK" });
    const res = await proposeMetaActionForOwner("org1", "thread1", {
      planTitle: "Raise budget",
      steps: [{ op: "set_budget" as const, targetId: "s1", intent: { dailyBudgetMinor: 2000 } }],
    });
    expect(res).toMatchObject({ cardId: "card-1" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
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

  // ── FIX D: persist the REAL auto outcome on the card payload so the UI doesn't lie ──
  it("a refused auto-run patches autoOutcome.ran=false onto the persisted card", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: adObjects });
    mockFindUnique.mockResolvedValue({ adsAutonomy: "AUTO" });
    // maybeAutoRun refused (e.g. kill-switch / mode flipped) — ran:false
    mockMaybeAutoRun.mockResolvedValue({ ran: false, reason: "kill-switch" });

    const res = await proposeMetaActionForOwner("org1", "thread1", pauseInput);
    expect(res).toMatchObject({ cardId: "card-1", autoEligible: true, autoRan: false });

    // the card payload was patched with autoOutcome.ran === false
    expect(mockUpdate).toHaveBeenCalled();
    const patched = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0];
    expect(patched.where).toMatchObject({ id: "card-1" });
    expect(patched.data.payload.autoOutcome).toMatchObject({ ran: false });
  });

  it("a successful auto-run patches autoOutcome.ran=true + state onto the persisted card", async () => {
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: adObjects });
    mockFindUnique.mockResolvedValue({ adsAutonomy: "AUTO" });
    mockMaybeAutoRun.mockResolvedValue({ ran: true, ok: true, state: "done", results: [] });

    await proposeMetaActionForOwner("org1", "thread1", pauseInput);

    const patched = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0];
    expect(patched.data.payload.autoOutcome).toMatchObject({ ran: true, state: "done" });
  });
});

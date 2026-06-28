import { describe, it, expect, vi, beforeEach } from "vitest";

// runApprovedPlan is the SOLE Meta writer. These tests pin its security invariants:
// kill-switch refuses (no graph calls), per-step idempotency (no double-write), the
// live-re-read DIVERGENCE gate (no write when the world drifted), stop-on-first-failure
// (partial), and MAYBE-APPLIED reconciliation (no blind re-post).

const {
  mockConnFindUnique,
  mockMsgFindFirst,
  mockExecFindFirst,
  mockExecCreate,
  mockExecUpdate,
  mockEventCreate,
  mockGraphGet,
  mockGraphPost,
} = vi.hoisted(() => ({
  mockConnFindUnique: vi.fn(),
  mockMsgFindFirst: vi.fn(),
  mockExecFindFirst: vi.fn(),
  mockExecCreate: vi.fn(),
  mockExecUpdate: vi.fn(),
  mockEventCreate: vi.fn(),
  mockGraphGet: vi.fn(),
  mockGraphPost: vi.fn(),
}));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    metaConnection: { findUnique: mockConnFindUnique },
    chatMessage: { findFirst: mockMsgFindFirst },
    metaActionExecution: { findFirst: mockExecFindFirst, create: mockExecCreate, update: mockExecUpdate },
    actionEvent: { create: mockEventCreate },
  },
}));
vi.mock("@fikirtive/core", () => ({ newId: () => "id-fixed" }));
vi.mock("../meta-graph", () => ({ metaGraphGet: mockGraphGet, metaGraphPost: mockGraphPost }));
// token-encryption is REAL: decryptToken round-trips a token we encrypt under a fixed key.

import { runApprovedPlan } from "../meta-write-actions";
import { encryptToken } from "../token-encryption";

// ── builders ──────────────────────────────────────────────────────────────────

/** A writeable connection row with a real, decryptable token. */
function conn(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: "u1",
    accessTokenEnc: encryptToken("LIVE-TOKEN"),
    status: "active",
    adsAutonomy: "AUTO",
    adsWritesPaused: false,
    canWrite: true,
    ...overrides,
  };
}

/** An ACTION_CARD ChatMessage carrying a MetaActionCardPayload with these steps. */
function card(steps: unknown[]) {
  return { id: "card-1", ownerId: "u1", kind: "ACTION_CARD", payload: { planTitle: "p", steps } };
}

const pauseStep = {
  index: 0,
  op: "pause",
  targetId: "act_1_camp_9",
  targetName: "Camp",
  currentValue: { status: "ACTIVE" },
  targetValue: {},
  moneyClass: "safe",
};

const budgetDownStep = {
  index: 0,
  op: "budget_down",
  targetId: "act_1_camp_9",
  targetName: "Camp",
  currentValue: { dailyBudgetMinor: 10000 },
  targetValue: { dailyBudgetMinor: 5000 },
  moneyClass: "safe",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);
  // default: no prior execution row, create + update succeed
  mockExecFindFirst.mockResolvedValue(null);
  mockExecCreate.mockResolvedValue({ id: "id-fixed" });
  mockExecUpdate.mockResolvedValue({});
  mockEventCreate.mockResolvedValue({});
});

describe("runApprovedPlan — kill-switch", () => {
  it("refuses ALL writes when adsWritesPaused, with NO graph calls", async () => {
    mockConnFindUnique.mockResolvedValue(conn({ adsWritesPaused: true }));
    mockMsgFindFirst.mockResolvedValue(card([pauseStep]));

    await expect(runApprovedPlan("u1", "card-1")).rejects.toThrow(/KILL_SWITCH/);

    expect(mockGraphGet).not.toHaveBeenCalled();
    expect(mockGraphPost).not.toHaveBeenCalled();
    expect(mockExecCreate).not.toHaveBeenCalled();
  });

  it("refuses with needsReconnect when canWrite is false (no writes)", async () => {
    mockConnFindUnique.mockResolvedValue(conn({ canWrite: false }));
    const res = await runApprovedPlan("u1", "card-1");
    expect(res).toEqual({ results: [], state: "failed", needsReconnect: true });
    expect(mockGraphPost).not.toHaveBeenCalled();
  });

  it("refuses when there is no connection row", async () => {
    mockConnFindUnique.mockResolvedValue(null);
    const res = await runApprovedPlan("u1", "card-1");
    expect(res.state).toBe("failed");
    expect(mockGraphPost).not.toHaveBeenCalled();
  });
});

describe("runApprovedPlan — card loading", () => {
  it("refuses when the owner-scoped ACTION_CARD is missing", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(null);
    const res = await runApprovedPlan("u1", "card-1");
    expect(res.state).toBe("failed");
    expect(mockGraphPost).not.toHaveBeenCalled();
    // owner-scoped lookup
    expect(mockMsgFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "card-1", ownerId: "u1" }) }),
    );
  });
});

describe("runApprovedPlan — idempotency", () => {
  it("SKIPS a step whose row is already APPLIED — no second post", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card([pauseStep]));
    mockExecFindFirst.mockResolvedValue({ id: "x", status: "APPLIED", stepIndex: 0 });

    const res = await runApprovedPlan("u1", "card-1");

    expect(res).toEqual({ results: [{ index: 0, status: "SKIPPED" }], state: "done" });
    expect(mockGraphPost).not.toHaveBeenCalled();
    expect(mockExecCreate).not.toHaveBeenCalled();
  });
});

describe("runApprovedPlan — pause apply", () => {
  it("posts { status: 'PAUSED' } and marks the row APPLIED", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card([pauseStep]));
    // live re-read: still ACTIVE → pause still resolves to pause/safe → matches frozen
    mockGraphGet.mockResolvedValue({ id: "act_1_camp_9", effective_status: "ACTIVE" });
    mockGraphPost.mockResolvedValue({ success: true });

    const res = await runApprovedPlan("u1", "card-1");

    expect(res).toEqual({ results: [{ index: 0, status: "APPLIED" }], state: "done" });
    expect(mockGraphPost).toHaveBeenCalledTimes(1);
    expect(mockGraphPost).toHaveBeenCalledWith("LIVE-TOKEN", "act_1_camp_9", { status: "PAUSED" });
    // row was moved to APPLIED
    const applied = mockExecUpdate.mock.calls.find(
      (c) => c[0]?.data?.status === "APPLIED",
    );
    expect(applied).toBeTruthy();
  });
});

describe("runApprovedPlan — DIVERGENCE gate", () => {
  it("does NOT write when a frozen budget_down is now a budget_up live (drift)", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card([budgetDownStep]));
    // Frozen: down from 10000 → 5000 (safe). Live current is now 3000 → setting 5000 is an
    // INCREASE → recomputes to budget_up/spend → DIVERGED from the sanctioned budget_down.
    mockGraphGet.mockResolvedValue({ id: "act_1_camp_9", daily_budget: "3000" });

    const res = await runApprovedPlan("u1", "card-1");

    expect(res.results[0].status).toBe("DIVERGED");
    expect(res.state).toBe("failed");
    expect(mockGraphPost).not.toHaveBeenCalled();
    // the row is marked FAILED, never APPLIED
    const failed = mockExecUpdate.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(failed).toBeTruthy();
    const appliedRow = mockExecUpdate.mock.calls.find((c) => c[0]?.data?.status === "APPLIED");
    expect(appliedRow).toBeFalsy();
  });
});

describe("runApprovedPlan — partial (stop on first failure)", () => {
  it("step 2 write throws → step 3 NOT attempted, step 1 APPLIED, state partial", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    const s0 = { ...pauseStep, index: 0, targetId: "t0" };
    const s1 = { ...pauseStep, index: 1, targetId: "t1" };
    const s2 = { ...pauseStep, index: 2, targetId: "t2" };
    mockMsgFindFirst.mockResolvedValue(card([s0, s1, s2]));
    // every live re-read says ACTIVE (pause stays pause/safe → no divergence)
    mockGraphGet.mockResolvedValue({ effective_status: "ACTIVE" });
    // step 0 post ok; step 1 post throws; step 2 never reached
    mockGraphPost
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error("graph 500"));

    const res = await runApprovedPlan("u1", "card-1");

    expect(res.state).toBe("partial");
    expect(res.results[0]).toEqual({ index: 0, status: "APPLIED" });
    expect(res.results[1].status).toBe("FAILED");
    // step 2 was never attempted
    expect(res.results.find((r) => r.index === 2)).toBeUndefined();
    expect(mockGraphPost).toHaveBeenCalledTimes(2);
  });
});

describe("runApprovedPlan — MAYBE-APPLIED reconcile", () => {
  it("APPLYING row + live ambiguous → NEEDS_CONFIRM, no re-post", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card([budgetDownStep]));
    // a prior crash left this row APPLYING with no confirmed result
    mockExecFindFirst.mockResolvedValue({ id: "x", status: "APPLYING", stepIndex: 0 });
    // live state does NOT yet equal the frozen target (5000) → still ambiguous
    mockGraphGet.mockResolvedValue({ id: "act_1_camp_9", daily_budget: "10000" });

    const res = await runApprovedPlan("u1", "card-1");

    expect(res.results[0].status).toBe("NEEDS_CONFIRM");
    expect(res.state).toBe("failed");
    expect(mockGraphPost).not.toHaveBeenCalled();
  });

  it("APPLYING row + live ALREADY equals target → treated APPLIED (SKIPPED), no re-post", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card([budgetDownStep]));
    mockExecFindFirst.mockResolvedValue({ id: "x", status: "APPLYING", stepIndex: 0 });
    // live already AT the frozen target (5000) → the prior write landed → idempotent skip
    mockGraphGet.mockResolvedValue({ id: "act_1_camp_9", daily_budget: "5000" });

    const res = await runApprovedPlan("u1", "card-1");

    expect(res.results[0].status).toBe("SKIPPED");
    expect(res.state).toBe("done");
    expect(mockGraphPost).not.toHaveBeenCalled();
  });
});

describe("runApprovedPlan — duplicate-insert race", () => {
  it("a P2002 on create → re-reads the existing row; if APPLIED → SKIPPED, no post", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card([pauseStep]));
    // no row at first findFirst → we try to create → loses the race (P2002)
    mockExecFindFirst
      .mockResolvedValueOnce(null) // initial claim check
      .mockResolvedValueOnce({ id: "x", status: "APPLIED", stepIndex: 0 }); // re-read after P2002
    mockExecCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));

    const res = await runApprovedPlan("u1", "card-1");

    expect(res.results[0].status).toBe("SKIPPED");
    expect(mockGraphPost).not.toHaveBeenCalled();
  });
});

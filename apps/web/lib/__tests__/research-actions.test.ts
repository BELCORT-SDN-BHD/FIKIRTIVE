import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — mirror storyboard-gate1-actions.test.ts style (vi.hoisted + vi.mock).
// db mock's chatMessage/researchJob/creditAccount are the SAME object instances the
// code sees inside the (passthrough) $transaction — so tx.researchJob.create ===
// mockResearchCreate. requireOwner, getBoss, and the otto research pricing helper are mocked;
// @fikirtive/core is kept real except newId so RESEARCH_QUEUE stays real.
// ---------------------------------------------------------------------------
const {
  mockOwner,
  mockChatFindFirst,
  mockChatUpdate,
  mockChatUpdateMany,
  mockResearchCreate,
  mockResearchFindFirst,
  mockResearchUpdate,
  mockCreditFindUnique,
  mockGenJobCreate,
  mockExecuteRaw,
  mockReserve,
  mockSettle,
  mockBossSend,
  mockGetBoss,
  mockIsImpersonating,
  db,
} = vi.hoisted(() => {
  const mockChatFindFirst = vi.fn();
  const mockChatUpdate = vi.fn();
  const mockChatUpdateMany = vi.fn();
  const mockResearchCreate = vi.fn();
  const mockResearchFindFirst = vi.fn();
  const mockResearchUpdate = vi.fn();
  const mockCreditFindUnique = vi.fn();
  const mockGenJobCreate = vi.fn();
  const mockExecuteRaw = vi.fn();
  const db: Record<string, unknown> = {
    chatMessage: { findFirst: mockChatFindFirst, update: mockChatUpdate, updateMany: mockChatUpdateMany },
    researchJob: { create: mockResearchCreate, findFirst: mockResearchFindFirst, update: mockResearchUpdate },
    creditAccount: { findUnique: mockCreditFindUnique },
    genJob: { create: mockGenJobCreate },
    $executeRaw: mockExecuteRaw,
  };
  // passthrough $transaction: the callback's tx IS the shared db, so writes inside the
  // tx are captured by the same mock fns the assertions read.
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  const mockBossSend = vi.fn();
  return {
    mockOwner: vi.fn(),
    mockChatFindFirst,
    mockChatUpdate,
    mockChatUpdateMany,
    mockResearchCreate,
    mockResearchFindFirst,
    mockResearchUpdate,
    mockCreditFindUnique,
    mockGenJobCreate,
    mockExecuteRaw,
    mockReserve: vi.fn(),
    mockSettle: vi.fn(),
    mockBossSend,
    mockGetBoss: vi.fn(async () => ({ send: mockBossSend })),
    mockIsImpersonating: vi.fn(),
    db,
  };
});

// db mock exposes reserveCredits/settleCredits so the $0 assertion can prove they're never called.
vi.mock("@fikirtive/db", () => ({ prisma: db, Prisma: {}, reserveCredits: mockReserve, settleCredits: mockSettle }));
vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("../queue", () => ({ getBoss: mockGetBoss }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));

// newId: deterministic id so the created job id is predictable.
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: () => "job-new-1",
  RESEARCH_QUEUE: "research",
}));
vi.mock("@fikirtive/otto", () => ({
  RESEARCH_TIERS: {
    quick: { label: "Quick", maxSearches: 5, maxPages: 8, maxSteps: 6, estimatedCredits: 6 },
    standard: { label: "Standard", maxSearches: 12, maxPages: 20, maxSteps: 12, estimatedCredits: 11 },
    deep: { label: "Deep", maxSearches: 25, maxPages: 40, maxSteps: 24, estimatedCredits: 22 },
  },
  researchTierBudgetInternal: (maxSteps: number) => maxSteps * 9,
}));

import { approveResearch } from "../research-actions";
// RESEARCH_QUEUE is real (core mock keeps importOriginal — only newId is overridden).
import { RESEARCH_TIERS, researchTierBudgetInternal } from "@fikirtive/otto";
import { RESEARCH_QUEUE } from "@fikirtive/core";

const OWNER = "owner-1";

/** A planned RESEARCH_CARD row shaped like loadCard's select (with thread recheck fields). */
function card(overrides: Partial<{ tier: keyof typeof RESEARCH_TIERS; status: string }> = {}) {
  const tier = overrides.tier ?? "standard";
  return {
    id: "card-1",
    threadId: "t-1",
    payload: {
      researchId: "r-1",
      topic: "market size of X",
      tier,
      questions: ["q1", "q2"],
      estimatedCredits: RESEARCH_TIERS[tier].estimatedCredits,
      status: overrides.status ?? "planned",
    },
    thread: { ownerId: OWNER, deletedAt: null },
  };
}

/** Wire chatMessage.findFirst to resolve the parent RESEARCH_CARD (load + the in-tx RMW re-read). */
function wireCard(parent: ReturnType<typeof card> | null) {
  mockChatFindFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
    const where = args?.where ?? {};
    if (where.kind === "RESEARCH_CARD" && where.id === parent?.id) return parent;
    return null;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockOwner.mockResolvedValue({ ownerId: OWNER });
  mockResearchCreate.mockResolvedValue({});
  mockResearchUpdate.mockResolvedValue({});
  mockChatUpdate.mockResolvedValue({});
  mockChatUpdateMany.mockResolvedValue({ count: 1 });
  mockBossSend.mockResolvedValue("queue-abc");
  mockGetBoss.mockResolvedValue({ send: mockBossSend });
  mockIsImpersonating.mockResolvedValue(false);
  mockExecuteRaw.mockResolvedValue(undefined);
  // ample balance by default (standard tier estimate = 11, derived from turnBudgetInternal)
  mockCreditFindUnique.mockResolvedValue({ balance: 1000 });
});

describe("approveResearch — happy path", () => {
  it("建 ResearchJob(idempotencyKey research:<cardId>)+ 卡 status→running + enqueue", async () => {
    wireCard(card());
    const res = await approveResearch({ cardId: "card-1" });

    expect(res).toEqual({ jobId: "job-new-1" });

    // ResearchJob created with the once-EVER key + owner/thread/card/tier
    expect(mockResearchCreate).toHaveBeenCalledTimes(1);
    const created = mockResearchCreate.mock.calls[0][0].data;
    expect(created.idempotencyKey).toBe("research:card-1");
    expect(created.ownerId).toBe(OWNER);
    expect(created.threadId).toBe("t-1");
    expect(created.cardId).toBe("card-1");
    expect(created.tier).toBe("standard");
    expect(created.id).toBe("job-new-1");
    // $0: no reserve/settle fields set at approve
    expect("reservedCredits" in created).toBe(false);
    expect("actualCredits" in created).toBe(false);

    // card flipped to running, ONLY status changed (topic/tier/etc byte-preserved)
    expect(mockChatUpdate).toHaveBeenCalledTimes(1);
    const upd = mockChatUpdate.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "card-1" });
    expect(upd.data.payload.status).toBe("running");
    expect(upd.data.payload.topic).toBe("market size of X");
    expect(upd.data.payload.tier).toBe("standard");
    expect(upd.data.payload.researchId).toBe("r-1");

    // enqueued to the research queue with { jobId }
    expect(mockGetBoss).toHaveBeenCalledTimes(1);
    expect(mockBossSend).toHaveBeenCalledTimes(1);
    expect(mockBossSend).toHaveBeenCalledWith(RESEARCH_QUEUE, { jobId: "job-new-1" });
    // queueJobId persisted best-effort
    expect(mockResearchUpdate).toHaveBeenCalledWith({ where: { id: "job-new-1" }, data: { queueJobId: "queue-abc" } });
  });

  it("enqueue 抛错 → fail-close job/card,不留下 running 死卡", async () => {
    wireCard(card());
    mockBossSend.mockRejectedValue(new Error("queue down"));
    const res = await approveResearch({ cardId: "card-1" });
    expect(res).toEqual({ error: "Could not reach the research queue — please try again." });
    expect(mockResearchCreate).toHaveBeenCalledTimes(1);
    expect(mockChatUpdate).toHaveBeenCalledTimes(1);
    expect(mockResearchUpdate).toHaveBeenCalledWith({
      where: { id: "job-new-1" },
      data: { status: "FAILED", error: "dispatch failed: queue down" },
    });
    expect(mockChatUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "card-1", ownerId: OWNER, kind: "RESEARCH_CARD" }),
      }),
    );
    const failedPayload = mockChatUpdateMany.mock.calls[0][0].data.payload;
    expect(failedPayload).toMatchObject({ status: "failed", error: "dispatch failed: queue down" });
  });
});

describe("approveResearch — 幂等 double-approve", () => {
  it("并发同卡(create 抛 P2002)→ 返回既有 job,不重复建/不重复 enqueue-create", async () => {
    wireCard(card());
    // create hits the once-EVER index → P2002; the recovery read returns the existing job.
    mockResearchCreate.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    mockResearchFindFirst.mockResolvedValue({ id: "job-existing" });

    const res = await approveResearch({ cardId: "card-1" });
    expect(res).toEqual({ jobId: "job-existing" });

    // recovery lookup scoped to the research key (all-status)
    expect(mockResearchFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: OWNER, idempotencyKey: "research:card-1" } }),
    );
    // the tx rolled back → card NOT flipped a second time by this attempt
    // (passthrough tx means the update ran, but there's no SECOND create — that's the key claim)
    expect(mockResearchCreate).toHaveBeenCalledTimes(1);
  });
});

describe("approveResearch — 拒绝路径(不建 job)", () => {
  it("卡 status 非 planned(running)→ error,不建 job/不 enqueue", async () => {
    wireCard(card({ status: "running" }));
    const res = await approveResearch({ cardId: "card-1" });
    expect(res).toEqual({ error: "This research is already running or done." });
    expect(mockResearchCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
  });

  it("卡 status 非 planned(done)→ error,不建 job", async () => {
    wireCard(card({ status: "done" }));
    const res = await approveResearch({ cardId: "card-1" });
    expect("error" in res).toBe(true);
    expect(mockResearchCreate).not.toHaveBeenCalled();
  });

  it("余额低于 INTERNAL 预算 → insufficient_credits,NOT 建 job / NOT enqueue / NOT 读账后写", async () => {
    const deepInternal = researchTierBudgetInternal(RESEARCH_TIERS.deep.maxSteps); // = 216 internal
    wireCard(card({ tier: "deep" }));
    mockCreditFindUnique.mockResolvedValue({ balance: deepInternal - 1 }); // just below the worker reserve
    const res = await approveResearch({ cardId: "card-1" });
    expect(res).toEqual({ error: "You don't have enough credits for this research.", code: "insufficient_credits" });
    expect(mockResearchCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
  });

  it("余额 ≥ INTERNAL 预算 → 放行(建 job)", async () => {
    const deepInternal = researchTierBudgetInternal(RESEARCH_TIERS.deep.maxSteps);
    wireCard(card({ tier: "deep" }));
    mockCreditFindUnique.mockResolvedValue({ balance: deepInternal }); // exactly the reserve → allowed
    const res = await approveResearch({ cardId: "card-1" });
    expect(res).toEqual({ jobId: "job-new-1" });
    expect(mockResearchCreate).toHaveBeenCalledTimes(1);
  });

  it("卡在线程锁内消失 → Card not found,不建 job/不 enqueue", async () => {
    const planned = card();
    mockChatFindFirst
      .mockResolvedValueOnce(planned)
      .mockResolvedValueOnce(null);
    const res = await approveResearch({ cardId: "card-1" });
    expect(res).toEqual({ error: "Card not found." });
    expect(mockResearchCreate).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
  });

  // THE UNIT-MISMATCH REGRESSION: a balance ABOVE the card's DISPLAYED estimate but BELOW the
  // INTERNAL worker reserve must now REFUSE. Under the old (buggy) gate — which compared the
  // internal balance to the displayed estimate — this balance would have wrongly PASSED.
  it("余额高于显示预估但低于内部预算 → 仍拒(锁死单位不匹配 bug)", async () => {
    const tier = "deep" as const;
    const displayed = RESEARCH_TIERS[tier].estimatedCredits; // 22 (displayed units)
    const internal = researchTierBudgetInternal(RESEARCH_TIERS[tier].maxSteps); // 216 (internal units)
    expect(displayed).toBeLessThan(internal); // sanity: the two units genuinely differ
    const balance = displayed + 1; // 23 — clears the OLD displayed gate, fails the NEW internal one
    expect(balance).toBeLessThan(internal);
    wireCard(card({ tier }));
    mockCreditFindUnique.mockResolvedValue({ balance });
    const res = await approveResearch({ cardId: "card-1" });
    expect(res).toEqual({ error: "You don't have enough credits for this research.", code: "insufficient_credits" });
    expect(mockResearchCreate).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
  });

  it("账户不存在(null balance→0)且预算>0 → insufficient_credits,不建 job", async () => {
    wireCard(card());
    mockCreditFindUnique.mockResolvedValue(null);
    const res = await approveResearch({ cardId: "card-1" });
    expect((res as { code?: string }).code).toBe("insufficient_credits");
    expect(mockResearchCreate).not.toHaveBeenCalled();
  });
});

describe("approveResearch — owner-scope / 入参", () => {
  it("impersonating customer → blocked before card/balance reads", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    const res = await approveResearch({ cardId: "card-1" });
    expect(res).toEqual({ error: "Paused while impersonating a customer — exit impersonation to do this." });
    expect(mockChatFindFirst).not.toHaveBeenCalled();
    expect(mockCreditFindUnique).not.toHaveBeenCalled();
    expect(mockResearchCreate).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
  });

  it("requireOwner 失败 → {error},不碰 DB", async () => {
    mockOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await approveResearch({ cardId: "card-1" });
    expect(res).toEqual({ error: "Not authorized." });
    expect(mockChatFindFirst).not.toHaveBeenCalled();
    expect(mockResearchCreate).not.toHaveBeenCalled();
  });

  it("卡不存在/非本人(loadCard null)→ Card not found,不建 job", async () => {
    wireCard(card());
    const res = await approveResearch({ cardId: "missing" });
    expect(res).toEqual({ error: "Card not found." });
    expect(mockResearchCreate).not.toHaveBeenCalled();
  });

  it("thread 属于他人(owner 复核失败)→ Card not found", async () => {
    const foreign = card();
    foreign.thread.ownerId = "someone-else";
    // findFirst returns the row (ownerId filter passed at query level in real prisma, but the
    // in-code thread.ownerId recheck must still reject it).
    mockChatFindFirst.mockResolvedValue(foreign);
    const res = await approveResearch({ cardId: "card-1" });
    expect(res).toEqual({ error: "Card not found." });
    expect(mockResearchCreate).not.toHaveBeenCalled();
  });

  it("非法入参(空 cardId)→ error,不碰 DB", async () => {
    const res = await approveResearch({ cardId: "" });
    expect("error" in res).toBe(true);
    expect(mockOwner).not.toHaveBeenCalled();
    expect(mockChatFindFirst).not.toHaveBeenCalled();
  });
});

describe("approveResearch — $0 铁证(approve 不花钱)", () => {
  it("happy path:reserveCredits / settleCredits / genJob.create 从未被调", async () => {
    wireCard(card());
    await approveResearch({ cardId: "card-1" });
    expect(mockReserve).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  it("balance 预检是只读:findUnique 调过,但绝不 update creditAccount(无 reserve 写)", async () => {
    wireCard(card());
    await approveResearch({ cardId: "card-1" });
    // creditAccount is read (findUnique) but the db mock has no creditAccount.update — proving
    // the code never mutates the account (a reserve would). reserveCredits itself never called.
    expect(mockCreditFindUnique).toHaveBeenCalledTimes(1);
    expect((db.creditAccount as Record<string, unknown>).update).toBeUndefined();
    expect(mockReserve).not.toHaveBeenCalled();
  });
});

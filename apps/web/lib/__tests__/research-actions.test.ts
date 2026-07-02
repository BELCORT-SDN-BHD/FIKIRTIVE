import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — mirror storyboard-gate1-actions.test.ts style (vi.hoisted + vi.mock).
// db mock's chatMessage/researchJob/creditAccount are the SAME object instances the
// code sees inside the (passthrough) $transaction — so tx.researchJob.create ===
// mockResearchCreate. requireOwner, getBoss are mocked. @fikirtive/core and
// @fikirtive/otto are kept REAL (importOriginal) so RESEARCH_QUEUE + RESEARCH_TIERS
// are the real values; only newId is overridden for determinism.
// ---------------------------------------------------------------------------
const {
  mockOwner,
  mockChatFindFirst,
  mockChatUpdate,
  mockResearchCreate,
  mockResearchFindFirst,
  mockResearchUpdate,
  mockCreditFindUnique,
  mockGenJobCreate,
  mockReserve,
  mockSettle,
  mockBossSend,
  mockGetBoss,
  db,
} = vi.hoisted(() => {
  const mockChatFindFirst = vi.fn();
  const mockChatUpdate = vi.fn();
  const mockResearchCreate = vi.fn();
  const mockResearchFindFirst = vi.fn();
  const mockResearchUpdate = vi.fn();
  const mockCreditFindUnique = vi.fn();
  const mockGenJobCreate = vi.fn();
  const db: Record<string, unknown> = {
    chatMessage: { findFirst: mockChatFindFirst, update: mockChatUpdate },
    researchJob: { create: mockResearchCreate, findFirst: mockResearchFindFirst, update: mockResearchUpdate },
    creditAccount: { findUnique: mockCreditFindUnique },
    genJob: { create: mockGenJobCreate },
  };
  // passthrough $transaction: the callback's tx IS the shared db, so writes inside the
  // tx are captured by the same mock fns the assertions read.
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  const mockBossSend = vi.fn();
  return {
    mockOwner: vi.fn(),
    mockChatFindFirst,
    mockChatUpdate,
    mockResearchCreate,
    mockResearchFindFirst,
    mockResearchUpdate,
    mockCreditFindUnique,
    mockGenJobCreate,
    mockReserve: vi.fn(),
    mockSettle: vi.fn(),
    mockBossSend,
    mockGetBoss: vi.fn(async () => ({ send: mockBossSend })),
    db,
  };
});

// db mock exposes reserveCredits/settleCredits so the $0 assertion can prove they're never called.
vi.mock("@fikirtive/db", () => ({ prisma: db, Prisma: {}, reserveCredits: mockReserve, settleCredits: mockSettle }));
vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("../queue", () => ({ getBoss: mockGetBoss }));

// newId: deterministic id so the created job id is predictable.
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: () => "job-new-1",
}));

import { approveResearch } from "../research-actions";
// RESEARCH_TIERS is real (@fikirtive/otto not mocked); RESEARCH_QUEUE is real (core mock keeps
// importOriginal — only newId is overridden).
import { RESEARCH_TIERS } from "@fikirtive/otto";
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
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: OWNER });
  mockResearchCreate.mockResolvedValue({});
  mockResearchUpdate.mockResolvedValue({});
  mockChatUpdate.mockResolvedValue({});
  mockBossSend.mockResolvedValue("queue-abc");
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

  it("enqueue 抛错 → 仍返回 jobId(job 已建+卡已 running,best-effort 不回滚)", async () => {
    wireCard(card());
    mockBossSend.mockRejectedValue(new Error("queue down"));
    const res = await approveResearch({ cardId: "card-1" });
    expect(res).toEqual({ jobId: "job-new-1" });
    expect(mockResearchCreate).toHaveBeenCalledTimes(1);
    expect(mockChatUpdate).toHaveBeenCalledTimes(1);
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

  it("余额低于预估 → insufficient_credits,NOT 建 job / NOT enqueue / NOT 读账后写", async () => {
    wireCard(card({ tier: "deep" })); // deep estimate = 22 (derived from turnBudgetInternal)
    mockCreditFindUnique.mockResolvedValue({ balance: 10 }); // 10 < 22
    const res = await approveResearch({ cardId: "card-1" });
    expect(res).toEqual({ error: "You don't have enough credits for this research.", code: "insufficient_credits" });
    expect(mockResearchCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
  });

  it("账户不存在(null balance→0)且预估>0 → insufficient_credits,不建 job", async () => {
    wireCard(card());
    mockCreditFindUnique.mockResolvedValue(null);
    const res = await approveResearch({ cardId: "card-1" });
    expect((res as { code?: string }).code).toBe("insufficient_credits");
    expect(mockResearchCreate).not.toHaveBeenCalled();
  });
});

describe("approveResearch — owner-scope / 入参", () => {
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

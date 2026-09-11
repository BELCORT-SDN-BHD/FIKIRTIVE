/**
 * generate.test.ts — money-machine tests for the generate tool
 *
 * Tests #1–9 from the Task 1.5 brief. Mock @fikirtive/db and inject a mock ctx.startGen.
 * Every money-safety property is asserted independently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { generateSkill, generateInput, executeGenerate } from "./generate.js";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Mock @fikirtive/db — no real DB
// ---------------------------------------------------------------------------
vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatMessage: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    genJob: {
      findFirst: vi.fn(),
    },
  },
}));

// ---------------------------------------------------------------------------
// Shared test context + card fixture
// ---------------------------------------------------------------------------

const CARD_ID = "card-abc123";
const ORG_ID = "org-test";

function makeCtx(overrides?: Partial<OttoContext>): OttoContext {
  return {
    orgId: ORG_ID,
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    sourceGenerationId: null,
    startGen: vi.fn().mockResolvedValue({ id: "job-new" }),
    ...overrides,
  };
}

/** A minimal image card payload that passes coworkProposalSchema validation.
 *  desiredAspect/desiredDuration/desiredAudio must be undefined (not null) for the
 *  .optional() fields in coworkProposalSchema. */
function makeImageCardPayload(overrides?: Record<string, unknown>) {
  return {
    kind: "image",
    model: "seedream",
    structuredPrompt: "A bright product shot",
    entityIds: [],
    variantSel: {},
    // desiredAspect, desiredDuration, desiredAudio intentionally omitted (undefined = optional)
    params: { count: 1 },
    ...overrides,
  };
}

function makeCard(payloadOverrides?: Record<string, unknown>) {
  return {
    id: CARD_ID,
    threadId: "thread-test",
    payload: makeImageCardPayload(payloadOverrides),
    thread: {
      projectId: "proj-test",
      deletedAt: null,
      ownerId: ORG_ID,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getPrisma() {
  const db = await import("@fikirtive/db");
  return db.prisma as unknown as {
    chatMessage: {
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    genJob: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
}

// ---------------------------------------------------------------------------
// Test 1: needsApproval is the LITERAL `true` (async () => true, not () => false)
//
// The SDK normalizes boolean `needsApproval` to an async function that returns the value.
// Passing `true` → async () => true. Passing `0`, `undefined`, or omitting it → async () => false.
// We call the function and assert it resolves to `true`. A numeric predicate would resolve
// to `false` (fail-open — approve nothing is blocked, everything runs).
// ---------------------------------------------------------------------------

describe("Test 1 — needsApproval resolves to literal true", () => {
  it("generate.needsApproval() resolves to true (not false/undefined)", async () => {
    // The SDK wraps boolean into: async () => typeof v === 'boolean' ? v : false
    // So true → resolves true; 0 or undefined → resolves false (fail-open).
    // We call the function (it's always async after SDK normalization).
    const result = await (generateSkill.tool.needsApproval as () => Promise<boolean>)();
    expect(result).toBe(true);
    // Extra: the field must exist and be truthy (guards against accidental removal)
    expect(generateSkill.tool.needsApproval).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Test 2: input schema only accepts cardId — spend params are ignored/rejected
// (We test using the exported generateInput Zod schema directly, since the built
// tool's .parameters is a JSON Schema object, not the Zod schema.)
// ---------------------------------------------------------------------------

describe("Test 2 — input is only cardId; spend params stripped", () => {
  it("schema strips unknown spend params (model, count, kind) from input", () => {
    const raw = { cardId: CARD_ID, model: "gpt-5", count: 9, kind: "video" };
    const parsed = generateInput.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const data = parsed.data as Record<string, unknown>;
      expect(data["cardId"]).toBe(CARD_ID);
      // spend params must NOT surface in the parsed input
      expect(data["model"]).toBeUndefined();
      expect(data["count"]).toBeUndefined();
      expect(data["kind"]).toBeUndefined();
    }
  });

  it("schema rejects missing cardId", () => {
    const parsed = generateInput.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it("schema rejects empty string cardId", () => {
    const parsed = generateInput.safeParse({ cardId: "" });
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 3: server-derived / anti-flip — card payload dictates kind/model
// ---------------------------------------------------------------------------

describe("Test 3 — server-derived / anti-flip", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard());
    p.genJob.findFirst.mockResolvedValue(null);
    p.chatMessage.update.mockResolvedValue({});
  });

  it("request kind and model come from the card payload, not from input", async () => {
    // The card is an IMAGE card with model=seedream.
    // Even if we somehow passed model/kind in input (schema strips them), the built
    // request must reflect the card's values.
    const ctx = makeCtx();
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).not.toHaveProperty("error");
    // startGen was called; inspect what it was called with
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).toHaveBeenCalledTimes(1);
    const req = startGenMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(req["kind"]).toBe("image");
    expect(req["model"]).toBe("seedream");
  });

  it("buildGenRequestFromCard is called with overrides: undefined (anti-flip)", async () => {
    // The generate tool must pass overrides: undefined — the model cannot inject params.
    // We verify this indirectly: the built request's model must equal the card's model.
    const ctx = makeCtx();
    await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    const req = startGenMock.mock.calls[0]![0] as Record<string, unknown>;
    // With overrides:undefined, chosenModel = card's model (seedream).
    expect(req["model"]).toBe("seedream");
  });
});

// ---------------------------------------------------------------------------
// Test 4: startGen called with idempotencyKey = cowork:<cardId>
// ---------------------------------------------------------------------------

describe("Test 4 — startGen receives idempotencyKey cowork:<cardId>", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard());
    p.genJob.findFirst.mockResolvedValue(null);
    p.chatMessage.update.mockResolvedValue({});
  });

  it("startGen is called with idempotencyKey=cowork:<cardId>", async () => {
    const ctx = makeCtx();
    await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).toHaveBeenCalledTimes(1);
    const req = startGenMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(req["idempotencyKey"]).toBe(`cowork:${CARD_ID}`);
    // Also confirm card's model/kind are in the request
    expect(req["kind"]).toBe("image");
    expect(req["model"]).toBe("seedream");
  });
});

// ---------------------------------------------------------------------------
// Test 5: exactly-once re-spend guard — existing job → startGen NOT called
// ---------------------------------------------------------------------------

describe("Test 5 — exactly-once re-spend guard", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard());
    p.chatMessage.update.mockResolvedValue({});
  });

  it("when genJob exists for this card, returns existing job WITHOUT calling startGen", async () => {
    const p = await getPrisma();
    p.genJob.findFirst.mockResolvedValue({ id: "existing-job-id", status: "DONE" });

    const ctx = makeCtx();
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    // Returns existing job
    expect(result).toEqual({ genJobId: "existing-job-id", status: "DONE" });

    // startGen must NOT have been called — no re-charge
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).not.toHaveBeenCalled();
  });

  it("re-spend guard queries by orgId + idempotencyKey=cowork:<cardId>", async () => {
    const p = await getPrisma();
    const orgId = "org-check";
    // Card thread.ownerId must match ctx.orgId or the card-not-found guard fires first
    p.chatMessage.findFirst.mockResolvedValue({
      ...makeCard(),
      thread: { projectId: "proj-test", deletedAt: null, ownerId: orgId },
    });
    p.genJob.findFirst.mockResolvedValue({ id: "job-x", status: "QUEUED" });

    const ctx = makeCtx({ orgId });
    await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(p.genJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerId: orgId,
          idempotencyKey: `cowork:${CARD_ID}`,
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Test 6: owner scope — cross-tenant card rejected; ownerId on query = ctx.orgId
// ---------------------------------------------------------------------------

describe("Test 6 — owner scope", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.genJob.findFirst.mockResolvedValue(null);
    p.chatMessage.update.mockResolvedValue({});
  });

  it("chatMessage.findFirst is called with ownerId=ctx.orgId", async () => {
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard());

    const ctx = makeCtx({ orgId: "org-scoped" });
    await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(p.chatMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: CARD_ID,
          ownerId: "org-scoped",
          kind: "GEN_CARD",
        }),
      }),
    );
  });

  it("cross-tenant card (thread.ownerId !== ctx.orgId) → error, no spend", async () => {
    const p = await getPrisma();
    // Card exists but thread.ownerId is a different org
    p.chatMessage.findFirst.mockResolvedValue({
      ...makeCard(),
      thread: { projectId: "proj-test", deletedAt: null, ownerId: "org-OTHER" },
    });

    const ctx = makeCtx({ orgId: "org-scoped" });
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).not.toHaveBeenCalled();
  });

  it("card not found (null) → error, no spend", async () => {
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(null);

    const ctx = makeCtx();
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).not.toHaveBeenCalled();
  });

  it("soft-deleted thread → error, no spend", async () => {
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue({
      ...makeCard(),
      thread: { projectId: "proj-test", deletedAt: new Date(), ownerId: ORG_ID },
    });

    const ctx = makeCtx();
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 6b: thread/project scope — Fix 1 (P1-a)
// ---------------------------------------------------------------------------

describe("Test 6b — thread/project scope (Fix 1 / P1-a)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.genJob.findFirst.mockResolvedValue(null);
    p.chatMessage.update.mockResolvedValue({});
  });

  it("card.threadId !== ctx.threadId → error, no startGen call", async () => {
    const p = await getPrisma();
    // Card belongs to a different thread than ctx
    p.chatMessage.findFirst.mockResolvedValue({
      ...makeCard(),
      threadId: "thread-OTHER",
    });

    const ctx = makeCtx({ threadId: "thread-test" });
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).not.toHaveBeenCalled();
  });

  it("card.thread.projectId !== ctx.projectId → error, no startGen call", async () => {
    const p = await getPrisma();
    // Card belongs to a different project
    p.chatMessage.findFirst.mockResolvedValue({
      ...makeCard(),
      thread: { projectId: "proj-OTHER", deletedAt: null, ownerId: ORG_ID },
    });

    const ctx = makeCtx({ projectId: "proj-test" });
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).not.toHaveBeenCalled();
  });

  it("card with matching threadId and projectId → startGen called (happy path)", async () => {
    const p = await getPrisma();
    // Card matches both ctx.threadId and ctx.projectId
    p.chatMessage.findFirst.mockResolvedValue(makeCard());

    const ctx = makeCtx({ threadId: "thread-test", projectId: "proj-test" });
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).not.toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Test 7: disabled model → error, startGen NOT called
// ---------------------------------------------------------------------------

describe("Test 7 — disabled model check", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.genJob.findFirst.mockResolvedValue(null);
    p.chatMessage.update.mockResolvedValue({});
  });

  it("model in ctx.disabledModels → error response, startGen NOT called", async () => {
    const p = await getPrisma();
    // Card uses "seedream"
    p.chatMessage.findFirst.mockResolvedValue(makeCard({ model: "seedream" }));

    const ctx = makeCtx({ disabledModels: ["seedream"] });
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).not.toHaveBeenCalled();
  });

  it("non-disabled model → startGen IS called", async () => {
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard({ model: "seedream" }));

    const ctx = makeCtx({ disabledModels: ["some-other-model"] });
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).not.toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Test 8: missing startGen port → throws (fail loud, never silent no-op)
// ---------------------------------------------------------------------------

describe("Test 8 — missing startGen port throws", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard());
    p.genJob.findFirst.mockResolvedValue(null);
    p.chatMessage.update.mockResolvedValue({});
  });

  it("ctx.startGen undefined → throws 'startGen port required'", async () => {
    const ctx = makeCtx({ startGen: undefined });
    await expect(executeGenerate({ cardId: CARD_ID }, { context: ctx })).rejects.toThrow(
      "startGen port required",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 9: import audit — generate.ts does NOT bypass startGen
// ---------------------------------------------------------------------------

describe("Test 9 — import audit: no direct spend bypass in generate.ts", () => {
  it("generate.ts source does not import the generation provider directly, create GenJob directly, or import from apps/*", () => {
    // Read the source file and assert forbidden patterns are absent.
    const src = readFileSync(
      new URL("./generate.ts", import.meta.url),
      "utf8",
    );

    // Must NOT directly call/import the generation provider package
    expect(src).not.toMatch(/from\s+['"]@fikirtive\/generation['"]/);

    // Must NOT create a GenJob directly (only startGen does this)
    expect(src).not.toMatch(/genJob\.create/);

    // Must NOT import startGen or gen-actions from apps/* (boundary violation)
    expect(src).not.toMatch(/from\s+['"][^'"]*apps\//);
    expect(src).not.toMatch(/from\s+['"][^'"]*gen-actions/);

    // Must use ctx.startGen as the ONLY spend path
    expect(src).toMatch(/ctx\.startGen/);

    // Must NOT call reserveCredits as a function call (import or call expression)
    // We check for it as a function call pattern, not as a comment word
    expect(src).not.toMatch(/reserveCredits\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// FSE-012（creation-engine.md §5 :170，Founder 2026-09-10 裁 #1307）——
// 「批的是 A，执行的不许是 B」
//
// 判官第 3 轮 P2-b 钉的窗口：`ottoApprove` 门口那道报价版本闸读了一次卡、比对通过，恢复轮
// 才开始跑；这一步**再读一次**卡并按它重拼整份请求，所以卡在这两次读之间被改掉时，价钱会
// 自洽在**新**的那一版上——`startCoworkGen` 的「卡面价 vs 现算价对签」与事务内的
// `cardFingerprint` 都拦不住它（两边都是新的那一份）。商家批了 1 张、被收了 2 张的钱。
//
// 出路是把「他批的是哪一版」随 ctx 带进来（`ottoApprove` 注入，绝不来自模型参数），在这里
// 与**这一次读出来、马上要拿去拼装请求的那张卡**逐串比对。`ctx.startGen` 是这条路上唯一
// 花钱的出口（本文件末尾那条源码闸钉着这件事），所以「一次都没调用」就是「一分钱没花」。
// ---------------------------------------------------------------------------

describe("creation §5 :170 FSE-012 —— 批准那一版之后卡被改掉,执行不许按新的那一版收费", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.genJob.findFirst.mockResolvedValue(null);
    p.chatMessage.update.mockResolvedValue({});
  });

  it("creation §5 :170 FSE-012 批准 1 张之后卡被改成 2 张:拒绝,startGen 一次都没被调用(零预扣)", async () => {
    const { cardQuoteVersion, QUOTE_VERSION_STALE } = await import("@fikirtive/core");
    const p = await getPrisma();
    // 商家眼前那一版:1 张。
    const approvedVersion = cardQuoteVersion(makeImageCardPayload({ params: { count: 1 }, estimatedCredits: 1 }));
    // 这一步读到的却已经是改过的那一版:2 张、价也变了。
    p.chatMessage.findFirst.mockResolvedValue(makeCard({ params: { count: 2 }, estimatedCredits: 2 }));
    const ctx = makeCtx({ approvedQuoteVersion: { cardId: CARD_ID, version: approvedVersion } });

    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toEqual({ error: QUOTE_VERSION_STALE });
    // 这条路上唯一花钱的出口一次都没被调用 ⇒ 零建任务、零预扣、账本零新增行。
    expect(ctx.startGen as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    // 也没有把任何东西写回那张卡 —— 拒绝不是一次写。
    expect(p.chatMessage.update).not.toHaveBeenCalled();
    // 判官第 5 轮 P2-a —— 这道闸把判决**报上去**：外层（`ottoApprove`）据此知道这一趟
    // 到底发生了什么，而不是靠「这张卡有没有任务行」猜（同一轮生成了别的卡时那个判据会说谎）。
    expect(ctx.approvedQuoteVersion?.refused).toBe(true);
  });

  it("creation §5 :170 FSE-012 卡没被动过:版本对得上,照常走到 startGen", async () => {
    const { cardQuoteVersion } = await import("@fikirtive/core");
    const p = await getPrisma();
    const payload = makeImageCardPayload({ params: { count: 1 }, estimatedCredits: 1 });
    p.chatMessage.findFirst.mockResolvedValue(makeCard({ params: { count: 1 }, estimatedCredits: 1 }));
    const ctx = makeCtx({ approvedQuoteVersion: { cardId: CARD_ID, version: cardQuoteVersion(payload) } });

    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).not.toHaveProperty("error");
    expect(ctx.startGen as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    // 没拒 ⇒ 那一格说的必须是「没拒」（外层读到 true 就会把一次成功的批准说成「价变了」）。
    // 判官第 6 轮 P1：这道闸放行时**写下**这个判决，而不是把上一次的判决留在那里。
    expect(ctx.approvedQuoteVersion?.refused).toBe(false);
  });

  it("creation §5 :170 FSE-012 这一版只批准了这一张卡:同一轮里生成别的卡不受它约束", async () => {
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard({ params: { count: 2 }, estimatedCredits: 2 }));
    // 批的是**另一张**卡的报价版本 —— 拿它去拦这一张,等于凭空拦下一次合法生成。
    const ctx = makeCtx({ approvedQuoteVersion: { cardId: "card-some-other", version: "whatever" } });

    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).not.toHaveProperty("error");
    expect(ctx.startGen as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("creation §5 :170 FSE-012 缺席＝放行:没有这一格时行为与这道闸出现之前逐字相同", async () => {
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard({ params: { count: 2 }, estimatedCredits: 2 }));
    const ctx = makeCtx();

    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).not.toHaveProperty("error");
    expect(ctx.startGen as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("creation §5 :170 FSE-012 已经成交的那张卡:幂等取回优先,不被说成价变了", async () => {
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard({ params: { count: 2 }, estimatedCredits: 2 }));
    p.genJob.findFirst.mockResolvedValue({ id: "job-existing", status: "DONE" });
    const ctx = makeCtx({ approvedQuoteVersion: { cardId: CARD_ID, version: "a-stale-version" } });

    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toEqual({ genJobId: "job-existing", status: "DONE" });
    expect(ctx.startGen as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
  /**
   * 判官第 6 轮 P1（其一）——「先被拒、随后同一张卡真的生成成功」。
   *
   * 恢复轮里模型对工具错误重试一次，就会在**同一轮**里第二次调用这个技能；商家在这中间把
   * 那一格改了回去（控件不锁，他改得动），版本于是重新对得上。那一格只置不清的话，外层读到
   * 的仍是「被拒」——商家听到「价变了，什么都没生成」，而任务行与生成预扣**已经落地**。
   */
  it("creation §5 :170 FSE-012 同一轮里先拒后放行:判决被收回,不许把一次真的生成说成价变了", async () => {
    const { cardQuoteVersion, QUOTE_VERSION_STALE } = await import("@fikirtive/core");
    const p = await getPrisma();
    const approvedVersion = cardQuoteVersion(makeImageCardPayload({ params: { count: 1 }, estimatedCredits: 1 }));
    const ctx = makeCtx({ approvedQuoteVersion: { cardId: CARD_ID, version: approvedVersion } });

    // ① 卡被改成 2 张 ⇒ 拒。
    p.chatMessage.findFirst.mockResolvedValue(makeCard({ params: { count: 2 }, estimatedCredits: 2 }));
    expect(await executeGenerate({ cardId: CARD_ID }, { context: ctx })).toEqual({ error: QUOTE_VERSION_STALE });
    expect(ctx.approvedQuoteVersion?.refused).toBe(true);

    // ② 商家改了回去 ⇒ 同一轮第二次调用真的成交。
    p.chatMessage.findFirst.mockResolvedValue(makeCard({ params: { count: 1 }, estimatedCredits: 1 }));
    const second = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(second).not.toHaveProperty("error");
    expect(ctx.startGen as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    // 判决被收回 ⇒ 外层交回的是「成交」，不是「价变了」。
    expect(ctx.approvedQuoteVersion?.refused).toBe(false);
  });

  /**
   * 判官第 6 轮 P1（其二）—— 报价拒绝的**第二个发生地**：钱事务里那次逐字复读
   * （`gen-actions.ts` 的 `cardFingerprint` 对签）。卡在本步读卡之后、create/reserve 之前
   * 被重铸时，拒绝由 `startGen` 报出来，而这一格从前一次都没置 ⇒ 外层把那一趟读成一次
   * 正常结束的恢复轮，`onApproved` 照常被调用。判据不是那句错误文案（措辞会改、会本地化），
   * 是同一条：库里这张卡此刻还是不是他批的那一版。
   */
  it("creation §5 :170 FSE-012 下游拒绝且卡此刻已漂:按报价拒绝上报,交回同一句话", async () => {
    const { cardQuoteVersion, QUOTE_VERSION_STALE } = await import("@fikirtive/core");
    const p = await getPrisma();
    const approvedVersion = cardQuoteVersion(makeImageCardPayload({ params: { count: 1 }, estimatedCredits: 1 }));
    // 第一次读(闸比对)对得上;错误路径那次重读读到的已经是改过的那一版。
    p.chatMessage.findFirst
      .mockResolvedValueOnce(makeCard({ params: { count: 1 }, estimatedCredits: 1 }))
      .mockResolvedValueOnce(makeCard({ params: { count: 2 }, estimatedCredits: 2 }));
    const ctx = makeCtx({
      approvedQuoteVersion: { cardId: CARD_ID, version: approvedVersion },
      startGen: vi.fn().mockResolvedValue({ error: "This card changed while you were approving it — review it once more, then generate." }),
    });

    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toEqual({ error: QUOTE_VERSION_STALE });
    expect(ctx.approvedQuoteVersion?.refused).toBe(true);
  });

  it("creation §5 :170 FSE-012 下游拒绝但卡一格没漂:原样交回那句话,不许被翻译成价变了", async () => {
    const { cardQuoteVersion, QUOTE_VERSION_STALE } = await import("@fikirtive/core");
    const p = await getPrisma();
    const approvedVersion = cardQuoteVersion(makeImageCardPayload({ params: { count: 1 }, estimatedCredits: 1 }));
    p.chatMessage.findFirst.mockResolvedValue(makeCard({ params: { count: 1 }, estimatedCredits: 1 }));
    const ctx = makeCtx({
      approvedQuoteVersion: { cardId: CARD_ID, version: approvedVersion },
      startGen: vi.fn().mockResolvedValue({ error: "You don't have enough credits for this." }),
    });

    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toEqual({ error: "You don't have enough credits for this." });
    expect(result).not.toEqual({ error: QUOTE_VERSION_STALE });
    expect(ctx.approvedQuoteVersion?.refused).toBe(false);
  });
});

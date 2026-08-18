import { describe, it, expect, vi, beforeEach } from "vitest";
import { researchCardInput, buildResearchCardPayload, RESEARCH_TIERS, researchTierEstimate, researchTierBudgetInternal, researchTierSearchBudgetInternal } from "./propose-research.helpers.js";
import { executeProposeResearch, proposeResearchSkill } from "./propose-research.js";
import { turnBudgetInternal, llmPricesFor, ottoLlmMargin, displayCredits, searchChargeInternal } from "@fikirtive/core";
import type { OttoContext } from "../context.js";

vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatMessage: { findFirst: vi.fn(), create: vi.fn() },
    genJob: { create: vi.fn() }, // must NEVER be called ($0)
  },
}));

function makeCtx(over?: Partial<OttoContext>): OttoContext {
  return { orgId: "org-test", userId: "u", projectId: "p", threadId: "t-1", disabledModels: [], sourceGenerationId: null, ...over } as OttoContext;
}

describe("researchCardInput schema", () => {
  it("accepts a minimal valid research plan (tier defaults to standard)", () => {
    const r = researchCardInput.safeParse({ topic: "EV market in SEA" });
    expect(r.success).toBe(true);
    expect(r.success && r.data.tier).toBe("standard");
  });
  it("requires topic ≥3 chars", () => {
    expect(researchCardInput.safeParse({ topic: "ab" }).success).toBe(false);
  });
  it("caps topic at 200 chars", () => {
    expect(researchCardInput.safeParse({ topic: "x".repeat(201) }).success).toBe(false);
  });
  it("goal is optional", () => {
    expect(researchCardInput.safeParse({ topic: "coffee trends", goal: "brief a launch" }).success).toBe(true);
  });
  it("accepts each valid tier and rejects unknown ones", () => {
    for (const tier of ["quick", "standard", "deep"] as const) {
      expect(researchCardInput.safeParse({ topic: "market", tier }).success).toBe(true);
    }
    expect(researchCardInput.safeParse({ topic: "market", tier: "extreme" }).success).toBe(false);
  });
  it("accepts optional sub-questions and caps them at 8", () => {
    expect(researchCardInput.safeParse({ topic: "market", questions: ["who?", "how big?"] }).success).toBe(true);
    const nine = Array.from({ length: 9 }, (_, i) => `q${i}`);
    expect(researchCardInput.safeParse({ topic: "market", questions: nine }).success).toBe(false);
  });
});

describe("RESEARCH_TIERS", () => {
  it("is monotonic increasing on every axis (quick < standard < deep)", () => {
    const axes = ["maxSearches", "maxPages", "maxSteps", "estimatedCredits"] as const;
    for (const axis of axes) {
      expect(RESEARCH_TIERS.quick[axis]).toBeLessThan(RESEARCH_TIERS.standard[axis]);
      expect(RESEARCH_TIERS.standard[axis]).toBeLessThan(RESEARCH_TIERS.deep[axis]);
    }
  });

  it("estimatedCredits is DERIVED from the worker's withLlmBudget reserve, not a magic number", () => {
    // Each tier's card estimate must equal displayCredits(LLM 预算 + 搜索预算) rounded up —
    // i.e. the SAME hold apps/worker/src/jobs/research.ts hands to withLlmBudget, expressed in
    // DISPLAYED credits. This is the honesty invariant: card quote ≈ worker reserve.
    //
    // 钱路 M1-c(裁决 9b):这个不变量现在盖**两条腿**。搜索此前是 free,所以卡面报的价与
    // worker 真持有的数曾经是同一个数;3× 计价落地后,少算搜索的卡面就是在骗商家 ——
    // 这里把两条腿一起钉住,正是为了不让它们再分家。
    for (const key of ["quick", "standard", "deep"] as const) {
      const t = RESEARCH_TIERS[key];
      const expected = Math.ceil(
        displayCredits(
          turnBudgetInternal(llmPricesFor("claude-sonnet-4-6"), ottoLlmMargin(), t.maxSteps) +
            searchChargeInternal(t.maxSearches),
        ),
      );
      expect(t.estimatedCredits).toBe(expected);
      // And it is NOT the retired S2 placeholder (10/25/60).
      expect(t.estimatedCredits).not.toBe({ quick: 10, standard: 25, deep: 60 }[key]);
    }
  });

  it("卡面预估真的**含**搜索那一笔 —— 少算它就是报低价", () => {
    for (const key of ["quick", "standard", "deep"] as const) {
      const t = RESEARCH_TIERS[key];
      const llmOnly = turnBudgetInternal(llmPricesFor("claude-sonnet-4-6"), ottoLlmMargin(), t.maxSteps);
      expect(researchTierBudgetInternal(t.maxSteps, t.maxSearches)).toBe(llmOnly + searchChargeInternal(t.maxSearches));
      expect(searchChargeInternal(t.maxSearches)).toBeGreaterThan(0);
    }
  });

  it("researchTierEstimate is monotonic in maxSteps and matches the tier table", () => {
    expect(researchTierEstimate(6, 5)).toBeLessThan(researchTierEstimate(12, 12));
    expect(researchTierEstimate(12, 12)).toBeLessThan(researchTierEstimate(24, 25));
    expect(researchTierEstimate(RESEARCH_TIERS.quick.maxSteps, RESEARCH_TIERS.quick.maxSearches)).toBe(
      RESEARCH_TIERS.quick.estimatedCredits,
    );
    expect(researchTierEstimate(RESEARCH_TIERS.deep.maxSteps, RESEARCH_TIERS.deep.maxSearches)).toBe(
      RESEARCH_TIERS.deep.estimatedCredits,
    );
  });

  it("researchTierBudgetInternal returns the RAW internal hold (the worker's withLlmBudget reserve)", () => {
    // This is the exact value apps/worker/src/jobs/research.ts holds via withLlmBudget for the
    // tier — approve's balance gate compares CreditAccount.balance (also internal) to it.
    // 钱路 M1-c:worker 的 hold = LLM 部分 + extraHoldInternal(搜索部分),这里两边逐字对齐。
    for (const key of ["quick", "standard", "deep"] as const) {
      const { maxSteps, maxSearches } = RESEARCH_TIERS[key];
      const expected =
        turnBudgetInternal(llmPricesFor("claude-sonnet-4-6"), ottoLlmMargin(), maxSteps) +
        researchTierSearchBudgetInternal(maxSearches);
      expect(researchTierBudgetInternal(maxSteps, maxSearches)).toBe(expected);
    }
  });

  it("researchTierSearchBudgetInternal = worker 传给 extraHoldInternal 的那个数(一个定义,两处引用)", () => {
    expect(researchTierSearchBudgetInternal(RESEARCH_TIERS.quick.maxSearches)).toBe(5 * 3);
    expect(researchTierSearchBudgetInternal(RESEARCH_TIERS.standard.maxSearches)).toBe(12 * 3);
    expect(researchTierSearchBudgetInternal(RESEARCH_TIERS.deep.maxSearches)).toBe(25 * 3);
  });

  it("internal budget > displayed estimate for the same tier (they are DIFFERENT units)", () => {
    // Regression guard: internal (balance-unit) and displayed (card-unit) must never be conflated.
    // The internal budget is INTERNAL_PER_DISPLAY (~10×) larger — that gap IS the unit-mismatch
    // the approve gate must respect. If a refactor ever makes these equal, this fails loudly.
    for (const key of ["quick", "standard", "deep"] as const) {
      const { maxSteps, maxSearches } = RESEARCH_TIERS[key];
      expect(researchTierBudgetInternal(maxSteps, maxSearches)).toBeGreaterThan(
        researchTierEstimate(maxSteps, maxSearches),
      );
    }
  });

  it("researchTierBudgetInternal is monotonic across tiers", () => {
    const budget = (key: "quick" | "standard" | "deep") =>
      researchTierBudgetInternal(RESEARCH_TIERS[key].maxSteps, RESEARCH_TIERS[key].maxSearches);
    expect(budget("quick")).toBeLessThan(budget("standard"));
    expect(budget("standard")).toBeLessThan(budget("deep"));
  });

  // 判官 P3-2:两个预算函数的 maxSearches 是**必填**。默认 0 会留一条「安静地按只有 LLM
  // 的价钱算」的路 —— 少算一条腿的报价不会报错,只会报低价,而那正是这张票要杀的病。
  it("maxSearches 是必填参数 —— 漏传搜索腿不再是一个悄悄变便宜的估值", () => {
    // 类型层面已经挡住(漏传是编译错误);这里钉住**行为**:传 0 与传真实上限算出来的数
    // 必须不同,证明这个参数真的参与计价,而不是一个被忽略的形参。
    const { maxSteps, maxSearches } = RESEARCH_TIERS.standard;
    expect(researchTierBudgetInternal(maxSteps, 0)).toBeLessThan(
      researchTierBudgetInternal(maxSteps, maxSearches),
    );
    expect(researchTierBudgetInternal(maxSteps, maxSearches) - researchTierBudgetInternal(maxSteps, 0)).toBe(
      researchTierSearchBudgetInternal(maxSearches),
    );
  });
});

describe("buildResearchCardPayload", () => {
  // 注入计数器 id 工厂,让 researchId 确定可断言(默认工厂是 newId=ULID,非确定)。
  const counter = () => { let n = 0; return () => `res-${n++}`; };
  it("stamps a researchId via the injected mintId", () => {
    const p = buildResearchCardPayload(researchCardInput.parse({ topic: "EV market" }), counter());
    expect(p.researchId).toBe("res-0");
  });
  it("mints a researchId by default (no injected factory)", () => {
    const p = buildResearchCardPayload(researchCardInput.parse({ topic: "EV market" }));
    expect(typeof p.researchId).toBe("string");
    expect(p.researchId.length).toBeGreaterThan(0);
  });
  it("pulls estimatedCredits from RESEARCH_TIERS[tier]", () => {
    const p = buildResearchCardPayload(researchCardInput.parse({ topic: "EV market", tier: "deep" }), counter());
    expect(p.tier).toBe("deep");
    expect(p.estimatedCredits).toBe(RESEARCH_TIERS.deep.estimatedCredits);
  });
  it("defaults questions to [] when omitted", () => {
    const p = buildResearchCardPayload(researchCardInput.parse({ topic: "EV market" }), counter());
    expect(p.questions).toEqual([]);
  });
  it("carries goal + questions onto the payload when present, sets status=planned", () => {
    const p = buildResearchCardPayload(
      researchCardInput.parse({ topic: "EV market", goal: "size the market", questions: ["who leads?"] }),
      counter(),
    );
    expect(p.goal).toBe("size the market");
    expect(p.questions).toEqual(["who leads?"]);
    expect(p.status).toBe("planned");
  });
  it("omits goal from the payload when absent", () => {
    const p = buildResearchCardPayload(researchCardInput.parse({ topic: "EV market" }), counter());
    expect("goal" in p).toBe(false);
  });
});

describe("executeProposeResearch — mock DB", () => {
  let m: { chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }; genJob: { create: ReturnType<typeof vi.fn> } };
  beforeEach(async () => {
    vi.clearAllMocks();
    m = (await import("@fikirtive/db")).prisma as unknown as typeof m;
    m.chatMessage.findFirst.mockResolvedValue({ seq: 4 });
    m.chatMessage.create.mockResolvedValue({});
  });

  it("persists a RESEARCH_CARD with ownerId+threadId from ctx, seq=last+1, correct payload", async () => {
    const ctx = makeCtx({ orgId: "org-A", threadId: "thr-A" });
    const res = await executeProposeResearch(
      { topic: "SEA coffee market", goal: "brief a launch", tier: "deep", questions: ["who leads?"] },
      { context: ctx },
    );
    expect(m.chatMessage.create).toHaveBeenCalledTimes(1);
    const data = (m.chatMessage.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.kind).toBe("RESEARCH_CARD");
    expect(data.ownerId).toBe("org-A");
    expect(data.threadId).toBe("thr-A");
    expect(data.role).toBe("AGENT");
    expect(data.seq).toBe(5);
    expect(data.text).toBe("");
    expect(data.genJobId).toBeUndefined();
    const payload = data.payload as { researchId: string; topic: string; goal?: string; tier: string; questions: string[]; estimatedCredits: number; status: string };
    expect(payload.topic).toBe("SEA coffee market");
    expect(payload.goal).toBe("brief a launch");
    expect(payload.tier).toBe("deep");
    expect(payload.questions).toEqual(["who leads?"]);
    expect(payload.estimatedCredits).toBe(RESEARCH_TIERS.deep.estimatedCredits);
    expect(payload.status).toBe("planned");
    expect(typeof payload.researchId).toBe("string");
    expect(payload.researchId.length).toBeGreaterThan(0);
    expect(res.cardId).toEqual(expect.any(String));
  });

  it("never creates a GenJob ($0)", async () => {
    await executeProposeResearch({ topic: "coffee market", tier: "standard" }, { context: makeCtx() });
    expect(m.genJob.create).not.toHaveBeenCalled();
  });
});

describe("proposeResearchSkill gate", () => {
  it("free/write/internal → not gated; declares a topic requirement", () => {
    expect(proposeResearchSkill.cost).toBe("free");
    expect(proposeResearchSkill.effect).toBe("write");
    expect(proposeResearchSkill.reach).toBe("internal");
    expect(proposeResearchSkill.needsApproval).toBe(false);
    expect(proposeResearchSkill.requires.map((r) => r.field)).toContain("topic");
  });
});

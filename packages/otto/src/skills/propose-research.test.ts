import { describe, it, expect, vi, beforeEach } from "vitest";
import { researchCardInput, buildResearchCardPayload, RESEARCH_TIERS } from "./propose-research.helpers.js";
import { executeProposeResearch, proposeResearchSkill } from "./propose-research.js";
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

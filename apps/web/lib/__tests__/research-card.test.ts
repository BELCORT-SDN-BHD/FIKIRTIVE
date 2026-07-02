import { describe, it, expect } from "vitest";
import { parseResearchCardPayload, RESEARCH_TIER_LABELS } from "../research-card";

describe("parseResearchCardPayload", () => {
  it("empty / undefined / null payload → 兜底(空 topic、standard 档、空问题、0 credits、planned)", () => {
    const base = { topic: "", tier: "standard", questions: [], estimatedCredits: 0, status: "planned" };
    expect(parseResearchCardPayload(undefined)).toEqual(base);
    expect(parseResearchCardPayload(null)).toEqual(base);
    expect(parseResearchCardPayload({})).toEqual(base);
  });

  it("合法 payload → 全字段透传", () => {
    const r = parseResearchCardPayload({
      researchId: "rz_1",
      topic: "EV market",
      goal: "size the SEA opportunity",
      tier: "deep",
      questions: ["Who leads?", "Margins?"],
      estimatedCredits: 60,
      status: "planned",
    });
    expect(r.topic).toBe("EV market");
    expect(r.goal).toBe("size the SEA opportunity");
    expect(r.tier).toBe("deep");
    expect(r.questions).toEqual(["Who leads?", "Margins?"]);
    expect(r.estimatedCredits).toBe(60);
    expect(r.status).toBe("planned");
  });

  it("partial payload(只有 topic)→ 其余兜底", () => {
    const r = parseResearchCardPayload({ topic: "trends" });
    expect(r.topic).toBe("trends");
    expect(r.goal).toBeUndefined();
    expect(r.tier).toBe("standard");
    expect(r.questions).toEqual([]);
    expect(r.estimatedCredits).toBe(0);
    expect(r.status).toBe("planned");
  });

  it("未知 tier → 回落 standard", () => {
    expect(parseResearchCardPayload({ topic: "x", tier: "ultra" }).tier).toBe("standard");
    expect(parseResearchCardPayload({ topic: "x", tier: 42 }).tier).toBe("standard");
  });

  it("已知 tier 各档标签存在(client-safe 副本)", () => {
    expect(RESEARCH_TIER_LABELS.quick).toBe("Quick");
    expect(RESEARCH_TIER_LABELS.standard).toBe("Standard");
    expect(RESEARCH_TIER_LABELS.deep).toBe("Deep");
    expect(parseResearchCardPayload({ topic: "x", tier: "quick" }).tier).toBe("quick");
  });

  it("questions 非数组 → 归空;数组里混入非字符串 → 过滤", () => {
    expect(parseResearchCardPayload({ topic: "x", questions: "nope" }).questions).toEqual([]);
    expect(parseResearchCardPayload({ topic: "x", questions: ["a", 1, null, "b"] }).questions).toEqual(["a", "b"]);
  });

  it("未知/缺失 status → 回落 planned;running/done 透传", () => {
    expect(parseResearchCardPayload({ topic: "x", status: "weird" }).status).toBe("planned");
    expect(parseResearchCardPayload({ topic: "x" }).status).toBe("planned");
    expect(parseResearchCardPayload({ topic: "x", status: "running" }).status).toBe("running");
    expect(parseResearchCardPayload({ topic: "x", status: "done" }).status).toBe("done");
  });

  it("estimatedCredits 非 number → 兜底 0;goal 空串 → 省略", () => {
    expect(parseResearchCardPayload({ topic: "x", estimatedCredits: "60" }).estimatedCredits).toBe(0);
    expect(parseResearchCardPayload({ topic: "x", goal: "" }).goal).toBeUndefined();
  });
});

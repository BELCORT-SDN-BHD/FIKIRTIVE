import { describe, it, expect } from "vitest";
import { parseResearchCardPayload, RESEARCH_TIER_LABELS } from "../research-card";

describe("parseResearchCardPayload", () => {
  it("empty / undefined / null payload → 兜底(空 topic、standard 档、空问题、**没有报价**、planned)", () => {
    const base = { topic: "", tier: "standard", questions: [], estimatedCredits: null, status: "planned" };
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
    expect(r.estimatedCredits).toBeNull();
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

  it("未知/缺失 status → 回落 planned;running/done/failed 透传", () => {
    expect(parseResearchCardPayload({ topic: "x", status: "weird" }).status).toBe("planned");
    expect(parseResearchCardPayload({ topic: "x" }).status).toBe("planned");
    expect(parseResearchCardPayload({ topic: "x", status: "running" }).status).toBe("running");
    expect(parseResearchCardPayload({ topic: "x", status: "done" }).status).toBe("done");
    expect(parseResearchCardPayload({ topic: "x", status: "failed" }).status).toBe("failed");
  });

  it("goal 空串 → 省略", () => {
    expect(parseResearchCardPayload({ topic: "x", goal: "" }).goal).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // #896 r2 P0-b —— 报价只认「正的安全整数」,别的一律 null(= 这张卡没有价)
  //
  // 以前这里把缺失/畸形的 estimatedCredits 兜底成 **0**,而 0 会一路装成一个真报价:
  // canAffordPack(0, 任何余额) 恒真 ⇒ 按钮是启用的、写着「Run research · 0 credits」,
  // 商家按下去,服务端却按 tier 的正数预算真跑 —— 屏幕上的价和实际扣的钱是两个数。
  // 0 不是「免费」,它只可能是脏数据;与 GEN_CARD 的 guaranteedCredits 同一条口径。
  // -------------------------------------------------------------------------
  it("缺失 / 非 number 的 estimatedCredits → null,不是 0", () => {
    expect(parseResearchCardPayload({ topic: "x" }).estimatedCredits).toBeNull();
    expect(parseResearchCardPayload({ topic: "x", estimatedCredits: "60" }).estimatedCredits).toBeNull();
    expect(parseResearchCardPayload({ topic: "x", estimatedCredits: null }).estimatedCredits).toBeNull();
  });

  it("0 / 负数 / 小数 / 非有限值 → null(不存在免费或半个 credit 的研究)", () => {
    for (const bad of [0, -1, -20, 4.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) {
      expect(
        parseResearchCardPayload({ topic: "x", estimatedCredits: bad }).estimatedCredits,
        `estimatedCredits=${String(bad)} 不是一个能给商家看、能照着扣的报价`,
      ).toBeNull();
    }
  });

  it("正的安全整数 → 原样透传(唯一算数的报价)", () => {
    expect(parseResearchCardPayload({ topic: "x", estimatedCredits: 1 }).estimatedCredits).toBe(1);
    expect(parseResearchCardPayload({ topic: "x", estimatedCredits: 22 }).estimatedCredits).toBe(22);
  });
});

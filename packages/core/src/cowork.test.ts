import { describe, expect, it } from "vitest";
import { coworkTurnRequest } from "./cowork.js";
import { GOAL_PRESETS } from "./goals.js";

describe("coworkTurnRequest goalKey (#995)", () => {
  const base = { projectId: "p1", text: "let's go" };

  // 枚举原来是手抄的一份四个键的清单。加一个目标却忘了改它,界面上画得出来的那颗 chip
  // 会被服务端静默拒收 —— 而且没有任何测试会红。所以这里逐个目标核一遍。
  it.each(Object.keys(GOAL_PRESETS))("接受界面上真的存在的目标「%s」", (goalKey) => {
    expect(coworkTurnRequest.safeParse({ ...base, goalKey }).success).toBe(true);
  });

  it("不认识的目标照旧拒收", () => {
    expect(coworkTurnRequest.safeParse({ ...base, goalKey: "make-me-rich" }).success).toBe(false);
  });
});

describe("coworkTurnRequest sourceGenerationId", () => {
  const base = { projectId: "p1", text: "animate this" };
  it("is optional (a normal turn omits it)", () => {
    const r = coworkTurnRequest.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.success && r.data.sourceGenerationId).toBeUndefined();
  });
  it("accepts an id within bounds", () => {
    const r = coworkTurnRequest.safeParse({ ...base, sourceGenerationId: "gen_abc" });
    expect(r.success).toBe(true);
    expect(r.success && r.data.sourceGenerationId).toBe("gen_abc");
  });
  it("rejects an over-long id", () => {
    const r = coworkTurnRequest.safeParse({ ...base, sourceGenerationId: "x".repeat(65) });
    expect(r.success).toBe(false);
  });
});

describe("coworkTurnRequest sourceGenerationIds", () => {
  const base = { projectId: "p1", text: "compare these" };
  it("accepts multiple bounded image reference ids", () => {
    const r = coworkTurnRequest.safeParse({ ...base, sourceGenerationIds: ["gen_a", "gen_b"] });
    expect(r.success).toBe(true);
    expect(r.success && r.data.sourceGenerationIds).toEqual(["gen_a", "gen_b"]);
  });
  it("rejects over-length ids inside sourceGenerationIds", () => {
    const r = coworkTurnRequest.safeParse({ ...base, sourceGenerationIds: ["gen_a", "x".repeat(65)] });
    expect(r.success).toBe(false);
  });
});

describe("coworkTurnRequest referenceVideoGenerationId", () => {
  const base = { projectId: "p", text: "hi" };
  it("accepts a bounded referenceVideoGenerationId", () => {
    const r = coworkTurnRequest.safeParse({ ...base, referenceVideoGenerationId: "gen_vid" });
    expect(r.success && r.data.referenceVideoGenerationId).toBe("gen_vid");
  });
  it("rejects an over-length referenceVideoGenerationId", () => {
    const r = coworkTurnRequest.safeParse({ ...base, referenceVideoGenerationId: "x".repeat(65) });
    expect(r.success).toBe(false);
  });
});

describe("coworkTurnRequest referenceVideoGenerationIds", () => {
  const base = { projectId: "p", text: "hi" };
  it("accepts multiple bounded video reference ids", () => {
    const r = coworkTurnRequest.safeParse({ ...base, referenceVideoGenerationIds: ["gen_vid_1", "gen_vid_2"] });
    expect(r.success).toBe(true);
    expect(r.success && r.data.referenceVideoGenerationIds).toEqual(["gen_vid_1", "gen_vid_2"]);
  });
  it("rejects over-length ids inside referenceVideoGenerationIds", () => {
    const r = coworkTurnRequest.safeParse({ ...base, referenceVideoGenerationIds: ["gen_vid", "x".repeat(65)] });
    expect(r.success).toBe(false);
  });
});

// #879 step 1 — Otto foundation schema pinning: position-only page-context fields.
describe("coworkTurnRequest surface / subjectRef / outletId (#879 step 1)", () => {
  const base = { projectId: "p1", text: "hi" };

  it("are all optional (a normal turn omits them)", () => {
    const r = coworkTurnRequest.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.success && r.data.surface).toBeUndefined();
    expect(r.success && r.data.subjectRef).toBeUndefined();
    expect(r.success && r.data.outletId).toBeUndefined();
  });

  it("accepts bounded values for all three", () => {
    const r = coworkTurnRequest.safeParse({
      ...base,
      surface: "campaign",
      subjectRef: "campaign_123",
      outletId: "outlet_abc",
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.surface).toBe("campaign");
    expect(r.success && r.data.subjectRef).toBe("campaign_123");
    expect(r.success && r.data.outletId).toBe("outlet_abc");
  });

  it("rejects an over-long surface", () => {
    const r = coworkTurnRequest.safeParse({ ...base, surface: "x".repeat(65) });
    expect(r.success).toBe(false);
  });

  it("rejects an over-long subjectRef", () => {
    const r = coworkTurnRequest.safeParse({ ...base, subjectRef: "x".repeat(65) });
    expect(r.success).toBe(false);
  });

  it("rejects an over-long outletId", () => {
    const r = coworkTurnRequest.safeParse({ ...base, outletId: "x".repeat(65) });
    expect(r.success).toBe(false);
  });

  // Security boundary: actorId and visibility are IDENTITY columns — there is no
  // client-facing field for them. `.strict()` on the object schema means the whole
  // request is rejected (not silently stripped) if a caller sends them, so an
  // over-claiming client cannot smuggle identity through this door at all.
  it("rejects the whole request if the client tries to smuggle actorId", () => {
    const r = coworkTurnRequest.safeParse({ ...base, actorId: "user_someone_else" });
    expect(r.success).toBe(false);
  });

  it("rejects the whole request if the client tries to smuggle visibility", () => {
    const r = coworkTurnRequest.safeParse({ ...base, visibility: "private" });
    expect(r.success).toBe(false);
  });
});

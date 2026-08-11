import { describe, it, expect } from "vitest";
import { pricedRefgenCredits, displayCredits } from "@fikirtive/core";
import { spendCapRefusal, approvedToolCostInternal } from "@/lib/spend-cap-preflight";

// #524 r3(判官 r2 P1-B):卡片批准的是「恢复轮 LLM hold + 那个付费工具」两条腿。每条闸只看
// 得见自己那条,所以只有这里能把一次批准的全成本加起来说给商家听。这支测试钉的是这个加总:
// 数字必须来自中央定价函数,未知成本一律算 0(宁可漏算落到真闸,也不能多算拦下本可放行的活)。

/** A stand-in for the `organization` delegate the preflight reads through. */
function orgReading(settings: unknown) {
  return {
    organization: { findUnique: async () => (settings === undefined ? null : { settings }) },
  } as unknown as Parameters<typeof spendCapRefusal>[0];
}

describe("approvedToolCostInternal — the second leg of one approval", () => {
  it("prices generateReferences through the SAME central function the tool charges with", () => {
    for (const count of [1, 2, 3, 4, 5, 6]) {
      expect(approvedToolCostInternal("generateReferences", { count })).toBe(
        pricedRefgenCredits({ model: "seedream", count }),
      );
    }
  });

  it("judge r2's repro adds up: 6 reference images are 60 internal credits", () => {
    expect(approvedToolCostInternal("generateReferences", { count: 6 })).toBe(60);
  });

  it("BASE is single-image at the charging site, so a BASE ask never counts more than one", () => {
    // startRefGen: effectiveCount = mode === "REFSHEET" ? count : 1. Counting 6 here would refuse
    // approvals the ledger would have allowed — the one direction that is NOT safe.
    const one = pricedRefgenCredits({ model: "seedream", count: 1 });
    expect(approvedToolCostInternal("generateReferences", { count: 6, mode: "BASE" })).toBe(one);
    // REFSHEET is the schema default, explicit or not.
    expect(approvedToolCostInternal("generateReferences", { count: 6, mode: "REFSHEET" })).toBe(60);
    expect(approvedToolCostInternal("generateReferences", { count: 6 })).toBe(60);
  });

  it("a malformed or missing count reads as the schema default of 1 — the value the tool would run with", () => {
    const one = pricedRefgenCredits({ model: "seedream", count: 1 });
    for (const bad of [undefined, null, "6", 0, 7, 2.5, NaN]) {
      expect(approvedToolCostInternal("generateReferences", { count: bad })).toBe(one);
    }
  });

  it("costs it cannot know are ZERO, never a guess — under-counting falls through to the real gate", () => {
    // runFactoryBatch's charge depends on cells resolved later; approveScheduledPost spends nothing.
    expect(approvedToolCostInternal("runFactoryBatch", { batchId: "b1" })).toBe(0);
    expect(approvedToolCostInternal("approveScheduledPost", {})).toBe(0);
    expect(approvedToolCostInternal("somethingInventedTomorrow", { count: 6 })).toBe(0);
  });
});

describe("spendCapRefusal — the same reading as the gate, or nothing", () => {
  it("under the cap: says nothing and lets the real gates decide", async () => {
    expect(await spendCapRefusal(orgReading({ spendCapCredits: 50 }), "org_1", 100)).toBeNull();
  });

  it("no cap set (0 or absent settings) never refuses", async () => {
    expect(await spendCapRefusal(orgReading({ spendCapCredits: 0 }), "org_1", 10_000)).toBeNull();
    expect(await spendCapRefusal(orgReading(null), "org_1", 10_000)).toBeNull();
  });

  it("over the cap: names the full cost and the ceiling, in displayed credits", async () => {
    const msg = await spendCapRefusal(orgReading({ spendCapCredits: 5 }), "org_1", 100);
    expect(msg).toContain("spend cap");
    expect(msg).toContain(`this needs ${displayCredits(100)} credits`);
    expect(msg).toContain("your cap is 5 credits");
  });

  it("fails closed on a cap it cannot read — corrupted value, or no organization row", async () => {
    expect(await spendCapRefusal(orgReading({ spendCapCredits: "5" }), "org_1", 10)).toContain(
      "couldn't be read",
    );
    expect(await spendCapRefusal(orgReading(undefined), "org_1", 10)).toContain("couldn't be read");
  });

  it("a free action can never exceed a ceiling — no read, no refusal", async () => {
    const neverCalled = {
      organization: {
        findUnique: async () => {
          throw new Error("the preflight must not read for a zero-cost action");
        },
      },
    } as unknown as Parameters<typeof spendCapRefusal>[0];
    expect(await spendCapRefusal(neverCalled, "org_1", 0)).toBeNull();
  });
});

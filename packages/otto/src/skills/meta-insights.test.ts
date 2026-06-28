import { describe, it, expect } from "vitest";
import { metaInsightsSkill, executeMetaInsights } from "./meta-insights.js";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Helpers — mirror research-web.test.ts's makeCtx / makeRunCtx pattern
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<OttoContext>): OttoContext {
  return {
    orgId: "u1",
    userId: "u1",
    projectId: "p1",
    threadId: "t1",
    disabledModels: [],
    ...overrides,
  };
}

function makeRunCtx(ctx: OttoContext) {
  return { context: ctx };
}

// ---------------------------------------------------------------------------
// Gate assertions — cost/effect/reach/needsApproval (reads from OttoSkill directly)
// ---------------------------------------------------------------------------

describe("metaInsights skill — gate fields", () => {
  it("is free/read/external (no approval)", () => {
    expect(metaInsightsSkill.cost).toBe("free");
    expect(metaInsightsSkill.effect).toBe("read");
    expect(metaInsightsSkill.reach).toBe("external");
  });

  it("needsApproval is false (free + read + external → not gated)", () => {
    expect(metaInsightsSkill.needsApproval).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// executeMetaInsights — port absent
// ---------------------------------------------------------------------------

describe("executeMetaInsights — port absent", () => {
  it("returns a graceful message when the port is absent", async () => {
    const ctx = makeCtx(); // no metaInsights port
    const out = await executeMetaInsights({ datePreset: "last_30d" }, makeRunCtx(ctx));
    expect(JSON.stringify(out).toLowerCase()).toContain("connect");
  });
});

// ---------------------------------------------------------------------------
// executeMetaInsights — not connected / needs reconnect
// ---------------------------------------------------------------------------

describe("executeMetaInsights — connection states", () => {
  it("tells the user to connect when notConnected", async () => {
    const ctx = makeCtx({
      metaInsights: { get: async () => ({ notConnected: true as const }) },
    });
    const out = await executeMetaInsights({ datePreset: "last_30d" }, makeRunCtx(ctx));
    expect(JSON.stringify(out).toLowerCase()).toContain("connect");
  });

  it("tells the user to connect when needsReconnect", async () => {
    const ctx = makeCtx({
      metaInsights: { get: async () => ({ needsReconnect: true as const }) },
    });
    const out = await executeMetaInsights({ datePreset: "last_30d" }, makeRunCtx(ctx));
    expect(JSON.stringify(out).toLowerCase()).toContain("connect");
  });
});

// ---------------------------------------------------------------------------
// executeMetaInsights — connected
// ---------------------------------------------------------------------------

describe("executeMetaInsights — connected", () => {
  it("returns the metrics when connected", async () => {
    const accounts = [
      {
        accountId: "act_1",
        name: "Kaia Cafe",
        metrics: {
          spend: "120",
          impressions: "64312",
          reach: "35316",
          frequency: "1.82",
          clicks: "1775",
          ctr: "2.76",
          cpc: "0.71",
          cpm: "19.56",
          purchaseRoas: null,
        },
      },
    ];
    const ctx = makeCtx({
      metaInsights: { get: async () => ({ accounts }) },
    });
    const out = await executeMetaInsights({ datePreset: "last_30d" }, makeRunCtx(ctx));
    expect(JSON.stringify(out)).toContain("64312");
  });

  it("returns a graceful message when no accounts returned", async () => {
    const ctx = makeCtx({
      metaInsights: { get: async () => ({ accounts: [] }) },
    });
    const out = await executeMetaInsights({ datePreset: "last_7d" }, makeRunCtx(ctx));
    expect(JSON.stringify(out).toLowerCase()).toContain("connected");
  });
});

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
        currency: "MYR",
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

  it("#692: passes each account's currency through so Otto can name it in chat", async () => {
    const accounts = [
      { accountId: "act_1", name: "Kaia Cafe", currency: "MYR", metrics: { spend: "48.75" } },
      { accountId: "act_2", name: "Night Market", currency: "SGD", metrics: { spend: "33.10" } },
    ];
    const ctx = makeCtx({ metaInsights: { get: async () => ({ accounts }) } });
    const out = await executeMetaInsights({ datePreset: "last_30d" }, makeRunCtx(ctx));
    expect(JSON.stringify(out)).toContain("MYR");
    expect(JSON.stringify(out)).toContain("SGD");
  });

  // #692 r2 [P2]: pin the promise, not the word "currency".
  it("#692: the tool description forbids adding or comparing money across currencies", () => {
    const d = metaInsightsSkill.description;
    expect(d).toContain("Each account carries its own currency code");
    expect(d).toContain("never add or compare money across accounts in different currencies");
    expect(d).toContain("report one subtotal per currency instead");
  });

  it("returns a graceful message when no accounts returned", async () => {
    const ctx = makeCtx({
      metaInsights: { get: async () => ({ accounts: [] }) },
    });
    const out = await executeMetaInsights({ datePreset: "last_7d" }, makeRunCtx(ctx));
    expect(JSON.stringify(out).toLowerCase()).toContain("connected");
  });
});

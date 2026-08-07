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
  // #692 r3: the port now hands over FINISHED money text. These fixtures mirror that shape.
  const account = (accountId: string, name: string, currency: string | null, spend: string, bucket: string) => ({
    accountId, name, currency, moneyBucket: bucket,
    money: { spend, cpc: "—", cpm: "—" },
    metrics: { impressions: "64312", reach: "35316", frequency: "1.82", clicks: "1775", ctr: "2.76", purchaseRoas: null },
  });

  it("returns the metrics when connected", async () => {
    const accounts = [account("act_1", "Kaia Cafe", "MYR", "MYR 120", "MYR")];
    const ctx = makeCtx({ metaInsights: { get: async () => ({ accounts }) } });
    const out = await executeMetaInsights({ datePreset: "last_30d" }, makeRunCtx(ctx));
    expect(JSON.stringify(out)).toContain("64312");
  });

  it("#692: passes each account's currency through so Otto can name it in chat", async () => {
    const accounts = [
      account("act_1", "Kaia Cafe", "MYR", "MYR 48.75", "MYR"),
      account("act_2", "Night Market", "SGD", "SGD 33.10", "SGD"),
    ];
    const ctx = makeCtx({ metaInsights: { get: async () => ({ accounts }) } });
    const out = await executeMetaInsights({ datePreset: "last_30d" }, makeRunCtx(ctx));
    expect(JSON.stringify(out)).toContain("MYR");
    expect(JSON.stringify(out)).toContain("SGD");
  });

  // #692 r3 pin ①: the load-bearing one. Telling the model not to add is what failed three
  // times; what it receives must not be addable.
  it("#692 r3: hands the model no bare amount it could add across accounts", async () => {
    const accounts = [
      account("act_1", "Kaia Cafe", "MYR", "MYR 48.75", "MYR"),
      account("act_2", "Night Market", "SGD", "SGD 33.10", "SGD"),
    ];
    const ctx = makeCtx({ metaInsights: { get: async () => ({ accounts }) } });
    const out = (await executeMetaInsights({ datePreset: "last_30d" }, makeRunCtx(ctx))) as Record<string, unknown>;
    const emitted = (out.accounts as Record<string, unknown>[])[0]!;
    const money = emitted.money as Record<string, unknown>;
    expect(typeof money.spend).toBe("string");
    expect(String(money.spend)).not.toMatch(/^-?[\d,]+(\.\d+)?$/);
    expect((emitted.metrics as Record<string, unknown>).spend).toBeUndefined();
  });

  // #692 r3 pin ②: the rule travels WITH the data, as text the model actually sees, and it
  // covers the case two rounds of review kept missing — two accounts with no currency at all.
  it("#692 r3: the payload carries the bucket rule, including the unknown-currency case", async () => {
    const accounts = [
      account("act_1", "Kaia Cafe", null, "1240 (currency not reported — Kaia Cafe)", "unknown:act_1"),
      account("act_2", "Night Market", null, "990 (currency not reported — Night Market)", "unknown:act_2"),
    ];
    const ctx = makeCtx({ metaInsights: { get: async () => ({ accounts }) } });
    const out = (await executeMetaInsights({ datePreset: "last_30d" }, makeRunCtx(ctx))) as Record<string, unknown>;
    const rule = String(out.moneyRule);
    expect(rule).toContain("moneyBucket");
    expect(rule).toContain("never add, rank or compare");
    expect(rule).toContain("no currency");
    const emitted = out.accounts as Record<string, unknown>[];
    expect((emitted[0]!.money as Record<string, string>).spend)
      .toBe("1240 (currency not reported — Kaia Cafe)");
    expect((emitted[1]!.money as Record<string, string>).spend)
      .toBe("990 (currency not reported — Night Market)");
    expect(emitted[0]!.moneyBucket).not.toBe(emitted[1]!.moneyBucket);
    expect(JSON.stringify(out)).not.toContain("2230"); // 1240 + 990
  });

  it("returns a graceful message when no accounts returned", async () => {
    const ctx = makeCtx({
      metaInsights: { get: async () => ({ accounts: [] }) },
    });
    const out = await executeMetaInsights({ datePreset: "last_7d" }, makeRunCtx(ctx));
    expect(JSON.stringify(out).toLowerCase()).toContain("connected");
  });

  // #692 r2 [P2] + r3: pin the promise, not the word "currency" — and pin the clause that
  // covers what two review rounds kept missing: accounts with no reported currency at all.
  it("#692: the tool description forbids adding or comparing money across buckets", () => {
    const d = metaInsightsSkill.description;
    expect(d).toContain("already formatted");
    expect(d).toContain("never add, rank or compare money across different moneyBucket values");
    expect(d).toContain("no currency");
    expect(d).toContain("Ratio metrics (CTR, ROAS) and counts");
    expect(d).toContain("ARE comparable across accounts");
  });
});

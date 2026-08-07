import { describe, it, expect } from "vitest";
import { toOttoInsightAccounts, toOttoAdRows } from "../otto-money-view";
import type { AccountInsights } from "../meta-insights";
import type { OwnerAdRow } from "../meta-performance";

// --- helpers ----------------------------------------------------------------

const metrics = (over: Record<string, string | null> = {}) => ({
  spend: "612", impressions: "9120", reach: "6400", frequency: "1.43",
  clicks: "286", ctr: "3.14", cpc: "0.11", cpm: "3.42", purchaseRoas: "3.8",
  ...over,
});

const account = (
  accountId: string,
  name: string,
  currency: string | null,
  over: Record<string, string | null> = {},
): AccountInsights => ({ accountId, name, currency, metrics: metrics(over) as AccountInsights["metrics"] });

const ad = (
  adId: string,
  accountId: string,
  accountName: string | null,
  currency: string | null,
  over: Record<string, string | null> = {},
): OwnerAdRow => ({
  adId, adName: adId, accountId, accountName, currency,
  metrics: metrics(over), creative: null,
});

/** Every leaf value in the payload, so a shape assertion can't be dodged by nesting. */
function leaves(value: unknown, path = ""): { path: string; value: unknown }[] {
  if (value === null || typeof value !== "object") return [{ path, value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
}

// ---------------------------------------------------------------------------
// #692 r3 [P1] — the load-bearing pin. Three rounds of telling the model "don't add
// these" failed. What reaches the model must not BE addable: every money figure crosses
// this boundary as finished text, so there is no bare amount to sum across accounts.
describe("Otto money boundary — no summable amount reaches the model (#692 r3)", () => {
  const twoCurrencies = [
    account("act_1", "Kaia Cafe", "MYR", { spend: "48.75", cpc: "0.12", cpm: "2.66" }),
    account("act_2", "Night Market", "SGD", { spend: "33.10", cpc: "0.20", cpm: "3.00" }),
  ];

  it("no money field survives as a number or a bare numeric string", () => {
    const out = toOttoInsightAccounts(twoCurrencies);
    for (const { path, value } of leaves(out)) {
      const isMoneyPath = /(^|\.)money\./.test(path) || /spend|cpc|cpm/i.test(path);
      if (!isMoneyPath) continue;
      expect(typeof value).toBe("string");
      // a bare numeric string is exactly what could be parsed back and summed
      expect(String(value)).not.toMatch(/^-?[\d,]+(\.\d+)?$/);
    }
  });

  it("the account object exposes no `spend`, `cpc` or `cpm` key of its own", () => {
    const out = toOttoInsightAccounts(twoCurrencies);
    const keys = leaves(out).map((l) => l.path);
    expect(keys.some((k) => /\.metrics\.spend$/.test(k))).toBe(false);
    expect(keys.some((k) => /\.metrics\.cpc$/.test(k))).toBe(false);
    expect(keys.some((k) => /\.metrics\.cpm$/.test(k))).toBe(false);
  });

  it("known currencies arrive as finished text carrying their code", () => {
    const out = toOttoInsightAccounts(twoCurrencies);
    expect(out[0]!.money.spend).toBe("MYR 48.75");
    expect(out[0]!.money.cpc).toBe("MYR 0.12");
    expect(out[1]!.money.spend).toBe("SGD 33.10");
    expect(out[0]!.moneyBucket).toBe("MYR");
    expect(out[1]!.moneyBucket).toBe("SGD");
  });

  it("counts and ratios stay numeric — those ARE comparable across accounts", () => {
    const out = toOttoInsightAccounts(twoCurrencies);
    expect(out[0]!.metrics.reach).toBe("6400");
    expect(out[0]!.metrics.ctr).toBe("3.14");
    expect(out[0]!.metrics.purchaseRoas).toBe("3.8");
    expect(out[0]!.metrics.clicks).toBe("286");
  });

  it("a money value Meta never sent renders — , not an empty currency code", () => {
    const out = toOttoInsightAccounts([account("act_1", "Kaia Cafe", "MYR", { spend: null, cpc: "n/a" })]);
    expect(out[0]!.money.spend).toBe("—");
    expect(out[0]!.money.cpc).toBe("—");
  });
});

// #692 r3 pin ② — two accounts Meta reported no currency for.
describe("Otto money boundary — accounts with no reported currency (#692 r3)", () => {
  const twoUnknown = [
    account("act_1", "Kaia Cafe", null, { spend: "1240" }),
    account("act_2", "Night Market", null, { spend: "990" }),
  ];

  it("each unlabelled figure names its own account, and the two never share a bucket", () => {
    const out = toOttoInsightAccounts(twoUnknown);
    expect(out[0]!.money.spend).toBe("1240 (currency not reported — Kaia Cafe)");
    expect(out[1]!.money.spend).toBe("990 (currency not reported — Night Market)");
    expect(out[0]!.moneyBucket).not.toBe(out[1]!.moneyBucket);
  });

  it("their figures are still not bare numbers the model could add", () => {
    const out = toOttoInsightAccounts(twoUnknown);
    expect(out[0]!.money.spend).not.toMatch(/^-?[\d,]+(\.\d+)?$/);
    expect(JSON.stringify(out)).not.toContain("2230"); // 1240 + 990
  });

  it("an account with a blank name falls back to its id so the figure is still placed", () => {
    const out = toOttoInsightAccounts([account("act_77", "  ", null, { spend: "5" })]);
    expect(out[0]!.money.spend).toBe("5 (currency not reported — act_77)");
  });
});

// ---------------------------------------------------------------------------
describe("Otto money boundary — per-ad rows (#692 r3)", () => {
  it("per-ad money is finished text too, and no numeric spend survives", () => {
    const out = toOttoAdRows([ad("a1", "act_1", "Kaia Cafe", "MYR", { spend: "31.20", cpc: "0.11" })]);
    expect(out[0]!.money.spend).toBe("MYR 31.20");
    expect(out[0]!.money.cpc).toBe("MYR 0.11");
    const keys = leaves(out).map((l) => l.path);
    expect(keys.some((k) => /\.metrics\.spend$/.test(k))).toBe(false);
  });

  it("carries hasSpend so the diagnosis can still tell a live ad from a dormant one", () => {
    const spent = toOttoAdRows([ad("a1", "act_1", "Kaia Cafe", "MYR", { spend: "31.20" })]);
    const dormant = toOttoAdRows([ad("a2", "act_1", "Kaia Cafe", "MYR", { spend: "0" })]);
    const missing = toOttoAdRows([ad("a3", "act_1", "Kaia Cafe", "MYR", { spend: null })]);
    expect(spent[0]!.hasSpend).toBe(true);
    expect(dormant[0]!.hasSpend).toBe(false);
    expect(missing[0]!.hasSpend).toBe(false);
  });

  it("two unlabelled ad accounts get separate buckets and self-naming figures", () => {
    const out = toOttoAdRows([
      ad("a1", "act_1", "Kaia Cafe", null, { spend: "20" }),
      ad("b1", "act_2", "Night Market", null, { spend: "30" }),
    ]);
    expect(out[0]!.money.spend).toBe("20 (currency not reported — Kaia Cafe)");
    expect(out[1]!.money.spend).toBe("30 (currency not reported — Night Market)");
    expect(out[0]!.moneyBucket).not.toBe(out[1]!.moneyBucket);
  });

  it("ratios and the creative ride through untouched", () => {
    const out = toOttoAdRows([ad("a1", "act_1", "Kaia Cafe", "MYR")]);
    expect(out[0]!.metrics.ctr).toBe("3.14");
    expect(out[0]!.metrics.purchaseRoas).toBe("3.8");
    expect(out[0]!.creative).toBeNull();
  });
});
